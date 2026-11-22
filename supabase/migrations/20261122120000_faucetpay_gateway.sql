-- Replace CCPayment with a verified FaucetPay hosted Merchant checkout.
-- Run this migration before enabling FaucetPay in Admin -> Payments.

BEGIN;

ALTER TABLE public.crypto_deposit_invoices
  DROP CONSTRAINT IF EXISTS crypto_deposit_invoices_fiat_currency_check;
ALTER TABLE public.crypto_deposit_invoices
  ADD CONSTRAINT crypto_deposit_invoices_fiat_currency_check
  CHECK (fiat_currency ~ '^[A-Z0-9]{2,12}$');

ALTER TABLE public.crypto_deposit_invoices
  DROP CONSTRAINT IF EXISTS crypto_deposit_invoices_status_check;
ALTER TABLE public.crypto_deposit_invoices
  ADD CONSTRAINT crypto_deposit_invoices_status_check CHECK (status IN (
    'creating', 'waiting', 'confirming', 'partially_paid', 'completed',
    'review_required', 'expired', 'failed', 'refunded'
  ));

CREATE TABLE IF NOT EXISTS public.payment_provider_configs (
  provider_code TEXT PRIMARY KEY CHECK (provider_code ~ '^[a-z0-9_]{2,40}$'),
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  public_config JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(public_config) = 'object'),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.payment_provider_configs IS
  'Service-role-only runtime configuration for payment providers. Never store API keys or webhook secrets here.';
COMMENT ON COLUMN public.payment_provider_configs.public_config IS
  'Non-secret provider settings only. Secrets belong in encrypted server storage or environment variables.';

ALTER TABLE public.payment_provider_configs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_provider_configs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payment_provider_configs TO service_role;

INSERT INTO public.payment_provider_configs(provider_code, is_enabled, public_config)
VALUES (
  'faucetpay',
  FALSE,
  jsonb_build_object(
    'merchant_username', '',
    'price_currency', 'USDT',
    'pay_currency', '',
    'site_url', ''
  )
)
ON CONFLICT(provider_code) DO NOTHING;

UPDATE public.payment_methods
SET
  is_enabled = FALSE,
  archived_at = COALESCE(archived_at, NOW()),
  updated_at = NOW()
WHERE regexp_replace(lower(COALESCE(code, '')), '[^a-z0-9]', '', 'g') IN ('ccpayment', 'ccpayments')
   OR regexp_replace(lower(COALESCE(provider_code, '')), '[^a-z0-9]', '', 'g') IN ('ccpayment', 'ccpayments')
   OR regexp_replace(lower(COALESCE(name, '')), '[^a-z0-9]', '', 'g') IN (
     'ccpayment', 'ccpayments', 'ccpaymentcryptocheckout', 'ccpaymenthostedcryptocheckout'
   );

INSERT INTO public.payment_methods(
  name, code, method_type, provider_code, currency, network, instructions,
  min_amount, max_amount, is_enabled, display_order
)
VALUES(
  'FaucetPay', 'faucetpay', 'provider', 'faucetpay', 'USDT', NULL,
  'Secure hosted FaucetPay checkout. Credit is applied only after server-side token verification.',
  10, 100000, FALSE, 15
)
ON CONFLICT(code) DO UPDATE SET
  name = 'FaucetPay',
  method_type = 'provider',
  provider_code = 'faucetpay',
  archived_at = NULL,
  updated_at = NOW();

CREATE OR REPLACE FUNCTION public.is_active_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND COALESCE(is_admin, FALSE) = TRUE
      AND admin_role = 'super_admin'
      AND COALESCE(is_suspended, FALSE) = FALSE
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_super_admin() TO authenticated, service_role;

DROP POLICY IF EXISTS "users_read_enabled_payment_methods" ON public.payment_methods;
CREATE POLICY "users_read_enabled_payment_methods" ON public.payment_methods
  FOR SELECT TO authenticated
  USING (
    (
      is_enabled = TRUE
      AND archived_at IS NULL
      AND (
        COALESCE(provider_code, '') <> 'faucetpay'
        AND code <> 'faucetpay'
        OR NOT EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND COALESCE(is_admin, FALSE) = TRUE
        )
        OR public.is_active_super_admin()
      )
    )
    OR (
      public.has_admin_role(ARRAY['finance'])
      AND (
        COALESCE(provider_code, '') <> 'faucetpay'
        AND code <> 'faucetpay'
        OR public.is_active_super_admin()
      )
    )
  );

CREATE OR REPLACE FUNCTION public.save_faucetpay_provider_config(
  p_actor UUID,
  p_enabled BOOLEAN,
  p_merchant_username TEXT,
  p_price_currency TEXT,
  p_pay_currency TEXT,
  p_site_url TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merchant_username TEXT := trim(COALESCE(p_merchant_username, ''));
  v_price_currency TEXT := upper(trim(COALESCE(p_price_currency, '')));
  v_pay_currency TEXT := upper(trim(COALESCE(p_pay_currency, '')));
  v_site_url TEXT := trim(trailing '/' FROM trim(COALESCE(p_site_url, '')));
  v_method_id UUID;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = p_actor
      AND COALESCE(is_admin, FALSE) = TRUE
      AND admin_role = 'super_admin'
      AND COALESCE(is_suspended, FALSE) = FALSE
  ) THEN
    RAISE EXCEPTION 'Super admin authorization required';
  END IF;

  IF length(v_merchant_username) NOT BETWEEN 1 AND 180 THEN
    RAISE EXCEPTION 'FaucetPay merchant username is required';
  END IF;
  IF v_price_currency NOT IN ('USD', 'USDT') THEN
    RAISE EXCEPTION 'FaucetPay price currency must be USD or USDT';
  END IF;
  IF v_pay_currency <> '' AND v_pay_currency !~ '^[A-Z0-9]{2,12}$' THEN
    RAISE EXCEPTION 'Invalid FaucetPay payment coin';
  END IF;
  IF length(v_site_url) > 2048 OR NOT (
    v_site_url ~* '^https://[a-z0-9.-]+(:[0-9]{1,5})?$'
    OR v_site_url ~* '^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$'
  ) THEN
    RAISE EXCEPTION 'A valid HTTPS FaucetPay site URL is required';
  END IF;

  INSERT INTO public.payment_provider_configs(
    provider_code, is_enabled, public_config, updated_by, updated_at
  )
  VALUES (
    'faucetpay',
    COALESCE(p_enabled, FALSE),
    jsonb_build_object(
      'merchant_username', v_merchant_username,
      'price_currency', v_price_currency,
      'pay_currency', v_pay_currency,
      'site_url', v_site_url
    ),
    p_actor,
    NOW()
  )
  ON CONFLICT(provider_code) DO UPDATE SET
    is_enabled = EXCLUDED.is_enabled,
    public_config = EXCLUDED.public_config,
    updated_by = EXCLUDED.updated_by,
    updated_at = NOW();

  INSERT INTO public.payment_methods(
    name, code, method_type, provider_code, currency, network, instructions,
    min_amount, max_amount, is_enabled, display_order, created_by, updated_by
  )
  VALUES (
    'FaucetPay', 'faucetpay', 'provider', 'faucetpay', v_price_currency, NULL,
    'Secure hosted FaucetPay checkout. Credit is applied only after server-side token verification.',
    10, 100000, COALESCE(p_enabled, FALSE), 15, p_actor, p_actor
  )
  ON CONFLICT(code) DO UPDATE SET
    name = EXCLUDED.name,
    method_type = 'provider',
    provider_code = 'faucetpay',
    currency = EXCLUDED.currency,
    is_enabled = EXCLUDED.is_enabled,
    archived_at = NULL,
    updated_by = p_actor,
    updated_at = NOW()
  RETURNING id INTO v_method_id;

  INSERT INTO public.audit_logs(admin_id, action, entity_type, entity_id, changes)
  VALUES (
    p_actor,
    'faucetpay_provider_config_update',
    'payment_provider',
    v_method_id,
    jsonb_build_object(
      'provider_code', 'faucetpay',
      'fields', jsonb_build_array(
        'enabled', 'merchant_username', 'price_currency', 'pay_currency', 'site_url'
      ),
      'enabled', COALESCE(p_enabled, FALSE),
      'credential_changed', FALSE
    )
  );

  RETURN jsonb_build_object(
    'providerCode', 'faucetpay',
    'enabled', COALESCE(p_enabled, FALSE),
    'merchantUsername', v_merchant_username,
    'priceCurrency', v_price_currency,
    'payCurrency', v_pay_currency,
    'siteUrl', v_site_url,
    'configured', TRUE,
    'source', 'database',
    'callbackUrl', v_site_url || '/api/payments/faucetpay/callback'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_faucetpay_provider_config(
  UUID, BOOLEAN, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_faucetpay_provider_config(
  UUID, BOOLEAN, TEXT, TEXT, TEXT, TEXT
) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_faucetpay_deposit_update(
  p_event_key TEXT,
  p_provider_payment_id TEXT,
  p_invoice_id UUID,
  p_amount1 NUMERIC,
  p_currency1 TEXT,
  p_amount2 NUMERIC,
  p_currency2 TEXT,
  p_payer_username TEXT,
  p_payload_hash TEXT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice public.crypto_deposit_invoices%ROWTYPE;
  v_cash NUMERIC(18,2);
  v_bonus NUMERIC(18,2);
  v_balance NUMERIC(18,2);
  v_deposit_limit NUMERIC(15,2);
  v_month_crypto NUMERIC(15,2);
  v_month_manual NUMERIC(15,2);
  v_month_deposits NUMERIC(15,2);
  v_transaction UUID;
  v_safe_payload JSONB := COALESCE(p_payload, '{}'::JSONB) - 'token';
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Service authorization required';
  END IF;
  IF NULLIF(trim(COALESCE(p_event_key, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_provider_payment_id, '')), '') IS NULL
     OR p_invoice_id IS NULL
     OR p_amount1 IS NULL OR p_amount1 <= 0
     OR p_amount2 IS NULL OR p_amount2 <= 0
     OR upper(trim(COALESCE(p_currency1, ''))) !~ '^[A-Z0-9]{2,12}$'
     OR upper(trim(COALESCE(p_currency2, ''))) !~ '^[A-Z0-9]{2,12}$'
     OR NULLIF(trim(COALESCE(p_payload_hash, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Invalid verified FaucetPay event';
  END IF;

  INSERT INTO public.crypto_webhook_events(
    provider, event_key, provider_payment_id, payment_status,
    signature_verified, payload_hash, payload
  )
  VALUES (
    'faucetpay', trim(p_event_key), trim(p_provider_payment_id), 'completed',
    TRUE, trim(p_payload_hash), v_safe_payload
  )
  ON CONFLICT(provider, event_key) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', TRUE, 'duplicate', TRUE);
  END IF;

  SELECT *
  INTO v_invoice
  FROM public.crypto_deposit_invoices
  WHERE id = p_invoice_id
    AND provider = 'faucetpay'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FaucetPay deposit invoice not found';
  END IF;
  IF upper(trim(p_currency1)) <> upper(v_invoice.fiat_currency)
     OR round(p_amount1, 2) <> round(v_invoice.fiat_amount, 2) THEN
    RAISE EXCEPTION 'FaucetPay payment does not match the deposit invoice';
  END IF;
  IF v_invoice.provider_payment_id IS NOT NULL
     AND v_invoice.provider_payment_id <> trim(p_provider_payment_id) THEN
    RAISE EXCEPTION 'FaucetPay invoice already belongs to another transaction';
  END IF;
  IF v_invoice.wallet_transaction_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'duplicate', TRUE,
      'status', v_invoice.status,
      'invoiceId', v_invoice.id
    );
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
    UPDATE public.crypto_deposit_invoices
    SET provider_payment_id = trim(p_provider_payment_id),
        status = 'review_required',
        pay_currency = lower(trim(p_currency2)),
        pay_amount = p_amount2,
        actually_paid = p_amount2,
        provider_payload = v_safe_payload,
        updated_at = NOW()
    WHERE id = v_invoice.id;

    RETURN jsonb_build_object(
      'success', TRUE,
      'duplicate', FALSE,
      'status', 'review_required',
      'reason', 'account_ineligible',
      'invoiceId', v_invoice.id
    );
  END IF;

  SELECT COALESCE(SUM(fiat_amount), 0)
  INTO v_month_crypto
  FROM public.crypto_deposit_invoices
  WHERE user_id = v_invoice.user_id
    AND status = 'completed'
    AND completed_at >= date_trunc('month', NOW());

  SELECT COALESCE(SUM(amount), 0)
  INTO v_month_manual
  FROM public.manual_deposit_requests
  WHERE user_id = v_invoice.user_id
    AND status = 'approved'
    AND reviewed_at >= date_trunc('month', NOW());

  v_month_deposits := COALESCE(v_month_crypto, 0) + COALESCE(v_month_manual, 0);

  IF v_deposit_limit IS NOT NULL
     AND v_month_deposits + v_invoice.fiat_amount > v_deposit_limit THEN
    UPDATE public.crypto_deposit_invoices
    SET provider_payment_id = trim(p_provider_payment_id),
        status = 'review_required',
        pay_currency = lower(trim(p_currency2)),
        pay_amount = p_amount2,
        actually_paid = p_amount2,
        provider_payload = v_safe_payload,
        updated_at = NOW()
    WHERE id = v_invoice.id;

    RETURN jsonb_build_object(
      'success', TRUE,
      'duplicate', FALSE,
      'status', 'review_required',
      'reason', 'deposit_limit',
      'invoiceId', v_invoice.id
    );
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
    user_id, type, amount, balance_before, balance_after, description,
    reference_id, status, metadata
  )
  VALUES (
    v_invoice.user_id,
    'deposit',
    v_invoice.fiat_amount,
    v_balance,
    v_balance + v_invoice.fiat_amount,
    'Verified FaucetPay merchant deposit',
    v_invoice.id,
    'completed',
    jsonb_build_object(
      'provider', 'faucetpay',
      'provider_payment_id', trim(p_provider_payment_id),
      'payer_username', NULLIF(trim(COALESCE(p_payer_username, '')), ''),
      'paid_currency', upper(trim(p_currency2)),
      'paid_amount', p_amount2,
      'reconciled', TRUE
    )
  )
  RETURNING id INTO v_transaction;

  UPDATE public.crypto_deposit_invoices
  SET provider_payment_id = trim(p_provider_payment_id),
      status = 'completed',
      pay_currency = lower(trim(p_currency2)),
      pay_amount = p_amount2,
      actually_paid = p_amount2,
      wallet_transaction_id = v_transaction,
      completed_at = NOW(),
      provider_payload = v_safe_payload,
      updated_at = NOW()
  WHERE id = v_invoice.id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'duplicate', FALSE,
    'status', 'completed',
    'invoiceId', v_invoice.id,
    'walletTransactionId', v_transaction
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_faucetpay_deposit_update(
  TEXT, TEXT, UUID, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_faucetpay_deposit_update(
  TEXT, TEXT, UUID, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB
) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_restricted_payment_method_mutations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_jwt_role TEXT := auth.role();
  v_touches_ccpayment BOOLEAN := FALSE;
  v_touches_faucetpay BOOLEAN := FALSE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_touches_ccpayment :=
      regexp_replace(lower(COALESCE(OLD.code, '')), '[^a-z0-9]', '', 'g') IN ('ccpayment', 'ccpayments')
      OR regexp_replace(lower(COALESCE(OLD.provider_code, '')), '[^a-z0-9]', '', 'g') IN ('ccpayment', 'ccpayments')
      OR regexp_replace(lower(COALESCE(OLD.name, '')), '[^a-z0-9]', '', 'g') IN (
        'ccpayment', 'ccpayments', 'ccpaymentcryptocheckout', 'ccpaymenthostedcryptocheckout'
      );
    v_touches_faucetpay :=
      regexp_replace(lower(COALESCE(OLD.code, '')), '[^a-z0-9]', '', 'g') = 'faucetpay'
      OR regexp_replace(lower(COALESCE(OLD.provider_code, '')), '[^a-z0-9]', '', 'g') = 'faucetpay';
  END IF;

  IF TG_OP <> 'DELETE' THEN
    v_touches_ccpayment := v_touches_ccpayment
      OR regexp_replace(lower(COALESCE(NEW.code, '')), '[^a-z0-9]', '', 'g') IN ('ccpayment', 'ccpayments')
      OR regexp_replace(lower(COALESCE(NEW.provider_code, '')), '[^a-z0-9]', '', 'g') IN ('ccpayment', 'ccpayments')
      OR regexp_replace(lower(COALESCE(NEW.name, '')), '[^a-z0-9]', '', 'g') IN (
        'ccpayment', 'ccpayments', 'ccpaymentcryptocheckout', 'ccpaymenthostedcryptocheckout'
      );
    v_touches_faucetpay := v_touches_faucetpay
      OR regexp_replace(lower(COALESCE(NEW.code, '')), '[^a-z0-9]', '', 'g') = 'faucetpay'
      OR regexp_replace(lower(COALESCE(NEW.provider_code, '')), '[^a-z0-9]', '', 'g') = 'faucetpay';
  END IF;

  IF v_touches_ccpayment AND v_jwt_role IS NOT NULL THEN
    RAISE EXCEPTION 'CCPayment has been retired';
  END IF;

  IF v_touches_faucetpay
     AND COALESCE(v_jwt_role, '') <> 'service_role'
     AND v_jwt_role IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.profiles
       WHERE id = v_actor
         AND COALESCE(is_admin, FALSE) = TRUE
         AND admin_role = 'super_admin'
         AND COALESCE(is_suspended, FALSE) = FALSE
     ) THEN
    RAISE EXCEPTION 'Only an active Super Admin can manage FaucetPay';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_restricted_payment_method_mutations() FROM PUBLIC;

DROP TRIGGER IF EXISTS guard_restricted_payment_method_mutations ON public.payment_methods;
CREATE TRIGGER guard_restricted_payment_method_mutations
BEFORE INSERT OR UPDATE OR DELETE ON public.payment_methods
FOR EACH ROW
EXECUTE FUNCTION public.guard_restricted_payment_method_mutations();

COMMENT ON FUNCTION public.apply_faucetpay_deposit_update(
  TEXT, TEXT, UUID, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB
) IS 'Idempotently settles a token-verified FaucetPay payment into the authoritative wallet ledger.';
COMMENT ON FUNCTION public.guard_restricted_payment_method_mutations() IS
  'Retires CCPayment and restricts FaucetPay payment-method administration to active Super Admins or service role.';

NOTIFY pgrst, 'reload schema';

COMMIT;
