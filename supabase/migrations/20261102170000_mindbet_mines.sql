-- MindBet Mines: server-authoritative, provably-fair turn-based casino game.
-- Outcomes are committed before play and cannot be changed by an administrator.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.mines_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  stake NUMERIC(15,2) NOT NULL CHECK (stake BETWEEN 1 AND 500),
  mine_count INTEGER NOT NULL CHECK (mine_count BETWEEN 3 AND 10),
  revealed_cells INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  mine_positions INTEGER[] NOT NULL,
  current_multiplier NUMERIC(12,2) NOT NULL DEFAULT 1.00,
  payout NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','lost','cashed_out')),
  server_seed TEXT NOT NULL,
  server_seed_hash TEXT NOT NULL,
  client_seed TEXT NOT NULL,
  idempotency_key UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS mines_one_active_game_per_user
  ON public.mines_games(user_id)
  WHERE status='active';

CREATE INDEX IF NOT EXISTS mines_games_user_created_idx
  ON public.mines_games(user_id,created_at DESC);

ALTER TABLE public.mines_games ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mines_games FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.mines_multiplier(p_mines INTEGER,p_safe_picks INTEGER)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path=public
AS $$
DECLARE
  v_multiplier NUMERIC := 1;
  v_index INTEGER;
BEGIN
  IF p_mines NOT BETWEEN 3 AND 10 OR p_safe_picks < 0 OR p_safe_picks > 25-p_mines THEN
    RAISE EXCEPTION 'Invalid Mines multiplier inputs';
  END IF;
  IF p_safe_picks=0 THEN RETURN 1.00; END IF;
  FOR v_index IN 0..p_safe_picks-1 LOOP
    v_multiplier:=v_multiplier*((25-v_index)::NUMERIC/(25-p_mines-v_index)::NUMERIC);
  END LOOP;
  RETURN GREATEST(1.01,FLOOR(v_multiplier*0.99*100)/100);
END;
$$;

CREATE OR REPLACE FUNCTION public.mines_get_state(p_game_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_user UUID:=auth.uid();
  v_game public.mines_games%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  IF p_game_id IS NULL THEN
    SELECT * INTO v_game
    FROM public.mines_games
    WHERE user_id=v_user
    ORDER BY (status='active') DESC,created_at DESC
    LIMIT 1;
  ELSE
    SELECT * INTO v_game
    FROM public.mines_games
    WHERE id=p_game_id AND user_id=v_user;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'game',NULL,
      'settings',jsonb_build_object('min_stake',1,'max_stake',500,'min_mines',3,'max_mines',10,'max_payout',100000)
    );
  END IF;

  RETURN jsonb_build_object(
    'game',jsonb_build_object(
      'id',v_game.id,
      'stake',v_game.stake,
      'mine_count',v_game.mine_count,
      'revealed_cells',to_jsonb(v_game.revealed_cells),
      'mine_positions',CASE WHEN v_game.status='active' THEN '[]'::JSONB ELSE to_jsonb(v_game.mine_positions) END,
      'current_multiplier',v_game.current_multiplier,
      'potential_payout',LEAST(100000,ROUND(v_game.stake*v_game.current_multiplier,2)),
      'payout',v_game.payout,
      'status',v_game.status,
      'server_seed_hash',v_game.server_seed_hash,
      'server_seed',CASE WHEN v_game.status='active' THEN NULL ELSE v_game.server_seed END,
      'client_seed',v_game.client_seed,
      'created_at',v_game.created_at,
      'completed_at',v_game.completed_at
    ),
    'settings',jsonb_build_object('min_stake',1,'max_stake',500,'min_mines',3,'max_mines',10,'max_payout',100000)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mines_start(
  p_stake NUMERIC,
  p_mine_count INTEGER,
  p_client_seed TEXT,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_user UUID:=auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_existing UUID;
  v_game UUID;
  v_seed TEXT;
  v_seed_hash TEXT;
  v_hash BYTEA;
  v_mines INTEGER[]:=ARRAY[]::INTEGER[];
  v_candidate INTEGER;
  v_counter INTEGER:=0;
  v_available NUMERIC(18,2);
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Idempotency key is required'; END IF;
  IF p_stake IS NULL OR ROUND(p_stake,2) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Stake must be between 1 and 500'; END IF;
  IF p_mine_count NOT BETWEEN 3 AND 10 THEN RAISE EXCEPTION 'Choose between 3 and 10 mines'; END IF;
  IF char_length(trim(COALESCE(p_client_seed,''))) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'Client seed must contain 8 to 128 characters'; END IF;

  SELECT id INTO v_existing
  FROM public.mines_games
  WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
  IF FOUND THEN RETURN public.mines_get_state(v_existing); END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id=v_user FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_profile.is_admin,FALSE) THEN RAISE EXCEPTION 'Customer account required'; END IF;
  IF COALESCE(v_profile.is_suspended,FALSE)
     OR COALESCE(v_profile.account_status,'pending_kyc')<>'active'
     OR NOT (v_profile.kyc_status='approved' OR COALESCE(v_profile.kyc_activation_override,FALSE))
  THEN RAISE EXCEPTION 'Complete KYC or obtain an administrator activation before playing'; END IF;
  IF COALESCE(v_profile.wallet_frozen,FALSE) OR COALESCE(v_profile.betting_disabled,FALSE) THEN
    RAISE EXCEPTION 'Casino play is disabled for this account';
  END IF;

  IF EXISTS (SELECT 1 FROM public.mines_games WHERE user_id=v_user AND status='active') THEN
    RAISE EXCEPTION 'Finish the active Mines round first';
  END IF;

  PERFORM 1 FROM public.ledger_accounts
  WHERE user_id=v_user AND currency='USD' AND account_code IN ('cash','bonus')
  FOR UPDATE;
  SELECT COALESCE(SUM(balance),0) INTO v_available
  FROM public.ledger_accounts
  WHERE user_id=v_user AND currency='USD' AND account_code IN ('cash','bonus');
  IF v_available<ROUND(p_stake,2) THEN RAISE EXCEPTION 'Insufficient funded balance'; END IF;

  v_seed:=encode(gen_random_bytes(32),'hex');
  v_seed_hash:=encode(digest(v_seed,'sha256'),'hex');

  WHILE cardinality(v_mines)<p_mine_count LOOP
    v_hash:=digest(v_seed||':'||trim(p_client_seed)||':'||v_counter::TEXT,'sha256');
    v_candidate:=(
      get_byte(v_hash,0)::BIGINT*16777216+
      get_byte(v_hash,1)::BIGINT*65536+
      get_byte(v_hash,2)::BIGINT*256+
      get_byte(v_hash,3)::BIGINT
    )%25;
    IF NOT (v_candidate=ANY(v_mines)) THEN v_mines:=array_append(v_mines,v_candidate); END IF;
    v_counter:=v_counter+1;
  END LOOP;

  INSERT INTO public.mines_games(
    user_id,stake,mine_count,mine_positions,server_seed,server_seed_hash,client_seed,idempotency_key
  ) VALUES (
    v_user,ROUND(p_stake,2),p_mine_count,v_mines,v_seed,v_seed_hash,trim(p_client_seed),p_idempotency_key
  ) RETURNING id INTO v_game;

  INSERT INTO public.wallet_transactions(
    user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata
  ) VALUES (
    v_user,'bet_placed',-ROUND(p_stake,2),v_available,v_available-ROUND(p_stake,2),
    'MindBet Mines stake',v_game,'completed',
    jsonb_build_object('game','mines','mine_count',p_mine_count,'server_seed_hash',v_seed_hash)
  );

  RETURN public.mines_get_state(v_game);
END;
$$;

CREATE OR REPLACE FUNCTION public.mines_pick(p_cell INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_user UUID:=auth.uid();
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
  WHERE user_id=v_user AND status='active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No active Mines round'; END IF;

  IF p_cell=ANY(v_game.revealed_cells) THEN RETURN public.mines_get_state(v_game.id); END IF;

  IF p_cell=ANY(v_game.mine_positions) THEN
    UPDATE public.mines_games
    SET status='lost',completed_at=NOW()
    WHERE id=v_game.id;
    RETURN public.mines_get_state(v_game.id);
  END IF;

  v_revealed:=array_append(v_game.revealed_cells,p_cell);
  v_multiplier:=public.mines_multiplier(v_game.mine_count,cardinality(v_revealed));

  IF cardinality(v_revealed)=25-v_game.mine_count THEN
    v_payout:=LEAST(100000,ROUND(v_game.stake*v_multiplier,2));
    UPDATE public.mines_games
    SET revealed_cells=v_revealed,current_multiplier=v_multiplier,payout=v_payout,status='cashed_out',completed_at=NOW()
    WHERE id=v_game.id;

    PERFORM 1 FROM public.ledger_accounts
    WHERE user_id=v_user AND currency='USD' AND account_code IN ('cash','bonus')
    FOR UPDATE;
    SELECT COALESCE(SUM(balance),0) INTO v_available
    FROM public.ledger_accounts
    WHERE user_id=v_user AND currency='USD' AND account_code IN ('cash','bonus');

    INSERT INTO public.wallet_transactions(
      user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata
    ) VALUES (
      v_user,'bet_won',v_payout,v_available,v_available+v_payout,
      'MindBet Mines automatic cash-out',v_game.id,'completed',
      jsonb_build_object('game','mines','multiplier',v_multiplier)
    );
  ELSE
    UPDATE public.mines_games
    SET revealed_cells=v_revealed,current_multiplier=v_multiplier
    WHERE id=v_game.id;
  END IF;

  RETURN public.mines_get_state(v_game.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.mines_cashout()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_user UUID:=auth.uid();
  v_game public.mines_games%ROWTYPE;
  v_payout NUMERIC(15,2);
  v_available NUMERIC(18,2);
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_game
  FROM public.mines_games
  WHERE user_id=v_user AND status='active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No active Mines round'; END IF;
  IF cardinality(v_game.revealed_cells)=0 THEN RAISE EXCEPTION 'Reveal at least one safe tile before cashing out'; END IF;

  v_payout:=LEAST(100000,ROUND(v_game.stake*v_game.current_multiplier,2));
  UPDATE public.mines_games
  SET payout=v_payout,status='cashed_out',completed_at=NOW()
  WHERE id=v_game.id;

  PERFORM 1 FROM public.ledger_accounts
  WHERE user_id=v_user AND currency='USD' AND account_code IN ('cash','bonus')
  FOR UPDATE;
  SELECT COALESCE(SUM(balance),0) INTO v_available
  FROM public.ledger_accounts
  WHERE user_id=v_user AND currency='USD' AND account_code IN ('cash','bonus');

  INSERT INTO public.wallet_transactions(
    user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata
  ) VALUES (
    v_user,'bet_won',v_payout,v_available,v_available+v_payout,
    'MindBet Mines cash-out',v_game.id,'completed',
    jsonb_build_object('game','mines','multiplier',v_game.current_multiplier)
  );

  RETURN public.mines_get_state(v_game.id);
END;
$$;

REVOKE ALL ON FUNCTION public.mines_multiplier(INTEGER,INTEGER) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mines_get_state(UUID) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.mines_start(NUMERIC,INTEGER,TEXT,UUID) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.mines_pick(INTEGER) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.mines_cashout() FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.mines_get_state(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mines_start(NUMERIC,INTEGER,TEXT,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mines_pick(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mines_cashout() TO authenticated;

COMMENT ON TABLE public.mines_games IS
  'Server-authoritative provably-fair Mines rounds. Server seed is disclosed only after completion.';
