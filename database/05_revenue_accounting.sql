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

  SELECT COALESCE(SUM(commission_amount),0) INTO v_partner_commission
  FROM public.broker_commissions
  WHERE status IN ('accrued','approved','paid')
    AND created_at>=p_period_from AND created_at<p_period_to;

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
AS $
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
$;

REVOKE ALL ON FUNCTION public.apply_configured_sport_margin() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reprice_sport_odds(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reprice_sport_odds(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.create_casino_provider_settlements(TIMESTAMPTZ,TIMESTAMPTZ,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_finance_summary(TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_casino_provider_settlements(TIMESTAMPTZ,TIMESTAMPTZ,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_finance_summary(TIMESTAMPTZ,TIMESTAMPTZ) TO service_role;
