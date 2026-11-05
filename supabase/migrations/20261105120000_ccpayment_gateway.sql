-- CCPayment hosted crypto checkout settlement.
-- Webhooks are notifications only: the API route re-queries CCPayment with a
-- signed server request before invoking this service-role-only function.

CREATE OR REPLACE FUNCTION public.apply_ccpayment_invoice_update(
  p_event_key TEXT,
  p_invoice_id UUID,
  p_payment_status TEXT,
  p_price_value NUMERIC,
  p_price_symbol TEXT,
  p_paid_value NUMERIC,
  p_pay_currency TEXT,
  p_tx_hash TEXT,
  p_risky BOOLEAN,
  p_payload_hash TEXT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_invoice public.crypto_deposit_invoices%ROWTYPE;
  v_cash NUMERIC(18,2);
  v_bonus NUMERIC(18,2);
  v_balance NUMERIC(18,2);
  v_deposit_limit NUMERIC(15,2);
  v_month_deposits NUMERIC(15,2);
  v_transaction UUID;
  v_status TEXT;
  v_asset TEXT;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Service authorization required';
  END IF;

  IF p_event_key IS NULL OR p_invoice_id IS NULL OR p_payload_hash IS NULL THEN
    RAISE EXCEPTION 'Invalid CCPayment event';
  END IF;

  v_status := CASE lower(COALESCE(p_payment_status, ''))
    WHEN 'processing' THEN 'confirming'
    WHEN 'success' THEN 'completed'
    WHEN 'failed' THEN 'failed'
    WHEN 'risky' THEN 'failed'
    ELSE NULL
  END;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Unsupported CCPayment status';
  END IF;

  v_asset := left(regexp_replace(lower(COALESCE(p_pay_currency, 'multi')), '[^a-z0-9]', '', 'g'), 20);
  IF char_length(v_asset) < 2 THEN v_asset := 'multi'; END IF;

  INSERT INTO public.crypto_webhook_events(
    provider,
    event_key,
    provider_payment_id,
    payment_status,
    signature_verified,
    payload_hash,
    payload
  )
  VALUES(
    'ccpayment',
    p_event_key,
    p_invoice_id::TEXT,
    p_payment_status,
    TRUE,
    p_payload_hash,
    p_payload
  )
  ON CONFLICT(provider, event_key) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', TRUE, 'duplicate', TRUE);
  END IF;

  SELECT *
  INTO v_invoice
  FROM public.crypto_deposit_invoices
  WHERE id = p_invoice_id
    AND provider = 'ccpayment'
    AND provider_payment_id = p_invoice_id::TEXT
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CCPayment invoice not found';
  END IF;

  IF upper(COALESCE(p_price_symbol, '')) <> v_invoice.fiat_currency
     OR ABS(COALESCE(p_price_value, 0) - v_invoice.fiat_amount) > 0.01 THEN
    RAISE EXCEPTION 'CCPayment order does not match the deposit invoice';
  END IF;

  IF COALESCE(p_risky, FALSE) OR v_status = 'failed' THEN
    IF v_invoice.wallet_transaction_id IS NULL THEN
      UPDATE public.crypto_deposit_invoices
      SET status = 'failed',
          pay_currency = v_asset,
          actually_paid = GREATEST(COALESCE(p_paid_value, 0), 0),
          tx_hash = COALESCE(NULLIF(p_tx_hash, ''), tx_hash),
          provider_payload = p_payload,
          updated_at = NOW()
      WHERE id = v_invoice.id;
    END IF;
    RETURN jsonb_build_object(
      'success', TRUE,
      'duplicate', FALSE,
      'status', 'failed',
      'risky', COALESCE(p_risky, FALSE)
    );
  END IF;

  IF v_status = 'confirming' THEN
    IF v_invoice.status NOT IN ('completed', 'refunded') THEN
      UPDATE public.crypto_deposit_invoices
      SET status = 'confirming',
          pay_currency = v_asset,
          actually_paid = GREATEST(COALESCE(p_paid_value, 0), 0),
          tx_hash = COALESCE(NULLIF(p_tx_hash, ''), tx_hash),
          provider_payload = p_payload,
          updated_at = NOW()
      WHERE id = v_invoice.id;
    END IF;
    RETURN jsonb_build_object('success', TRUE, 'duplicate', FALSE, 'status', 'confirming');
  END IF;

  IF COALESCE(p_paid_value, 0) + 0.00000001 < v_invoice.fiat_amount THEN
    RAISE EXCEPTION 'CCPayment order is underpaid';
  END IF;

  IF v_invoice.wallet_transaction_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', TRUE, 'duplicate', TRUE, 'status', 'completed');
  END IF;

  SELECT deposit_limit
  INTO v_deposit_limit
  FROM public.profiles
  WHERE id = v_invoice.user_id
    AND COALESCE(is_admin, FALSE) = FALSE
    AND COALESCE(is_suspended, FALSE) = FALSE
    AND COALESCE(wallet_frozen, FALSE) = FALSE
    AND COALESCE(deposits_disabled, FALSE) = FALSE
    AND COALESCE(account_status, 'active') <> 'closed'
    AND (self_exclusion_until IS NULL OR self_exclusion_until <= NOW())
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account is not eligible for deposits';
  END IF;

  SELECT COALESCE(SUM(fiat_amount), 0)
  INTO v_month_deposits
  FROM public.crypto_deposit_invoices
  WHERE user_id = v_invoice.user_id
    AND status = 'completed'
    AND completed_at >= date_trunc('month', NOW());

  IF v_deposit_limit IS NOT NULL
     AND v_month_deposits + v_invoice.fiat_amount > v_deposit_limit THEN
    RAISE EXCEPTION 'Monthly deposit limit would be exceeded';
  END IF;

  PERFORM public.ensure_user_ledger_accounts_from_id(v_invoice.user_id, 0);

  SELECT
    COALESCE(MAX(balance) FILTER (WHERE account_code = 'cash'), 0),
    COALESCE(MAX(balance) FILTER (WHERE account_code = 'bonus'), 0)
  INTO v_cash, v_bonus
  FROM public.ledger_accounts
  WHERE user_id = v_invoice.user_id
    AND currency = 'USD';

  v_balance := COALESCE(v_cash, 0) + COALESCE(v_bonus, 0);

  INSERT INTO public.wallet_transactions(
    user_id,
    type,
    amount,
    balance_before,
    balance_after,
    description,
    reference_id,
    status,
    metadata
  )
  VALUES(
    v_invoice.user_id,
    'deposit',
    v_invoice.fiat_amount,
    v_balance,
    v_balance + v_invoice.fiat_amount,
    'CCPayment crypto deposit',
    v_invoice.id,
    'completed',
    jsonb_build_object(
      'provider', 'ccpayment',
      'asset', v_asset,
      'provider_payment_id', p_invoice_id::TEXT,
      'tx_hash', NULLIF(p_tx_hash, ''),
      'reconciled', TRUE
    )
  )
  RETURNING id INTO v_transaction;

  UPDATE public.crypto_deposit_invoices
  SET status = 'completed',
      pay_currency = v_asset,
      actually_paid = p_paid_value,
      tx_hash = NULLIF(p_tx_hash, ''),
      wallet_transaction_id = v_transaction,
      completed_at = NOW(),
      provider_payload = p_payload,
      updated_at = NOW()
  WHERE id = v_invoice.id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'duplicate', FALSE,
    'status', 'completed',
    'invoiceId', v_invoice.id,
    'transactionId', v_transaction
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_ccpayment_invoice_update(
  TEXT, UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, BOOLEAN, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_ccpayment_invoice_update(
  TEXT, UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, BOOLEAN, TEXT, JSONB
) TO service_role;

COMMENT ON FUNCTION public.apply_ccpayment_invoice_update(
  TEXT, UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, BOOLEAN, TEXT, JSONB
) IS 'Idempotently settles an API-reconciled CCPayment invoice into the authoritative wallet ledger.';

NOTIFY pgrst, 'reload schema';
