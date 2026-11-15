-- Fairness-safe administration for MindBet Mines.
-- Admins can control availability and future risk limits, never a user's board
-- layout, mine positions, or a live round outcome.

CREATE TABLE IF NOT EXISTS public.mines_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_paused BOOLEAN NOT NULL DEFAULT FALSE,
  maintenance_message TEXT NOT NULL DEFAULT 'Mines is temporarily unavailable',
  min_stake NUMERIC(15,2) NOT NULL DEFAULT 1,
  max_stake NUMERIC(15,2) NOT NULL DEFAULT 500,
  min_mines INTEGER NOT NULL DEFAULT 3,
  max_mines INTEGER NOT NULL DEFAULT 10,
  max_payout NUMERIC(15,2) NOT NULL DEFAULT 100000,
  house_edge_percent NUMERIC(5,2) NOT NULL DEFAULT 1,
  max_user_daily_wager NUMERIC(15,2) NOT NULL DEFAULT 10000,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (min_stake BETWEEN 1 AND 500),
  CHECK (max_stake BETWEEN min_stake AND 500),
  CHECK (min_mines BETWEEN 3 AND 10),
  CHECK (max_mines BETWEEN min_mines AND 10),
  CHECK (max_payout BETWEEN 1 AND 1000000),
  CHECK (house_edge_percent BETWEEN 0 AND 10),
  CHECK (max_user_daily_wager BETWEEN 1 AND 10000000),
  CHECK (char_length(maintenance_message) BETWEEN 3 AND 240)
);

INSERT INTO public.mines_settings(id)
VALUES (TRUE)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.mines_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mines_settings FROM PUBLIC, anon, authenticated;

ALTER TABLE public.mines_games
  ADD COLUMN IF NOT EXISTS house_edge_percent NUMERIC(5,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_payout_limit NUMERIC(15,2) NOT NULL DEFAULT 100000;

CREATE OR REPLACE FUNCTION public.mines_multiplier(
  p_mines INTEGER,
  p_safe_picks INTEGER,
  p_house_edge_percent NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $function$
DECLARE
  v_multiplier NUMERIC := 1;
  v_index INTEGER;
  v_return_percent NUMERIC;
BEGIN
  IF p_mines NOT BETWEEN 3 AND 10
     OR p_safe_picks < 0
     OR p_safe_picks > 25 - p_mines
     OR p_house_edge_percent NOT BETWEEN 0 AND 10
  THEN
    RAISE EXCEPTION 'Invalid Mines multiplier inputs';
  END IF;

  IF p_safe_picks = 0 THEN
    RETURN 1.00;
  END IF;

  FOR v_index IN 0..p_safe_picks - 1 LOOP
    v_multiplier := v_multiplier
      * ((25 - v_index)::NUMERIC / (25 - p_mines - v_index)::NUMERIC);
  END LOOP;

  v_return_percent := (100 - p_house_edge_percent) / 100;
  RETURN GREATEST(1.01, FLOOR(v_multiplier * v_return_percent * 100) / 100);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mines_multiplier(
  p_mines INTEGER,
  p_safe_picks INTEGER
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT public.mines_multiplier(
    p_mines,
    p_safe_picks,
    COALESCE(
      (SELECT house_edge_percent FROM public.mines_settings WHERE id = TRUE),
      1
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.mines_get_state(p_game_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_game public.mines_games%ROWTYPE;
  v_settings public.mines_settings%ROWTYPE;
  v_history JSONB := '[]'::JSONB;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_settings
  FROM public.mines_settings
  WHERE id = TRUE;

  IF p_game_id IS NULL THEN
    SELECT * INTO v_game
    FROM public.mines_games
    WHERE user_id = v_user
    ORDER BY (status = 'active') DESC, created_at DESC
    LIMIT 1;
  ELSE
    SELECT * INTO v_game
    FROM public.mines_games
    WHERE id = p_game_id
      AND user_id = v_user;
  END IF;

  SELECT COALESCE(jsonb_agg(item ORDER BY created_at DESC), '[]'::JSONB)
  INTO v_history
  FROM (
    SELECT created_at, jsonb_build_object(
      'id', id,
      'stake', stake,
      'mine_count', mine_count,
      'status', status,
      'multiplier', current_multiplier,
      'payout', payout,
      'created_at', created_at,
      'completed_at', completed_at
    ) AS item
    FROM public.mines_games
    WHERE user_id = v_user
      AND status <> 'active'
    ORDER BY created_at DESC
    LIMIT 10
  ) recent;

  RETURN jsonb_build_object(
    'game',
      CASE WHEN v_game.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', v_game.id,
        'stake', v_game.stake,
        'mine_count', v_game.mine_count,
        'revealed_cells', to_jsonb(v_game.revealed_cells),
        'mine_positions', CASE
          WHEN v_game.status = 'active' THEN '[]'::JSONB
          ELSE to_jsonb(v_game.mine_positions)
        END,
        'current_multiplier', v_game.current_multiplier,
        'potential_payout', LEAST(
          v_game.max_payout_limit,
          ROUND(v_game.stake * v_game.current_multiplier, 2)
        ),
        'payout', v_game.payout,
        'status', v_game.status,
        'server_seed_hash', v_game.server_seed_hash,
        'server_seed', CASE
          WHEN v_game.status = 'active' THEN NULL
          ELSE v_game.server_seed
        END,
        'client_seed', v_game.client_seed,
        'created_at', v_game.created_at,
        'completed_at', v_game.completed_at
      ) END,
    'settings', jsonb_build_object(
      'is_enabled', v_settings.is_enabled,
      'is_paused', v_settings.is_paused,
      'maintenance_message', v_settings.maintenance_message,
      'min_stake', v_settings.min_stake,
      'max_stake', v_settings.max_stake,
      'min_mines', v_settings.min_mines,
      'max_mines', v_settings.max_mines,
      'max_payout', v_settings.max_payout,
      'house_edge_percent', v_settings.house_edge_percent,
      'max_user_daily_wager', v_settings.max_user_daily_wager
    ),
    'history', v_history
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mines_start(
  p_stake NUMERIC,
  p_mine_count INTEGER,
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
  v_settings public.mines_settings%ROWTYPE;
  v_existing UUID;
  v_game UUID;
  v_seed TEXT;
  v_seed_hash TEXT;
  v_hash BYTEA;
  v_mines INTEGER[] := ARRAY[]::INTEGER[];
  v_candidate INTEGER;
  v_counter INTEGER := 0;
  v_available NUMERIC(18,2);
  v_daily_wager NUMERIC(18,2);
  v_stake NUMERIC(15,2) := ROUND(p_stake, 2);
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Idempotency key is required'; END IF;

  SELECT * INTO v_settings
  FROM public.mines_settings
  WHERE id = TRUE
  FOR UPDATE;

  IF NOT v_settings.is_enabled OR v_settings.is_paused THEN
    RAISE EXCEPTION '%', v_settings.maintenance_message;
  END IF;

  IF v_stake IS NULL OR v_stake < v_settings.min_stake OR v_stake > v_settings.max_stake THEN
    RAISE EXCEPTION 'Stake must be between % and %', v_settings.min_stake, v_settings.max_stake;
  END IF;

  IF p_mine_count < v_settings.min_mines OR p_mine_count > v_settings.max_mines THEN
    RAISE EXCEPTION 'Choose between % and % mines', v_settings.min_mines, v_settings.max_mines;
  END IF;

  IF char_length(trim(COALESCE(p_client_seed, ''))) NOT BETWEEN 8 AND 128 THEN
    RAISE EXCEPTION 'Client seed must contain 8 to 128 characters';
  END IF;

  SELECT id INTO v_existing
  FROM public.mines_games
  WHERE user_id = v_user
    AND idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN public.mines_get_state(v_existing); END IF;

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

  IF EXISTS (
    SELECT 1 FROM public.mines_games
    WHERE user_id = v_user AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Finish the active Mines round first';
  END IF;

  SELECT COALESCE(SUM(stake), 0)
  INTO v_daily_wager
  FROM public.mines_games
  WHERE user_id = v_user
    AND created_at >= NOW() - INTERVAL '24 hours';

  IF v_daily_wager + v_stake > v_settings.max_user_daily_wager THEN
    RAISE EXCEPTION 'Daily Mines wager limit reached';
  END IF;

  PERFORM public.ensure_user_ledger_accounts_from_id(v_user, 0);

  PERFORM 1
  FROM public.ledger_accounts
  WHERE user_id = v_user
    AND currency = 'USD'
    AND account_code IN ('cash', 'bonus')
  FOR UPDATE;

  SELECT COALESCE(SUM(balance), 0)
  INTO v_available
  FROM public.ledger_accounts
  WHERE user_id = v_user
    AND currency = 'USD'
    AND account_code IN ('cash', 'bonus');

  IF v_available < v_stake THEN
    RAISE EXCEPTION 'Insufficient funded balance';
  END IF;

  v_seed := encode(extensions.gen_random_bytes(32), 'hex');
  v_seed_hash := encode(extensions.digest(v_seed, 'sha256'), 'hex');

  WHILE cardinality(v_mines) < p_mine_count LOOP
    v_hash := extensions.digest(
      v_seed || ':' || trim(p_client_seed) || ':' || v_counter::TEXT,
      'sha256'
    );
    v_candidate := (
      get_byte(v_hash, 0)::BIGINT * 16777216
      + get_byte(v_hash, 1)::BIGINT * 65536
      + get_byte(v_hash, 2)::BIGINT * 256
      + get_byte(v_hash, 3)::BIGINT
    ) % 25;
    IF NOT (v_candidate = ANY(v_mines)) THEN
      v_mines := array_append(v_mines, v_candidate);
    END IF;
    v_counter := v_counter + 1;
  END LOOP;

  INSERT INTO public.mines_games(
    user_id, stake, mine_count, mine_positions, server_seed,
    server_seed_hash, client_seed, idempotency_key,
    house_edge_percent, max_payout_limit
  )
  VALUES (
    v_user, v_stake, p_mine_count, v_mines, v_seed,
    v_seed_hash, trim(p_client_seed), p_idempotency_key,
    v_settings.house_edge_percent, v_settings.max_payout
  )
  RETURNING id INTO v_game;

  INSERT INTO public.wallet_transactions(
    user_id, type, amount, balance_before, balance_after,
    description, reference_id, status, metadata
  )
  VALUES (
    v_user, 'bet_placed', -v_stake, v_available, v_available - v_stake,
    'MindBet Mines stake', v_game, 'completed',
    jsonb_build_object(
      'game', 'mines',
      'mine_count', p_mine_count,
      'server_seed_hash', v_seed_hash,
      'house_edge_percent', v_settings.house_edge_percent,
      'idempotency_key', p_idempotency_key
    )
  );

  RETURN public.mines_get_state(v_game);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mines_pick(p_cell INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_game public.mines_games%ROWTYPE;
  v_revealed INTEGER[];
  v_multiplier NUMERIC(12,2);
  v_payout NUMERIC(15,2);
  v_available NUMERIC(18,2);
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_cell NOT BETWEEN 0 AND 24 THEN RAISE EXCEPTION 'Invalid board cell'; END IF;

  SELECT * INTO v_game
  FROM public.mines_games
  WHERE user_id = v_user AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No active Mines round'; END IF;

  IF p_cell = ANY(v_game.revealed_cells) THEN
    RETURN public.mines_get_state(v_game.id);
  END IF;

  IF p_cell = ANY(v_game.mine_positions) THEN
    UPDATE public.mines_games
    SET status = 'lost', completed_at = NOW()
    WHERE id = v_game.id;
    RETURN public.mines_get_state(v_game.id);
  END IF;

  v_revealed := array_append(v_game.revealed_cells, p_cell);
  v_multiplier := public.mines_multiplier(
    v_game.mine_count,
    cardinality(v_revealed),
    v_game.house_edge_percent
  );

  IF cardinality(v_revealed) = 25 - v_game.mine_count THEN
    v_payout := LEAST(
      v_game.max_payout_limit,
      ROUND(v_game.stake * v_multiplier, 2)
    );

    UPDATE public.mines_games
    SET revealed_cells = v_revealed,
        current_multiplier = v_multiplier,
        payout = v_payout,
        status = 'cashed_out',
        completed_at = NOW()
    WHERE id = v_game.id;

    SELECT COALESCE(SUM(balance), 0)
    INTO v_available
    FROM public.ledger_accounts
    WHERE user_id = v_user
      AND currency = 'USD'
      AND account_code IN ('cash', 'bonus')
    FOR UPDATE;

    INSERT INTO public.wallet_transactions(
      user_id, type, amount, balance_before, balance_after,
      description, reference_id, status, metadata
    )
    VALUES (
      v_user, 'bet_won', v_payout, v_available, v_available + v_payout,
      'MindBet Mines automatic cash-out', v_game.id, 'completed',
      jsonb_build_object(
        'game', 'mines',
        'multiplier', v_multiplier,
        'house_edge_percent', v_game.house_edge_percent
      )
    );
  ELSE
    UPDATE public.mines_games
    SET revealed_cells = v_revealed,
        current_multiplier = v_multiplier
    WHERE id = v_game.id;
  END IF;

  RETURN public.mines_get_state(v_game.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mines_cashout()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_game public.mines_games%ROWTYPE;
  v_payout NUMERIC(15,2);
  v_available NUMERIC(18,2);
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_game
  FROM public.mines_games
  WHERE user_id = v_user AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No active Mines round'; END IF;
  IF cardinality(v_game.revealed_cells) = 0 THEN
    RAISE EXCEPTION 'Reveal at least one safe tile before cashing out';
  END IF;

  v_payout := LEAST(
    v_game.max_payout_limit,
    ROUND(v_game.stake * v_game.current_multiplier, 2)
  );

  UPDATE public.mines_games
  SET payout = v_payout,
      status = 'cashed_out',
      completed_at = NOW()
  WHERE id = v_game.id;

  SELECT COALESCE(SUM(balance), 0)
  INTO v_available
  FROM public.ledger_accounts
  WHERE user_id = v_user
    AND currency = 'USD'
    AND account_code IN ('cash', 'bonus')
  FOR UPDATE;

  INSERT INTO public.wallet_transactions(
    user_id, type, amount, balance_before, balance_after,
    description, reference_id, status, metadata
  )
  VALUES (
    v_user, 'bet_won', v_payout, v_available, v_available + v_payout,
    'MindBet Mines cash-out', v_game.id, 'completed',
    jsonb_build_object(
      'game', 'mines',
      'multiplier', v_game.current_multiplier,
      'house_edge_percent', v_game.house_edge_percent
    )
  );

  RETURN public.mines_get_state(v_game.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mines_admin_get_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_admin UUID := auth.uid();
  v_settings public.mines_settings%ROWTYPE;
  v_wager NUMERIC(18,2);
  v_payout NUMERIC(18,2);
  v_active INTEGER;
  v_exposure NUMERIC(18,2);
  v_recent JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_admin
      AND is_admin = TRUE
      AND admin_role IN ('super_admin', 'admin')
      AND COALESCE(is_suspended, FALSE) = FALSE
  ) THEN
    RAISE EXCEPTION 'Mines admin authorization required';
  END IF;

  SELECT * INTO v_settings FROM public.mines_settings WHERE id = TRUE;

  SELECT
    COALESCE(SUM(stake), 0),
    COALESCE(SUM(payout), 0),
    COUNT(*) FILTER (WHERE status = 'active'),
    COALESCE(SUM(
      CASE WHEN status = 'active'
        THEN LEAST(max_payout_limit, stake * current_multiplier)
        ELSE 0
      END
    ), 0)
  INTO v_wager, v_payout, v_active, v_exposure
  FROM public.mines_games
  WHERE created_at >= NOW() - INTERVAL '24 hours';

  SELECT COALESCE(jsonb_agg(item ORDER BY created_at DESC), '[]'::JSONB)
  INTO v_recent
  FROM (
    SELECT created_at, jsonb_build_object(
      'id', id,
      'stake', stake,
      'mine_count', mine_count,
      'status', status,
      'multiplier', current_multiplier,
      'payout', payout,
      'created_at', created_at
    ) AS item
    FROM public.mines_games
    ORDER BY created_at DESC
    LIMIT 12
  ) rows;

  RETURN jsonb_build_object(
    'settings', to_jsonb(v_settings) - 'updated_by',
    'metrics', jsonb_build_object(
      'wager_24h', v_wager,
      'payout_24h', v_payout,
      'ggr_24h', v_wager - v_payout,
      'active_rounds', v_active,
      'current_exposure', v_exposure
    ),
    'recent_rounds', v_recent
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mines_admin_update_settings(
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
  v_previous public.mines_settings%ROWTYPE;
  v_enabled BOOLEAN;
  v_paused BOOLEAN;
  v_message TEXT;
  v_min_stake NUMERIC;
  v_max_stake NUMERIC;
  v_min_mines INTEGER;
  v_max_mines INTEGER;
  v_max_payout NUMERIC;
  v_edge NUMERIC;
  v_daily NUMERIC;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_admin
      AND is_admin = TRUE
      AND admin_role IN ('super_admin', 'admin')
      AND COALESCE(is_suspended, FALSE) = FALSE
  ) THEN
    RAISE EXCEPTION 'Mines admin authorization required';
  END IF;

  IF char_length(trim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'A meaningful audit reason is required';
  END IF;

  SELECT * INTO v_previous
  FROM public.mines_settings
  WHERE id = TRUE
  FOR UPDATE;

  v_enabled := COALESCE((p_settings->>'is_enabled')::BOOLEAN, v_previous.is_enabled);
  v_paused := COALESCE((p_settings->>'is_paused')::BOOLEAN, v_previous.is_paused);
  v_message := COALESCE(NULLIF(trim(p_settings->>'maintenance_message'), ''), v_previous.maintenance_message);
  v_min_stake := COALESCE((p_settings->>'min_stake')::NUMERIC, v_previous.min_stake);
  v_max_stake := COALESCE((p_settings->>'max_stake')::NUMERIC, v_previous.max_stake);
  v_min_mines := COALESCE((p_settings->>'min_mines')::INTEGER, v_previous.min_mines);
  v_max_mines := COALESCE((p_settings->>'max_mines')::INTEGER, v_previous.max_mines);
  v_max_payout := COALESCE((p_settings->>'max_payout')::NUMERIC, v_previous.max_payout);
  v_edge := COALESCE((p_settings->>'house_edge_percent')::NUMERIC, v_previous.house_edge_percent);
  v_daily := COALESCE((p_settings->>'max_user_daily_wager')::NUMERIC, v_previous.max_user_daily_wager);

  IF v_min_stake NOT BETWEEN 1 AND 500
     OR v_max_stake < v_min_stake OR v_max_stake > 500
     OR v_min_mines NOT BETWEEN 3 AND 10
     OR v_max_mines < v_min_mines OR v_max_mines > 10
     OR v_max_payout NOT BETWEEN 1 AND 1000000
     OR v_edge NOT BETWEEN 0 AND 10
     OR v_daily NOT BETWEEN 1 AND 10000000
     OR char_length(v_message) NOT BETWEEN 3 AND 240
  THEN
    RAISE EXCEPTION 'Invalid Mines settings';
  END IF;

  UPDATE public.mines_settings
  SET is_enabled = v_enabled,
      is_paused = v_paused,
      maintenance_message = v_message,
      min_stake = ROUND(v_min_stake, 2),
      max_stake = ROUND(v_max_stake, 2),
      min_mines = v_min_mines,
      max_mines = v_max_mines,
      max_payout = ROUND(v_max_payout, 2),
      house_edge_percent = ROUND(v_edge, 2),
      max_user_daily_wager = ROUND(v_daily, 2),
      updated_by = v_admin,
      updated_at = NOW()
  WHERE id = TRUE;

  INSERT INTO public.audit_logs(admin_id, action, entity_type, entity_id, changes)
  VALUES (
    v_admin,
    'mines_settings_updated',
    'mines_settings',
    NULL,
    jsonb_build_object(
      'reason', trim(p_reason),
      'before', to_jsonb(v_previous) - 'updated_by',
      'after', p_settings
    )
  );

  RETURN public.mines_admin_get_dashboard();
END;
$function$;

REVOKE ALL ON FUNCTION public.mines_multiplier(INTEGER, INTEGER, NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mines_admin_get_dashboard()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mines_admin_update_settings(JSONB, TEXT)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.mines_get_state(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mines_start(NUMERIC, INTEGER, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mines_pick(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mines_cashout() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mines_admin_get_dashboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mines_admin_update_settings(JSONB, TEXT) TO authenticated;

COMMENT ON TABLE public.mines_settings IS
  'Fairness-safe Mines operational limits. Settings affect future rounds only and cannot target outcomes.';
