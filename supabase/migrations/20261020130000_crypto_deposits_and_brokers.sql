-- Provider-controlled crypto deposits and agent/broker revenue-share accounts.
-- Real-money activation remains an operational decision: provider merchant
-- approval, KYC/AML and licensing must be complete before enabling the API.

CREATE TABLE IF NOT EXISTS public.crypto_deposit_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL DEFAULT 'nowpayments',
  provider_payment_id TEXT,
  idempotency_key TEXT NOT NULL,
  fiat_amount NUMERIC(15,2) NOT NULL CHECK (fiat_amount >= 10 AND fiat_amount <= 100000),
  fiat_currency TEXT NOT NULL DEFAULT 'USD' CHECK (fiat_currency ~ '^[A-Z]{3}$'),
  pay_currency TEXT NOT NULL CHECK (pay_currency ~ '^[a-z0-9]{2,20}$'),
  pay_amount NUMERIC(36,18),
  actually_paid NUMERIC(36,18) NOT NULL DEFAULT 0,
  pay_address TEXT,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'creating' CHECK (status IN (
    'creating','waiting','confirming','partially_paid','completed',
    'expired','failed','refunded'
  )),
  expires_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  wallet_transaction_id UUID REFERENCES public.wallet_transactions(id),
  reversal_transaction_id UUID REFERENCES public.wallet_transactions(id),
  provider_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, idempotency_key),
  UNIQUE (provider, provider_payment_id)
);

CREATE INDEX IF NOT EXISTS crypto_deposit_user_created_idx
  ON public.crypto_deposit_invoices(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS crypto_deposit_status_idx
  ON public.crypto_deposit_invoices(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.crypto_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_key TEXT NOT NULL,
  provider_payment_id TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
  payload_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, event_key)
);

ALTER TABLE public.crypto_deposit_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crypto_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_crypto_deposits" ON public.crypto_deposit_invoices
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "finance_read_crypto_deposits" ON public.crypto_deposit_invoices
  FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['finance']));
CREATE POLICY "finance_read_crypto_webhooks" ON public.crypto_webhook_events
  FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['finance']));

REVOKE INSERT, UPDATE, DELETE ON public.crypto_deposit_invoices FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.crypto_webhook_events FROM PUBLIC, anon, authenticated;

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
      AND kyc_status='approved'
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

CREATE TABLE IF NOT EXISTS public.brokers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE RESTRICT,
  company_name TEXT NOT NULL CHECK (length(trim(company_name)) BETWEEN 2 AND 120),
  broker_code TEXT NOT NULL UNIQUE CHECK (broker_code ~ '^[A-Z0-9]{6,16}$'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected','suspended')),
  commission_bps INTEGER NOT NULL DEFAULT 1500 CHECK (commission_bps BETWEEN 0 AND 5000),
  settlement_model TEXT NOT NULL DEFAULT 'revenue_share' CHECK (settlement_model IN ('revenue_share','turnover')),
  notes TEXT,
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.broker_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id UUID NOT NULL REFERENCES public.brokers(id) ON DELETE RESTRICT,
  player_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE RESTRICT,
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attribution_source TEXT NOT NULL DEFAULT 'broker_code',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (attribution_source IN ('broker_code','admin','campaign'))
);

CREATE TABLE IF NOT EXISTS public.broker_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id UUID NOT NULL REFERENCES public.brokers(id) ON DELETE RESTRICT,
  player_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  bet_id UUID NOT NULL UNIQUE REFERENCES public.bets(id) ON DELETE RESTRICT,
  gross_revenue NUMERIC(15,2) NOT NULL,
  commission_bps INTEGER NOT NULL,
  commission_amount NUMERIC(15,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'accrued' CHECK (status IN ('accrued','approved','paid','reversed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.broker_payout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id UUID NOT NULL REFERENCES public.brokers(id) ON DELETE RESTRICT,
  amount NUMERIC(15,2) NOT NULL CHECK (amount >= 100),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','rejected')),
  destination_reference TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS broker_players_broker_idx ON public.broker_players(broker_id,is_active);
CREATE INDEX IF NOT EXISTS broker_commissions_broker_idx ON public.broker_commissions(broker_id,created_at DESC);
CREATE INDEX IF NOT EXISTS broker_payout_status_idx ON public.broker_payout_requests(status,requested_at);

ALTER TABLE public.brokers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broker_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broker_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broker_payout_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brokers_read_own_record" ON public.brokers
  FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY "brokers_read_own_players" ON public.broker_players
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.brokers b WHERE b.id=broker_id AND b.user_id=auth.uid()));
CREATE POLICY "players_read_own_broker" ON public.broker_players
  FOR SELECT TO authenticated USING (player_id=auth.uid());
CREATE POLICY "brokers_read_own_commissions" ON public.broker_commissions
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.brokers b WHERE b.id=broker_id AND b.user_id=auth.uid()));
CREATE POLICY "brokers_read_own_payouts" ON public.broker_payout_requests
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.brokers b WHERE b.id=broker_id AND b.user_id=auth.uid()));
CREATE POLICY "finance_manage_brokers" ON public.brokers
  FOR ALL TO authenticated USING (public.has_admin_role(ARRAY['finance'])) WITH CHECK (public.has_admin_role(ARRAY['finance']));
CREATE POLICY "finance_read_broker_players" ON public.broker_players
  FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['finance']));
CREATE POLICY "finance_manage_broker_commissions" ON public.broker_commissions
  FOR ALL TO authenticated USING (public.has_admin_role(ARRAY['finance'])) WITH CHECK (public.has_admin_role(ARRAY['finance']));
CREATE POLICY "finance_manage_broker_payouts" ON public.broker_payout_requests
  FOR ALL TO authenticated USING (public.has_admin_role(ARRAY['finance'])) WITH CHECK (public.has_admin_role(ARRAY['finance']));

REVOKE INSERT,UPDATE,DELETE ON public.brokers FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.broker_players FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.broker_commissions FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.broker_payout_requests FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.apply_for_broker(p_company_name TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user UUID:=auth.uid(); v_broker public.brokers%ROWTYPE; v_code TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF length(trim(COALESCE(p_company_name,'')))<2 THEN RAISE EXCEPTION 'Company or broker name is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_user AND kyc_status='approved' AND COALESCE(is_suspended,FALSE)=FALSE) THEN
    RAISE EXCEPTION 'Approved KYC is required for broker applications';
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

CREATE OR REPLACE FUNCTION public.link_my_broker(p_broker_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user UUID:=auth.uid(); v_broker public.brokers%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF EXISTS(SELECT 1 FROM public.bets WHERE user_id=v_user) THEN RAISE EXCEPTION 'A broker can only be linked before the first bet'; END IF;
  IF EXISTS(SELECT 1 FROM public.broker_players WHERE player_id=v_user) THEN RAISE EXCEPTION 'A broker is already linked'; END IF;
  SELECT * INTO v_broker FROM public.brokers WHERE broker_code=upper(trim(p_broker_code)) AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Active broker code not found'; END IF;
  IF v_broker.user_id=v_user THEN RAISE EXCEPTION 'A broker cannot refer their own account'; END IF;
  INSERT INTO public.broker_players(broker_id,player_id) VALUES(v_broker.id,v_user);
  RETURN jsonb_build_object('success',TRUE,'broker',v_broker.company_name);
END; $$;

CREATE OR REPLACE FUNCTION public.accrue_broker_commission()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_link public.broker_players%ROWTYPE; v_broker public.brokers%ROWTYPE; v_ggr NUMERIC; v_commission NUMERIC;
BEGIN
  IF OLD.status='pending' AND NEW.status IN('won','lost','cashout') THEN
    SELECT * INTO v_link FROM public.broker_players WHERE player_id=NEW.user_id AND is_active=TRUE;
    IF FOUND THEN
      SELECT * INTO v_broker FROM public.brokers WHERE id=v_link.broker_id AND status='active';
      IF FOUND THEN
        v_ggr:=ROUND(NEW.stake-COALESCE(NEW.payout,0),2);
        v_commission:=CASE WHEN v_broker.settlement_model='turnover' THEN ROUND(NEW.stake*v_broker.commission_bps/10000.0,2) ELSE ROUND(v_ggr*v_broker.commission_bps/10000.0,2) END;
        INSERT INTO public.broker_commissions(broker_id,player_id,bet_id,gross_revenue,commission_bps,commission_amount)
        VALUES(v_broker.id,NEW.user_id,NEW.id,v_ggr,v_broker.commission_bps,v_commission)
        ON CONFLICT(bet_id) DO NOTHING;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS accrue_broker_commission_trigger ON public.bets;
CREATE TRIGGER accrue_broker_commission_trigger AFTER UPDATE OF status,payout ON public.bets
FOR EACH ROW EXECUTE FUNCTION public.accrue_broker_commission();

CREATE OR REPLACE FUNCTION public.get_my_broker_dashboard()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH mine AS (SELECT * FROM public.brokers WHERE user_id=auth.uid()),
  totals AS (
    SELECT COUNT(DISTINCT bp.player_id) AS players,
      COALESCE(SUM(bc.gross_revenue),0) AS gross_revenue,
      COALESCE(SUM(bc.commission_amount) FILTER(WHERE bc.status IN('accrued','approved')),0) AS commission_available,
      COALESCE(SUM(bc.commission_amount) FILTER(WHERE bc.status='paid'),0) AS commission_paid
    FROM mine m LEFT JOIN public.broker_players bp ON bp.broker_id=m.id AND bp.is_active=TRUE
    LEFT JOIN public.broker_commissions bc ON bc.broker_id=m.id
  )
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM mine) THEN NULL ELSE jsonb_build_object(
    'id',(SELECT id FROM mine),'companyName',(SELECT company_name FROM mine),
    'brokerCode',(SELECT broker_code FROM mine),'status',(SELECT status FROM mine),
    'commissionBps',(SELECT commission_bps FROM mine),'players',totals.players,
    'grossRevenue',totals.gross_revenue,'commissionAvailable',totals.commission_available,
    'commissionPaid',totals.commission_paid) END FROM totals;
$$;

CREATE OR REPLACE FUNCTION public.request_broker_payout(p_amount NUMERIC,p_destination_reference TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user UUID:=auth.uid(); v_broker public.brokers%ROWTYPE; v_available NUMERIC; v_reserved NUMERIC; v_id UUID;
BEGIN
  SELECT * INTO v_broker FROM public.brokers WHERE user_id=v_user AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active broker account required'; END IF;
  IF p_amount<100 THEN RAISE EXCEPTION 'Minimum broker payout is 100'; END IF;
  SELECT COALESCE(SUM(commission_amount),0) INTO v_available FROM public.broker_commissions WHERE broker_id=v_broker.id AND status IN('accrued','approved');
  SELECT COALESCE(SUM(amount),0) INTO v_reserved FROM public.broker_payout_requests WHERE broker_id=v_broker.id AND status IN('pending','approved');
  IF p_amount>v_available-v_reserved THEN RAISE EXCEPTION 'Payout amount exceeds available commission'; END IF;
  INSERT INTO public.broker_payout_requests(broker_id,amount,destination_reference)
  VALUES(v_broker.id,p_amount,NULLIF(trim(p_destination_reference),'')) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.review_broker_application(p_broker_id UUID,p_status TEXT,p_commission_bps INTEGER,p_notes TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_admin_role(ARRAY['finance']) THEN RAISE EXCEPTION 'Finance authorization required'; END IF;
  IF p_status NOT IN('active','rejected','suspended') OR p_commission_bps<0 OR p_commission_bps>5000 THEN RAISE EXCEPTION 'Invalid broker review'; END IF;
  UPDATE public.brokers SET status=p_status,commission_bps=p_commission_bps,notes=NULLIF(trim(p_notes),''),reviewed_by=auth.uid(),reviewed_at=NOW(),updated_at=NOW() WHERE id=p_broker_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Broker not found'; END IF;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes)
  VALUES(auth.uid(),'broker_review','broker',p_broker_id,jsonb_build_object('status',p_status,'commission_bps',p_commission_bps,'notes',p_notes));
END; $$;

REVOKE ALL ON FUNCTION public.apply_for_broker(TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.apply_for_broker(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.link_my_broker(TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_my_broker(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.accrue_broker_commission() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_my_broker_dashboard() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_broker_dashboard() TO authenticated;
REVOKE ALL ON FUNCTION public.request_broker_payout(NUMERIC,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_broker_payout(NUMERIC,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.review_broker_application(UUID,TEXT,INTEGER,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_broker_application(UUID,TEXT,INTEGER,TEXT) TO authenticated;

