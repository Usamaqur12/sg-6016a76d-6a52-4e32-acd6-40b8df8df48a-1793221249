-- Function to create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, demo_balance, referral_code)
  VALUES (
    NEW.id,
    NEW.email,
    10000.00,
    SUBSTRING(MD5(RANDOM()::TEXT || NEW.id::TEXT) FROM 1 FOR 8)
  );
  
  -- Create initial wallet transaction for starting balance
  INSERT INTO public.wallet_transactions (user_id, type, amount, balance_after, description)
  VALUES (
    NEW.id,
    'deposit',
    10000.00,
    10000.00,
    'Welcome bonus - Demo credits'
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create profile on user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to place a bet
CREATE OR REPLACE FUNCTION public.place_bet(
  p_user_id UUID,
  p_bet_type TEXT,
  p_stake DECIMAL,
  p_selections JSONB
)
RETURNS UUID AS $$
DECLARE
  v_bet_id UUID;
  v_total_odds DECIMAL := 1.0;
  v_potential_return DECIMAL;
  v_current_balance DECIMAL;
  v_selection JSONB;
  v_odds_value DECIMAL;
BEGIN
  -- Check user balance
  SELECT demo_balance INTO v_current_balance
  FROM profiles
  WHERE id = p_user_id;
  
  IF v_current_balance < p_stake THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;
  
  -- Calculate total odds
  FOR v_selection IN SELECT * FROM jsonb_array_elements(p_selections)
  LOOP
    v_odds_value := (v_selection->>'odds_value')::DECIMAL;
    v_total_odds := v_total_odds * v_odds_value;
  END LOOP;
  
  v_potential_return := p_stake * v_total_odds;
  
  -- Create bet
  INSERT INTO bets (user_id, type, stake, total_odds, potential_return, status)
  VALUES (p_user_id, p_bet_type, p_stake, v_total_odds, v_potential_return, 'pending')
  RETURNING id INTO v_bet_id;
  
  -- Create bet selections
  FOR v_selection IN SELECT * FROM jsonb_array_elements(p_selections)
  LOOP
    INSERT INTO bet_selections (
      bet_id,
      event_id,
      market_id,
      odds_id,
      selection,
      odds_value,
      result
    ) VALUES (
      v_bet_id,
      (v_selection->>'event_id')::UUID,
      (v_selection->>'market_id')::UUID,
      (v_selection->>'odds_id')::UUID,
      v_selection->>'selection',
      (v_selection->>'odds_value')::DECIMAL,
      'pending'
    );
  END LOOP;
  
  -- Update user balance
  UPDATE profiles
  SET demo_balance = demo_balance - p_stake,
      updated_at = NOW()
  WHERE id = p_user_id;
  
  -- Create wallet transaction
  INSERT INTO wallet_transactions (user_id, type, amount, balance_after, description, reference_id)
  VALUES (
    p_user_id,
    'bet_placed',
    -p_stake,
    v_current_balance - p_stake,
    'Bet placed - ' || p_bet_type,
    v_bet_id
  );
  
  RETURN v_bet_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to settle a bet
CREATE OR REPLACE FUNCTION public.settle_bet(
  p_bet_id UUID,
  p_result TEXT,
  p_payout DECIMAL DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_user_id UUID;
  v_current_balance DECIMAL;
  v_payout DECIMAL := p_payout;
BEGIN
  SELECT user_id INTO v_user_id
  FROM bets
  WHERE id = p_bet_id;
  
  SELECT demo_balance INTO v_current_balance
  FROM profiles
  WHERE id = v_user_id;
  
  IF p_result = 'won' AND v_payout IS NOT NULL THEN
    -- Update user balance
    UPDATE profiles
    SET demo_balance = demo_balance + v_payout,
        updated_at = NOW()
    WHERE id = v_user_id;
    
    -- Create wallet transaction
    INSERT INTO wallet_transactions (user_id, type, amount, balance_after, description, reference_id)
    VALUES (
      v_user_id,
      'bet_won',
      v_payout,
      v_current_balance + v_payout,
      'Bet won',
      p_bet_id
    );
  ELSIF p_result = 'lost' THEN
    -- No balance change needed (already deducted), just log
    INSERT INTO wallet_transactions (user_id, type, amount, balance_after, description, reference_id)
    VALUES (
      v_user_id,
      'bet_lost',
      0,
      v_current_balance,
      'Bet lost',
      p_bet_id
    );
  END IF;
  
  -- Update bet status
  UPDATE bets
  SET status = p_result,
      payout = v_payout,
      settled_at = NOW()
  WHERE id = p_bet_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to award bonus
CREATE OR REPLACE FUNCTION public.award_bonus(
  p_user_id UUID,
  p_promotion_id UUID,
  p_amount DECIMAL,
  p_wagering_requirement DECIMAL
)
RETURNS UUID AS $$
DECLARE
  v_bonus_id UUID;
  v_current_balance DECIMAL;
BEGIN
  SELECT demo_balance INTO v_current_balance
  FROM profiles
  WHERE id = p_user_id;
  
  -- Create user bonus
  INSERT INTO user_bonuses (user_id, promotion_id, amount, wagering_requirement, expires_at)
  VALUES (
    p_user_id,
    p_promotion_id,
    p_amount,
    p_wagering_requirement,
    NOW() + INTERVAL '30 days'
  )
  RETURNING id INTO v_bonus_id;
  
  -- Update user balance
  UPDATE profiles
  SET demo_balance = demo_balance + p_amount,
      updated_at = NOW()
  WHERE id = p_user_id;
  
  -- Create wallet transaction
  INSERT INTO wallet_transactions (user_id, type, amount, balance_after, description, reference_id)
  VALUES (
    p_user_id,
    'bonus_awarded',
    p_amount,
    v_current_balance + p_amount,
    'Bonus awarded',
    v_bonus_id
  );
  
  RETURN v_bonus_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;