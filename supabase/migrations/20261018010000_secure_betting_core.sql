-- Harden the money/betting boundary. Client code may read betting data, but all
-- balance mutations and bet creation happen in the atomic functions below.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_admin_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_admin_role_check
  CHECK (
    admin_role IN (
      'super_admin', 'admin', 'finance', 'kyc', 'support',
      'risk_manager', 'sports_trader'
    ) OR admin_role IS NULL
  );

ALTER TABLE public.bets DROP CONSTRAINT IF EXISTS bets_status_check;
ALTER TABLE public.bets ADD CONSTRAINT bets_status_check
  CHECK (status IN ('pending', 'won', 'lost', 'void', 'cashout', 'cancelled'));

-- Users may update their own safe profile fields, but never balances, roles,
-- verification, KYC or suspension state.
CREATE OR REPLACE FUNCTION public.protect_profile_system_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() AND NOT public.is_service_role() THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.email IS DISTINCT FROM OLD.email
      OR NEW.demo_balance IS DISTINCT FROM OLD.demo_balance
      OR NEW.is_admin IS DISTINCT FROM OLD.is_admin
      OR NEW.admin_role IS DISTINCT FROM OLD.admin_role
      OR NEW.kyc_status IS DISTINCT FROM OLD.kyc_status
      OR NEW.is_verified IS DISTINCT FROM OLD.is_verified
      OR NEW.is_suspended IS DISTINCT FROM OLD.is_suspended
      OR NEW.suspension_reason IS DISTINCT FROM OLD.suspension_reason
      OR NEW.referral_code IS DISTINCT FROM OLD.referral_code
      OR NEW.referred_by IS DISTINCT FROM OLD.referred_by
    THEN
      RAISE EXCEPTION 'Protected profile fields cannot be changed by this user';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_system_fields_trigger ON public.profiles;
CREATE TRIGGER protect_profile_system_fields_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_system_fields();

DROP POLICY IF EXISTS "users_update_own_profile" ON public.profiles;
CREATE POLICY "users_update_own_profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Remove client-side mutation paths that can bypass the wallet ledger.
DROP POLICY IF EXISTS "System can insert transactions" ON public.wallet_transactions;
DROP POLICY IF EXISTS "Users can insert own bets" ON public.bets;
DROP POLICY IF EXISTS "Users can insert bet selections" ON public.bet_selections;

-- Retire unsafe RPCs. Their old signatures accepted arbitrary user IDs or
-- arbitrary payouts and ran with SECURITY DEFINER privileges.
REVOKE ALL ON FUNCTION public.place_bet(UUID, TEXT, DECIMAL, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_bet(UUID, TEXT, DECIMAL) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.award_bonus(UUID, UUID, DECIMAL, DECIMAL) FROM PUBLIC, anon, authenticated;
DO $$
DECLARE
  v_function REGPROCEDURE;
BEGIN
  FOR v_function IN
    SELECT p.oid::REGPROCEDURE
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'place_bet_atomic'
  LOOP
    EXECUTE format('DROP FUNCTION %s', v_function);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.place_bet_atomic(
  p_bet_type TEXT,
  p_stake DECIMAL,
  p_selections JSONB,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_balance DECIMAL;
  v_bet_id UUID;
  v_transaction_id UUID;
  v_selection JSONB;
  v_event_id UUID;
  v_market_id UUID;
  v_odds_id UUID;
  v_requested_odds DECIMAL;
  v_current_odds DECIMAL;
  v_current_selection TEXT;
  v_total_odds DECIMAL := 1;
  v_potential_return DECIMAL;
  v_selection_count INTEGER;
  v_response JSONB;
  v_cached JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 8 THEN
    RAISE EXCEPTION 'A valid idempotency key is required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::TEXT || ':' || p_idempotency_key, 0)
  );

  SELECT response_data INTO v_cached
  FROM public.idempotency_keys
  WHERE key = p_idempotency_key
    AND user_id = v_user_id
    AND expires_at > NOW();

  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  IF p_bet_type NOT IN ('single', 'multiple') THEN
    RAISE EXCEPTION 'Only single and multiple bets are currently supported';
  END IF;

  IF p_stake IS NULL OR p_stake <= 0 OR p_stake > 100000 THEN
    RAISE EXCEPTION 'Invalid stake';
  END IF;

  IF p_selections IS NULL OR jsonb_typeof(p_selections) <> 'array' THEN
    RAISE EXCEPTION 'Selections must be a JSON array';
  END IF;

  v_selection_count := jsonb_array_length(p_selections);
  IF v_selection_count = 0 OR v_selection_count > 25 THEN
    RAISE EXCEPTION 'Invalid number of selections';
  END IF;
  IF p_bet_type = 'single' AND v_selection_count <> 1 THEN
    RAISE EXCEPTION 'A single bet requires exactly one selection';
  END IF;
  IF p_bet_type = 'multiple' AND v_selection_count < 2 THEN
    RAISE EXCEPTION 'A multiple bet requires at least two selections';
  END IF;

  SELECT COALESCE(demo_balance, 0)
  INTO v_balance
  FROM public.profiles
  WHERE id = v_user_id
    AND COALESCE(is_suspended, FALSE) = FALSE
    AND (self_exclusion_until IS NULL OR self_exclusion_until <= NOW())
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account is unavailable or self-excluded';
  END IF;
  IF v_balance < p_stake THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- Read every price from the database. Browser-supplied odds are used only to
  -- detect a reprice; they never determine the accepted payout.
  FOR v_selection IN SELECT value FROM jsonb_array_elements(p_selections)
  LOOP
    v_event_id := (v_selection->>'event_id')::UUID;
    v_market_id := (v_selection->>'market_id')::UUID;
    v_odds_id := (v_selection->>'odds_id')::UUID;
    v_requested_odds := (v_selection->>'odds_value')::DECIMAL;

    SELECT o.value, o.selection
    INTO v_current_odds, v_current_selection
    FROM public.odds o
    JOIN public.markets m ON m.id = o.market_id
    JOIN public.events e ON e.id = m.event_id
    WHERE o.id = v_odds_id
      AND m.id = v_market_id
      AND e.id = v_event_id
      AND o.is_active = TRUE
      AND COALESCE(o.is_locked, FALSE) = FALSE
      AND m.status = 'active'
      AND e.status IN ('upcoming', 'live')
      AND COALESCE(e.is_suspended, FALSE) = FALSE
    FOR SHARE OF o, m, e;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A selection is unavailable';
    END IF;
    IF v_current_selection IS DISTINCT FROM (v_selection->>'selection') THEN
      RAISE EXCEPTION 'Selection does not match current market data';
    END IF;
    IF ABS(v_current_odds - v_requested_odds) > 0.01 THEN
      RAISE EXCEPTION 'Odds changed. Current odds: %', v_current_odds;
    END IF;

    v_total_odds := v_total_odds * v_current_odds;
  END LOOP;

  v_potential_return := ROUND(p_stake * v_total_odds, 2);

  INSERT INTO public.bets (
    user_id, type, stake, total_odds, potential_return, status
  ) VALUES (
    v_user_id, p_bet_type, p_stake, v_total_odds,
    v_potential_return, 'pending'
  ) RETURNING id INTO v_bet_id;

  FOR v_selection IN SELECT value FROM jsonb_array_elements(p_selections)
  LOOP
    INSERT INTO public.bet_selections (
      bet_id, event_id, market_id, odds_id, selection, odds_value, result
    ) VALUES (
      v_bet_id,
      (v_selection->>'event_id')::UUID,
      (v_selection->>'market_id')::UUID,
      (v_selection->>'odds_id')::UUID,
      v_selection->>'selection',
      (SELECT value FROM public.odds WHERE id = (v_selection->>'odds_id')::UUID),
      'pending'
    );
  END LOOP;

  UPDATE public.profiles
  SET demo_balance = v_balance - p_stake,
      updated_at = NOW()
  WHERE id = v_user_id;

  INSERT INTO public.wallet_transactions (
    user_id, type, amount, balance_before, balance_after,
    description, reference_id, status
  ) VALUES (
    v_user_id, 'bet_placed', -p_stake, v_balance, v_balance - p_stake,
    'Bet placed - ' || p_bet_type, v_bet_id, 'completed'
  ) RETURNING id INTO v_transaction_id;

  UPDATE public.bets
  SET wallet_transaction_id = v_transaction_id
  WHERE id = v_bet_id;

  v_response := jsonb_build_object(
    'success', TRUE,
    'bet', jsonb_build_object(
      'id', v_bet_id,
      'type', p_bet_type,
      'stake', p_stake,
      'totalOdds', v_total_odds,
      'potentialReturn', v_potential_return,
      'status', 'pending'
    ),
    'result', 'accepted'
  );

  INSERT INTO public.idempotency_keys (
    user_id, key, request_data, response_data, expires_at
  ) VALUES (
    v_user_id,
    p_idempotency_key,
    jsonb_build_object(
      'betType', p_bet_type,
      'stake', p_stake,
      'selections', p_selections
    ),
    v_response,
    NOW() + INTERVAL '24 hours'
  );

  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.place_bet_atomic(TEXT, DECIMAL, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_bet_atomic(TEXT, DECIMAL, JSONB, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_bet_atomic(p_bet_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_bet public.bets%ROWTYPE;
  v_balance DECIMAL;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_bet
  FROM public.bets
  WHERE id = p_bet_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_bet.status <> 'pending' THEN
    RAISE EXCEPTION 'Bet is not cancellable';
  END IF;
  IF v_bet.created_at < NOW() - INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'Cancellation period expired';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.bet_selections bs
    JOIN public.events e ON e.id = bs.event_id
    WHERE bs.bet_id = p_bet_id AND e.start_time <= NOW()
  ) THEN
    RAISE EXCEPTION 'An event has already started';
  END IF;

  SELECT COALESCE(demo_balance, 0) INTO v_balance
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  UPDATE public.profiles
  SET demo_balance = v_balance + v_bet.stake,
      updated_at = NOW()
  WHERE id = v_user_id;

  UPDATE public.bets
  SET status = 'cancelled', settled_at = NOW(), payout = v_bet.stake
  WHERE id = p_bet_id;

  INSERT INTO public.wallet_transactions (
    user_id, type, amount, balance_before, balance_after,
    description, reference_id, status
  ) VALUES (
    v_user_id, 'adjustment', v_bet.stake, v_balance,
    v_balance + v_bet.stake, 'Bet cancellation refund', p_bet_id, 'completed'
  );

  RETURN jsonb_build_object('success', TRUE, 'betId', p_bet_id);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_bet_atomic(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_bet_atomic(UUID) TO authenticated;

-- Existing administrative money functions now enforce caller authorization.
CREATE OR REPLACE FUNCTION public.settle_bet(
  p_bet_id UUID,
  p_result TEXT,
  p_payout DECIMAL DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bet public.bets%ROWTYPE;
  v_balance DECIMAL;
  v_credit DECIMAL := 0;
  v_transaction_type TEXT;
BEGIN
  IF NOT public.is_admin() AND NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;
  IF p_result NOT IN ('won', 'lost', 'void') THEN
    RAISE EXCEPTION 'Invalid settlement result';
  END IF;

  SELECT * INTO v_bet FROM public.bets WHERE id = p_bet_id FOR UPDATE;
  IF NOT FOUND OR v_bet.status <> 'pending' THEN
    RAISE EXCEPTION 'Bet is not pending';
  END IF;

  SELECT COALESCE(demo_balance, 0) INTO v_balance
  FROM public.profiles WHERE id = v_bet.user_id FOR UPDATE;

  IF p_result = 'won' THEN
    v_credit := v_bet.potential_return;
    v_transaction_type := 'bet_won';
  ELSIF p_result = 'void' THEN
    v_credit := v_bet.stake;
    v_transaction_type := 'adjustment';
  ELSE
    v_transaction_type := 'bet_lost';
  END IF;

  UPDATE public.profiles
  SET demo_balance = v_balance + v_credit, updated_at = NOW()
  WHERE id = v_bet.user_id;

  UPDATE public.bets
  SET status = p_result, payout = v_credit, settled_at = NOW()
  WHERE id = p_bet_id;

  UPDATE public.bet_selections
  SET result = p_result
  WHERE bet_id = p_bet_id;

  INSERT INTO public.wallet_transactions (
    user_id, type, amount, balance_before, balance_after,
    description, reference_id, status
  ) VALUES (
    v_bet.user_id, v_transaction_type, v_credit, v_balance,
    v_balance + v_credit, 'Bet settled - ' || p_result,
    p_bet_id, 'completed'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.settle_bet(UUID, TEXT, DECIMAL) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_bet(UUID, TEXT, DECIMAL) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.award_bonus(
  p_user_id UUID,
  p_promotion_id UUID,
  p_amount DECIMAL,
  p_wagering_requirement DECIMAL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bonus_id UUID;
  v_balance DECIMAL;
BEGIN
  IF NOT public.is_admin() AND NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Bonus amount must be positive';
  END IF;

  SELECT COALESCE(demo_balance, 0) INTO v_balance
  FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  INSERT INTO public.user_bonuses (
    user_id, promotion_id, amount, wagering_requirement, expires_at
  ) VALUES (
    p_user_id, p_promotion_id, p_amount,
    GREATEST(COALESCE(p_wagering_requirement, 0), 0),
    NOW() + INTERVAL '30 days'
  ) RETURNING id INTO v_bonus_id;

  UPDATE public.profiles
  SET demo_balance = v_balance + p_amount, updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO public.wallet_transactions (
    user_id, type, amount, balance_before, balance_after,
    description, reference_id, status
  ) VALUES (
    p_user_id, 'bonus_awarded', p_amount, v_balance,
    v_balance + p_amount, 'Bonus awarded', v_bonus_id, 'completed'
  );

  RETURN v_bonus_id;
END;
$$;

REVOKE ALL ON FUNCTION public.award_bonus(UUID, UUID, DECIMAL, DECIMAL) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_bonus(UUID, UUID, DECIMAL, DECIMAL) TO service_role;
