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

NOTIFY pgrst,'reload schema';
