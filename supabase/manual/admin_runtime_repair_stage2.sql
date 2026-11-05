-- MindBet Pro admin runtime repair: STAGE 2
-- Run only after STAGE 1 creates and verifies public.casino_providers.

-- ============================================================
-- SOURCE: supabase/migrations/20261102120000_revenue_accounting.sql
-- ============================================================

-- Production revenue accounting, automatic sportsbook margin application, and provider settlements.

CREATE TABLE IF NOT EXISTS public.finance_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  payment_fee_bps INTEGER NOT NULL DEFAULT 0 CHECK (payment_fee_bps BETWEEN 0 AND 5000),
  gaming_tax_bps INTEGER NOT NULL DEFAULT 0 CHECK (gaming_tax_bps BETWEEN 0 AND 10000),
  default_casino_share_bps INTEGER NOT NULL DEFAULT 1500 CHECK (default_casino_share_bps BETWEEN 0 AND 10000),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.finance_settings(id) VALUES(TRUE) ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.finance_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN (
    'payment_fee','provider_fee','gaming_tax','chargeback','refund','bonus_cost','affiliate_commission','other_cost','other_income'
  )),
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  reference TEXT,
  notes TEXT NOT NULL CHECK (char_length(btrim(notes)) BETWEEN 3 AND 1000),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS finance_adjustments_occurred_idx
  ON public.finance_adjustments(occurred_at DESC, adjustment_type);


CREATE TABLE IF NOT EXISTS public.partner_vertical_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id UUID NOT NULL REFERENCES public.brokers(id) ON DELETE RESTRICT,
  player_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK (source_type IN ('casino','aviator')),
  source_id UUID NOT NULL,
  gross_revenue NUMERIC(18,2) NOT NULL,
  commission_bps INTEGER NOT NULL CHECK (commission_bps BETWEEN 0 AND 5000),
  commission_amount NUMERIC(18,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'accrued' CHECK (status IN ('accrued','void')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(broker_id,source_type,source_id)
);
CREATE INDEX IF NOT EXISTS partner_vertical_commissions_broker_idx
  ON public.partner_vertical_commissions(broker_id,created_at DESC);
ALTER TABLE public.partner_vertical_commissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS partner_reads_vertical_commissions ON public.partner_vertical_commissions;
CREATE POLICY partner_reads_vertical_commissions ON public.partner_vertical_commissions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.brokers b
    WHERE b.id=broker_id AND b.user_id=auth.uid()
  ));
DROP POLICY IF EXISTS finance_reads_vertical_commissions ON public.partner_vertical_commissions;
CREATE POLICY finance_reads_vertical_commissions ON public.partner_vertical_commissions
  FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['finance']));
REVOKE INSERT,UPDATE,DELETE ON public.partner_vertical_commissions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.partner_vertical_commissions TO authenticated;

ALTER TABLE public.casino_providers
  ADD COLUMN IF NOT EXISTS revenue_share_bps INTEGER NOT NULL DEFAULT 1500
    CHECK (revenue_share_bps BETWEEN 0 AND 10000),
  ADD COLUMN IF NOT EXISTS settlement_currency TEXT NOT NULL DEFAULT 'USD'
    CHECK (settlement_currency ~ '^[A-Z]{3}$');

CREATE TABLE IF NOT EXISTS public.casino_provider_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES public.casino_providers(id) ON DELETE RESTRICT,
  period_from TIMESTAMPTZ NOT NULL,
  period_to TIMESTAMPTZ NOT NULL,
  stakes NUMERIC(18,2) NOT NULL DEFAULT 0,
  payouts NUMERIC(18,2) NOT NULL DEFAULT 0,
  refunds NUMERIC(18,2) NOT NULL DEFAULT 0,
  gross_gaming_revenue NUMERIC(18,2) NOT NULL DEFAULT 0,
  revenue_share_bps INTEGER NOT NULL CHECK (revenue_share_bps BETWEEN 0 AND 10000),
  provider_share NUMERIC(18,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','paid','disputed')),
  payment_reference TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  CHECK (period_to > period_from),
  UNIQUE(provider_id,period_from,period_to)
);

CREATE INDEX IF NOT EXISTS casino_provider_settlements_period_idx
  ON public.casino_provider_settlements(period_from DESC,provider_id);

ALTER TABLE public.finance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casino_provider_settlements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.finance_settings,public.finance_adjustments,public.casino_provider_settlements
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.apply_configured_sport_margin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_margin NUMERIC := 0;
BEGIN
  IF NEW.provider_odds IS NULL OR NEW.provider_odds < 1.01 OR COALESCE(NEW.is_locked,FALSE) THEN
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND NEW.provider_odds IS NOT DISTINCT FROM OLD.provider_odds THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(sc.default_margin,0)
  INTO v_margin
  FROM public.markets m
  JOIN public.events e ON e.id=m.event_id
  LEFT JOIN public.sport_config sc ON sc.sport_id=e.sport_id
  WHERE m.id=NEW.market_id;

  v_margin:=LEAST(50,GREATEST(0,COALESCE(v_margin,0)));
  NEW.value:=ROUND(GREATEST(1.01,NEW.provider_odds/(1+(v_margin/100.0))),3);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_configured_sport_margin_trigger ON public.odds;
CREATE TRIGGER apply_configured_sport_margin_trigger
BEFORE INSERT OR UPDATE OF provider_odds ON public.odds
FOR EACH ROW EXECUTE FUNCTION public.apply_configured_sport_margin();

CREATE OR REPLACE FUNCTION public.create_casino_provider_settlements(
  p_period_from TIMESTAMPTZ,
  p_period_to TIMESTAMPTZ,
  p_admin_id UUID
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NOT public.is_service_role() THEN RAISE EXCEPTION 'Service authorization required'; END IF;
  IF p_period_to<=p_period_from THEN RAISE EXCEPTION 'Invalid settlement period'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id=p_admin_id AND is_admin=TRUE
      AND admin_role IN ('super_admin','finance')
      AND COALESCE(is_suspended,FALSE)=FALSE
  ) THEN RAISE EXCEPTION 'Finance authorization required'; END IF;

  INSERT INTO public.casino_provider_settlements(
    provider_id,period_from,period_to,stakes,payouts,refunds,gross_gaming_revenue,
    revenue_share_bps,provider_share,created_by
  )
  SELECT
    cp.id,p_period_from,p_period_to,
    COALESCE(SUM(ct.amount) FILTER(WHERE ct.transaction_type='bet'),0),
    COALESCE(SUM(ct.amount) FILTER(WHERE ct.transaction_type='win'),0),
    COALESCE(SUM(ct.amount) FILTER(WHERE ct.transaction_type='refund'),0),
    COALESCE(SUM(ct.amount) FILTER(WHERE ct.transaction_type='bet'),0)
      -COALESCE(SUM(ct.amount) FILTER(WHERE ct.transaction_type='win'),0)
      -COALESCE(SUM(ct.amount) FILTER(WHERE ct.transaction_type='refund'),0),
    cp.revenue_share_bps,
    ROUND(GREATEST(0,
      COALESCE(SUM(ct.amount) FILTER(WHERE ct.transaction_type='bet'),0)
      -COALESCE(SUM(ct.amount) FILTER(WHERE ct.transaction_type='win'),0)
      -COALESCE(SUM(ct.amount) FILTER(WHERE ct.transaction_type='refund'),0)
    )*cp.revenue_share_bps/10000.0,2),
    p_admin_id
  FROM public.casino_providers cp
  LEFT JOIN public.casino_transactions ct
    ON ct.provider_id=cp.id
   AND ct.created_at>=p_period_from
   AND ct.created_at<p_period_to
  WHERE cp.is_demo=FALSE
  GROUP BY cp.id,cp.revenue_share_bps
  ON CONFLICT(provider_id,period_from,period_to) DO UPDATE SET
    stakes=EXCLUDED.stakes,payouts=EXCLUDED.payouts,refunds=EXCLUDED.refunds,
    gross_gaming_revenue=EXCLUDED.gross_gaming_revenue,
    revenue_share_bps=EXCLUDED.revenue_share_bps,
    provider_share=EXCLUDED.provider_share;

  GET DIAGNOSTICS v_count=ROW_COUNT;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,changes)
  VALUES(p_admin_id,'casino_settlements_generated','casino_provider_settlement',
    jsonb_build_object('period_from',p_period_from,'period_to',p_period_to,'providers',v_count));
  RETURN v_count;
END;
$$;


CREATE OR REPLACE FUNCTION public.accrue_partner_casino_commission()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_broker public.brokers%ROWTYPE; v_ggr NUMERIC; v_commission NUMERIC;
BEGIN
  SELECT b.* INTO v_broker
  FROM public.broker_players bp JOIN public.brokers b ON b.id=bp.broker_id
  WHERE bp.player_id=NEW.user_id AND bp.is_active=TRUE AND b.status='active'
  LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  v_ggr:=CASE WHEN NEW.transaction_type='bet' THEN NEW.amount ELSE -NEW.amount END;
  v_commission:=ROUND(v_ggr*v_broker.commission_bps/10000.0,2);
  INSERT INTO public.partner_vertical_commissions(
    broker_id,player_id,source_type,source_id,gross_revenue,commission_bps,commission_amount
  ) VALUES(v_broker.id,NEW.user_id,'casino',NEW.id,v_ggr,v_broker.commission_bps,v_commission)
  ON CONFLICT(broker_id,source_type,source_id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS accrue_partner_casino_commission_trigger ON public.casino_transactions;
CREATE TRIGGER accrue_partner_casino_commission_trigger
AFTER INSERT ON public.casino_transactions
FOR EACH ROW EXECUTE FUNCTION public.accrue_partner_casino_commission();

CREATE OR REPLACE FUNCTION public.accrue_partner_aviator_commission()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_broker public.brokers%ROWTYPE; v_ggr NUMERIC; v_commission NUMERIC;
BEGIN
  IF OLD.status<>'placed' OR NEW.status NOT IN ('cashed_out','lost','refunded') THEN RETURN NEW; END IF;
  SELECT b.* INTO v_broker
  FROM public.broker_players bp JOIN public.brokers b ON b.id=bp.broker_id
  WHERE bp.player_id=NEW.user_id AND bp.is_active=TRUE AND b.status='active'
  LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  v_ggr:=CASE WHEN NEW.status='refunded' THEN 0 ELSE NEW.stake-COALESCE(NEW.payout,0) END;
  v_commission:=ROUND(v_ggr*v_broker.commission_bps/10000.0,2);
  INSERT INTO public.partner_vertical_commissions(
    broker_id,player_id,source_type,source_id,gross_revenue,commission_bps,commission_amount
  ) VALUES(v_broker.id,NEW.user_id,'aviator',NEW.id,v_ggr,v_broker.commission_bps,v_commission)
  ON CONFLICT(broker_id,source_type,source_id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS accrue_partner_aviator_commission_trigger ON public.aviator_bets;
CREATE TRIGGER accrue_partner_aviator_commission_trigger
AFTER UPDATE OF status,payout ON public.aviator_bets
FOR EACH ROW EXECUTE FUNCTION public.accrue_partner_aviator_commission();

CREATE OR REPLACE FUNCTION public.get_finance_summary(
  p_period_from TIMESTAMPTZ,
  p_period_to TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_settings public.finance_settings%ROWTYPE;
  v_sports_stakes NUMERIC:=0; v_sports_payouts NUMERIC:=0;
  v_casino_stakes NUMERIC:=0; v_casino_payouts NUMERIC:=0; v_casino_refunds NUMERIC:=0;
  v_aviator_stakes NUMERIC:=0; v_aviator_payouts NUMERIC:=0;
  v_bonus_cost NUMERIC:=0; v_partner_commission NUMERIC:=0;
  v_deposits NUMERIC:=0; v_payment_fees NUMERIC:=0; v_provider_fees NUMERIC:=0;
  v_chargebacks NUMERIC:=0; v_refunds NUMERIC:=0; v_manual_tax NUMERIC:=0;
  v_other_cost NUMERIC:=0; v_other_income NUMERIC:=0;
  v_provider_share NUMERIC:=0; v_gaming_tax NUMERIC:=0;
  v_sports_ggr NUMERIC:=0; v_casino_ggr NUMERIC:=0; v_aviator_ggr NUMERIC:=0;
  v_ggr NUMERIC:=0; v_ngr NUMERIC:=0;
BEGIN
  IF NOT public.is_service_role() THEN RAISE EXCEPTION 'Service authorization required'; END IF;
  IF p_period_to<=p_period_from THEN RAISE EXCEPTION 'Invalid reporting period'; END IF;
  SELECT * INTO v_settings FROM public.finance_settings WHERE id=TRUE;

  SELECT
    COALESCE(SUM(stake) FILTER(WHERE COALESCE(status,'pending') NOT IN ('pending','placed','void','cancelled')),0),
    COALESCE(SUM(COALESCE(payout,0)) FILTER(WHERE COALESCE(status,'pending') NOT IN ('pending','placed','void','cancelled')),0)
  INTO v_sports_stakes,v_sports_payouts
  FROM public.bets WHERE created_at>=p_period_from AND created_at<p_period_to;

  SELECT
    COALESCE(SUM(amount) FILTER(WHERE transaction_type='bet'),0),
    COALESCE(SUM(amount) FILTER(WHERE transaction_type='win'),0),
    COALESCE(SUM(amount) FILTER(WHERE transaction_type='refund'),0)
  INTO v_casino_stakes,v_casino_payouts,v_casino_refunds
  FROM public.casino_transactions WHERE created_at>=p_period_from AND created_at<p_period_to;

  SELECT
    COALESCE(SUM(stake) FILTER(WHERE status IN ('cashed_out','lost')),0),
    COALESCE(SUM(payout) FILTER(WHERE status='cashed_out'),0)
  INTO v_aviator_stakes,v_aviator_payouts
  FROM public.aviator_bets WHERE placed_at>=p_period_from AND placed_at<p_period_to;

  SELECT COALESCE(SUM(amount),0) INTO v_bonus_cost
  FROM public.wallet_transactions
  WHERE type='bonus_awarded' AND status='completed'
    AND created_at>=p_period_from AND created_at<p_period_to;

  SELECT COALESCE(SUM(amount),0) INTO v_partner_commission FROM (
    SELECT commission_amount AS amount FROM public.broker_commissions
    WHERE status IN ('accrued','approved','paid')
      AND created_at>=p_period_from AND created_at<p_period_to
    UNION ALL
    SELECT commission_amount AS amount FROM public.partner_vertical_commissions
    WHERE status='accrued' AND created_at>=p_period_from AND created_at<p_period_to
  ) partner_costs;

  SELECT COALESCE(SUM(amount),0) INTO v_deposits
  FROM public.wallet_transactions
  WHERE type='deposit' AND status='completed' AND amount>0
    AND created_at>=p_period_from AND created_at<p_period_to;

  SELECT
    COALESCE(SUM(amount) FILTER(WHERE adjustment_type='payment_fee'),0),
    COALESCE(SUM(amount) FILTER(WHERE adjustment_type='provider_fee'),0),
    COALESCE(SUM(amount) FILTER(WHERE adjustment_type='chargeback'),0),
    COALESCE(SUM(amount) FILTER(WHERE adjustment_type='refund'),0),
    COALESCE(SUM(amount) FILTER(WHERE adjustment_type='gaming_tax'),0),
    COALESCE(SUM(amount) FILTER(WHERE adjustment_type IN ('bonus_cost','affiliate_commission','other_cost')),0),
    COALESCE(SUM(amount) FILTER(WHERE adjustment_type='other_income'),0)
  INTO v_payment_fees,v_provider_fees,v_chargebacks,v_refunds,v_manual_tax,v_other_cost,v_other_income
  FROM public.finance_adjustments
  WHERE occurred_at>=p_period_from AND occurred_at<p_period_to;

  SELECT COALESCE(SUM(
    GREATEST(0,provider_ggr)*revenue_share_bps/10000.0
  ),0) INTO v_provider_share
  FROM (
    SELECT cp.id,cp.revenue_share_bps,
      COALESCE(SUM(ct.amount) FILTER(WHERE ct.transaction_type='bet'),0)
      -COALESCE(SUM(ct.amount) FILTER(WHERE ct.transaction_type='win'),0)
      -COALESCE(SUM(ct.amount) FILTER(WHERE ct.transaction_type='refund'),0) AS provider_ggr
    FROM public.casino_providers cp
    LEFT JOIN public.casino_transactions ct
      ON ct.provider_id=cp.id AND ct.created_at>=p_period_from AND ct.created_at<p_period_to
    WHERE cp.is_demo=FALSE
    GROUP BY cp.id,cp.revenue_share_bps
  ) provider_totals;

  v_sports_ggr:=v_sports_stakes-v_sports_payouts;
  v_casino_ggr:=v_casino_stakes-v_casino_payouts-v_casino_refunds;
  v_aviator_ggr:=v_aviator_stakes-v_aviator_payouts;
  v_ggr:=v_sports_ggr+v_casino_ggr+v_aviator_ggr;
  v_payment_fees:=v_payment_fees+ROUND(v_deposits*v_settings.payment_fee_bps/10000.0,2);
  v_gaming_tax:=v_manual_tax+ROUND(GREATEST(0,v_ggr)*v_settings.gaming_tax_bps/10000.0,2);
  v_ngr:=v_ggr+v_other_income-v_bonus_cost-v_partner_commission-v_provider_share-v_payment_fees
    -v_provider_fees-v_chargebacks-v_refunds-v_gaming_tax-v_other_cost;

  RETURN jsonb_build_object(
    'periodFrom',p_period_from,'periodTo',p_period_to,
    'sportsbook',jsonb_build_object('stakes',v_sports_stakes,'payouts',v_sports_payouts,'ggr',v_sports_ggr),
    'casino',jsonb_build_object('stakes',v_casino_stakes,'payouts',v_casino_payouts,'refunds',v_casino_refunds,'ggr',v_casino_ggr,'providerShare',ROUND(v_provider_share,2)),
    'aviator',jsonb_build_object('stakes',v_aviator_stakes,'payouts',v_aviator_payouts,'ggr',v_aviator_ggr),
    'deductions',jsonb_build_object(
      'bonusCost',v_bonus_cost,'partnerCommission',v_partner_commission,'paymentFees',v_payment_fees,
      'providerFees',v_provider_fees,'chargebacks',v_chargebacks,'refunds',v_refunds,
      'gamingTax',v_gaming_tax,'otherCost',v_other_cost,'otherIncome',v_other_income
    ),
    'deposits',v_deposits,'ggr',v_ggr,'ngr',v_ngr
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.reprice_sport_odds(p_sport_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE v_count INTEGER;
BEGIN
  IF NOT public.has_admin_role(ARRAY['super_admin','admin','sports_trader']) THEN
    RAISE EXCEPTION 'Trading authorization required';
  END IF;
  UPDATE public.odds o
  SET value=ROUND(GREATEST(1.01,o.provider_odds/(1+(LEAST(50,GREATEST(0,sc.default_margin))/100.0))),3),
      updated_at=NOW()
  FROM public.markets m
  JOIN public.events e ON e.id=m.event_id
  JOIN public.sport_config sc ON sc.sport_id=e.sport_id
  WHERE o.market_id=m.id AND e.sport_id=p_sport_id
    AND o.provider_odds IS NOT NULL AND o.provider_odds>=1.01 AND COALESCE(o.is_locked,FALSE)=FALSE;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END;
$$;


CREATE OR REPLACE FUNCTION public.get_my_broker_dashboard()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH mine AS (SELECT * FROM public.brokers WHERE user_id=auth.uid()),
  all_commissions AS (
    SELECT bc.broker_id,bc.gross_revenue,bc.commission_amount,bc.status
    FROM public.broker_commissions bc JOIN mine m ON m.id=bc.broker_id
    UNION ALL
    SELECT vc.broker_id,vc.gross_revenue,vc.commission_amount,vc.status
    FROM public.partner_vertical_commissions vc JOIN mine m ON m.id=vc.broker_id
  ),
  commission_totals AS (
    SELECT COALESCE(SUM(gross_revenue) FILTER(WHERE status<>'void'),0) AS gross_revenue,
      COALESCE(SUM(commission_amount) FILTER(WHERE status<>'void'),0) AS commission_earned
    FROM all_commissions
  ),
  player_totals AS (
    SELECT COUNT(*) FILTER(WHERE bp.is_active) AS players
    FROM mine m LEFT JOIN public.broker_players bp ON bp.broker_id=m.id
  ),
  payout_totals AS (
    SELECT COALESCE(SUM(pr.amount) FILTER(WHERE pr.status IN('pending','approved')),0) AS commission_reserved,
      COALESCE(SUM(pr.amount) FILTER(WHERE pr.status='paid'),0) AS commission_paid
    FROM mine m LEFT JOIN public.broker_payout_requests pr ON pr.broker_id=m.id
  )
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM mine) THEN NULL ELSE jsonb_build_object(
    'id',(SELECT id FROM mine),'companyName',(SELECT company_name FROM mine),
    'brokerCode',(SELECT broker_code FROM mine),'status',(SELECT status FROM mine),
    'commissionBps',(SELECT commission_bps FROM mine),'players',player_totals.players,
    'grossRevenue',commission_totals.gross_revenue,
    'commissionAvailable',GREATEST(commission_totals.commission_earned-payout_totals.commission_reserved-payout_totals.commission_paid,0),
    'commissionReserved',payout_totals.commission_reserved,'commissionPaid',payout_totals.commission_paid
  ) END FROM commission_totals,player_totals,payout_totals;
$$;

CREATE OR REPLACE FUNCTION public.request_broker_payout(p_amount NUMERIC,p_destination_reference TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user UUID:=auth.uid(); v_broker public.brokers%ROWTYPE; v_earned NUMERIC; v_committed NUMERIC; v_id UUID;
BEGIN
  SELECT * INTO v_broker FROM public.brokers WHERE user_id=v_user AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active partner account required'; END IF;
  IF p_amount<100 THEN RAISE EXCEPTION 'Minimum partner payout is 100'; END IF;
  IF length(trim(COALESCE(p_destination_reference,'')))<3 THEN RAISE EXCEPTION 'Approved payout destination is required'; END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_earned FROM (
    SELECT commission_amount AS amount FROM public.broker_commissions
      WHERE broker_id=v_broker.id AND status IN('accrued','approved','paid')
    UNION ALL
    SELECT commission_amount AS amount FROM public.partner_vertical_commissions
      WHERE broker_id=v_broker.id AND status='accrued'
  ) earned;
  SELECT COALESCE(SUM(amount),0) INTO v_committed
  FROM public.broker_payout_requests WHERE broker_id=v_broker.id AND status IN('pending','approved','paid');
  IF p_amount>v_earned-v_committed THEN RAISE EXCEPTION 'Payout amount exceeds available commission'; END IF;
  INSERT INTO public.broker_payout_requests(broker_id,amount,destination_reference)
  VALUES(v_broker.id,p_amount,trim(p_destination_reference)) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accrue_partner_casino_commission() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.accrue_partner_aviator_commission() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_my_broker_dashboard() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_broker_dashboard() TO authenticated;
REVOKE ALL ON FUNCTION public.request_broker_payout(NUMERIC,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_broker_payout(NUMERIC,TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.apply_configured_sport_margin() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reprice_sport_odds(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reprice_sport_odds(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.create_casino_provider_settlements(TIMESTAMPTZ,TIMESTAMPTZ,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_finance_summary(TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_casino_provider_settlements(TIMESTAMPTZ,TIMESTAMPTZ,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_finance_summary(TIMESTAMPTZ,TIMESTAMPTZ) TO service_role;


-- ============================================================
-- SOURCE: supabase/migrations/20261105100000_advanced_aviator_controls.sql
-- ============================================================

-- Advanced fairness-safe Aviator operations.
-- Admins can control limits, alerts, UX defaults and future statistical
-- configuration. No function can select a crash point for a player, stake,
-- active bet or active round.

ALTER TABLE public.aviator_settings
  ADD COLUMN IF NOT EXISTS maintenance_message TEXT NOT NULL DEFAULT 'Aviator is temporarily unavailable',
  ADD COLUMN IF NOT EXISTS max_bets_per_round INTEGER NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS max_round_exposure NUMERIC(18,2) NOT NULL DEFAULT 1000000,
  ADD COLUMN IF NOT EXISTS max_user_daily_wager NUMERIC(18,2) NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS max_user_daily_loss NUMERIC(18,2) NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS auto_cashout_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS min_auto_cashout NUMERIC(12,2) NOT NULL DEFAULT 1.10,
  ADD COLUMN IF NOT EXISTS max_auto_cashout NUMERIC(12,2) NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS reminder_minutes INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS high_exposure_alert_percent NUMERIC(5,2) NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS low_data_mode_default BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sound_enabled_default BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS vibration_enabled_default BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS dual_approval_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pending_settings JSONB,
  ADD COLUMN IF NOT EXISTS pending_settings_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS pending_settings_at TIMESTAMPTZ;

ALTER TABLE public.aviator_bets
  ADD COLUMN IF NOT EXISTS auto_cashout_multiplier NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS result_reason TEXT;

-- Keep newly introduced defaults valid for installations where an operator
-- previously lowered the global multiplier cap.
UPDATE public.aviator_settings
SET max_auto_cashout=LEAST(max_auto_cashout,max_multiplier),
    min_auto_cashout=LEAST(min_auto_cashout,LEAST(max_auto_cashout,max_multiplier));

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='aviator_settings_advanced_limits_check') THEN
    ALTER TABLE public.aviator_settings
      ADD CONSTRAINT aviator_settings_advanced_limits_check CHECK (
        max_bets_per_round BETWEEN 1 AND 100000
        AND max_round_exposure > 0
        AND max_user_daily_wager > 0
        AND max_user_daily_loss > 0
        AND min_auto_cashout BETWEEN 1.01 AND max_auto_cashout
        AND max_auto_cashout <= max_multiplier
        AND reminder_minutes BETWEEN 5 AND 240
        AND high_exposure_alert_percent BETWEEN 1 AND 100
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='aviator_bets_auto_cashout_check') THEN
    ALTER TABLE public.aviator_bets
      ADD CONSTRAINT aviator_bets_auto_cashout_check CHECK (
        auto_cashout_multiplier IS NULL OR auto_cashout_multiplier > 1
      );
  END IF;
END
$constraints$;

CREATE TABLE IF NOT EXISTS public.aviator_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID REFERENCES public.aviator_rounds(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('high_exposure','bet_capacity','daily_limit','engine')),
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS aviator_alerts_open_idx
  ON public.aviator_alerts(created_at DESC) WHERE acknowledged_at IS NULL;

CREATE TABLE IF NOT EXISTS public.aviator_setting_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  changed_by UUID NOT NULL REFERENCES public.profiles(id),
  approved_by UUID REFERENCES public.profiles(id),
  reason TEXT NOT NULL,
  settings JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS aviator_setting_versions_created_idx
  ON public.aviator_setting_versions(created_at DESC);

ALTER TABLE public.aviator_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aviator_setting_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aviator_alerts, public.aviator_setting_versions
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.aviator_is_operator()
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path=public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles
    WHERE id=auth.uid()
      AND is_admin=TRUE
      AND admin_role IN ('super_admin','admin','risk_manager')
      AND COALESCE(is_suspended,FALSE)=FALSE
  )
$$;
REVOKE ALL ON FUNCTION public.aviator_is_operator() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.aviator_is_operator() TO authenticated;

CREATE OR REPLACE FUNCTION public.aviator_process_auto_cashouts(
  p_round_id UUID,
  p_current_multiplier NUMERIC,
  p_now TIMESTAMPTZ
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_settings public.aviator_settings%ROWTYPE;
  v_bet public.aviator_bets%ROWTYPE;
  v_balance NUMERIC(18,2);
  v_payout NUMERIC(18,2);
  v_count INTEGER:=0;
BEGIN
  SELECT * INTO v_settings FROM public.aviator_settings WHERE id=TRUE;
  IF NOT v_settings.auto_cashout_enabled THEN RETURN 0; END IF;

  FOR v_bet IN
    SELECT * FROM public.aviator_bets
    WHERE round_id=p_round_id
      AND status='placed'
      AND auto_cashout_multiplier IS NOT NULL
      AND auto_cashout_multiplier<=p_current_multiplier
    FOR UPDATE
  LOOP
    v_payout:=LEAST(
      v_settings.max_payout,
      floor(v_bet.stake*v_bet.auto_cashout_multiplier*100)/100
    );
    SELECT COALESCE(demo_balance,0) INTO v_balance
    FROM public.profiles WHERE id=v_bet.user_id FOR UPDATE;

    UPDATE public.aviator_bets
    SET status='cashed_out',
        cashout_multiplier=v_bet.auto_cashout_multiplier,
        payout=v_payout,
        result_reason='auto_cashout',
        settled_at=p_now
    WHERE id=v_bet.id AND status='placed';

    IF FOUND THEN
      UPDATE public.profiles
      SET demo_balance=COALESCE(demo_balance,0)+v_payout,updated_at=NOW()
      WHERE id=v_bet.user_id;

      INSERT INTO public.wallet_transactions(
        user_id,type,amount,balance_before,balance_after,description,
        reference_id,status,metadata
      ) VALUES(
        v_bet.user_id,'bet_won',v_payout,v_balance,v_balance+v_payout,
        'Aviator automatic cash-out',v_bet.id,'completed',
        jsonb_build_object(
          'game','aviator','round_id',p_round_id,
          'multiplier',v_bet.auto_cashout_multiplier,'automatic',TRUE
        )
      );
      v_count:=v_count+1;
    END IF;
  END LOOP;
  RETURN v_count;
END
$$;
REVOKE ALL ON FUNCTION public.aviator_process_auto_cashouts(UUID,NUMERIC,TIMESTAMPTZ)
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.aviator_sync_round()
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_settings public.aviator_settings%ROWTYPE;
  v_round public.aviator_rounds%ROWTYPE;
  v_seed TEXT;
  v_hash TEXT;
  v_client TEXT:='mindbetpro-public-v2';
  v_nonce BIGINT;
  v_crash NUMERIC;
  v_current NUMERIC;
  v_now TIMESTAMPTZ:=clock_timestamp();
  v_start TIMESTAMPTZ;
  v_crash_at TIMESTAMPTZ;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('primebet-aviator-engine'));
  SELECT * INTO v_settings FROM public.aviator_settings WHERE id=TRUE FOR UPDATE;
  SELECT * INTO v_round FROM public.aviator_rounds
  ORDER BY round_number DESC LIMIT 1 FOR UPDATE;

  IF v_settings.is_paused OR NOT v_settings.is_enabled THEN
    RETURN v_round.id;
  END IF;

  IF v_round.id IS NOT NULL AND v_round.status='betting' AND v_now>=v_round.betting_closes_at THEN
    UPDATE public.aviator_rounds SET status='running' WHERE id=v_round.id;
    v_round.status:='running';
  END IF;

  IF v_round.id IS NOT NULL AND v_round.status='running' AND v_now<v_round.crashed_at THEN
    v_current:=LEAST(
      v_round.crash_multiplier,
      floor(EXP(EXTRACT(EPOCH FROM (v_now-v_round.started_at))*v_round.growth_rate::DOUBLE PRECISION)*100)/100
    );
    PERFORM public.aviator_process_auto_cashouts(v_round.id,v_current,v_now);
  END IF;

  IF v_round.id IS NOT NULL AND v_round.status='running' AND v_now>=v_round.crashed_at THEN
    PERFORM public.aviator_process_auto_cashouts(v_round.id,v_round.crash_multiplier,v_round.crashed_at);
    UPDATE public.aviator_rounds
    SET status='crashed',server_seed_reveal=server_seed_secret
    WHERE id=v_round.id;
    UPDATE public.aviator_bets
    SET status='lost',result_reason='crash',settled_at=v_now
    WHERE round_id=v_round.id AND status='placed';
    v_round.status:='crashed';
    v_round.server_seed_reveal:=v_round.server_seed_secret;
  END IF;

  IF v_round.id IS NOT NULL AND (
    v_round.status IN ('betting','running')
    OR (v_round.status='crashed' AND v_now<v_round.next_round_at)
  ) THEN RETURN v_round.id; END IF;

  -- A fresh random seed is generated for every round. This is stronger than
  -- periodic seed rotation and keeps every future outcome independently committed.
  v_seed:=encode(extensions.gen_random_bytes(32),'hex');
  v_hash:=encode(extensions.digest(v_seed,'sha256'),'hex');
  SELECT COALESCE(MAX(round_number),0)+1 INTO v_nonce FROM public.aviator_rounds;
  v_crash:=public.aviator_calculate_crash(
    v_seed,v_client,v_nonce,v_settings.house_edge_percent,v_settings.max_multiplier
  );
  v_start:=v_now+make_interval(secs=>v_settings.betting_seconds);
  v_crash_at:=v_start+make_interval(
    secs=>LN(v_crash::DOUBLE PRECISION)/v_settings.growth_rate::DOUBLE PRECISION
  );

  INSERT INTO public.aviator_rounds(
    status,server_seed_hash,server_seed_secret,client_seed,nonce,crash_multiplier,
    growth_rate,betting_closes_at,started_at,crashed_at,next_round_at
  ) VALUES(
    'betting',v_hash,v_seed,v_client,v_nonce,v_crash,v_settings.growth_rate,
    v_start,v_start,v_crash_at,
    v_crash_at+make_interval(secs=>v_settings.cooldown_seconds)
  ) RETURNING id INTO v_round.id;
  RETURN v_round.id;
END
$$;
REVOKE ALL ON FUNCTION public.aviator_sync_round() FROM PUBLIC,anon,authenticated;

DROP FUNCTION IF EXISTS public.aviator_place_bet(NUMERIC);
CREATE FUNCTION public.aviator_place_bet(
  p_stake NUMERIC,
  p_auto_cashout NUMERIC DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_user UUID:=auth.uid();
  v_round_id UUID;
  v_round public.aviator_rounds%ROWTYPE;
  v_settings public.aviator_settings%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_stake NUMERIC(15,2):=ROUND(p_stake,2);
  v_auto NUMERIC(12,2):=CASE WHEN p_auto_cashout IS NULL THEN NULL ELSE ROUND(p_auto_cashout,2) END;
  v_daily_wager NUMERIC(18,2);
  v_daily_loss NUMERIC(18,2);
  v_exposure NUMERIC(18,2);
  v_projected NUMERIC(18,2);
  v_bet_count INTEGER;
  v_tx UUID;
  v_bet UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_round_id:=public.aviator_sync_round();
  SELECT * INTO v_settings FROM public.aviator_settings WHERE id=TRUE;
  SELECT * INTO v_round FROM public.aviator_rounds WHERE id=v_round_id FOR UPDATE;

  IF NOT v_settings.is_enabled OR v_settings.is_paused
    OR v_round.status<>'betting' OR clock_timestamp()>=v_round.betting_closes_at
  THEN RAISE EXCEPTION '%',v_settings.maintenance_message; END IF;

  IF v_stake<v_settings.min_stake OR v_stake>v_settings.max_stake THEN
    RAISE EXCEPTION 'Stake is outside the allowed limits';
  END IF;
  IF v_auto IS NOT NULL AND (
    NOT v_settings.auto_cashout_enabled
    OR v_auto<v_settings.min_auto_cashout
    OR v_auto>v_settings.max_auto_cashout
  ) THEN RAISE EXCEPTION 'Automatic cash-out is outside the allowed range'; END IF;

  SELECT COUNT(*) INTO v_bet_count
  FROM public.aviator_bets WHERE round_id=v_round_id;
  IF v_bet_count>=v_settings.max_bets_per_round THEN
    RAISE EXCEPTION 'This round has reached its bet capacity';
  END IF;

  SELECT COALESCE(SUM(stake),0) INTO v_daily_wager
  FROM public.aviator_bets
  WHERE user_id=v_user AND placed_at>=NOW()-INTERVAL '24 hours';

  SELECT COALESCE(SUM(
    CASE
      WHEN status='lost' THEN stake
      WHEN status='cashed_out' THEN GREATEST(stake-payout,0)
      ELSE 0
    END
  ),0) INTO v_daily_loss
  FROM public.aviator_bets
  WHERE user_id=v_user AND placed_at>=NOW()-INTERVAL '24 hours';

  IF v_daily_wager+v_stake>v_settings.max_user_daily_wager THEN
    RAISE EXCEPTION 'Daily Aviator wager limit reached';
  END IF;
  IF v_daily_loss>=v_settings.max_user_daily_loss THEN
    RAISE EXCEPTION 'Daily Aviator loss limit reached';
  END IF;

  SELECT COALESCE(SUM(LEAST(
    v_settings.max_payout,
    stake*COALESCE(auto_cashout_multiplier,v_settings.max_multiplier)
  )),0) INTO v_exposure
  FROM public.aviator_bets
  WHERE round_id=v_round_id AND status='placed';

  v_projected:=v_exposure+LEAST(
    v_settings.max_payout,
    v_stake*COALESCE(v_auto,v_settings.max_multiplier)
  );
  IF v_projected>v_settings.max_round_exposure THEN
    RAISE EXCEPTION 'Round exposure limit reached';
  END IF;

  SELECT * INTO v_profile FROM public.profiles
  WHERE id=v_user AND COALESCE(is_admin,FALSE)=FALSE FOR UPDATE;
  IF NOT FOUND OR v_profile.is_suspended
    OR COALESCE(v_profile.account_status,'active')<>'active'
    OR COALESCE(v_profile.wallet_frozen,FALSE)
    OR COALESCE(v_profile.betting_disabled,FALSE)
  THEN RAISE EXCEPTION 'Account is not eligible for Aviator betting'; END IF;
  IF COALESCE(v_profile.demo_balance,0)<v_stake THEN
    RAISE EXCEPTION 'Insufficient wallet balance';
  END IF;

  INSERT INTO public.aviator_bets(
    round_id,user_id,stake,auto_cashout_multiplier
  ) VALUES(v_round_id,v_user,v_stake,v_auto)
  RETURNING id INTO v_bet;

  UPDATE public.profiles
  SET demo_balance=demo_balance-v_stake,updated_at=NOW() WHERE id=v_user;
  INSERT INTO public.wallet_transactions(
    user_id,type,amount,balance_before,balance_after,description,
    reference_id,status,metadata
  ) VALUES(
    v_user,'bet_placed',-v_stake,v_profile.demo_balance,v_profile.demo_balance-v_stake,
    'Aviator bet placed',v_bet,'completed',
    jsonb_build_object(
      'game','aviator','round_id',v_round_id,'auto_cashout',v_auto
    )
  ) RETURNING id INTO v_tx;
  UPDATE public.aviator_bets SET wallet_transaction_id=v_tx WHERE id=v_bet;

  IF v_projected>=v_settings.max_round_exposure*v_settings.high_exposure_alert_percent/100
    AND NOT EXISTS(
      SELECT 1 FROM public.aviator_alerts
      WHERE round_id=v_round_id AND alert_type='high_exposure' AND acknowledged_at IS NULL
    )
  THEN
    INSERT INTO public.aviator_alerts(round_id,alert_type,severity,message,metadata)
    VALUES(
      v_round_id,'high_exposure','warning','Aviator round exposure crossed the configured alert threshold',
      jsonb_build_object('exposure',v_projected,'limit',v_settings.max_round_exposure)
    );
  END IF;

  RETURN public.aviator_get_state();
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Only one Aviator bet is allowed per round';
END
$$;
REVOKE ALL ON FUNCTION public.aviator_place_bet(NUMERIC,NUMERIC) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.aviator_place_bet(NUMERIC,NUMERIC) TO authenticated;

CREATE OR REPLACE FUNCTION public.aviator_get_state()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_round_id UUID;
  v_round public.aviator_rounds%ROWTYPE;
  v_settings public.aviator_settings%ROWTYPE;
  v_bet public.aviator_bets%ROWTYPE;
  v_now TIMESTAMPTZ:=clock_timestamp();
  v_phase TEXT;
  v_current NUMERIC:=1;
  v_history JSONB;
BEGIN
  v_round_id:=public.aviator_sync_round();
  SELECT * INTO v_settings FROM public.aviator_settings WHERE id=TRUE;
  IF v_round_id IS NOT NULL THEN
    SELECT * INTO v_round FROM public.aviator_rounds WHERE id=v_round_id;
  END IF;
  IF auth.uid() IS NOT NULL AND v_round_id IS NOT NULL THEN
    SELECT * INTO v_bet FROM public.aviator_bets
    WHERE round_id=v_round_id AND user_id=auth.uid();
  END IF;

  IF v_settings.is_paused OR NOT v_settings.is_enabled THEN v_phase:='paused';
  ELSIF v_round.status='betting' THEN v_phase:='betting';
  ELSIF v_round.status='running' THEN
    v_phase:='running';
    v_current:=LEAST(
      v_round.crash_multiplier,
      floor(EXP(EXTRACT(EPOCH FROM (v_now-v_round.started_at))*v_round.growth_rate::DOUBLE PRECISION)*100)/100
    );
  ELSE v_phase:='crashed';v_current:=v_round.crash_multiplier;
  END IF;

  SELECT COALESCE(jsonb_agg(item ORDER BY round_number DESC),'[]'::JSONB) INTO v_history
  FROM (
    SELECT round_number,jsonb_build_object(
      'round_number',round_number,'crash_multiplier',crash_multiplier,
      'server_seed_hash',server_seed_hash,'server_seed_reveal',server_seed_reveal,
      'client_seed',client_seed,'nonce',nonce,'crashed_at',crashed_at
    ) AS item
    FROM public.aviator_rounds WHERE status='crashed'
    ORDER BY round_number DESC LIMIT 20
  ) history_rows;

  RETURN jsonb_build_object(
    'server_time',v_now,'phase',v_phase,
    'current_multiplier',COALESCE(v_current,1),
    'settings',jsonb_build_object(
      'is_enabled',v_settings.is_enabled,'is_paused',v_settings.is_paused,
      'maintenance_message',v_settings.maintenance_message,
      'betting_seconds',v_settings.betting_seconds,
      'cooldown_seconds',v_settings.cooldown_seconds,
      'growth_rate',v_settings.growth_rate,
      'min_stake',v_settings.min_stake,'max_stake',v_settings.max_stake,
      'max_multiplier',v_settings.max_multiplier,'max_payout',v_settings.max_payout,
      'house_edge_percent',v_settings.house_edge_percent,
      'auto_cashout_enabled',v_settings.auto_cashout_enabled,
      'min_auto_cashout',v_settings.min_auto_cashout,
      'max_auto_cashout',v_settings.max_auto_cashout,
      'reminder_minutes',v_settings.reminder_minutes,
      'low_data_mode_default',v_settings.low_data_mode_default,
      'sound_enabled_default',v_settings.sound_enabled_default,
      'vibration_enabled_default',v_settings.vibration_enabled_default
    ),
    'round',CASE WHEN v_round.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',v_round.id,'round_number',v_round.round_number,'status',v_round.status,
      'server_seed_hash',v_round.server_seed_hash,
      'server_seed_reveal',CASE WHEN v_round.status='crashed' THEN v_round.server_seed_reveal ELSE NULL END,
      'client_seed',v_round.client_seed,'nonce',v_round.nonce,
      'crash_multiplier',CASE WHEN v_round.status='crashed' THEN v_round.crash_multiplier ELSE NULL END,
      'betting_closes_at',v_round.betting_closes_at,'started_at',v_round.started_at,
      'next_round_at',v_round.next_round_at
    ) END,
    'my_bet',CASE WHEN v_bet.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',v_bet.id,'stake',v_bet.stake,'status',v_bet.status,
      'auto_cashout_multiplier',v_bet.auto_cashout_multiplier,
      'cashout_multiplier',v_bet.cashout_multiplier,'payout',v_bet.payout,
      'result_reason',v_bet.result_reason
    ) END,
    'history',v_history
  );
END
$$;
REVOKE ALL ON FUNCTION public.aviator_get_state() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aviator_get_state() TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.aviator_apply_settings_json(
  p_settings JSONB,
  p_actor UUID,
  p_reason TEXT,
  p_approved_by UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_previous public.aviator_settings%ROWTYPE;
  v_next JSONB;
  v_bet RECORD;
  v_balance NUMERIC;
  v_enabled BOOLEAN;
  v_paused BOOLEAN;
  v_betting INTEGER;
  v_cooldown INTEGER;
  v_growth NUMERIC;
  v_min NUMERIC;
  v_max NUMERIC;
  v_max_multiplier NUMERIC;
  v_max_payout NUMERIC;
  v_edge NUMERIC;
  v_max_bets INTEGER;
  v_exposure NUMERIC;
  v_daily_wager NUMERIC;
  v_daily_loss NUMERIC;
  v_auto_enabled BOOLEAN;
  v_auto_min NUMERIC;
  v_auto_max NUMERIC;
  v_reminder INTEGER;
  v_alert NUMERIC;
  v_low_data BOOLEAN;
  v_sound BOOLEAN;
  v_vibration BOOLEAN;
  v_dual BOOLEAN;
  v_message TEXT;
BEGIN
  SELECT * INTO v_previous FROM public.aviator_settings WHERE id=TRUE FOR UPDATE;

  v_enabled:=COALESCE((p_settings->>'is_enabled')::BOOLEAN,v_previous.is_enabled);
  v_paused:=COALESCE((p_settings->>'is_paused')::BOOLEAN,v_previous.is_paused);
  v_betting:=COALESCE((p_settings->>'betting_seconds')::INTEGER,v_previous.betting_seconds);
  v_cooldown:=COALESCE((p_settings->>'cooldown_seconds')::INTEGER,v_previous.cooldown_seconds);
  v_growth:=COALESCE((p_settings->>'growth_rate')::NUMERIC,v_previous.growth_rate);
  v_min:=COALESCE((p_settings->>'min_stake')::NUMERIC,v_previous.min_stake);
  v_max:=COALESCE((p_settings->>'max_stake')::NUMERIC,v_previous.max_stake);
  v_max_multiplier:=COALESCE((p_settings->>'max_multiplier')::NUMERIC,v_previous.max_multiplier);
  v_max_payout:=COALESCE((p_settings->>'max_payout')::NUMERIC,v_previous.max_payout);
  v_edge:=COALESCE((p_settings->>'house_edge_percent')::NUMERIC,v_previous.house_edge_percent);
  v_max_bets:=COALESCE((p_settings->>'max_bets_per_round')::INTEGER,v_previous.max_bets_per_round);
  v_exposure:=COALESCE((p_settings->>'max_round_exposure')::NUMERIC,v_previous.max_round_exposure);
  v_daily_wager:=COALESCE((p_settings->>'max_user_daily_wager')::NUMERIC,v_previous.max_user_daily_wager);
  v_daily_loss:=COALESCE((p_settings->>'max_user_daily_loss')::NUMERIC,v_previous.max_user_daily_loss);
  v_auto_enabled:=COALESCE((p_settings->>'auto_cashout_enabled')::BOOLEAN,v_previous.auto_cashout_enabled);
  v_auto_min:=COALESCE((p_settings->>'min_auto_cashout')::NUMERIC,v_previous.min_auto_cashout);
  v_auto_max:=COALESCE((p_settings->>'max_auto_cashout')::NUMERIC,v_previous.max_auto_cashout);
  v_reminder:=COALESCE((p_settings->>'reminder_minutes')::INTEGER,v_previous.reminder_minutes);
  v_alert:=COALESCE((p_settings->>'high_exposure_alert_percent')::NUMERIC,v_previous.high_exposure_alert_percent);
  v_low_data:=COALESCE((p_settings->>'low_data_mode_default')::BOOLEAN,v_previous.low_data_mode_default);
  v_sound:=COALESCE((p_settings->>'sound_enabled_default')::BOOLEAN,v_previous.sound_enabled_default);
  v_vibration:=COALESCE((p_settings->>'vibration_enabled_default')::BOOLEAN,v_previous.vibration_enabled_default);
  v_dual:=COALESCE((p_settings->>'dual_approval_required')::BOOLEAN,v_previous.dual_approval_required);
  v_message:=LEFT(COALESCE(NULLIF(TRIM(p_settings->>'maintenance_message'),''),v_previous.maintenance_message),240);

  IF v_betting NOT BETWEEN 3 AND 30 OR v_cooldown NOT BETWEEN 2 AND 15
    OR v_growth NOT BETWEEN 0.03 AND 0.50 OR v_min<=0 OR v_max<v_min
    OR v_max_multiplier NOT BETWEEN 2 AND 100000 OR v_max_payout<=0
    OR v_edge NOT BETWEEN 0 AND 10 OR v_max_bets NOT BETWEEN 1 AND 100000
    OR v_exposure<=0 OR v_daily_wager<=0 OR v_daily_loss<=0
    OR v_auto_min<1.01 OR v_auto_max<v_auto_min OR v_auto_max>v_max_multiplier
    OR v_reminder NOT BETWEEN 5 AND 240 OR v_alert NOT BETWEEN 1 AND 100
  THEN RAISE EXCEPTION 'Invalid advanced Aviator settings'; END IF;

  IF v_paused AND NOT v_previous.is_paused THEN
    FOR v_bet IN
      SELECT b.* FROM public.aviator_bets b
      JOIN public.aviator_rounds r ON r.id=b.round_id
      WHERE b.status='placed' AND r.status IN ('betting','running')
      FOR UPDATE OF b
    LOOP
      SELECT COALESCE(demo_balance,0) INTO v_balance
      FROM public.profiles WHERE id=v_bet.user_id FOR UPDATE;
      UPDATE public.profiles
      SET demo_balance=COALESCE(demo_balance,0)+v_bet.stake,updated_at=NOW()
      WHERE id=v_bet.user_id;
      INSERT INTO public.wallet_transactions(
        user_id,type,amount,balance_before,balance_after,description,
        reference_id,status,metadata
      ) VALUES(
        v_bet.user_id,'adjustment',v_bet.stake,v_balance,v_balance+v_bet.stake,
        'Aviator safe-pause refund',v_bet.id,'completed',
        jsonb_build_object('game','aviator','reason','admin_pause')
      );
      UPDATE public.aviator_bets
      SET status='refunded',payout=v_bet.stake,result_reason='admin_pause',settled_at=NOW()
      WHERE id=v_bet.id;
    END LOOP;
    UPDATE public.aviator_rounds
    SET status='crashed',crash_multiplier=1,crashed_at=NOW(),next_round_at=NOW(),
        server_seed_reveal=server_seed_secret
    WHERE status IN ('betting','running');
  END IF;

  UPDATE public.aviator_settings SET
    is_enabled=v_enabled,is_paused=v_paused,maintenance_message=v_message,
    betting_seconds=v_betting,cooldown_seconds=v_cooldown,growth_rate=v_growth,
    min_stake=v_min,max_stake=v_max,max_multiplier=v_max_multiplier,
    max_payout=v_max_payout,house_edge_percent=v_edge,
    max_bets_per_round=v_max_bets,max_round_exposure=v_exposure,
    max_user_daily_wager=v_daily_wager,max_user_daily_loss=v_daily_loss,
    auto_cashout_enabled=v_auto_enabled,min_auto_cashout=v_auto_min,
    max_auto_cashout=v_auto_max,reminder_minutes=v_reminder,
    high_exposure_alert_percent=v_alert,low_data_mode_default=v_low_data,
    sound_enabled_default=v_sound,vibration_enabled_default=v_vibration,
    dual_approval_required=v_dual,updated_by=p_actor,updated_at=NOW()
  WHERE id=TRUE;

  SELECT to_jsonb(s)-'pending_settings'-'pending_settings_by'-'pending_settings_at'
  INTO v_next FROM public.aviator_settings s WHERE id=TRUE;

  INSERT INTO public.aviator_setting_versions(changed_by,approved_by,reason,settings)
  VALUES(p_actor,p_approved_by,p_reason,v_next);
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes)
  VALUES(p_actor,'aviator_settings_applied','aviator_settings',NULL,
    jsonb_build_object('reason',p_reason,'approved_by',p_approved_by,'before',to_jsonb(v_previous),'after',v_next));

  RETURN public.aviator_get_state();
END
$$;
REVOKE ALL ON FUNCTION public.aviator_apply_settings_json(JSONB,UUID,TEXT,UUID)
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.aviator_admin_update_advanced_settings(
  p_settings JSONB,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_admin UUID:=auth.uid();
  v_current public.aviator_settings%ROWTYPE;
  v_state JSONB;
BEGIN
  IF NOT public.aviator_is_operator() THEN
    RAISE EXCEPTION 'Aviator operator authorization required';
  END IF;
  IF char_length(TRIM(COALESCE(p_reason,'')))<5 THEN
    RAISE EXCEPTION 'A meaningful settings reason is required';
  END IF;

  SELECT * INTO v_current FROM public.aviator_settings WHERE id=TRUE FOR UPDATE;
  IF v_current.dual_approval_required THEN
    UPDATE public.aviator_settings
    SET pending_settings=p_settings,pending_settings_by=v_admin,
        pending_settings_at=NOW(),updated_at=NOW()
    WHERE id=TRUE;
    INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes)
    VALUES(v_admin,'aviator_settings_proposed','aviator_settings',NULL,
      jsonb_build_object('reason',TRIM(p_reason),'settings',p_settings));
    RETURN jsonb_build_object('status','pending','state',public.aviator_get_state());
  END IF;

  v_state:=public.aviator_apply_settings_json(p_settings,v_admin,TRIM(p_reason),NULL);
  RETURN jsonb_build_object('status','applied','state',v_state);
END
$$;
REVOKE ALL ON FUNCTION public.aviator_admin_update_advanced_settings(JSONB,TEXT)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.aviator_admin_update_advanced_settings(JSONB,TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.aviator_admin_approve_pending(
  p_approve BOOLEAN,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_admin UUID:=auth.uid();
  v_current public.aviator_settings%ROWTYPE;
  v_state JSONB;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.profiles
    WHERE id=v_admin AND is_admin=TRUE AND admin_role='super_admin'
      AND COALESCE(is_suspended,FALSE)=FALSE
  ) THEN RAISE EXCEPTION 'Super admin approval required'; END IF;
  IF char_length(TRIM(COALESCE(p_reason,'')))<5 THEN
    RAISE EXCEPTION 'A meaningful approval reason is required';
  END IF;

  SELECT * INTO v_current FROM public.aviator_settings WHERE id=TRUE FOR UPDATE;
  IF v_current.pending_settings IS NULL THEN
    RAISE EXCEPTION 'No pending Aviator settings';
  END IF;
  IF v_current.pending_settings_by=v_admin THEN
    RAISE EXCEPTION 'A different super admin must approve this change';
  END IF;

  IF p_approve THEN
    v_state:=public.aviator_apply_settings_json(
      v_current.pending_settings,v_current.pending_settings_by,
      TRIM(p_reason),v_admin
    );
  ELSE
    v_state:=public.aviator_get_state();
    INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes)
    VALUES(v_admin,'aviator_settings_rejected','aviator_settings',NULL,
      jsonb_build_object('reason',TRIM(p_reason),'proposed_by',v_current.pending_settings_by));
  END IF;

  UPDATE public.aviator_settings
  SET pending_settings=NULL,pending_settings_by=NULL,pending_settings_at=NULL,updated_at=NOW()
  WHERE id=TRUE;

  RETURN jsonb_build_object('status',CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,'state',v_state);
END
$$;
REVOKE ALL ON FUNCTION public.aviator_admin_approve_pending(BOOLEAN,TEXT)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.aviator_admin_approve_pending(BOOLEAN,TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.aviator_admin_acknowledge_alert(p_alert_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF NOT public.aviator_is_operator() THEN
    RAISE EXCEPTION 'Aviator operator authorization required';
  END IF;
  UPDATE public.aviator_alerts
  SET acknowledged_at=NOW(),acknowledged_by=auth.uid()
  WHERE id=p_alert_id AND acknowledged_at IS NULL;
END
$$;
REVOKE ALL ON FUNCTION public.aviator_admin_acknowledge_alert(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.aviator_admin_acknowledge_alert(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.aviator_admin_get_dashboard()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_settings public.aviator_settings%ROWTYPE;
  v_round public.aviator_rounds%ROWTYPE;
  v_wager NUMERIC;
  v_payout NUMERIC;
  v_active INTEGER;
  v_exposure NUMERIC;
  v_alerts JSONB;
  v_versions JSONB;
BEGIN
  IF NOT public.aviator_is_operator() THEN
    RAISE EXCEPTION 'Aviator operator authorization required';
  END IF;
  PERFORM public.aviator_sync_round();
  SELECT * INTO v_settings FROM public.aviator_settings WHERE id=TRUE;
  SELECT * INTO v_round FROM public.aviator_rounds ORDER BY round_number DESC LIMIT 1;

  SELECT COALESCE(SUM(stake),0),COALESCE(SUM(payout),0)
  INTO v_wager,v_payout
  FROM public.aviator_bets WHERE placed_at>=NOW()-INTERVAL '24 hours';

  SELECT COUNT(*),COALESCE(SUM(LEAST(
    v_settings.max_payout,
    stake*COALESCE(auto_cashout_multiplier,v_settings.max_multiplier)
  )),0)
  INTO v_active,v_exposure
  FROM public.aviator_bets
  WHERE round_id=v_round.id AND status='placed';

  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC),'[]'::JSONB)
  INTO v_alerts FROM (
    SELECT id,round_id,alert_type,severity,message,metadata,created_at
    FROM public.aviator_alerts
    WHERE acknowledged_at IS NULL ORDER BY created_at DESC LIMIT 20
  ) a;

  SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v.created_at DESC),'[]'::JSONB)
  INTO v_versions FROM (
    SELECT id,changed_by,approved_by,reason,settings,created_at
    FROM public.aviator_setting_versions ORDER BY created_at DESC LIMIT 10
  ) v;

  RETURN jsonb_build_object(
    'settings',to_jsonb(v_settings)-'pending_settings',
    'pending_settings',v_settings.pending_settings,
    'pending_settings_by',v_settings.pending_settings_by,
    'pending_settings_at',v_settings.pending_settings_at,
    'metrics',jsonb_build_object(
      'wager_24h',v_wager,'payout_24h',v_payout,
      'gross_gaming_revenue_24h',v_wager-v_payout,
      'rtp_24h',CASE WHEN v_wager>0 THEN ROUND(v_payout/v_wager*100,2) ELSE 0 END,
      'active_bets',v_active,'round_exposure',v_exposure,
      'round_exposure_percent',CASE WHEN v_settings.max_round_exposure>0
        THEN ROUND(v_exposure/v_settings.max_round_exposure*100,2) ELSE 0 END
    ),
    'alerts',v_alerts,'versions',v_versions
  );
END
$$;
REVOKE ALL ON FUNCTION public.aviator_admin_get_dashboard() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.aviator_admin_get_dashboard() TO authenticated;

-- Preserve compatibility while routing every basic save through the audited
-- advanced settings workflow.
CREATE OR REPLACE FUNCTION public.aviator_admin_update_settings(
  p_is_enabled BOOLEAN,p_is_paused BOOLEAN,p_betting_seconds INTEGER,
  p_cooldown_seconds INTEGER,p_growth_rate NUMERIC,p_min_stake NUMERIC,
  p_max_stake NUMERIC,p_max_multiplier NUMERIC,p_max_payout NUMERIC,
  p_house_edge_percent NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  RETURN public.aviator_admin_update_advanced_settings(
    jsonb_build_object(
      'is_enabled',p_is_enabled,'is_paused',p_is_paused,
      'betting_seconds',p_betting_seconds,'cooldown_seconds',p_cooldown_seconds,
      'growth_rate',p_growth_rate,'min_stake',p_min_stake,
      'max_stake',p_max_stake,'max_multiplier',p_max_multiplier,
      'max_payout',p_max_payout,'house_edge_percent',p_house_edge_percent
    ),
    'Basic Aviator settings update'
  );
END
$$;
REVOKE ALL ON FUNCTION public.aviator_admin_update_settings(
  BOOLEAN,BOOLEAN,INTEGER,INTEGER,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC
) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.aviator_admin_update_settings(
  BOOLEAN,BOOLEAN,INTEGER,INTEGER,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC
) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_approved_wallet_operation()
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_catalog
AS $$
DECLARE v_context TEXT;
BEGIN
  GET DIAGNOSTICS v_context=PG_CONTEXT;
  RETURN v_context ~
    'PL/pgSQL function (public\.)?(place_bet_atomic|place_system_bet_atomic|cancel_bet_atomic|settle_bet|process_next_settlement_job|settle_ready_system_bet|accept_cashout|process_early_payout_for_event|aviator_place_bet|aviator_cashout|aviator_admin_update_settings|aviator_apply_settings_json|aviator_process_auto_cashouts|transfer_user_bonus_funds|claim_promotion|award_bonus|apply_crypto_deposit_update|review_manual_deposit_request|finalize_manual_deposit_approval|submit_manual_withdrawal_request|reject_manual_withdrawal|apply_casino_transaction|admin_credit_user_balance|admin_adjust_user_balance)\(';
END
$$;
REVOKE ALL ON FUNCTION public.is_approved_wallet_operation()
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.protect_profile_system_fields()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_catalog
AS $$
BEGIN
  IF NOT public.is_service_role() THEN
    IF NEW.demo_balance IS DISTINCT FROM OLD.demo_balance
      AND NOT public.is_approved_wallet_operation()
    THEN
      RAISE EXCEPTION 'Profile balance must be changed through an approved server operation';
    END IF;

    IF (
      NEW.id IS DISTINCT FROM OLD.id
      OR NEW.email IS DISTINCT FROM OLD.email
      OR NEW.is_admin IS DISTINCT FROM OLD.is_admin
      OR NEW.admin_role IS DISTINCT FROM OLD.admin_role
    ) AND NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Only a super admin can change admin authority';
    END IF;

    IF NOT public.is_admin() AND (
      NEW.kyc_status IS DISTINCT FROM OLD.kyc_status
      OR NEW.is_verified IS DISTINCT FROM OLD.is_verified
      OR NEW.is_suspended IS DISTINCT FROM OLD.is_suspended
      OR NEW.suspension_reason IS DISTINCT FROM OLD.suspension_reason
      OR NEW.referral_code IS DISTINCT FROM OLD.referral_code
      OR NEW.referred_by IS DISTINCT FROM OLD.referred_by
    ) THEN
      RAISE EXCEPTION 'Protected profile fields cannot be changed by this user';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS protect_profile_system_fields_trigger ON public.profiles;
CREATE TRIGGER protect_profile_system_fields_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_system_fields();

REVOKE ALL ON FUNCTION public.protect_profile_system_fields()
  FROM PUBLIC,anon,authenticated;

NOTIFY pgrst,'reload schema';


-- ============================================================
-- SOURCE: supabase/migrations/20261105110000_admin_platform_health_check.sql
-- ============================================================

-- Read-only schema diagnostics for the super-admin readiness page.
-- This does not expose data or secret values.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_platform_health_check()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_missing_tables JSONB;
  v_missing_functions JSONB;
  v_required_tables TEXT[] := ARRAY[
    'profiles',
    'audit_logs',
    'bets',
    'kyc_documents',
    'sports',
    'leagues',
    'events',
    'markets',
    'odds',
    'sports_feed_providers',
    'wallet_transactions',
    'ledger_accounts',
    'admin_balance_adjustments',
    'payment_methods',
    'manual_deposit_requests',
    'manual_withdrawal_requests',
    'support_tickets',
    'promotions',
    'casino_games',
    'feature_flags',
    'aviator_settings',
    'aviator_rounds'
  ];
  v_required_functions TEXT[] := ARRAY[
    'has_admin_role',
    'admin_adjust_user_balance',
    'get_user_wallet_balance',
    'review_kyc_document_manual',
    'hard_purge_customer',
    'aviator_get_state',
    'aviator_admin_get_dashboard',
    'save_payment_method',
    'reply_support_ticket',
    'get_finance_summary',
    'save_feature_flag'
  ];
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND is_admin = TRUE
        AND admin_role = 'super_admin'
        AND COALESCE(is_suspended, FALSE) = FALSE
    )
  THEN
    RAISE EXCEPTION 'Super admin authorization required';
  END IF;

  SELECT COALESCE(jsonb_agg(name ORDER BY name), '[]'::JSONB)
  INTO v_missing_tables
  FROM unnest(v_required_tables) AS name
  WHERE to_regclass(format('public.%I', name)) IS NULL;

  SELECT COALESCE(jsonb_agg(name ORDER BY name), '[]'::JSONB)
  INTO v_missing_functions
  FROM unnest(v_required_functions) AS name
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = name
  );

  RETURN jsonb_build_object(
    'schemaVersion', '20261105110000',
    'ready', jsonb_array_length(v_missing_tables) = 0
      AND jsonb_array_length(v_missing_functions) = 0,
    'missingTables', v_missing_tables,
    'missingFunctions', v_missing_functions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_platform_health_check() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_platform_health_check() TO authenticated, service_role;


NOTIFY pgrst, 'reload schema';

COMMIT;

