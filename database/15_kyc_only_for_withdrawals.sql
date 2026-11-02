-- KYC is required only when a customer requests a withdrawal.
-- Signup, login, deposits, sportsbook, casino, Aviator, Mines and broker applications
-- remain available to active, non-suspended customers. KYC records/statuses are preserved.
-- The existing submit_manual_withdrawal_request function is intentionally NOT replaced:
-- it continues to require profiles.kyc_status = 'approved'.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS kyc_activation_override BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.profiles
  ALTER COLUMN account_status SET DEFAULT 'active';

ALTER TABLE public.profiles
  ALTER COLUMN kyc_activation_override SET DEFAULT TRUE;

CREATE OR REPLACE FUNCTION public.sync_customer_kyc_activation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
  IF COALESCE(NEW.is_admin,FALSE) THEN
    NEW.account_status := 'active';
    RETURN NEW;
  END IF;

  IF NEW.account_status='closed' THEN
    RETURN NEW;
  END IF;

  -- KYC no longer controls general account activation. Withdrawal RPCs
  -- continue to require exact approved KYC.
  NEW.account_status := 'active';
  NEW.kyc_activation_override := TRUE;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS z_sync_customer_kyc_activation ON public.profiles;
CREATE TRIGGER z_sync_customer_kyc_activation
  BEFORE INSERT OR UPDATE OF kyc_status,kyc_activation_override,account_status,is_admin
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_customer_kyc_activation();

-- The previous protection trigger can reject a SQL-editor migration because it
-- is intentionally designed for signed-in application users. Disable only for
-- this controlled normalization and restore it immediately afterward.
DROP TRIGGER IF EXISTS a_protect_kyc_activation_fields ON public.profiles;

UPDATE public.profiles
SET account_status = CASE
      WHEN account_status='closed' THEN 'closed'
      ELSE 'active'
    END,
    kyc_activation_override = CASE
      WHEN account_status='closed' THEN COALESCE(kyc_activation_override,FALSE)
      ELSE TRUE
    END,
    updated_at = NOW()
WHERE COALESCE(is_admin,FALSE)=FALSE;

CREATE TRIGGER a_protect_kyc_activation_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_kyc_activation_fields();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,email,full_name,demo_balance,referral_code,
    account_status,kyc_activation_override
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name',NEW.raw_user_meta_data->>'name'),
    0.00,
    SUBSTRING(MD5(RANDOM()::TEXT || NEW.id::TEXT) FROM 1 FOR 8),
    'active',
    TRUE
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates a zero-balance active customer profile. KYC is required only for withdrawal requests.';

COMMENT ON COLUMN public.profiles.kyc_activation_override IS
  'Compatibility flag allowing normal account use without KYC; withdrawal RPCs still require approved KYC.';

CREATE OR REPLACE FUNCTION public.apply_crypto_deposit_update(
  p_provider TEXT,
  p_event_key TEXT,
  p_provider_payment_id TEXT,
  p_invoice_id UUID,
  p_payment_status TEXT,
  p_price_amount NUMERIC,
  p_price_currency TEXT,
  p_pay_currency TEXT,
  p_pay_amount NUMERIC,
  p_actually_paid NUMERIC,
  p_tx_hash TEXT,
  p_payload_hash TEXT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_invoice public.crypto_deposit_invoices%ROWTYPE;
  v_balance NUMERIC(15,2);
  v_deposit_limit NUMERIC(15,2);
  v_month_deposits NUMERIC(15,2);
  v_transaction UUID;
  v_status TEXT;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Service authorization required';
  END IF;
  IF p_provider <> 'nowpayments' OR p_event_key IS NULL OR p_provider_payment_id IS NULL THEN
    RAISE EXCEPTION 'Invalid provider event';
  END IF;

  INSERT INTO public.crypto_webhook_events (
    provider,event_key,provider_payment_id,payment_status,
    signature_verified,payload_hash,payload
  ) VALUES (
    p_provider,p_event_key,p_provider_payment_id,p_payment_status,
    TRUE,p_payload_hash,p_payload
  ) ON CONFLICT (provider,event_key) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',TRUE,'duplicate',TRUE);
  END IF;

  SELECT * INTO v_invoice
  FROM public.crypto_deposit_invoices
  WHERE id=p_invoice_id AND provider=p_provider
    AND provider_payment_id=p_provider_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Deposit invoice not found'; END IF;
  IF upper(p_price_currency) <> v_invoice.fiat_currency
     OR ABS(p_price_amount-v_invoice.fiat_amount) > 0.01
     OR lower(p_pay_currency) <> v_invoice.pay_currency THEN
    RAISE EXCEPTION 'Provider payment does not match the deposit invoice';
  END IF;

  v_status := CASE lower(p_payment_status)
    WHEN 'waiting' THEN 'waiting'
    WHEN 'confirming' THEN 'confirming'
    WHEN 'confirmed' THEN 'confirming'
    WHEN 'partially_paid' THEN 'partially_paid'
    WHEN 'finished' THEN 'completed'
    WHEN 'expired' THEN 'expired'
    WHEN 'failed' THEN 'failed'
    WHEN 'refunded' THEN 'refunded'
    ELSE NULL
  END;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Unsupported payment status'; END IF;

  IF v_status='completed' AND v_invoice.wallet_transaction_id IS NULL THEN
    IF COALESCE(p_actually_paid,0) + 0.000000000000000001 < COALESCE(v_invoice.pay_amount,p_pay_amount) THEN
      RAISE EXCEPTION 'Provider marked an underpaid invoice as finished';
    END IF;

    SELECT COALESCE(demo_balance,0),deposit_limit INTO v_balance,v_deposit_limit
    FROM public.profiles
    WHERE id=v_invoice.user_id
      AND COALESCE(is_suspended,FALSE)=FALSE
      AND (self_exclusion_until IS NULL OR self_exclusion_until <= NOW())
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Account is not eligible for deposits'; END IF;

    SELECT COALESCE(SUM(fiat_amount),0) INTO v_month_deposits
    FROM public.crypto_deposit_invoices
    WHERE user_id=v_invoice.user_id AND status='completed'
      AND completed_at>=date_trunc('month',NOW());
    IF v_deposit_limit IS NOT NULL AND v_month_deposits+v_invoice.fiat_amount>v_deposit_limit THEN
      RAISE EXCEPTION 'Monthly deposit limit would be exceeded';
    END IF;

    UPDATE public.profiles
    SET demo_balance=v_balance+v_invoice.fiat_amount,updated_at=NOW()
    WHERE id=v_invoice.user_id;

    INSERT INTO public.wallet_transactions(
      user_id,type,amount,balance_before,balance_after,description,
      reference_id,status,metadata
    ) VALUES (
      v_invoice.user_id,'deposit',v_invoice.fiat_amount,v_balance,
      v_balance+v_invoice.fiat_amount,'Verified crypto deposit',v_invoice.id,
      'completed',jsonb_build_object('provider',p_provider,'asset',p_pay_currency,'provider_payment_id',p_provider_payment_id,'tx_hash',p_tx_hash)
    ) RETURNING id INTO v_transaction;

    UPDATE public.crypto_deposit_invoices
    SET status='completed',actually_paid=COALESCE(p_actually_paid,0),
        pay_amount=COALESCE(pay_amount,p_pay_amount),tx_hash=NULLIF(p_tx_hash,''),
        wallet_transaction_id=v_transaction,completed_at=NOW(),
        provider_payload=p_payload,updated_at=NOW()
    WHERE id=v_invoice.id;
  ELSIF v_status='refunded' AND v_invoice.wallet_transaction_id IS NOT NULL
        AND v_invoice.reversal_transaction_id IS NULL THEN
    SELECT COALESCE(demo_balance,0) INTO v_balance
    FROM public.profiles WHERE id=v_invoice.user_id FOR UPDATE;
    UPDATE public.profiles
    SET demo_balance=v_balance-v_invoice.fiat_amount,updated_at=NOW()
    WHERE id=v_invoice.user_id;
    INSERT INTO public.wallet_transactions(
      user_id,type,amount,balance_before,balance_after,description,
      reference_id,status,metadata
    ) VALUES (
      v_invoice.user_id,'adjustment',-v_invoice.fiat_amount,v_balance,
      v_balance-v_invoice.fiat_amount,'Crypto deposit refund reversal',
      v_invoice.id,'completed',jsonb_build_object('provider',p_provider,'provider_payment_id',p_provider_payment_id)
    ) RETURNING id INTO v_transaction;
    UPDATE public.crypto_deposit_invoices
    SET status='refunded',reversal_transaction_id=v_transaction,
        refunded_at=NOW(),provider_payload=p_payload,updated_at=NOW()
    WHERE id=v_invoice.id;
  ELSIF v_invoice.status NOT IN ('completed','refunded') THEN
    UPDATE public.crypto_deposit_invoices
    SET status=v_status,actually_paid=COALESCE(p_actually_paid,actually_paid),
        pay_amount=COALESCE(pay_amount,p_pay_amount),tx_hash=COALESCE(NULLIF(p_tx_hash,''),tx_hash),
        provider_payload=p_payload,updated_at=NOW()
    WHERE id=v_invoice.id;
  END IF;

  RETURN jsonb_build_object('success',TRUE,'duplicate',FALSE,'status',v_status,'invoiceId',v_invoice.id);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_crypto_deposit_update(TEXT,TEXT,TEXT,UUID,TEXT,NUMERIC,TEXT,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_crypto_deposit_update(TEXT,TEXT,TEXT,UUID,TEXT,NUMERIC,TEXT,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_for_broker(p_company_name TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user UUID:=auth.uid(); v_broker public.brokers%ROWTYPE; v_code TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF length(trim(COALESCE(p_company_name,'')))<2 THEN RAISE EXCEPTION 'Company or broker name is required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id=v_user
      AND COALESCE(is_suspended,FALSE)=FALSE
      AND COALESCE(account_status,'active')<>'closed'
  ) THEN
    RAISE EXCEPTION 'An active account is required for broker applications';
  END IF;
  SELECT * INTO v_broker FROM public.brokers WHERE user_id=v_user;
  IF FOUND THEN RETURN jsonb_build_object('success',TRUE,'brokerId',v_broker.id,'status',v_broker.status,'brokerCode',v_broker.broker_code); END IF;
  LOOP
    v_code:=upper(substr(md5(gen_random_uuid()::TEXT),1,8));
    EXIT WHEN NOT EXISTS(SELECT 1 FROM public.brokers WHERE broker_code=v_code);
  END LOOP;
  INSERT INTO public.brokers(user_id,company_name,broker_code)
  VALUES(v_user,trim(p_company_name),v_code) RETURNING * INTO v_broker;
  RETURN jsonb_build_object('success',TRUE,'brokerId',v_broker.id,'status',v_broker.status,'brokerCode',v_broker.broker_code);
END; $$;

COMMENT ON FUNCTION public.apply_crypto_deposit_update(TEXT,TEXT,TEXT,UUID,TEXT,NUMERIC,TEXT,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,JSONB) IS
  'Processes verified provider deposits for active customers without using KYC as a deposit gate.';

COMMENT ON FUNCTION public.apply_for_broker(TEXT) IS
  'Creates a broker application for an active customer; KYC is enforced only at withdrawal.';

COMMIT;
