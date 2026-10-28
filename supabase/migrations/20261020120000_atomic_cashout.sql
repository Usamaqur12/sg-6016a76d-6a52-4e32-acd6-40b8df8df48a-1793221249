-- Atomic customer cash-out. The offer is recalculated from locked database
-- rows at acceptance time; browser-supplied balances and odds are never used.

CREATE OR REPLACE FUNCTION public.accept_cashout(
  p_bet_id UUID,
  p_cashout_type TEXT DEFAULT 'full',
  p_partial_amount NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_bet public.bets%ROWTYPE;
  v_balance NUMERIC(15,2);
  v_current_odds NUMERIC := 1;
  v_full_offer NUMERIC(15,2);
  v_credit NUMERIC(15,2);
  v_fraction NUMERIC;
  v_transaction_id UUID;
  v_offer_id UUID;
  v_selection RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_cashout_type NOT IN ('full', 'partial') THEN
    RAISE EXCEPTION 'Invalid cash-out type';
  END IF;

  SELECT * INTO v_bet
  FROM public.bets
  WHERE id = p_bet_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;
  IF v_bet.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending bets can be cashed out';
  END IF;

  FOR v_selection IN
    SELECT o.value
    FROM public.bet_selections bs
    JOIN public.odds o ON o.id = bs.odds_id
    JOIN public.markets m ON m.id = bs.market_id AND m.id = o.market_id
    JOIN public.events e ON e.id = bs.event_id AND e.id = m.event_id
    WHERE bs.bet_id = p_bet_id
      AND COALESCE(bs.result, 'pending') = 'pending'
      AND o.is_active = TRUE
      AND COALESCE(o.is_locked, FALSE) = FALSE
      AND m.status = 'active'
      AND e.status IN ('upcoming', 'live')
      AND COALESCE(e.is_suspended, FALSE) = FALSE
    FOR SHARE OF o, m, e
  LOOP
    v_current_odds := v_current_odds * v_selection.value;
  END LOOP;

  IF NOT FOUND OR v_current_odds <= 0 THEN
    RAISE EXCEPTION 'Cash-out is unavailable because a selection is suspended or settled';
  END IF;
  IF (SELECT COUNT(*) FROM public.bet_selections WHERE bet_id = p_bet_id)
     <> (SELECT COUNT(*)
         FROM public.bet_selections bs
         JOIN public.odds o ON o.id = bs.odds_id
         JOIN public.markets m ON m.id = bs.market_id AND m.id = o.market_id
         JOIN public.events e ON e.id = bs.event_id AND e.id = m.event_id
         WHERE bs.bet_id = p_bet_id
           AND COALESCE(bs.result, 'pending') = 'pending'
           AND o.is_active = TRUE
           AND COALESCE(o.is_locked, FALSE) = FALSE
           AND m.status = 'active'
           AND e.status IN ('upcoming', 'live')
           AND COALESCE(e.is_suspended, FALSE) = FALSE) THEN
    RAISE EXCEPTION 'Cash-out is unavailable because a selection changed state';
  END IF;

  v_full_offer := ROUND((v_bet.stake * v_current_odds * 0.85) / NULLIF(v_bet.total_odds, 0), 2);
  IF v_full_offer IS NULL OR v_full_offer < 0.01 THEN
    RAISE EXCEPTION 'Cash-out offer is unavailable';
  END IF;

  IF p_cashout_type = 'full' THEN
    v_credit := v_full_offer;
    v_fraction := 1;
  ELSE
    IF p_partial_amount IS NULL OR p_partial_amount < 0.01 OR p_partial_amount >= v_full_offer THEN
      RAISE EXCEPTION 'Partial cash-out must be at least 0.01 and less than the full offer';
    END IF;
    v_credit := ROUND(p_partial_amount, 2);
    v_fraction := v_credit / v_full_offer;
  END IF;

  SELECT COALESCE(demo_balance, 0) INTO v_balance
  FROM public.profiles
  WHERE id = v_user_id
    AND COALESCE(is_suspended, FALSE) = FALSE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet is unavailable';
  END IF;

  UPDATE public.profiles
  SET demo_balance = v_balance + v_credit,
      updated_at = NOW()
  WHERE id = v_user_id;

  INSERT INTO public.wallet_transactions (
    user_id, type, amount, balance_before, balance_after,
    description, reference_id, status, metadata
  ) VALUES (
    v_user_id, 'adjustment', v_credit, v_balance, v_balance + v_credit,
    CASE WHEN p_cashout_type = 'full' THEN 'Full cash-out' ELSE 'Partial cash-out' END,
    p_bet_id, 'completed',
    jsonb_build_object('cashout_type', p_cashout_type, 'full_offer', v_full_offer, 'fraction', v_fraction)
  ) RETURNING id INTO v_transaction_id;

  IF p_cashout_type = 'full' THEN
    UPDATE public.bets
    SET status = 'cashout', payout = v_credit, settled_at = NOW()
    WHERE id = p_bet_id;
  ELSE
    UPDATE public.bets
    SET stake = ROUND(stake * (1 - v_fraction), 2),
        potential_return = ROUND(potential_return * (1 - v_fraction), 2)
    WHERE id = p_bet_id;
  END IF;

  INSERT INTO public.cashout_offers (
    bet_id, user_id, offer_type, original_stake, original_odds,
    current_odds, cashout_amount, cashout_percentage, is_available,
    expires_at, accepted_at, wallet_transaction_id
  ) VALUES (
    p_bet_id, v_user_id, p_cashout_type, v_bet.stake, v_bet.total_odds,
    v_current_odds, v_credit, ROUND(v_fraction * 100, 2), FALSE,
    NOW() + INTERVAL '30 seconds', NOW(), v_transaction_id
  ) RETURNING id INTO v_offer_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'betId', p_bet_id,
    'offerId', v_offer_id,
    'cashoutType', p_cashout_type,
    'cashoutAmount', v_credit,
    'fullOffer', v_full_offer,
    'balanceAfter', v_balance + v_credit,
    'remainingStake', CASE WHEN p_cashout_type = 'partial' THEN ROUND(v_bet.stake * (1 - v_fraction), 2) ELSE 0 END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_cashout(UUID, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_cashout(UUID, TEXT, NUMERIC) TO authenticated;

