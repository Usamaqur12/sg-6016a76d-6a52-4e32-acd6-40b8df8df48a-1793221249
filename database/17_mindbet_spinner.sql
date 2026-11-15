-- MindBet Spinner: server-authoritative, provably-fair multiplier wheel.
-- The 24-segment paytable is fixed and auditable (95.83% theoretical RTP).
-- Admin settings affect future spins only and cannot target a user or result.

CREATE TABLE IF NOT EXISTS public.spinner_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_paused BOOLEAN NOT NULL DEFAULT FALSE,
  maintenance_message TEXT NOT NULL DEFAULT 'Spinner is temporarily unavailable',
  min_stake NUMERIC(15,2) NOT NULL DEFAULT 1,
  max_stake NUMERIC(15,2) NOT NULL DEFAULT 500,
  max_payout NUMERIC(15,2) NOT NULL DEFAULT 100000,
  max_user_daily_wager NUMERIC(15,2) NOT NULL DEFAULT 10000,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (min_stake BETWEEN 1 AND 500),
  CHECK (max_stake BETWEEN min_stake AND 500),
  CHECK (max_payout BETWEEN 1 AND 1000000),
  CHECK (max_user_daily_wager BETWEEN 1 AND 10000000),
  CHECK (char_length(maintenance_message) BETWEEN 3 AND 240)
);

INSERT INTO public.spinner_settings(id) VALUES(TRUE)
ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.spinner_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  stake NUMERIC(15,2) NOT NULL CHECK (stake > 0),
  segment_index INTEGER NOT NULL CHECK (segment_index BETWEEN 0 AND 23),
  multiplier NUMERIC(8,2) NOT NULL CHECK (multiplier >= 0),
  payout NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (payout >= 0),
  server_seed TEXT NOT NULL,
  server_seed_hash TEXT NOT NULL,
  client_seed TEXT NOT NULL,
  idempotency_key UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS spinner_games_user_created_idx
  ON public.spinner_games(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS spinner_games_created_idx
  ON public.spinner_games(created_at DESC);

ALTER TABLE public.spinner_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spinner_games ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.spinner_settings, public.spinner_games FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.spinner_paytable()
RETURNS NUMERIC[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT ARRAY[
    0, 0.5, 1, 0, 1.5, 0.5, 0, 2,
    1, 0.5, 0, 1, 3, 0.5, 0, 1.5,
    1, 0, 5, 0.5, 1, 0, 1.5, 1
  ]::NUMERIC[];
$function$;

CREATE OR REPLACE FUNCTION public.spinner_get_state()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_settings public.spinner_settings%ROWTYPE;
  v_history JSONB := '[]'::JSONB;
BEGIN
  SELECT * INTO v_settings FROM public.spinner_settings WHERE id = TRUE;

  IF v_user IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(item ORDER BY created_at DESC), '[]'::JSONB)
    INTO v_history
    FROM (
      SELECT created_at, jsonb_build_object(
        'id', id,
        'stake', stake,
        'segment_index', segment_index,
        'multiplier', multiplier,
        'payout', payout,
        'server_seed_hash', server_seed_hash,
        'server_seed', server_seed,
        'client_seed', client_seed,
        'created_at', created_at
      ) AS item
      FROM public.spinner_games
      WHERE user_id = v_user
      ORDER BY created_at DESC
      LIMIT 12
    ) recent;
  END IF;

  RETURN jsonb_build_object(
    'settings', jsonb_build_object(
      'is_enabled', v_settings.is_enabled,
      'is_paused', v_settings.is_paused,
      'maintenance_message', v_settings.maintenance_message,
      'min_stake', v_settings.min_stake,
      'max_stake', v_settings.max_stake,
      'max_payout', v_settings.max_payout,
      'max_user_daily_wager', v_settings.max_user_daily_wager,
      'theoretical_rtp', 95.83
    ),
    'segments', to_jsonb(public.spinner_paytable()),
    'history', v_history
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.spinner_spin(
  p_stake NUMERIC,
  p_client_seed TEXT,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_settings public.spinner_settings%ROWTYPE;
  v_existing public.spinner_games%ROWTYPE;
  v_stake NUMERIC(15,2) := ROUND(p_stake, 2);
  v_available NUMERIC(18,2);
  v_daily_wager NUMERIC(18,2);
  v_seed TEXT;
  v_hash TEXT;
  v_value BIGINT;
  v_index INTEGER;
  v_multiplier NUMERIC(8,2);
  v_payout NUMERIC(15,2);
  v_game UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Idempotency key is required'; END IF;
  IF char_length(trim(COALESCE(p_client_seed, ''))) NOT BETWEEN 8 AND 128 THEN
    RAISE EXCEPTION 'Client seed must contain 8 to 128 characters';
  END IF;

  SELECT * INTO v_existing
  FROM public.spinner_games
  WHERE user_id = v_user AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'game', to_jsonb(v_existing),
      'state', public.spinner_get_state(),
      'replayed', TRUE
    );
  END IF;

  SELECT * INTO v_settings
  FROM public.spinner_settings
  WHERE id = TRUE
  FOR UPDATE;

  IF NOT v_settings.is_enabled OR v_settings.is_paused THEN
    RAISE EXCEPTION '%', v_settings.maintenance_message;
  END IF;
  IF v_stake IS NULL OR v_stake < v_settings.min_stake OR v_stake > v_settings.max_stake THEN
    RAISE EXCEPTION 'Stake must be between % and %', v_settings.min_stake, v_settings.max_stake;
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_user
  FOR UPDATE;

  IF NOT FOUND OR COALESCE(v_profile.is_admin, FALSE) THEN
    RAISE EXCEPTION 'Customer account required';
  END IF;
  IF COALESCE(v_profile.is_suspended, FALSE)
     OR COALESCE(v_profile.account_status, 'active') IN ('suspended', 'closed', 'archived', 'disabled')
     OR COALESCE(v_profile.wallet_frozen, FALSE)
     OR COALESCE(v_profile.betting_disabled, FALSE)
  THEN
    RAISE EXCEPTION 'Casino play is disabled for this account';
  END IF;

  SELECT COALESCE(SUM(stake), 0)
  INTO v_daily_wager
  FROM public.spinner_games
  WHERE user_id = v_user
    AND created_at >= NOW() - INTERVAL '24 hours';

  IF v_daily_wager + v_stake > v_settings.max_user_daily_wager THEN
    RAISE EXCEPTION 'Daily Spinner wager limit reached';
  END IF;

  PERFORM public.ensure_user_ledger_accounts_from_id(v_user, 0);
  PERFORM 1
  FROM public.ledger_accounts
  WHERE user_id = v_user AND currency = 'USD' AND account_code IN ('cash', 'bonus')
  FOR UPDATE;

  SELECT COALESCE(SUM(balance), 0)
  INTO v_available
  FROM public.ledger_accounts
  WHERE user_id = v_user AND currency = 'USD' AND account_code IN ('cash', 'bonus');

  IF v_available < v_stake THEN RAISE EXCEPTION 'Insufficient funded balance'; END IF;

  v_seed := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(extensions.digest(v_seed || ':' || trim(p_client_seed), 'sha256'), 'hex');
  v_value := (('x' || substr(v_hash, 1, 8))::bit(32))::BIGINT;
  v_index := (v_value % 24)::INTEGER;
  v_multiplier := (public.spinner_paytable())[v_index + 1];
  v_payout := LEAST(v_settings.max_payout, ROUND(v_stake * v_multiplier, 2));

  INSERT INTO public.spinner_games(
    user_id, stake, segment_index, multiplier, payout,
    server_seed, server_seed_hash, client_seed, idempotency_key
  )
  VALUES (
    v_user, v_stake, v_index, v_multiplier, v_payout,
    v_seed, encode(extensions.digest(v_seed, 'sha256'), 'hex'),
    trim(p_client_seed), p_idempotency_key
  )
  RETURNING id INTO v_game;

  INSERT INTO public.wallet_transactions(
    user_id, type, amount, balance_before, balance_after,
    description, reference_id, status, metadata
  )
  VALUES (
    v_user, 'bet_placed', -v_stake, v_available, v_available - v_stake,
    'MindBet Spinner stake', v_game, 'completed',
    jsonb_build_object(
      'game', 'spinner',
      'segment_index', v_index,
      'server_seed_hash', encode(extensions.digest(v_seed, 'sha256'), 'hex'),
      'idempotency_key', p_idempotency_key
    )
  );

  IF v_payout > 0 THEN
    INSERT INTO public.wallet_transactions(
      user_id, type, amount, balance_before, balance_after,
      description, reference_id, status, metadata
    )
    VALUES (
      v_user, 'bet_won', v_payout,
      v_available - v_stake,
      v_available - v_stake + v_payout,
      'MindBet Spinner payout', v_game, 'completed',
      jsonb_build_object('game', 'spinner', 'multiplier', v_multiplier, 'segment_index', v_index)
    );
  END IF;

  SELECT * INTO v_existing FROM public.spinner_games WHERE id = v_game;
  RETURN jsonb_build_object(
    'game', to_jsonb(v_existing),
    'state', public.spinner_get_state(),
    'replayed', FALSE
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.spinner_admin_get_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_admin UUID := auth.uid();
  v_settings public.spinner_settings%ROWTYPE;
  v_wager NUMERIC(18,2);
  v_payout NUMERIC(18,2);
  v_spins BIGINT;
  v_recent JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_admin AND is_admin = TRUE
      AND admin_role IN ('super_admin', 'admin')
      AND COALESCE(is_suspended, FALSE) = FALSE
  ) THEN RAISE EXCEPTION 'Spinner admin authorization required'; END IF;

  SELECT * INTO v_settings FROM public.spinner_settings WHERE id = TRUE;
  SELECT COALESCE(SUM(stake),0), COALESCE(SUM(payout),0), COUNT(*)
  INTO v_wager, v_payout, v_spins
  FROM public.spinner_games
  WHERE created_at >= NOW() - INTERVAL '24 hours';

  SELECT COALESCE(jsonb_agg(item ORDER BY created_at DESC), '[]'::JSONB)
  INTO v_recent
  FROM (
    SELECT created_at, jsonb_build_object(
      'id', id, 'stake', stake, 'multiplier', multiplier,
      'payout', payout, 'segment_index', segment_index, 'created_at', created_at
    ) AS item
    FROM public.spinner_games
    ORDER BY created_at DESC
    LIMIT 20
  ) rows;

  RETURN jsonb_build_object(
    'settings', to_jsonb(v_settings) - 'updated_by',
    'metrics', jsonb_build_object(
      'wager_24h', v_wager,
      'payout_24h', v_payout,
      'ggr_24h', v_wager - v_payout,
      'spins_24h', v_spins,
      'rtp_24h', CASE WHEN v_wager > 0 THEN ROUND(v_payout / v_wager * 100, 2) ELSE 0 END
    ),
    'segments', to_jsonb(public.spinner_paytable()),
    'recent_spins', v_recent
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.spinner_admin_update_settings(
  p_settings JSONB,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_admin UUID := auth.uid();
  v_previous public.spinner_settings%ROWTYPE;
  v_enabled BOOLEAN;
  v_paused BOOLEAN;
  v_message TEXT;
  v_min NUMERIC;
  v_max NUMERIC;
  v_payout NUMERIC;
  v_daily NUMERIC;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_admin AND is_admin = TRUE
      AND admin_role IN ('super_admin', 'admin')
      AND COALESCE(is_suspended, FALSE) = FALSE
  ) THEN RAISE EXCEPTION 'Spinner admin authorization required'; END IF;
  IF char_length(trim(COALESCE(p_reason,''))) < 5 THEN
    RAISE EXCEPTION 'A meaningful audit reason is required';
  END IF;

  SELECT * INTO v_previous FROM public.spinner_settings WHERE id = TRUE FOR UPDATE;
  v_enabled := COALESCE((p_settings->>'is_enabled')::BOOLEAN, v_previous.is_enabled);
  v_paused := COALESCE((p_settings->>'is_paused')::BOOLEAN, v_previous.is_paused);
  v_message := COALESCE(NULLIF(trim(p_settings->>'maintenance_message'),''), v_previous.maintenance_message);
  v_min := COALESCE((p_settings->>'min_stake')::NUMERIC, v_previous.min_stake);
  v_max := COALESCE((p_settings->>'max_stake')::NUMERIC, v_previous.max_stake);
  v_payout := COALESCE((p_settings->>'max_payout')::NUMERIC, v_previous.max_payout);
  v_daily := COALESCE((p_settings->>'max_user_daily_wager')::NUMERIC, v_previous.max_user_daily_wager);

  IF v_min NOT BETWEEN 1 AND 500 OR v_max < v_min OR v_max > 500
     OR v_payout NOT BETWEEN 1 AND 1000000
     OR v_daily NOT BETWEEN 1 AND 10000000
     OR char_length(v_message) NOT BETWEEN 3 AND 240
  THEN RAISE EXCEPTION 'Invalid Spinner settings'; END IF;

  UPDATE public.spinner_settings
  SET is_enabled = v_enabled, is_paused = v_paused,
      maintenance_message = v_message,
      min_stake = ROUND(v_min,2), max_stake = ROUND(v_max,2),
      max_payout = ROUND(v_payout,2),
      max_user_daily_wager = ROUND(v_daily,2),
      updated_by = v_admin, updated_at = NOW()
  WHERE id = TRUE;

  INSERT INTO public.audit_logs(admin_id, action, entity_type, entity_id, changes)
  VALUES (
    v_admin, 'spinner_settings_updated', 'spinner_settings', NULL,
    jsonb_build_object(
      'reason', trim(p_reason),
      'before', to_jsonb(v_previous) - 'updated_by',
      'after', p_settings
    )
  );

  RETURN public.spinner_admin_get_dashboard();
END;
$function$;

REVOKE ALL ON FUNCTION public.spinner_paytable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.spinner_get_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.spinner_spin(NUMERIC, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.spinner_admin_get_dashboard() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.spinner_admin_update_settings(JSONB, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.spinner_get_state() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spinner_spin(NUMERIC, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spinner_admin_get_dashboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.spinner_admin_update_settings(JSONB, TEXT) TO authenticated;

COMMENT ON TABLE public.spinner_games IS
  'Server-authoritative provably-fair Spinner rounds with disclosed seeds and a fixed 24-segment paytable.';
