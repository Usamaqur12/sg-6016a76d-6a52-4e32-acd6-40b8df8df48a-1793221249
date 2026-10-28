-- Database-enforced stake/payout caps, exposure calculation and automatic
-- suspension. Browser risk calculations are informational only.

CREATE TABLE IF NOT EXISTS public.risk_engine_config (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  max_single_stake NUMERIC(15,2) NOT NULL DEFAULT 10000 CHECK (max_single_stake > 0),
  max_single_payout NUMERIC(15,2) NOT NULL DEFAULT 100000 CHECK (max_single_payout > 0),
  max_event_liability NUMERIC(15,2) NOT NULL DEFAULT 250000 CHECK (max_event_liability > 0),
  max_market_liability NUMERIC(15,2) NOT NULL DEFAULT 100000 CHECK (max_market_liability > 0),
  auto_suspend_percentage NUMERIC(5,2) NOT NULL DEFAULT 90 CHECK (auto_suspend_percentage BETWEEN 1 AND 100),
  velocity_bets_per_minute INTEGER NOT NULL DEFAULT 10 CHECK (velocity_bets_per_minute > 0),
  unusual_stake_multiplier NUMERIC(8,2) NOT NULL DEFAULT 5 CHECK (unusual_stake_multiplier > 1),
  updated_by UUID REFERENCES public.profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.risk_engine_config (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.risk_engine_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Risk staff can view risk config" ON public.risk_engine_config
  FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['risk_manager', 'sports_trader']));
CREATE POLICY "Risk staff can update risk config" ON public.risk_engine_config
  FOR UPDATE TO authenticated
  USING (public.has_admin_role(ARRAY['risk_manager']))
  WITH CHECK (public.has_admin_role(ARRAY['risk_manager']));

CREATE OR REPLACE FUNCTION public.enforce_and_refresh_bet_risk()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_selection public.bet_selections%ROWTYPE;
  v_bet public.bets%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_config public.risk_engine_config%ROWTYPE;
  v_user_stake_limit NUMERIC;
  v_user_payout_limit NUMERIC;
  v_event_stake NUMERIC;
  v_event_liability NUMERIC;
  v_event_max_payout NUMERIC;
  v_event_bets INTEGER;
  v_event_users INTEGER;
  v_market_stake NUMERIC;
  v_market_liability NUMERIC;
  v_market_max_payout NUMERIC;
  v_market_bets INTEGER;
  v_market_users INTEGER;
  v_selection_exposure JSONB;
  v_average_stake NUMERIC;
  v_recent_bets INTEGER;
  v_risk_level TEXT;
BEGIN
  v_selection := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT * INTO v_bet FROM public.bets WHERE id = v_selection.bet_id;
  SELECT * INTO v_event FROM public.events WHERE id = v_selection.event_id;
  SELECT * INTO v_config FROM public.risk_engine_config WHERE id = TRUE;

  IF TG_OP <> 'DELETE' AND v_bet.status = 'pending' THEN
    IF v_bet.stake > v_config.max_single_stake THEN
      RAISE EXCEPTION 'Stake exceeds platform risk limit';
    END IF;
    IF v_bet.potential_return > v_config.max_single_payout THEN
      RAISE EXCEPTION 'Potential payout exceeds platform risk limit';
    END IF;
    IF EXISTS (SELECT 1 FROM public.risk_profiles WHERE user_id = v_bet.user_id AND risk_level = 'restricted') THEN
      RAISE EXCEPTION 'Account is restricted by risk controls';
    END IF;

    SELECT MIN(limit_value) INTO v_user_stake_limit FROM public.user_limits
    WHERE user_id = v_bet.user_id AND limit_type = 'stake'
      AND (sport_id IS NULL OR sport_id = v_event.sport_id);
    SELECT MIN(limit_value) INTO v_user_payout_limit FROM public.user_limits
    WHERE user_id = v_bet.user_id AND limit_type = 'payout'
      AND (sport_id IS NULL OR sport_id = v_event.sport_id);
    IF v_user_stake_limit IS NOT NULL AND v_bet.stake > v_user_stake_limit THEN
      RAISE EXCEPTION 'Stake exceeds account risk limit';
    END IF;
    IF v_user_payout_limit IS NOT NULL AND v_bet.potential_return > v_user_payout_limit THEN
      RAISE EXCEPTION 'Potential payout exceeds account risk limit';
    END IF;
  END IF;

  SELECT
    COALESCE(SUM(b.stake), 0),
    COALESCE(SUM(GREATEST(b.potential_return - b.stake, 0)), 0),
    COALESCE(MAX(b.potential_return), 0), COUNT(*), COUNT(DISTINCT b.user_id)
  INTO v_event_stake, v_event_liability, v_event_max_payout, v_event_bets, v_event_users
  FROM public.bets b
  JOIN (SELECT DISTINCT bet_id FROM public.bet_selections WHERE event_id = v_selection.event_id) x ON x.bet_id = b.id
  WHERE b.status = 'pending';

  SELECT
    COALESCE(SUM(b.stake), 0),
    COALESCE(SUM(GREATEST(b.potential_return - b.stake, 0)), 0),
    COALESCE(MAX(b.potential_return), 0), COUNT(*), COUNT(DISTINCT b.user_id)
  INTO v_market_stake, v_market_liability, v_market_max_payout, v_market_bets, v_market_users
  FROM public.bets b
  JOIN (SELECT DISTINCT bet_id FROM public.bet_selections WHERE market_id = v_selection.market_id) x ON x.bet_id = b.id
  WHERE b.status = 'pending';

  IF TG_OP <> 'DELETE' AND v_event_liability > v_config.max_event_liability THEN
    RAISE EXCEPTION 'Event liability limit reached';
  END IF;
  IF TG_OP <> 'DELETE' AND v_market_liability > v_config.max_market_liability THEN
    RAISE EXCEPTION 'Market liability limit reached';
  END IF;

  v_risk_level := CASE
    WHEN v_event_liability >= v_config.max_event_liability * 0.9 THEN 'critical'
    WHEN v_event_liability >= v_config.max_event_liability * 0.75 THEN 'high'
    WHEN v_event_liability >= v_config.max_event_liability * 0.5 THEN 'medium'
    ELSE 'low' END;

  INSERT INTO public.event_exposure (
    event_id, total_stake, total_liability, max_potential_payout,
    home_liability, draw_liability, away_liability, bet_count,
    unique_users, risk_level, last_bet_at, updated_at
  ) VALUES (
    v_selection.event_id, v_event_stake, v_event_liability, v_event_max_payout,
    COALESCE((SELECT SUM(GREATEST(b.potential_return-b.stake,0)) FROM public.bets b JOIN public.bet_selections bs ON bs.bet_id=b.id WHERE b.status='pending' AND bs.event_id=v_selection.event_id AND lower(bs.selection) IN ('home','1')),0),
    COALESCE((SELECT SUM(GREATEST(b.potential_return-b.stake,0)) FROM public.bets b JOIN public.bet_selections bs ON bs.bet_id=b.id WHERE b.status='pending' AND bs.event_id=v_selection.event_id AND lower(bs.selection) IN ('draw','x')),0),
    COALESCE((SELECT SUM(GREATEST(b.potential_return-b.stake,0)) FROM public.bets b JOIN public.bet_selections bs ON bs.bet_id=b.id WHERE b.status='pending' AND bs.event_id=v_selection.event_id AND lower(bs.selection) IN ('away','2')),0),
    v_event_bets, v_event_users, v_risk_level, NOW(), NOW()
  ) ON CONFLICT (event_id) DO UPDATE SET
    total_stake=EXCLUDED.total_stake, total_liability=EXCLUDED.total_liability,
    max_potential_payout=EXCLUDED.max_potential_payout,
    home_liability=EXCLUDED.home_liability, draw_liability=EXCLUDED.draw_liability,
    away_liability=EXCLUDED.away_liability, bet_count=EXCLUDED.bet_count,
    unique_users=EXCLUDED.unique_users, risk_level=EXCLUDED.risk_level,
    last_bet_at=NOW(), updated_at=NOW();

  SELECT COALESCE(jsonb_object_agg(selection, liability), '{}'::JSONB) INTO v_selection_exposure
  FROM (
    SELECT bs.selection, SUM(GREATEST(b.potential_return-b.stake,0)) AS liability
    FROM public.bets b JOIN public.bet_selections bs ON bs.bet_id=b.id
    WHERE b.status='pending' AND bs.market_id=v_selection.market_id
    GROUP BY bs.selection
  ) grouped;

  v_risk_level := CASE
    WHEN v_market_liability >= v_config.max_market_liability * 0.9 THEN 'critical'
    WHEN v_market_liability >= v_config.max_market_liability * 0.75 THEN 'high'
    WHEN v_market_liability >= v_config.max_market_liability * 0.5 THEN 'medium'
    ELSE 'low' END;

  INSERT INTO public.market_exposure (
    market_id, total_stake, total_liability, max_potential_payout,
    bet_count, unique_users, selection_exposure, risk_level, last_bet_at, updated_at
  ) VALUES (
    v_selection.market_id, v_market_stake, v_market_liability, v_market_max_payout,
    v_market_bets, v_market_users, v_selection_exposure, v_risk_level, NOW(), NOW()
  ) ON CONFLICT (market_id) DO UPDATE SET
    total_stake=EXCLUDED.total_stake, total_liability=EXCLUDED.total_liability,
    max_potential_payout=EXCLUDED.max_potential_payout, bet_count=EXCLUDED.bet_count,
    unique_users=EXCLUDED.unique_users, selection_exposure=EXCLUDED.selection_exposure,
    risk_level=EXCLUDED.risk_level, last_bet_at=NOW(), updated_at=NOW();

  IF v_event_liability >= v_config.max_event_liability * v_config.auto_suspend_percentage / 100 THEN
    UPDATE public.events SET is_suspended=TRUE, updated_at=NOW() WHERE id=v_selection.event_id;
    UPDATE public.markets SET status='suspended' WHERE event_id=v_selection.event_id AND status='active';
  ELSIF v_market_liability >= v_config.max_market_liability * v_config.auto_suspend_percentage / 100 THEN
    UPDATE public.markets SET status='suspended' WHERE id=v_selection.market_id AND status='active';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(AVG(stake),0), COUNT(*) INTO v_average_stake, v_recent_bets
    FROM public.bets WHERE user_id=v_bet.user_id AND created_at >= NOW()-INTERVAL '30 days' AND id<>v_bet.id;

    IF (v_recent_bets >= 5 AND v_average_stake > 0 AND v_bet.stake >= v_average_stake*v_config.unusual_stake_multiplier)
       OR (SELECT COUNT(*) FROM public.bets WHERE user_id=v_bet.user_id AND created_at>=NOW()-INTERVAL '1 minute') > v_config.velocity_bets_per_minute THEN
      IF NOT EXISTS (SELECT 1 FROM public.fraud_flags WHERE user_id=v_bet.user_id AND created_at>=NOW()-INTERVAL '5 minutes' AND metadata->>'bet_id'=v_bet.id::TEXT) THEN
        INSERT INTO public.fraud_flags (user_id, flag_type, severity, description, metadata)
        VALUES (v_bet.user_id, 'unusual_pattern', 'high', 'Automated stake/velocity risk rule triggered', jsonb_build_object('bet_id',v_bet.id,'stake',v_bet.stake));
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_and_refresh_bet_risk_trigger ON public.bet_selections;
CREATE TRIGGER enforce_and_refresh_bet_risk_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.bet_selections
FOR EACH ROW EXECUTE FUNCTION public.enforce_and_refresh_bet_risk();

REVOKE ALL ON FUNCTION public.enforce_and_refresh_bet_risk() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_exposure_after_bet_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- A no-op selection update intentionally runs the exposure trigger after
    -- the bet has left (or re-entered) the pending state.
    UPDATE public.bet_selections SET result = result WHERE bet_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_exposure_after_bet_status_trigger ON public.bets;
CREATE TRIGGER refresh_exposure_after_bet_status_trigger
AFTER UPDATE OF status ON public.bets
FOR EACH ROW EXECUTE FUNCTION public.refresh_exposure_after_bet_status();

REVOKE ALL ON FUNCTION public.refresh_exposure_after_bet_status() FROM PUBLIC, anon, authenticated;
