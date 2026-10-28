-- Admin-managed payment methods and review-only manual deposits.
-- Provider secrets remain server environment variables and are never stored here.

CREATE TABLE IF NOT EXISTS public.payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_]{2,40}$'),
  method_type TEXT NOT NULL CHECK (method_type IN ('provider','manual_crypto','bank','ewallet')),
  provider_code TEXT,
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z0-9]{2,12}$'),
  network TEXT,
  destination_reference TEXT,
  instructions TEXT,
  min_amount NUMERIC(15,2) NOT NULL DEFAULT 10 CHECK (min_amount >= 0),
  max_amount NUMERIC(15,2) NOT NULL DEFAULT 100000 CHECK (max_amount >= min_amount),
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INTEGER NOT NULL DEFAULT 100 CHECK (display_order BETWEEN 0 AND 10000),
  created_by UUID REFERENCES public.profiles(id),
  updated_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CHECK (method_type = 'provider' OR length(trim(COALESCE(destination_reference,''))) >= 3)
);

CREATE TABLE IF NOT EXISTS public.manual_deposit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  payment_method_id UUID NOT NULL REFERENCES public.payment_methods(id) ON DELETE RESTRICT,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  transaction_reference TEXT NOT NULL CHECK (length(trim(transaction_reference)) BETWEEN 4 AND 180),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  user_note TEXT,
  review_note TEXT,
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  wallet_transaction_id UUID REFERENCES public.wallet_transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS manual_deposit_reference_unique
  ON public.manual_deposit_requests(payment_method_id, lower(transaction_reference));
CREATE INDEX IF NOT EXISTS manual_deposit_user_created_idx
  ON public.manual_deposit_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS manual_deposit_review_queue_idx
  ON public.manual_deposit_requests(status, created_at);
CREATE INDEX IF NOT EXISTS payment_methods_active_order_idx
  ON public.payment_methods(is_enabled, display_order) WHERE archived_at IS NULL;

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_deposit_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_enabled_payment_methods" ON public.payment_methods
  FOR SELECT TO authenticated
  USING ((is_enabled=TRUE AND archived_at IS NULL) OR public.has_admin_role(ARRAY['finance']));
CREATE POLICY "users_read_own_manual_deposits" ON public.manual_deposit_requests
  FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY "finance_read_manual_deposits" ON public.manual_deposit_requests
  FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['finance']));

REVOKE INSERT,UPDATE,DELETE ON public.payment_methods FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.manual_deposit_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.payment_methods TO authenticated;
GRANT SELECT ON public.manual_deposit_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.save_payment_method(
  p_id UUID,
  p_name TEXT,
  p_code TEXT,
  p_method_type TEXT,
  p_provider_code TEXT,
  p_currency TEXT,
  p_network TEXT,
  p_destination_reference TEXT,
  p_instructions TEXT,
  p_min_amount NUMERIC,
  p_max_amount NUMERIC,
  p_is_enabled BOOLEAN,
  p_display_order INTEGER
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID; v_previous JSONB;
BEGIN
  IF NOT public.has_admin_role(ARRAY['finance']) THEN RAISE EXCEPTION 'Finance authorization required'; END IF;
  IF COALESCE(auth.jwt()->>'aal','aal1') <> 'aal2' THEN RAISE EXCEPTION 'Two-factor verification required'; END IF;
  IF p_method_type NOT IN ('provider','manual_crypto','bank','ewallet') THEN RAISE EXCEPTION 'Invalid payment method type'; END IF;
  IF p_min_amount<0 OR p_max_amount<p_min_amount THEN RAISE EXCEPTION 'Invalid payment limits'; END IF;
  IF p_method_type<>'provider' AND length(trim(COALESCE(p_destination_reference,'')))<3 THEN RAISE EXCEPTION 'Destination details are required'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.payment_methods(
      name,code,method_type,provider_code,currency,network,destination_reference,
      instructions,min_amount,max_amount,is_enabled,display_order,created_by,updated_by
    ) VALUES (
      trim(p_name),lower(trim(p_code)),p_method_type,NULLIF(lower(trim(COALESCE(p_provider_code,''))),''),
      upper(trim(p_currency)),NULLIF(trim(COALESCE(p_network,'')),''),NULLIF(trim(COALESCE(p_destination_reference,'')),''),
      NULLIF(trim(COALESCE(p_instructions,'')),''),p_min_amount,p_max_amount,p_is_enabled,p_display_order,auth.uid(),auth.uid()
    ) RETURNING id INTO v_id;
  ELSE
    SELECT to_jsonb(pm) INTO v_previous FROM public.payment_methods pm WHERE id=p_id AND archived_at IS NULL FOR UPDATE;
    IF v_previous IS NULL THEN RAISE EXCEPTION 'Payment method not found'; END IF;
    UPDATE public.payment_methods SET
      name=trim(p_name),code=lower(trim(p_code)),method_type=p_method_type,
      provider_code=NULLIF(lower(trim(COALESCE(p_provider_code,''))),''),currency=upper(trim(p_currency)),
      network=NULLIF(trim(COALESCE(p_network,'')),''),destination_reference=NULLIF(trim(COALESCE(p_destination_reference,'')),''),
      instructions=NULLIF(trim(COALESCE(p_instructions,'')),''),min_amount=p_min_amount,max_amount=p_max_amount,
      is_enabled=p_is_enabled,display_order=p_display_order,updated_by=auth.uid(),updated_at=NOW()
    WHERE id=p_id RETURNING id INTO v_id;
  END IF;

  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes)
  VALUES(auth.uid(),CASE WHEN p_id IS NULL THEN 'payment_method_create' ELSE 'payment_method_update' END,
    'payment_method',v_id,jsonb_build_object('previous',v_previous,'name',p_name,'code',p_code,'enabled',p_is_enabled));
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.archive_payment_method(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_method public.payment_methods%ROWTYPE;
BEGIN
  IF NOT public.has_admin_role(ARRAY['finance']) THEN RAISE EXCEPTION 'Finance authorization required'; END IF;
  IF COALESCE(auth.jwt()->>'aal','aal1') <> 'aal2' THEN RAISE EXCEPTION 'Two-factor verification required'; END IF;
  SELECT * INTO v_method FROM public.payment_methods WHERE id=p_id AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment method not found'; END IF;
  UPDATE public.payment_methods SET is_enabled=FALSE,archived_at=NOW(),updated_by=auth.uid(),updated_at=NOW() WHERE id=p_id;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes)
  VALUES(auth.uid(),'payment_method_archive','payment_method',p_id,to_jsonb(v_method));
END; $$;

CREATE OR REPLACE FUNCTION public.submit_manual_deposit_request(
  p_payment_method_id UUID,
  p_amount NUMERIC,
  p_transaction_reference TEXT,
  p_user_note TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user UUID:=auth.uid(); v_method public.payment_methods%ROWTYPE; v_id UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_method FROM public.payment_methods
  WHERE id=p_payment_method_id AND is_enabled=TRUE AND archived_at IS NULL AND method_type<>'provider';
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment method is unavailable'; END IF;
  IF p_amount<v_method.min_amount OR p_amount>v_method.max_amount THEN RAISE EXCEPTION 'Amount is outside the allowed limits'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_user AND kyc_status='approved' AND COALESCE(is_suspended,FALSE)=FALSE AND (self_exclusion_until IS NULL OR self_exclusion_until<=NOW())) THEN
    RAISE EXCEPTION 'Approved KYC and an active account are required';
  END IF;
  INSERT INTO public.manual_deposit_requests(user_id,payment_method_id,amount,transaction_reference,user_note)
  VALUES(v_user,p_payment_method_id,p_amount,trim(p_transaction_reference),NULLIF(trim(COALESCE(p_user_note,'')),''))
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This transaction reference has already been submitted';
END; $$;

CREATE OR REPLACE FUNCTION public.review_manual_deposit_request(
  p_request_id UUID,
  p_status TEXT,
  p_review_note TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request public.manual_deposit_requests%ROWTYPE; v_balance NUMERIC(15,2); v_limit NUMERIC(15,2); v_month_total NUMERIC(15,2); v_tx UUID;
BEGIN
  IF NOT public.has_admin_role(ARRAY['finance']) THEN RAISE EXCEPTION 'Finance authorization required'; END IF;
  IF COALESCE(auth.jwt()->>'aal','aal1') <> 'aal2' THEN RAISE EXCEPTION 'Two-factor verification required'; END IF;
  IF p_status NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Invalid review status'; END IF;
  SELECT * INTO v_request FROM public.manual_deposit_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deposit request not found'; END IF;
  IF v_request.status<>'pending' THEN RAISE EXCEPTION 'Deposit request has already been reviewed'; END IF;

  IF p_status='approved' THEN
    SELECT COALESCE(demo_balance,0),deposit_limit INTO v_balance,v_limit FROM public.profiles
    WHERE id=v_request.user_id AND kyc_status='approved' AND COALESCE(is_suspended,FALSE)=FALSE
      AND (self_exclusion_until IS NULL OR self_exclusion_until<=NOW()) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Account is not eligible for deposits'; END IF;
    SELECT COALESCE((SELECT SUM(fiat_amount) FROM public.crypto_deposit_invoices WHERE user_id=v_request.user_id AND status='completed' AND completed_at>=date_trunc('month',NOW())),0)
      + COALESCE((SELECT SUM(amount) FROM public.manual_deposit_requests WHERE user_id=v_request.user_id AND status='approved' AND reviewed_at>=date_trunc('month',NOW())),0)
      INTO v_month_total;
    IF v_limit IS NOT NULL AND v_month_total+v_request.amount>v_limit THEN RAISE EXCEPTION 'Monthly deposit limit would be exceeded'; END IF;
    UPDATE public.profiles SET demo_balance=v_balance+v_request.amount,updated_at=NOW() WHERE id=v_request.user_id;
    INSERT INTO public.wallet_transactions(user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata)
    VALUES(v_request.user_id,'deposit',v_request.amount,v_balance,v_balance+v_request.amount,'Approved manual deposit',v_request.id,'completed',
      jsonb_build_object('payment_method_id',v_request.payment_method_id,'transaction_reference',v_request.transaction_reference)) RETURNING id INTO v_tx;
  END IF;

  UPDATE public.manual_deposit_requests SET status=p_status,review_note=NULLIF(trim(COALESCE(p_review_note,'')),''),
    reviewed_by=auth.uid(),reviewed_at=NOW(),wallet_transaction_id=v_tx,updated_at=NOW() WHERE id=p_request_id;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes)
  VALUES(auth.uid(),'manual_deposit_review','manual_deposit',p_request_id,jsonb_build_object('status',p_status,'note',p_review_note));
END; $$;

REVOKE ALL ON FUNCTION public.save_payment_method(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,BOOLEAN,INTEGER) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_payment_method(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,BOOLEAN,INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.archive_payment_method(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.archive_payment_method(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.submit_manual_deposit_request(UUID,NUMERIC,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_manual_deposit_request(UUID,NUMERIC,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.review_manual_deposit_request(UUID,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_manual_deposit_request(UUID,TEXT,TEXT) TO authenticated;

INSERT INTO public.payment_methods(name,code,method_type,provider_code,currency,network,instructions,min_amount,max_amount,is_enabled,display_order)
VALUES('NOWPayments Crypto','nowpayments','provider','nowpayments','USD',NULL,'Automatic invoice and signed callback processing.',10,100000,FALSE,10)
ON CONFLICT(code) DO NOTHING;
