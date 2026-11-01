-- Fair, server-authoritative Aviator engine.
-- Crash points are committed before betting through a SHA-256 server-seed hash.
-- No API or admin function can target a user, stake, or individual round outcome.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.aviator_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_paused BOOLEAN NOT NULL DEFAULT FALSE,
  betting_seconds INTEGER NOT NULL DEFAULT 8 CHECK (betting_seconds BETWEEN 3 AND 30),
  cooldown_seconds INTEGER NOT NULL DEFAULT 3 CHECK (cooldown_seconds BETWEEN 2 AND 15),
  growth_rate NUMERIC(8,5) NOT NULL DEFAULT 0.115 CHECK (growth_rate BETWEEN 0.03 AND 0.50),
  min_stake NUMERIC(15,2) NOT NULL DEFAULT 1 CHECK (min_stake > 0),
  max_stake NUMERIC(15,2) NOT NULL DEFAULT 1000 CHECK (max_stake >= min_stake),
  max_multiplier NUMERIC(12,2) NOT NULL DEFAULT 1000 CHECK (max_multiplier BETWEEN 2 AND 100000),
  max_payout NUMERIC(15,2) NOT NULL DEFAULT 100000 CHECK (max_payout > 0),
  house_edge_percent NUMERIC(5,2) NOT NULL DEFAULT 1 CHECK (house_edge_percent BETWEEN 0 AND 10),
  updated_by UUID REFERENCES public.profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.aviator_settings(id) VALUES(TRUE) ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.aviator_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  status TEXT NOT NULL DEFAULT 'betting' CHECK (status IN ('betting','running','crashed')),
  server_seed_hash TEXT NOT NULL,
  server_seed_secret TEXT NOT NULL,
  server_seed_reveal TEXT,
  client_seed TEXT NOT NULL,
  nonce BIGINT NOT NULL,
  crash_multiplier NUMERIC(12,2) NOT NULL CHECK (crash_multiplier >= 1),
  growth_rate NUMERIC(8,5) NOT NULL,
  betting_closes_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  crashed_at TIMESTAMPTZ NOT NULL,
  next_round_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS aviator_rounds_created_idx ON public.aviator_rounds(created_at DESC);
CREATE INDEX IF NOT EXISTS aviator_rounds_status_idx ON public.aviator_rounds(status,created_at DESC);

CREATE TABLE IF NOT EXISTS public.aviator_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES public.aviator_rounds(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  stake NUMERIC(15,2) NOT NULL CHECK (stake > 0),
  status TEXT NOT NULL DEFAULT 'placed' CHECK (status IN ('placed','cashed_out','lost','refunded')),
  cashout_multiplier NUMERIC(12,2),
  payout NUMERIC(15,2) NOT NULL DEFAULT 0,
  wallet_transaction_id UUID REFERENCES public.wallet_transactions(id),
  placed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  UNIQUE(round_id,user_id)
);

CREATE INDEX IF NOT EXISTS aviator_bets_user_idx ON public.aviator_bets(user_id,placed_at DESC);
CREATE INDEX IF NOT EXISTS aviator_bets_round_idx ON public.aviator_bets(round_id,status);

ALTER TABLE public.aviator_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aviator_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aviator_bets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aviator_settings,public.aviator_rounds,public.aviator_bets FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.aviator_calculate_crash(
  p_server_seed TEXT,
  p_client_seed TEXT,
  p_nonce BIGINT,
  p_house_edge NUMERIC,
  p_max_multiplier NUMERIC
) RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path=public
AS $$
DECLARE
  v_hex TEXT;
  v_value BIGINT;
  v_unit NUMERIC;
  v_result NUMERIC;
BEGIN
  v_hex:=encode(extensions.hmac(p_client_seed||':'||p_nonce::TEXT,p_server_seed,'sha256'),'hex');
  v_value:=(('x'||substr(v_hex,1,13))::bit(52))::BIGINT;
  v_unit:=v_value::NUMERIC/4503599627370496::NUMERIC;
  v_result:=floor((((100-p_house_edge)/100)/GREATEST(0.0000000001,1-v_unit))*100)/100;
  RETURN GREATEST(1.00,LEAST(p_max_multiplier,v_result));
END $$;

CREATE OR REPLACE FUNCTION public.aviator_sync_round()
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_settings public.aviator_settings%ROWTYPE;
  v_round public.aviator_rounds%ROWTYPE;
  v_seed TEXT;
  v_hash TEXT;
  v_client TEXT:='primebet-public-v1';
  v_nonce BIGINT;
  v_crash NUMERIC;
  v_now TIMESTAMPTZ:=clock_timestamp();
  v_start TIMESTAMPTZ;
  v_crash_at TIMESTAMPTZ;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('primebet-aviator-engine'));
  SELECT * INTO v_settings FROM public.aviator_settings WHERE id=TRUE FOR UPDATE;

  SELECT * INTO v_round
  FROM public.aviator_rounds
  ORDER BY round_number DESC
  LIMIT 1
  FOR UPDATE;

  IF v_settings.is_paused OR NOT v_settings.is_enabled THEN
    RETURN v_round.id;
  END IF;

  IF v_round.id IS NOT NULL AND v_round.status='betting' AND v_now>=v_round.betting_closes_at THEN
    UPDATE public.aviator_rounds SET status='running' WHERE id=v_round.id;
    v_round.status:='running';
  END IF;

  IF v_round.id IS NOT NULL AND v_round.status='running' AND v_now>=v_round.crashed_at THEN
    UPDATE public.aviator_rounds
    SET status='crashed',server_seed_reveal=server_seed_secret
    WHERE id=v_round.id;
    UPDATE public.aviator_bets
    SET status='lost',settled_at=v_now
    WHERE round_id=v_round.id AND status='placed';
    v_round.status:='crashed';
    v_round.server_seed_reveal:=v_round.server_seed_secret;
  END IF;

  IF v_round.id IS NOT NULL AND (
    v_round.status IN ('betting','running')
    OR (v_round.status='crashed' AND v_now<v_round.next_round_at)
  ) THEN
    RETURN v_round.id;
  END IF;

  v_seed:=encode(extensions.gen_random_bytes(32),'hex');
  v_hash:=encode(extensions.digest(v_seed,'sha256'),'hex');
  SELECT COALESCE(MAX(round_number),0)+1 INTO v_nonce FROM public.aviator_rounds;
  v_crash:=public.aviator_calculate_crash(
    v_seed,v_client,v_nonce,v_settings.house_edge_percent,v_settings.max_multiplier
  );
  v_start:=v_now+make_interval(secs=>v_settings.betting_seconds);
  v_crash_at:=v_start+make_interval(secs=>LN(v_crash::DOUBLE PRECISION)/v_settings.growth_rate::DOUBLE PRECISION);

  INSERT INTO public.aviator_rounds(
    status,server_seed_hash,server_seed_secret,client_seed,nonce,crash_multiplier,
    growth_rate,betting_closes_at,started_at,crashed_at,next_round_at
  ) VALUES(
    'betting',v_hash,v_seed,v_client,v_nonce,v_crash,v_settings.growth_rate,
    v_start,v_start,v_crash_at,v_crash_at+make_interval(secs=>v_settings.cooldown_seconds)
  ) RETURNING id INTO v_round.id;

  RETURN v_round.id;
END $$;

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
  IF v_round_id IS NOT NULL THEN SELECT * INTO v_round FROM public.aviator_rounds WHERE id=v_round_id; END IF;
  IF auth.uid() IS NOT NULL AND v_round_id IS NOT NULL THEN
    SELECT * INTO v_bet FROM public.aviator_bets WHERE round_id=v_round_id AND user_id=auth.uid();
  END IF;

  IF v_settings.is_paused OR NOT v_settings.is_enabled THEN
    v_phase:='paused';
  ELSIF v_round.status='betting' THEN
    v_phase:='betting';
  ELSIF v_round.status='running' THEN
    v_phase:='running';
    v_current:=LEAST(
      v_round.crash_multiplier,
      floor(EXP(EXTRACT(EPOCH FROM (v_now-v_round.started_at))*v_round.growth_rate::DOUBLE PRECISION)*100)/100
    );
  ELSE
    v_phase:='crashed';
    v_current:=v_round.crash_multiplier;
  END IF;

  SELECT COALESCE(jsonb_agg(item ORDER BY round_number DESC),'[]'::JSONB) INTO v_history
  FROM (
    SELECT round_number,jsonb_build_object(
      'round_number',round_number,
      'crash_multiplier',crash_multiplier,
      'server_seed_hash',server_seed_hash,
      'server_seed_reveal',server_seed_reveal,
      'client_seed',client_seed,
      'nonce',nonce,
      'crashed_at',crashed_at
    ) AS item
    FROM public.aviator_rounds
    WHERE status='crashed'
    ORDER BY round_number DESC
    LIMIT 12
  ) history_rows;

  RETURN jsonb_build_object(
    'server_time',v_now,
    'phase',v_phase,
    'current_multiplier',COALESCE(v_current,1),
    'settings',jsonb_build_object(
      'is_enabled',v_settings.is_enabled,
      'is_paused',v_settings.is_paused,
      'betting_seconds',v_settings.betting_seconds,
      'cooldown_seconds',v_settings.cooldown_seconds,
      'growth_rate',v_settings.growth_rate,
      'min_stake',v_settings.min_stake,
      'max_stake',v_settings.max_stake,
      'max_multiplier',v_settings.max_multiplier,
      'max_payout',v_settings.max_payout,
      'house_edge_percent',v_settings.house_edge_percent
    ),
    'round',CASE WHEN v_round.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',v_round.id,
      'round_number',v_round.round_number,
      'status',v_round.status,
      'server_seed_hash',v_round.server_seed_hash,
      'server_seed_reveal',CASE WHEN v_round.status='crashed' THEN v_round.server_seed_reveal ELSE NULL END,
      'client_seed',v_round.client_seed,
      'nonce',v_round.nonce,
      'crash_multiplier',CASE WHEN v_round.status='crashed' THEN v_round.crash_multiplier ELSE NULL END,
      'betting_closes_at',v_round.betting_closes_at,
      'started_at',v_round.started_at,
      'next_round_at',v_round.next_round_at
    ) END,
    'my_bet',CASE WHEN v_bet.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',v_bet.id,'stake',v_bet.stake,'status',v_bet.status,
      'cashout_multiplier',v_bet.cashout_multiplier,'payout',v_bet.payout
    ) END,
    'history',v_history
  );
END $$;

CREATE OR REPLACE FUNCTION public.aviator_place_bet(p_stake NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_user UUID:=auth.uid();
  v_round_id UUID;
  v_round public.aviator_rounds%ROWTYPE;
  v_settings public.aviator_settings%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_stake NUMERIC(15,2):=ROUND(p_stake,2);
  v_tx UUID;
  v_bet UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_round_id:=public.aviator_sync_round();
  SELECT * INTO v_settings FROM public.aviator_settings WHERE id=TRUE;
  SELECT * INTO v_round FROM public.aviator_rounds WHERE id=v_round_id FOR UPDATE;
  IF NOT v_settings.is_enabled OR v_settings.is_paused OR v_round.status<>'betting' OR clock_timestamp()>=v_round.betting_closes_at THEN
    RAISE EXCEPTION 'Betting is closed for this round';
  END IF;
  IF v_stake<v_settings.min_stake OR v_stake>v_settings.max_stake THEN
    RAISE EXCEPTION 'Stake is outside the allowed limits';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id=v_user AND COALESCE(is_admin,FALSE)=FALSE FOR UPDATE;
  IF NOT FOUND OR v_profile.is_suspended OR COALESCE(v_profile.account_status,'active')<>'active'
    OR COALESCE(v_profile.wallet_frozen,FALSE) OR COALESCE(v_profile.betting_disabled,FALSE) THEN
    RAISE EXCEPTION 'Account is not eligible for Aviator betting';
  END IF;
  IF COALESCE(v_profile.demo_balance,0)<v_stake THEN RAISE EXCEPTION 'Insufficient wallet balance'; END IF;

  INSERT INTO public.aviator_bets(round_id,user_id,stake)
  VALUES(v_round_id,v_user,v_stake)
  RETURNING id INTO v_bet;

  UPDATE public.profiles SET demo_balance=demo_balance-v_stake,updated_at=NOW() WHERE id=v_user;
  INSERT INTO public.wallet_transactions(
    user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata
  ) VALUES(
    v_user,'bet_placed',-v_stake,v_profile.demo_balance,v_profile.demo_balance-v_stake,
    'Aviator bet placed',v_bet,'completed',jsonb_build_object('game','aviator','round_id',v_round_id)
  ) RETURNING id INTO v_tx;
  UPDATE public.aviator_bets SET wallet_transaction_id=v_tx WHERE id=v_bet;

  RETURN public.aviator_get_state();
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Only one Aviator bet is allowed per round';
END $$;

CREATE OR REPLACE FUNCTION public.aviator_cashout()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_user UUID:=auth.uid();
  v_round_id UUID;
  v_round public.aviator_rounds%ROWTYPE;
  v_settings public.aviator_settings%ROWTYPE;
  v_bet public.aviator_bets%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_now TIMESTAMPTZ:=clock_timestamp();
  v_multiplier NUMERIC(12,2);
  v_payout NUMERIC(15,2);
  v_tx UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_round_id:=public.aviator_sync_round();
  SELECT * INTO v_settings FROM public.aviator_settings WHERE id=TRUE;
  SELECT * INTO v_round FROM public.aviator_rounds WHERE id=v_round_id FOR UPDATE;
  IF v_round.status<>'running' OR v_now>=v_round.crashed_at THEN RAISE EXCEPTION 'The plane has already flown away'; END IF;

  SELECT * INTO v_bet FROM public.aviator_bets
  WHERE round_id=v_round_id AND user_id=v_user AND status='placed'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No active Aviator bet found'; END IF;

  v_multiplier:=LEAST(
    v_round.crash_multiplier,
    floor(EXP(EXTRACT(EPOCH FROM (v_now-v_round.started_at))*v_round.growth_rate::DOUBLE PRECISION)*100)/100
  );
  v_payout:=LEAST(v_settings.max_payout,floor(v_bet.stake*v_multiplier*100)/100);
  SELECT * INTO v_profile FROM public.profiles WHERE id=v_user FOR UPDATE;

  UPDATE public.aviator_bets
  SET status='cashed_out',cashout_multiplier=v_multiplier,payout=v_payout,settled_at=v_now
  WHERE id=v_bet.id;
  UPDATE public.profiles SET demo_balance=demo_balance+v_payout,updated_at=NOW() WHERE id=v_user;
  INSERT INTO public.wallet_transactions(
    user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata
  ) VALUES(
    v_user,'bet_won',v_payout,v_profile.demo_balance,v_profile.demo_balance+v_payout,
    'Aviator cash-out',v_bet.id,'completed',
    jsonb_build_object('game','aviator','round_id',v_round_id,'multiplier',v_multiplier)
  ) RETURNING id INTO v_tx;

  RETURN public.aviator_get_state();
END $$;

CREATE OR REPLACE FUNCTION public.aviator_admin_update_settings(
  p_is_enabled BOOLEAN,
  p_is_paused BOOLEAN,
  p_betting_seconds INTEGER,
  p_cooldown_seconds INTEGER,
  p_growth_rate NUMERIC,
  p_min_stake NUMERIC,
  p_max_stake NUMERIC,
  p_max_multiplier NUMERIC,
  p_max_payout NUMERIC,
  p_house_edge_percent NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_admin UUID:=auth.uid();
  v_previous public.aviator_settings%ROWTYPE;
  v_bet RECORD;
  v_balance NUMERIC;
  v_tx UUID;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.profiles
    WHERE id=v_admin AND is_admin=TRUE AND admin_role IN ('super_admin','admin') AND is_suspended=FALSE
  ) THEN RAISE EXCEPTION 'Aviator admin authorization required'; END IF;
  IF p_betting_seconds NOT BETWEEN 3 AND 30 OR p_cooldown_seconds NOT BETWEEN 2 AND 15
    OR p_growth_rate NOT BETWEEN 0.03 AND 0.50 OR p_min_stake<=0 OR p_max_stake<p_min_stake
    OR p_max_multiplier NOT BETWEEN 2 AND 100000 OR p_max_payout<=0
    OR p_house_edge_percent NOT BETWEEN 0 AND 10 THEN
    RAISE EXCEPTION 'Invalid Aviator settings';
  END IF;

  SELECT * INTO v_previous FROM public.aviator_settings WHERE id=TRUE FOR UPDATE;

  IF p_is_paused AND NOT v_previous.is_paused THEN
    FOR v_bet IN
      SELECT b.* FROM public.aviator_bets b
      JOIN public.aviator_rounds r ON r.id=b.round_id
      WHERE b.status='placed' AND r.status IN ('betting','running')
      FOR UPDATE OF b
    LOOP
      SELECT demo_balance INTO v_balance FROM public.profiles WHERE id=v_bet.user_id FOR UPDATE;
      UPDATE public.profiles SET demo_balance=demo_balance+v_bet.stake,updated_at=NOW() WHERE id=v_bet.user_id;
      INSERT INTO public.wallet_transactions(
        user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata
      ) VALUES(
        v_bet.user_id,'adjustment',v_bet.stake,v_balance,v_balance+v_bet.stake,
        'Aviator pause refund',v_bet.id,'completed',jsonb_build_object('game','aviator','reason','admin_pause')
      ) RETURNING id INTO v_tx;
      UPDATE public.aviator_bets SET status='refunded',payout=v_bet.stake,settled_at=NOW() WHERE id=v_bet.id;
    END LOOP;
    UPDATE public.aviator_rounds
    SET status='crashed',crash_multiplier=1,crashed_at=NOW(),next_round_at=NOW(),
        server_seed_reveal=server_seed_secret
    WHERE status IN ('betting','running');
  END IF;

  UPDATE public.aviator_settings SET
    is_enabled=p_is_enabled,is_paused=p_is_paused,betting_seconds=p_betting_seconds,
    cooldown_seconds=p_cooldown_seconds,growth_rate=p_growth_rate,min_stake=p_min_stake,
    max_stake=p_max_stake,max_multiplier=p_max_multiplier,max_payout=p_max_payout,
    house_edge_percent=p_house_edge_percent,updated_by=v_admin,updated_at=NOW()
  WHERE id=TRUE;

  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes)
  VALUES(v_admin,'aviator_settings_updated','aviator_settings',NULL,jsonb_build_object(
    'before',to_jsonb(v_previous),
    'after',jsonb_build_object(
      'is_enabled',p_is_enabled,'is_paused',p_is_paused,'betting_seconds',p_betting_seconds,
      'cooldown_seconds',p_cooldown_seconds,'growth_rate',p_growth_rate,'min_stake',p_min_stake,
      'max_stake',p_max_stake,'max_multiplier',p_max_multiplier,'max_payout',p_max_payout,
      'house_edge_percent',p_house_edge_percent
    )
  ));

  RETURN public.aviator_get_state();
END $$;

REVOKE ALL ON FUNCTION public.aviator_calculate_crash(TEXT,TEXT,BIGINT,NUMERIC,NUMERIC) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.aviator_sync_round() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.aviator_get_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aviator_place_bet(NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aviator_cashout() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aviator_admin_update_settings(BOOLEAN,BOOLEAN,INTEGER,INTEGER,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.aviator_get_state() TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.aviator_place_bet(NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aviator_cashout() TO authenticated;
GRANT EXECUTE ON FUNCTION public.aviator_admin_update_settings(BOOLEAN,BOOLEAN,INTEGER,INTEGER,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC) TO authenticated;
