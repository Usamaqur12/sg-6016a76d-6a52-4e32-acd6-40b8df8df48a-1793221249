-- Complete MindBet Mines eligibility and ledger compatibility.
-- KYC is required for withdrawals, not for placing a Mines wager.
-- Outcomes remain server-authoritative and hash-committed before play.

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
  v_existing UUID;
  v_game UUID;
  v_seed TEXT;
  v_seed_hash TEXT;
  v_hash BYTEA;
  v_mines INTEGER[] := ARRAY[]::INTEGER[];
  v_candidate INTEGER;
  v_counter INTEGER := 0;
  v_available NUMERIC(18,2);
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Idempotency key is required';
  END IF;

  IF p_stake IS NULL OR ROUND(p_stake, 2) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Stake must be between 1 and 500';
  END IF;

  IF p_mine_count NOT BETWEEN 3 AND 10 THEN
    RAISE EXCEPTION 'Choose between 3 and 10 mines';
  END IF;

  IF char_length(trim(COALESCE(p_client_seed, ''))) NOT BETWEEN 8 AND 128 THEN
    RAISE EXCEPTION 'Client seed must contain 8 to 128 characters';
  END IF;

  SELECT id
  INTO v_existing
  FROM public.mines_games
  WHERE user_id = v_user
    AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN public.mines_get_state(v_existing);
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE id = v_user
  FOR UPDATE;

  IF NOT FOUND OR COALESCE(v_profile.is_admin, FALSE) THEN
    RAISE EXCEPTION 'Customer account required';
  END IF;

  -- KYC approval is intentionally not checked here. It is enforced at
  -- withdrawal time. Administrators can still suspend an account or disable
  -- its wallet/betting access independently.
  IF COALESCE(v_profile.is_suspended, FALSE)
     OR COALESCE(v_profile.account_status, 'active') IN ('suspended', 'closed', 'archived', 'disabled')
  THEN
    RAISE EXCEPTION 'Account is not eligible for casino play';
  END IF;

  IF COALESCE(v_profile.wallet_frozen, FALSE)
     OR COALESCE(v_profile.betting_disabled, FALSE)
  THEN
    RAISE EXCEPTION 'Casino play is disabled for this account';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.mines_games
    WHERE user_id = v_user
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Finish the active Mines round first';
  END IF;

  -- Create missing zero-balance wallet buckets without ever seeding from a
  -- legacy/demo profile balance.
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

  IF v_available < ROUND(p_stake, 2) THEN
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
    user_id,
    stake,
    mine_count,
    mine_positions,
    server_seed,
    server_seed_hash,
    client_seed,
    idempotency_key
  )
  VALUES (
    v_user,
    ROUND(p_stake, 2),
    p_mine_count,
    v_mines,
    v_seed,
    v_seed_hash,
    trim(p_client_seed),
    p_idempotency_key
  )
  RETURNING id INTO v_game;

  -- The installed wallet trigger posts the matching double-entry ledger
  -- journal atomically. A trigger failure rolls the entire game start back.
  INSERT INTO public.wallet_transactions(
    user_id,
    type,
    amount,
    balance_before,
    balance_after,
    description,
    reference_id,
    status,
    metadata
  )
  VALUES (
    v_user,
    'bet_placed',
    -ROUND(p_stake, 2),
    v_available,
    v_available - ROUND(p_stake, 2),
    'MindBet Mines stake',
    v_game,
    'completed',
    jsonb_build_object(
      'game', 'mines',
      'mine_count', p_mine_count,
      'server_seed_hash', v_seed_hash,
      'idempotency_key', p_idempotency_key
    )
  );

  RETURN public.mines_get_state(v_game);
END;
$function$;

REVOKE ALL ON FUNCTION public.mines_start(NUMERIC, INTEGER, TEXT, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mines_start(NUMERIC, INTEGER, TEXT, UUID)
  TO authenticated;

COMMENT ON FUNCTION public.mines_start(NUMERIC, INTEGER, TEXT, UUID) IS
  'Starts a server-authoritative provably-fair Mines round and debits the funded ledger atomically. KYC remains a withdrawal requirement.';
