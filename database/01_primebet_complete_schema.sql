-- PrimeBet complete Supabase/PostgreSQL installer
-- Generated: 2026-10-28T19:05:43.512Z
-- Migration count: 54
-- Latest migration: 20261029103000_admin_hierarchy_and_balance_credit
--
-- IMPORTANT: Run this only in a NEW/EMPTY Supabase project from SQL Editor.
-- For an existing database, apply only missing files from supabase/migrations.

SET statement_timeout = 0;
SET lock_timeout = '10s';

BEGIN;

DO $primebet_preflight$
BEGIN
  IF to_regclass('public.bets') IS NOT NULL
     OR to_regclass('public.profiles') IS NOT NULL THEN
    RAISE EXCEPTION 'PrimeBet tables already exist. Use ordered migrations instead of the complete installer.';
  END IF;
END
$primebet_preflight$;

-- ============================================================================
-- BEGIN MIGRATION: 20260914113158_migration_0dccde07.sql
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- User Profiles (extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  username TEXT UNIQUE,
  country TEXT,
  phone TEXT,
  date_of_birth DATE,
  demo_balance DECIMAL(15,2) DEFAULT 10000.00 NOT NULL,
  kyc_status TEXT DEFAULT 'pending' CHECK (kyc_status IN ('pending', 'submitted', 'approved', 'rejected')),
  kyc_verified_at TIMESTAMPTZ,
  referral_code TEXT UNIQUE,
  referred_by UUID REFERENCES profiles(id),
  is_self_excluded BOOLEAN DEFAULT FALSE,
  self_exclusion_until TIMESTAMPTZ,
  is_admin BOOLEAN DEFAULT FALSE,
  admin_role TEXT CHECK (admin_role IN ('super_admin', 'finance', 'kyc', 'support', 'risk_manager', 'sports_trader')),
  two_factor_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wallet Transactions (ledger-based)
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'bet_placed', 'bet_won', 'bet_lost', 'bonus_awarded', 'bonus_wagered', 'referral_bonus', 'adjustment')),
  amount DECIMAL(15,2) NOT NULL,
  balance_after DECIMAL(15,2) NOT NULL,
  description TEXT,
  reference_id UUID,
  status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sports
CREATE TABLE IF NOT EXISTS sports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  icon TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Leagues
CREATE TABLE IF NOT EXISTS leagues (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sport_id UUID NOT NULL REFERENCES sports(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  country TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sport_id, slug)
);

-- Events (matches/games)
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sport_id UUID NOT NULL REFERENCES sports(id) ON DELETE CASCADE,
  league_id UUID REFERENCES leagues(id) ON DELETE SET NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'live', 'finished', 'cancelled', 'postponed')),
  live_score_home INTEGER,
  live_score_away INTEGER,
  live_minute INTEGER,
  venue TEXT,
  is_featured BOOLEAN DEFAULT FALSE,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Markets (bet types for an event)
CREATE TABLE IF NOT EXISTS markets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('match_result', 'over_under', 'handicap', 'both_teams_score', 'correct_score', 'double_chance', 'draw_no_bet', 'first_half', 'total_goals')),
  line DECIMAL(10,2),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'settled')),
  result TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

-- Odds (individual betting options)
CREATE TABLE IF NOT EXISTS odds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  selection TEXT NOT NULL,
  value DECIMAL(10,2) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bets
CREATE TABLE IF NOT EXISTS bets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('single', 'multiple', 'system')),
  stake DECIMAL(15,2) NOT NULL,
  total_odds DECIMAL(10,2) NOT NULL,
  potential_return DECIMAL(15,2) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost', 'void', 'cashout')),
  settled_at TIMESTAMPTZ,
  payout DECIMAL(15,2),
  wallet_transaction_id UUID REFERENCES wallet_transactions(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bet Selections (individual picks in a bet)
CREATE TABLE IF NOT EXISTS bet_selections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bet_id UUID NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id),
  market_id UUID NOT NULL REFERENCES markets(id),
  odds_id UUID NOT NULL REFERENCES odds(id),
  selection TEXT NOT NULL,
  odds_value DECIMAL(10,2) NOT NULL,
  result TEXT CHECK (result IN ('won', 'lost', 'void', 'pending')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Promotions
CREATE TABLE IF NOT EXISTS promotions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('welcome_bonus', 'deposit_bonus', 'free_bet', 'cashback', 'referral')),
  bonus_amount DECIMAL(15,2),
  bonus_percentage DECIMAL(5,2),
  wagering_requirement INTEGER DEFAULT 1,
  min_deposit DECIMAL(15,2),
  max_bonus DECIMAL(15,2),
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  terms_and_conditions TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Bonuses
CREATE TABLE IF NOT EXISTS user_bonuses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  promotion_id UUID REFERENCES promotions(id) ON DELETE SET NULL,
  amount DECIMAL(15,2) NOT NULL,
  wagering_requirement DECIMAL(15,2) NOT NULL,
  wagering_completed DECIMAL(15,2) DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired', 'forfeited')),
  expires_at TIMESTAMPTZ,
  awarded_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- KYC Documents
CREATE TABLE IF NOT EXISTS kyc_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('passport', 'national_id', 'drivers_license', 'proof_of_address', 'selfie')),
  file_url TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Favorites
CREATE TABLE IF NOT EXISTS favorites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, event_id)
);

-- Support Tickets
CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assigned_to UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID NOT NULL REFERENCES profiles(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  changes JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id ON wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created_at ON wallet_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_sport_id ON events(sport_id);
CREATE INDEX IF NOT EXISTS idx_events_start_time ON events(start_time);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_bets_user_id ON bets(user_id);
CREATE INDEX IF NOT EXISTS idx_bets_status ON bets(status);
CREATE INDEX IF NOT EXISTS idx_bet_selections_bet_id ON bet_selections(bet_id);
CREATE INDEX IF NOT EXISTS idx_odds_market_id ON odds(market_id);
CREATE INDEX IF NOT EXISTS idx_markets_event_id ON markets(event_id);

-- END MIGRATION: 20260914113158_migration_0dccde07.sql

-- ============================================================================
-- BEGIN MIGRATION: 20260914113319_migration_63b3aa90.sql
-- ============================================================================

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
    -- Just record the transaction (stake already deducted)
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

-- END MIGRATION: 20260914113319_migration_63b3aa90.sql

-- ============================================================================
-- BEGIN MIGRATION: 20260914131351_migration_48fe83bf.sql
-- ============================================================================

-- Add missing columns to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS demo_balance DECIMAL(15,2) DEFAULT 10000.00;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS admin_role TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kyc_status TEXT DEFAULT 'not_submitted';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referred_by TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS suspension_reason TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS self_exclusion_until TIMESTAMP WITH TIME ZONE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deposit_limit DECIMAL(15,2);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS loss_limit DECIMAL(15,2);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE;

-- Add check constraint for admin_role
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_admin_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_admin_role_check 
  CHECK (admin_role IN ('super_admin', 'finance', 'kyc', 'support', 'risk_manager', 'sports_trader') OR admin_role IS NULL);

-- Add check constraint for kyc_status
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_kyc_status_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_kyc_status_check 
  CHECK (kyc_status IN ('not_submitted', 'pending', 'approved', 'rejected'));

-- Create index on referral_code
CREATE INDEX IF NOT EXISTS idx_profiles_referral_code ON profiles(referral_code);

-- END MIGRATION: 20260914131351_migration_48fe83bf.sql

-- ============================================================================
-- BEGIN MIGRATION: 20260914131416_migration_98ce2655.sql
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sports ENABLE ROW LEVEL SECURITY;
ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE odds ENABLE ROW LEVEL SECURITY;
ALTER TABLE bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE bet_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_bonuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing profile policies to recreate them with admin support
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins can view all profiles" ON profiles FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
);
CREATE POLICY "Admins can update all profiles" ON profiles FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
);

-- Wallet transactions policies
CREATE POLICY "Users can view own transactions" ON wallet_transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "System can insert transactions" ON wallet_transactions FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "Admins can view all transactions" ON wallet_transactions FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
);

-- Sports, leagues, events, markets, odds - public read
CREATE POLICY "Public can view active sports" ON sports FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Public can view active leagues" ON leagues FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Public can view events" ON events FOR SELECT USING (TRUE);
CREATE POLICY "Public can view markets" ON markets FOR SELECT USING (TRUE);
CREATE POLICY "Public can view active odds" ON odds FOR SELECT USING (is_active = TRUE);

-- Admin write policies for sports management
CREATE POLICY "Admins can manage sports" ON sports FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE AND admin_role IN ('super_admin', 'sports_trader'))
);
CREATE POLICY "Admins can manage leagues" ON leagues FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE AND admin_role IN ('super_admin', 'sports_trader'))
);
CREATE POLICY "Admins can manage events" ON events FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE AND admin_role IN ('super_admin', 'sports_trader'))
);
CREATE POLICY "Admins can manage markets" ON markets FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE AND admin_role IN ('super_admin', 'sports_trader'))
);
CREATE POLICY "Admins can manage odds" ON odds FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE AND admin_role IN ('super_admin', 'sports_trader'))
);

-- Bets policies
CREATE POLICY "Users can view own bets" ON bets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own bets" ON bets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all bets" ON bets FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
);
CREATE POLICY "Admins can update bets" ON bets FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
);

-- Bet selections policies
CREATE POLICY "Users can view own bet selections" ON bet_selections FOR SELECT USING (
  EXISTS (SELECT 1 FROM bets WHERE id = bet_selections.bet_id AND user_id = auth.uid())
);
CREATE POLICY "Users can insert bet selections" ON bet_selections FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM bets WHERE id = bet_selections.bet_id AND user_id = auth.uid())
);
CREATE POLICY "Admins can view all bet selections" ON bet_selections FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
);

-- Promotions policies
CREATE POLICY "Public can view active promotions" ON promotions FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Admins can manage promotions" ON promotions FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE AND admin_role IN ('super_admin', 'finance'))
);

-- User bonuses policies
CREATE POLICY "Users can view own bonuses" ON user_bonuses FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "System can insert bonuses" ON user_bonuses FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "Admins can view all bonuses" ON user_bonuses FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
);

-- KYC documents policies
CREATE POLICY "Users can view own kyc docs" ON kyc_documents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can upload kyc docs" ON kyc_documents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can manage kyc docs" ON kyc_documents FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE AND admin_role IN ('super_admin', 'kyc'))
);

-- Favorites policies
CREATE POLICY "Users can manage own favorites" ON favorites FOR ALL USING (auth.uid() = user_id);

-- Support tickets policies
CREATE POLICY "Users can view own tickets" ON support_tickets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create tickets" ON support_tickets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all tickets" ON support_tickets FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
);
CREATE POLICY "Admins can update tickets" ON support_tickets FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE AND admin_role IN ('super_admin', 'support'))
);

-- Audit logs policies
CREATE POLICY "Admins can view audit logs" ON audit_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
);
CREATE POLICY "Admins can insert audit logs" ON audit_logs FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
);

-- END MIGRATION: 20260914131416_migration_98ce2655.sql

-- ============================================================================
-- BEGIN MIGRATION: 20260914131440_migration_13a495c6.sql
-- ============================================================================

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

-- END MIGRATION: 20260914131440_migration_13a495c6.sql

-- ============================================================================
-- BEGIN MIGRATION: 20260915101831_migration_6e40b5dd.sql
-- ============================================================================

-- Create announcements table for global platform announcements
CREATE TABLE IF NOT EXISTS public.announcements (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL CHECK (type IN ('info', 'warning', 'success', 'urgent')),
  priority integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  starts_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone,
  created_by uuid REFERENCES profiles(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create index for active announcements
CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(is_active, starts_at DESC);

-- Enable RLS
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Public can view active announcements"
  ON announcements FOR SELECT
  USING (
    is_active = true 
    AND starts_at <= now() 
    AND (expires_at IS NULL OR expires_at > now())
  );

CREATE POLICY "Admins can manage announcements"
  ON announcements FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
      AND profiles.admin_role IN ('super_admin', 'support')
    )
  );

-- Create user_announcement_dismissals table to track which announcements users have dismissed
CREATE TABLE IF NOT EXISTS public.user_announcement_dismissals (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  dismissed_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id, announcement_id)
);

-- Enable RLS
ALTER TABLE user_announcement_dismissals ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can manage own dismissals"
  ON user_announcement_dismissals FOR ALL
  USING (auth.uid() = user_id);

-- Verify tables created
SELECT 
  schemaname,
  tablename,
  tableowner
FROM pg_tables
WHERE tablename IN ('announcements', 'user_announcement_dismissals');

-- END MIGRATION: 20260915101831_migration_6e40b5dd.sql

-- ============================================================================
-- BEGIN MIGRATION: 20260915102103_migration_0111d0c5.sql
-- ============================================================================

-- Create storage bucket for KYC documents if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('kyc-documents', 'kyc-documents', true)
ON CONFLICT (id) DO NOTHING;

-- Set up storage policies for kyc-documents bucket
DO $$
BEGIN
  -- Allow authenticated users to upload their own KYC documents
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Users can upload own KYC documents'
  ) THEN
    CREATE POLICY "Users can upload own KYC documents"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'kyc-documents' 
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  -- Allow authenticated users to read their own documents
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Users can read own KYC documents'
  ) THEN
    CREATE POLICY "Users can read own KYC documents"
      ON storage.objects FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'kyc-documents' 
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  -- Allow admins to read all KYC documents
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Admins can read all KYC documents'
  ) THEN
    CREATE POLICY "Admins can read all KYC documents"
      ON storage.objects FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'kyc-documents'
        AND EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid()
          AND profiles.admin_role IN ('super_admin', 'kyc')
        )
      );
  END IF;
END $$;

-- Verify bucket created
SELECT id, name, public FROM storage.buckets WHERE id = 'kyc-documents';

-- END MIGRATION: 20260915102103_migration_0111d0c5.sql

-- ============================================================================
-- BEGIN MIGRATION: 20260915103230_migration_1162135d.sql
-- ============================================================================

-- Add policy to allow users to read their own profile if it doesn't exist
DO $$
BEGIN
  -- Drop existing select_own policy if it exists to recreate it properly
  DROP POLICY IF EXISTS "select_own" ON public.profiles;
  
  -- Create policy allowing users to read their own profile
  CREATE POLICY "select_own" ON public.profiles
    FOR SELECT
    USING (auth.uid() = id);
    
  RAISE NOTICE 'RLS policy created: users can read their own profile';
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'Policy already exists';
END $$;

-- Verify the policy was created
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'profiles' AND policyname = 'select_own';

-- END MIGRATION: 20260915103230_migration_1162135d.sql

-- ============================================================================
-- BEGIN MIGRATION: 20260915104000_create_admin_helpers.sql
-- ============================================================================

-- Security helpers used by later RLS policies.
-- This migration intentionally sorts before 20260915104103, where is_admin()
-- is first referenced, so a fresh database can apply the full migration chain.

CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND is_admin = TRUE
      AND admin_role IS NOT NULL
      AND COALESCE(is_suspended, FALSE) = FALSE
  );
$$;

REVOKE ALL ON FUNCTION public.is_service_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

-- END MIGRATION: 20260915104000_create_admin_helpers.sql

-- ============================================================================
-- BEGIN MIGRATION: 20260915104103_migration_e58cf373.sql
-- ============================================================================

-- Step 3: Create new admin policies using the SECURITY DEFINER function
-- These will NOT cause recursion because is_admin() bypasses RLS

CREATE POLICY "admins_select_all_profiles"
ON public.profiles
FOR SELECT
TO public
USING (public.is_admin());

CREATE POLICY "admins_update_all_profiles"
ON public.profiles
FOR UPDATE
TO public
USING (public.is_admin());

-- Verify all current policies on profiles
SELECT 
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'profiles'
ORDER BY cmd, policyname;

-- END MIGRATION: 20260915104103_migration_e58cf373.sql

-- ============================================================================
-- BEGIN MIGRATION: 20260915104407_migration_f80851b3.sql
-- ============================================================================

-- Clean up old recursive policies on profiles table
-- Safe to drop - new non-recursive policies already provide the same access

DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Verify only the new clean policies remain
SELECT 
  policyname,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'profiles'
ORDER BY cmd, policyname;

-- END MIGRATION: 20260915104407_migration_f80851b3.sql

-- ============================================================================
-- BEGIN MIGRATION: 20260915112811_migration_e0bd1405.sql
-- ============================================================================

-- ============================================================================
-- PRIMEBET SPORTSBOOK CONTROL SYSTEM - DATABASE SCHEMA
-- ============================================================================

-- 1. ODDS HISTORY - Track all odds movements for up/down indicators
CREATE TABLE IF NOT EXISTS odds_history (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  odds_id uuid NOT NULL REFERENCES odds(id) ON DELETE CASCADE,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  selection text NOT NULL,
  previous_value numeric(10,2) NOT NULL,
  new_value numeric(10,2) NOT NULL,
  provider_odds numeric(10,2),
  margin_applied numeric(5,2),
  changed_by uuid REFERENCES profiles(id),
  change_type text NOT NULL CHECK (change_type IN ('manual', 'automatic', 'provider_update')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_odds_history_odds_id ON odds_history(odds_id);
CREATE INDEX IF NOT EXISTS idx_odds_history_market_id ON odds_history(market_id);
CREATE INDEX IF NOT EXISTS idx_odds_history_created_at ON odds_history(created_at DESC);

-- 2. SPORT CONFIGURATION - Sport-specific settings
CREATE TABLE IF NOT EXISTS sport_config (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  sport_id uuid NOT NULL UNIQUE REFERENCES sports(id) ON DELETE CASCADE,
  default_margin numeric(5,2) NOT NULL DEFAULT 5.00,
  max_stake numeric(15,2) NOT NULL DEFAULT 10000.00,
  max_payout numeric(15,2) NOT NULL DEFAULT 100000.00,
  live_bet_delay_seconds integer NOT NULL DEFAULT 5,
  auto_suspend_on_goal boolean NOT NULL DEFAULT true,
  auto_suspend_on_red_card boolean NOT NULL DEFAULT true,
  auto_suspend_on_penalty boolean NOT NULL DEFAULT true,
  risk_threshold numeric(15,2) NOT NULL DEFAULT 50000.00,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. MARKET CONFIGURATION - Market-specific limits and margins  
CREATE TABLE IF NOT EXISTS market_config (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  market_id uuid NOT NULL UNIQUE REFERENCES markets(id) ON DELETE CASCADE,
  margin_override numeric(5,2),
  max_stake_override numeric(15,2),
  max_payout_override numeric(15,2),
  risk_factor numeric(3,2) NOT NULL DEFAULT 1.00,
  auto_suspend_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. USER RISK PROFILES - User risk scoring and limits
CREATE TABLE IF NOT EXISTS risk_profiles (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'restricted')),
  risk_score numeric(5,2) NOT NULL DEFAULT 0.00,
  total_bets integer NOT NULL DEFAULT 0,
  total_wagered numeric(15,2) NOT NULL DEFAULT 0.00,
  total_won numeric(15,2) NOT NULL DEFAULT 0.00,
  win_rate numeric(5,2) NOT NULL DEFAULT 0.00,
  avg_stake numeric(15,2) NOT NULL DEFAULT 0.00,
  max_stake numeric(15,2) NOT NULL DEFAULT 10000.00,
  max_payout numeric(15,2) NOT NULL DEFAULT 100000.00,
  unusual_bet_count integer NOT NULL DEFAULT 0,
  last_bet_at timestamptz,
  flagged_at timestamptz,
  flagged_reason text,
  reviewed_by uuid REFERENCES profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5. USER LIMITS - User-specific betting limits
CREATE TABLE IF NOT EXISTS user_limits (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sport_id uuid REFERENCES sports(id) ON DELETE CASCADE,
  limit_type text NOT NULL CHECK (limit_type IN ('stake', 'payout', 'daily_loss', 'weekly_loss')),
  limit_value numeric(15,2) NOT NULL,
  current_usage numeric(15,2) NOT NULL DEFAULT 0.00,
  reset_at timestamptz,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, sport_id, limit_type)
);

-- 6. EVENT EXPOSURE - Track liability per event
CREATE TABLE IF NOT EXISTS event_exposure (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id uuid NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  total_stake numeric(15,2) NOT NULL DEFAULT 0.00,
  total_liability numeric(15,2) NOT NULL DEFAULT 0.00,
  max_potential_payout numeric(15,2) NOT NULL DEFAULT 0.00,
  home_liability numeric(15,2) NOT NULL DEFAULT 0.00,
  draw_liability numeric(15,2) NOT NULL DEFAULT 0.00,
  away_liability numeric(15,2) NOT NULL DEFAULT 0.00,
  bet_count integer NOT NULL DEFAULT 0,
  unique_users integer NOT NULL DEFAULT 0,
  risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  last_bet_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 7. MARKET EXPOSURE - Track liability per market
CREATE TABLE IF NOT EXISTS market_exposure (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  market_id uuid NOT NULL UNIQUE REFERENCES markets(id) ON DELETE CASCADE,
  total_stake numeric(15,2) NOT NULL DEFAULT 0.00,
  total_liability numeric(15,2) NOT NULL DEFAULT 0.00,
  max_potential_payout numeric(15,2) NOT NULL DEFAULT 0.00,
  bet_count integer NOT NULL DEFAULT 0,
  unique_users integer NOT NULL DEFAULT 0,
  selection_exposure jsonb NOT NULL DEFAULT '{}',
  risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  last_bet_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 8. SETTLEMENTS - Settlement history and audit
CREATE TABLE IF NOT EXISTS settlements (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  bet_id uuid NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
  bet_selection_id uuid REFERENCES bet_selections(id) ON DELETE CASCADE,
  settlement_type text NOT NULL CHECK (settlement_type IN ('win', 'loss', 'void', 'refund', 'half_win', 'half_loss')),
  original_stake numeric(15,2) NOT NULL,
  settlement_amount numeric(15,2) NOT NULL,
  settled_by uuid REFERENCES profiles(id),
  settlement_reason text,
  is_manual boolean NOT NULL DEFAULT false,
  wallet_transaction_id uuid REFERENCES wallet_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_settlements_bet_id ON settlements(bet_id);
CREATE INDEX IF NOT EXISTS idx_settlements_created_at ON settlements(created_at DESC);

-- 9. TRADER ACTIONS - Log all admin/trader actions
CREATE TABLE IF NOT EXISTS trader_actions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id uuid NOT NULL REFERENCES profiles(id),
  action_type text NOT NULL CHECK (action_type IN (
    'odds_change', 'market_suspend', 'market_resume', 'event_suspend', 'event_resume',
    'bet_void', 'bet_refund', 'bet_resettle', 'margin_change', 'limit_change',
    'sport_disable', 'league_disable'
  )),
  entity_type text NOT NULL CHECK (entity_type IN ('sport', 'league', 'event', 'market', 'odds', 'bet')),
  entity_id uuid NOT NULL,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trader_actions_admin_id ON trader_actions(admin_id);
CREATE INDEX IF NOT EXISTS idx_trader_actions_entity ON trader_actions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_trader_actions_created_at ON trader_actions(created_at DESC);

-- 10. BET VALIDATIONS - Log pre-acceptance validation checks
CREATE TABLE IF NOT EXISTS bet_validations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  bet_id uuid REFERENCES bets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  validation_result text NOT NULL CHECK (validation_result IN ('accepted', 'rejected', 'requote', 'suspended')),
  rejection_reason text,
  stake_requested numeric(15,2) NOT NULL,
  odds_requested numeric(10,2) NOT NULL,
  odds_at_validation numeric(10,2),
  market_status_at_validation text,
  event_status_at_validation text,
  balance_at_validation numeric(15,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bet_validations_user_id ON bet_validations(user_id);
CREATE INDEX IF NOT EXISTS idx_bet_validations_created_at ON bet_validations(created_at DESC);

-- 11. CASHOUT OFFERS - Track cash-out calculations
CREATE TABLE IF NOT EXISTS cashout_offers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  bet_id uuid NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  offer_type text NOT NULL CHECK (offer_type IN ('full', 'partial')),
  original_stake numeric(15,2) NOT NULL,
  original_odds numeric(10,2) NOT NULL,
  current_odds numeric(10,2) NOT NULL,
  cashout_amount numeric(15,2) NOT NULL,
  cashout_percentage numeric(5,2) NOT NULL,
  is_available boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  wallet_transaction_id uuid REFERENCES wallet_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cashout_offers_bet_id ON cashout_offers(bet_id);
CREATE INDEX IF NOT EXISTS idx_cashout_offers_user_id ON cashout_offers(user_id);

-- Grant permissions to authenticated users and admins
ALTER TABLE odds_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE sport_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_exposure ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_exposure ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE trader_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bet_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashout_offers ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Public read for odds history (for UI indicators)
CREATE POLICY "public_read_odds_history" ON odds_history FOR SELECT TO public USING (true);

-- RLS Policies - Public read for sport/market config
CREATE POLICY "public_read_sport_config" ON sport_config FOR SELECT TO public USING (true);
CREATE POLICY "public_read_market_config" ON market_config FOR SELECT TO public USING (true);

-- RLS Policies - Admins can manage all config
CREATE POLICY "admins_manage_sport_config" ON sport_config FOR ALL TO public
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "admins_manage_market_config" ON market_config FOR ALL TO public
  USING (is_admin()) WITH CHECK (is_admin());

-- RLS Policies - Users can view own risk profile
CREATE POLICY "users_read_own_risk_profile" ON risk_profiles FOR SELECT TO public
  USING (auth.uid() = user_id);
CREATE POLICY "admins_manage_risk_profiles" ON risk_profiles FOR ALL TO public
  USING (is_admin()) WITH CHECK (is_admin());

-- RLS Policies - Users can view own limits
CREATE POLICY "users_read_own_limits" ON user_limits FOR SELECT TO public
  USING (auth.uid() = user_id);
CREATE POLICY "admins_manage_user_limits" ON user_limits FOR ALL TO public
  USING (is_admin()) WITH CHECK (is_admin());

-- RLS Policies - Admins only for exposure tracking
CREATE POLICY "admins_read_event_exposure" ON event_exposure FOR SELECT TO public
  USING (is_admin());
CREATE POLICY "admins_read_market_exposure" ON market_exposure FOR SELECT TO public
  USING (is_admin());

-- RLS Policies - Users can view own settlements
CREATE POLICY "users_read_own_settlements" ON settlements FOR SELECT TO public
  USING (EXISTS (
    SELECT 1 FROM bets WHERE bets.id = settlements.bet_id AND bets.user_id = auth.uid()
  ));
CREATE POLICY "admins_manage_settlements" ON settlements FOR ALL TO public
  USING (is_admin()) WITH CHECK (is_admin());

-- RLS Policies - Admins only for trader actions
CREATE POLICY "admins_view_trader_actions" ON trader_actions FOR SELECT TO public
  USING (is_admin());
CREATE POLICY "admins_insert_trader_actions" ON trader_actions FOR INSERT TO public
  WITH CHECK (is_admin());

-- RLS Policies - Users can view own bet validations
CREATE POLICY "users_read_own_validations" ON bet_validations FOR SELECT TO public
  USING (auth.uid() = user_id);
CREATE POLICY "system_insert_validations" ON bet_validations FOR INSERT TO public
  WITH CHECK (true);

-- RLS Policies - Users can view own cashout offers
CREATE POLICY "users_manage_own_cashout" ON cashout_offers FOR ALL TO public
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

SELECT 'Sportsbook control system database schema created successfully' AS status;

-- END MIGRATION: 20260915112811_migration_e0bd1405.sql

-- ============================================================================
-- BEGIN MIGRATION: 20260915113252_migration_3a29fd45.sql
-- ============================================================================

-- Add missing columns for sportsbook control system

-- 1. Add is_suspended to events table (for admin to suspend events)
ALTER TABLE events 
ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false;

-- 2. Add is_locked to odds table (for admin to lock individual odds)
ALTER TABLE odds
ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_events_is_suspended ON events(is_suspended);
CREATE INDEX IF NOT EXISTS idx_odds_is_locked ON odds(is_locked);

SELECT 'Added is_suspended to events and is_locked to odds' AS status;

-- END MIGRATION: 20260915113252_migration_3a29fd45.sql

-- ============================================================================
-- BEGIN MIGRATION: 20260915115902_migration_2d89190e.sql
-- ============================================================================

-- ============================================================================
-- ADVANCED SPORTSBOOK ENGINE V2 - DATABASE SCHEMA
-- ============================================================================

-- 1. SPORTS FEED PROVIDER HEALTH MONITORING
CREATE TABLE IF NOT EXISTS provider_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name TEXT NOT NULL,
  provider_type TEXT NOT NULL, -- 'odds', 'scores', 'results'
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'degraded', 'down'
  last_successful_fetch TIMESTAMPTZ,
  last_failed_fetch TIMESTAMPTZ,
  success_rate DECIMAL DEFAULT 100,
  avg_latency_ms INTEGER DEFAULT 0,
  total_requests INTEGER DEFAULT 0,
  failed_requests INTEGER DEFAULT 0,
  consecutive_failures INTEGER DEFAULT 0,
  is_primary BOOLEAN DEFAULT false,
  error_message TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_health_status ON provider_health(status);
CREATE INDEX IF NOT EXISTS idx_provider_health_type ON provider_health(provider_type);

-- 2. BET IDEMPOTENCY (prevent duplicates)
CREATE TABLE IF NOT EXISTS bet_idempotency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  idempotency_key TEXT NOT NULL,
  bet_id UUID REFERENCES bets(id),
  request_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_bet_idempotency_user ON bet_idempotency(user_id);
CREATE INDEX IF NOT EXISTS idx_bet_idempotency_key ON bet_idempotency(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_bet_idempotency_expires ON bet_idempotency(expires_at);

-- 3. RESPONSIBLE GAMING LIMITS
CREATE TABLE IF NOT EXISTS responsible_gaming_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  limit_type TEXT NOT NULL, -- 'daily_stake', 'weekly_stake', 'monthly_stake', 'daily_loss', 'weekly_loss', 'monthly_loss', 'session_time'
  limit_value DECIMAL NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  current_usage DECIMAL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rg_limits_user ON responsible_gaming_limits(user_id);
CREATE INDEX IF NOT EXISTS idx_rg_limits_type ON responsible_gaming_limits(limit_type);
CREATE INDEX IF NOT EXISTS idx_rg_limits_active ON responsible_gaming_limits(is_active);

-- 4. SELF-EXCLUSION
CREATE TABLE IF NOT EXISTS self_exclusions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) UNIQUE,
  exclusion_type TEXT NOT NULL, -- 'timeout', 'self_exclusion', 'permanent'
  start_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_date TIMESTAMPTZ,
  reason TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_self_exclusions_user ON self_exclusions(user_id);
CREATE INDEX IF NOT EXISTS idx_self_exclusions_active ON self_exclusions(is_active);

-- 5. FRAUD FLAGS
CREATE TABLE IF NOT EXISTS fraud_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  flag_type TEXT NOT NULL, -- 'duplicate_bet', 'high_velocity', 'unusual_pattern', 'multi_account', 'bonus_abuse', 'suspicious_wallet'
  severity TEXT NOT NULL, -- 'low', 'medium', 'high', 'critical'
  description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  is_reviewed BOOLEAN DEFAULT false,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  resolution TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fraud_flags_user ON fraud_flags(user_id);
CREATE INDEX IF NOT EXISTS idx_fraud_flags_type ON fraud_flags(flag_type);
CREATE INDEX IF NOT EXISTS idx_fraud_flags_reviewed ON fraud_flags(is_reviewed);

-- 6. BACKGROUND JOBS
CREATE TABLE IF NOT EXISTS background_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL, -- 'settlement', 'odds_update', 'exposure_calc', 'risk_score', 'provider_health'
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed', 'retry'
  priority INTEGER DEFAULT 5,
  payload JSONB NOT NULL,
  result JSONB,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  scheduled_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bg_jobs_status ON background_jobs(status);
CREATE INDEX IF NOT EXISTS idx_bg_jobs_type ON background_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_bg_jobs_scheduled ON background_jobs(scheduled_at);

-- 7. SETTLEMENT VERSIONS (for resettlement tracking)
CREATE TABLE IF NOT EXISTS settlement_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id UUID NOT NULL REFERENCES bets(id),
  version INTEGER NOT NULL DEFAULT 1,
  settlement_type TEXT NOT NULL,
  settlement_amount DECIMAL NOT NULL,
  settled_by UUID NOT NULL REFERENCES auth.users(id),
  reason TEXT,
  previous_settlement_id UUID REFERENCES settlements(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_settlement_versions_bet ON settlement_versions(bet_id);
CREATE INDEX IF NOT EXISTS idx_settlement_versions_version ON settlement_versions(bet_id, version);

-- 8. LIVE BET DELAYS (configurable per sport)
CREATE TABLE IF NOT EXISTS live_bet_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport TEXT NOT NULL UNIQUE,
  acceptance_delay_seconds INTEGER NOT NULL DEFAULT 5,
  auto_suspend_events TEXT[] DEFAULT ARRAY['goal', 'penalty', 'red_card', 'var', 'wicket', 'match_point'],
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insert default live bet configs
INSERT INTO live_bet_config (sport, acceptance_delay_seconds, auto_suspend_events) VALUES
  ('football', 5, ARRAY['goal', 'penalty', 'red_card', 'var']),
  ('cricket', 3, ARRAY['wicket', 'boundary']),
  ('tennis', 3, ARRAY['match_point', 'set_point']),
  ('basketball', 3, ARRAY['timeout', 'foul'])
ON CONFLICT (sport) DO NOTHING;

-- 9. MARKET CORRELATION RULES (for bet builder)
CREATE TABLE IF NOT EXISTS market_correlations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_type_1 TEXT NOT NULL,
  market_type_2 TEXT NOT NULL,
  correlation_type TEXT NOT NULL, -- 'incompatible', 'dependent', 'independent'
  rule_description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Insert common correlation rules
INSERT INTO market_correlations (market_type_1, market_type_2, correlation_type, rule_description) VALUES
  ('match_result', 'match_result', 'incompatible', 'Cannot select multiple match results'),
  ('over_under', 'over_under', 'incompatible', 'Cannot select both over and under'),
  ('both_teams_score', 'match_result', 'dependent', 'BTTS correlates with match result')
ON CONFLICT DO NOTHING;

-- 10. Add missing columns to existing tables
ALTER TABLE odds ADD COLUMN IF NOT EXISTS provider_id TEXT;
ALTER TABLE odds ADD COLUMN IF NOT EXISTS provider_odds DECIMAL;
ALTER TABLE odds ADD COLUMN IF NOT EXISTS last_provider_update TIMESTAMPTZ;

ALTER TABLE events ADD COLUMN IF NOT EXISTS provider_id TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS provider_event_id TEXT;

-- RLS POLICIES

-- provider_health - admin only
ALTER TABLE provider_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access to provider_health" ON provider_health
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.admin_role IS NOT NULL
    )
  );

-- bet_idempotency - users can only see their own
ALTER TABLE bet_idempotency ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own idempotency" ON bet_idempotency
  FOR SELECT USING (auth.uid() = user_id);

-- responsible_gaming_limits - users can only see/update their own
ALTER TABLE responsible_gaming_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own RG limits" ON responsible_gaming_limits
  FOR ALL USING (auth.uid() = user_id);

-- self_exclusions - users can only see their own
ALTER TABLE self_exclusions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own exclusions" ON self_exclusions
  FOR SELECT USING (auth.uid() = user_id);

-- fraud_flags - admin only
ALTER TABLE fraud_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access to fraud_flags" ON fraud_flags
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.admin_role IS NOT NULL
    )
  );

-- background_jobs - admin only
ALTER TABLE background_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access to background_jobs" ON background_jobs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.admin_role IS NOT NULL
    )
  );

-- settlement_versions - admin only
ALTER TABLE settlement_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access to settlement_versions" ON settlement_versions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.admin_role IS NOT NULL
    )
  );

-- live_bet_config - admin only
ALTER TABLE live_bet_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access to live_bet_config" ON live_bet_config
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.admin_role IS NOT NULL
    )
  );

-- market_correlations - read only for all, admin write
ALTER TABLE market_correlations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read market_correlations" ON market_correlations
  FOR SELECT USING (true);
CREATE POLICY "Admin write market_correlations" ON market_correlations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.admin_role IS NOT NULL
    )
  );

SELECT 'Advanced Sportsbook Engine V2 database schema created successfully' AS status;

-- END MIGRATION: 20260915115902_migration_2d89190e.sql

-- ============================================================================
-- BEGIN MIGRATION: 20260915121146_migration_404169cf.sql
-- ============================================================================

-- Create market_correlation_rules table for bet builder
CREATE TABLE IF NOT EXISTS market_correlation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  market_id_1 UUID NOT NULL,
  market_id_2 UUID NOT NULL,
  correlation_type TEXT NOT NULL CHECK (correlation_type IN ('independent', 'dependent', 'mutually_exclusive')),
  is_allowed BOOLEAN NOT NULL DEFAULT true,
  adjustment_factor NUMERIC(5, 2) DEFAULT 1.00,
  rule_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_correlation_rules_event_id ON market_correlation_rules(event_id);
CREATE INDEX IF NOT EXISTS idx_market_correlation_rules_markets ON market_correlation_rules(market_id_1, market_id_2);

-- Enable RLS
ALTER TABLE market_correlation_rules ENABLE ROW LEVEL SECURITY;

-- Public read access for checking correlations
CREATE POLICY "Public can view correlation rules"
  ON market_correlation_rules FOR SELECT
  TO authenticated
  USING (true);

-- Admins can manage
CREATE POLICY "Admins can manage correlation rules"
  ON market_correlation_rules FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.admin_role IN ('super_admin', 'sports_trader')
    )
  );

SELECT 'Market correlation rules table created successfully' AS status;

-- END MIGRATION: 20260915121146_migration_404169cf.sql

-- ============================================================================
-- BEGIN MIGRATION: 20260915122837_migration_b4b55535.sql
-- ============================================================================

-- Create idempotency_keys table for duplicate bet prevention
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key TEXT NOT NULL UNIQUE,
  request_data JSONB NOT NULL,
  response_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Add index for fast key lookups
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_key ON idempotency_keys(key);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_user_id ON idempotency_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at ON idempotency_keys(expires_at);

-- Enable RLS
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only see their own idempotency keys
CREATE POLICY "users_select_own_idempotency_keys" ON idempotency_keys
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "users_insert_own_idempotency_keys" ON idempotency_keys
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_delete_own_idempotency_keys" ON idempotency_keys
  FOR DELETE USING (auth.uid() = user_id);

-- Admin full access
CREATE POLICY "admins_all_idempotency_keys" ON idempotency_keys
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND admin_role IN ('super_admin', 'support')
    )
  );

SELECT 'Idempotency keys table created successfully' AS status;

-- END MIGRATION: 20260915122837_migration_b4b55535.sql

-- ============================================================================
-- BEGIN MIGRATION: 20260915123230_migration_f66b5735.sql
-- ============================================================================

-- Add missing columns to wallet_transactions table
ALTER TABLE wallet_transactions
ADD COLUMN IF NOT EXISTS balance_before NUMERIC(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS balance_after NUMERIC(12,2) DEFAULT 0;

SELECT 'Added balance_before and balance_after columns to wallet_transactions' AS status;

-- END MIGRATION: 20260915123230_migration_f66b5735.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261018010000_secure_betting_core.sql
-- ============================================================================

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

-- END MIGRATION: 20261018010000_secure_betting_core.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261018011000_harden_rls_policies.sql
-- ============================================================================

-- Central, non-recursive role checks for RLS policies. Generic `admin` is a
-- full-access compatibility role; production accounts should use the narrower
-- finance, kyc, support, risk_manager and sports_trader roles where possible.
CREATE OR REPLACE FUNCTION public.has_admin_role(p_allowed_roles TEXT[] DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND is_admin = TRUE
      AND COALESCE(is_suspended, FALSE) = FALSE
      AND admin_role IS NOT NULL
      AND (
        admin_role IN ('super_admin', 'admin')
        OR p_allowed_roles IS NULL
        OR admin_role = ANY(p_allowed_roles)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.has_admin_role(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_admin_role(TEXT[]) TO anon, authenticated;

-- Profiles: remove recursive policies from the initial schema.
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "admins_select_all_profiles" ON public.profiles;
DROP POLICY IF EXISTS "admins_update_all_profiles" ON public.profiles;
CREATE POLICY "admins_select_all_profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.has_admin_role(NULL));
CREATE POLICY "admins_update_all_profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_admin_role(NULL))
  WITH CHECK (public.has_admin_role(NULL));

-- Ledger rows are append-only through trusted atomic functions. Finance can
-- read them, but no browser role can manufacture a transaction.
DROP POLICY IF EXISTS "System can insert transactions" ON public.wallet_transactions;
DROP POLICY IF EXISTS "Admins can view all transactions" ON public.wallet_transactions;
CREATE POLICY "finance_read_all_transactions" ON public.wallet_transactions
  FOR SELECT TO authenticated
  USING (public.has_admin_role(ARRAY['finance']));

-- Sports catalogue writes are restricted to trading roles.
DROP POLICY IF EXISTS "Admins can manage sports" ON public.sports;
DROP POLICY IF EXISTS "Admins can manage leagues" ON public.leagues;
DROP POLICY IF EXISTS "Admins can manage events" ON public.events;
DROP POLICY IF EXISTS "Admins can manage markets" ON public.markets;
DROP POLICY IF EXISTS "Admins can manage odds" ON public.odds;
CREATE POLICY "traders_manage_sports" ON public.sports FOR ALL TO authenticated
  USING (public.has_admin_role(ARRAY['sports_trader']))
  WITH CHECK (public.has_admin_role(ARRAY['sports_trader']));
CREATE POLICY "traders_manage_leagues" ON public.leagues FOR ALL TO authenticated
  USING (public.has_admin_role(ARRAY['sports_trader']))
  WITH CHECK (public.has_admin_role(ARRAY['sports_trader']));
CREATE POLICY "traders_manage_events" ON public.events FOR ALL TO authenticated
  USING (public.has_admin_role(ARRAY['sports_trader']))
  WITH CHECK (public.has_admin_role(ARRAY['sports_trader']));
CREATE POLICY "traders_manage_markets" ON public.markets FOR ALL TO authenticated
  USING (public.has_admin_role(ARRAY['sports_trader']))
  WITH CHECK (public.has_admin_role(ARRAY['sports_trader']));
CREATE POLICY "traders_manage_odds" ON public.odds FOR ALL TO authenticated
  USING (public.has_admin_role(ARRAY['sports_trader']))
  WITH CHECK (public.has_admin_role(ARRAY['sports_trader']));

-- Bet writes are only performed by security-definer transaction functions.
DROP POLICY IF EXISTS "Users can insert own bets" ON public.bets;
DROP POLICY IF EXISTS "Admins can view all bets" ON public.bets;
DROP POLICY IF EXISTS "Admins can update bets" ON public.bets;
CREATE POLICY "risk_and_traders_read_all_bets" ON public.bets
  FOR SELECT TO authenticated
  USING (public.has_admin_role(ARRAY['risk_manager', 'sports_trader']));

DROP POLICY IF EXISTS "Users can insert bet selections" ON public.bet_selections;
DROP POLICY IF EXISTS "Admins can view all bet selections" ON public.bet_selections;
CREATE POLICY "risk_and_traders_read_all_bet_selections" ON public.bet_selections
  FOR SELECT TO authenticated
  USING (public.has_admin_role(ARRAY['risk_manager', 'sports_trader']));

DROP POLICY IF EXISTS "Admins can manage promotions" ON public.promotions;
CREATE POLICY "finance_manage_promotions" ON public.promotions FOR ALL TO authenticated
  USING (public.has_admin_role(ARRAY['finance']))
  WITH CHECK (public.has_admin_role(ARRAY['finance']));

DROP POLICY IF EXISTS "System can insert bonuses" ON public.user_bonuses;
DROP POLICY IF EXISTS "Admins can view all bonuses" ON public.user_bonuses;
CREATE POLICY "finance_read_all_bonuses" ON public.user_bonuses
  FOR SELECT TO authenticated
  USING (public.has_admin_role(ARRAY['finance']));

DROP POLICY IF EXISTS "Admins can manage kyc docs" ON public.kyc_documents;
CREATE POLICY "kyc_admins_manage_documents" ON public.kyc_documents FOR ALL TO authenticated
  USING (public.has_admin_role(ARRAY['kyc']))
  WITH CHECK (public.has_admin_role(ARRAY['kyc']));

DROP POLICY IF EXISTS "Admins can view all tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Admins can update tickets" ON public.support_tickets;
CREATE POLICY "support_read_all_tickets" ON public.support_tickets
  FOR SELECT TO authenticated
  USING (public.has_admin_role(ARRAY['support']));
CREATE POLICY "support_update_all_tickets" ON public.support_tickets
  FOR UPDATE TO authenticated
  USING (public.has_admin_role(ARRAY['support']))
  WITH CHECK (public.has_admin_role(ARRAY['support']));

DROP POLICY IF EXISTS "Admins can view audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Admins can insert audit logs" ON public.audit_logs;
CREATE POLICY "super_admins_read_audit_logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.has_admin_role(ARRAY[]::TEXT[]));
CREATE POLICY "admins_insert_audit_logs" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.has_admin_role(NULL) AND admin_id = auth.uid());

-- These tables influence settlement or fraud controls and must not accept
-- arbitrary client-authored records.
DROP POLICY IF EXISTS "system_insert_validations" ON public.bet_validations;
DROP POLICY IF EXISTS "users_manage_own_cashout" ON public.cashout_offers;
CREATE POLICY "users_read_own_cashout_offers" ON public.cashout_offers
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_insert_own_idempotency_keys" ON public.idempotency_keys;
DROP POLICY IF EXISTS "users_delete_own_idempotency_keys" ON public.idempotency_keys;
DROP POLICY IF EXISTS "admins_all_idempotency_keys" ON public.idempotency_keys;
CREATE POLICY "support_read_idempotency_keys" ON public.idempotency_keys
  FOR SELECT TO authenticated
  USING (public.has_admin_role(ARRAY['support']));

DROP POLICY IF EXISTS "Admins can manage announcements" ON public.announcements;
CREATE POLICY "support_manage_announcements" ON public.announcements FOR ALL TO authenticated
  USING (public.has_admin_role(ARRAY['support']))
  WITH CHECK (public.has_admin_role(ARRAY['support']));

-- Repair older policies that queried profiles directly and could recurse.
DROP POLICY IF EXISTS "Admin full access to provider_health" ON public.provider_health;
CREATE POLICY "admins_manage_provider_health" ON public.provider_health FOR ALL TO authenticated
  USING (public.has_admin_role(ARRAY['sports_trader']))
  WITH CHECK (public.has_admin_role(ARRAY['sports_trader']));

DROP POLICY IF EXISTS "Admin full access to fraud_flags" ON public.fraud_flags;
CREATE POLICY "risk_manage_fraud_flags" ON public.fraud_flags FOR ALL TO authenticated
  USING (public.has_admin_role(ARRAY['risk_manager']))
  WITH CHECK (public.has_admin_role(ARRAY['risk_manager']));

DROP POLICY IF EXISTS "Admin full access to background_jobs" ON public.background_jobs;
CREATE POLICY "super_admins_manage_background_jobs" ON public.background_jobs FOR ALL TO authenticated
  USING (public.has_admin_role(ARRAY[]::TEXT[]))
  WITH CHECK (public.has_admin_role(ARRAY[]::TEXT[]));

DROP POLICY IF EXISTS "Admin full access to settlement_versions" ON public.settlement_versions;
CREATE POLICY "risk_manage_settlement_versions" ON public.settlement_versions FOR ALL TO authenticated
  USING (public.has_admin_role(ARRAY['risk_manager']))
  WITH CHECK (public.has_admin_role(ARRAY['risk_manager']));

DROP POLICY IF EXISTS "Admin full access to live_bet_config" ON public.live_bet_config;
CREATE POLICY "traders_manage_live_bet_config" ON public.live_bet_config FOR ALL TO authenticated
  USING (public.has_admin_role(ARRAY['sports_trader']))
  WITH CHECK (public.has_admin_role(ARRAY['sports_trader']));

DROP POLICY IF EXISTS "Admin write market_correlations" ON public.market_correlations;
CREATE POLICY "traders_manage_market_correlations" ON public.market_correlations FOR ALL TO authenticated
  USING (public.has_admin_role(ARRAY['sports_trader']))
  WITH CHECK (public.has_admin_role(ARRAY['sports_trader']));

DROP POLICY IF EXISTS "Admins can manage correlation rules" ON public.market_correlation_rules;
CREATE POLICY "traders_manage_correlation_rules" ON public.market_correlation_rules FOR ALL TO authenticated
  USING (public.has_admin_role(ARRAY['sports_trader']))
  WITH CHECK (public.has_admin_role(ARRAY['sports_trader']));

-- END MIGRATION: 20261018011000_harden_rls_policies.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261019090000_enforce_responsible_gaming.sql
-- ============================================================================

-- Responsible-play controls must be enforced by the database, not only by UI checks.

CREATE OR REPLACE FUNCTION public.set_my_responsible_limit(
  p_limit_type TEXT,
  p_limit_value NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_existing public.responsible_gaming_limits%ROWTYPE;
  v_id UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_limit_type NOT IN ('daily_stake', 'weekly_stake', 'monthly_stake') THEN
    RAISE EXCEPTION 'Unsupported limit type';
  END IF;
  IF p_limit_value IS NULL OR p_limit_value <= 0 OR p_limit_value > 1000000 THEN
    RAISE EXCEPTION 'Invalid limit value';
  END IF;

  v_start := CASE p_limit_type
    WHEN 'daily_stake' THEN date_trunc('day', NOW())
    WHEN 'weekly_stake' THEN date_trunc('week', NOW())
    ELSE date_trunc('month', NOW())
  END;
  v_end := CASE p_limit_type
    WHEN 'daily_stake' THEN v_start + INTERVAL '1 day'
    WHEN 'weekly_stake' THEN v_start + INTERVAL '1 week'
    ELSE v_start + INTERVAL '1 month'
  END;

  SELECT * INTO v_existing
  FROM public.responsible_gaming_limits
  WHERE user_id = v_user_id AND limit_type = p_limit_type AND is_active = TRUE
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND AND p_limit_value > v_existing.limit_value AND v_existing.period_end > NOW() THEN
    RAISE EXCEPTION 'An active limit can only be reduced until its period ends';
  END IF;

  UPDATE public.responsible_gaming_limits
  SET is_active = FALSE, updated_at = NOW()
  WHERE user_id = v_user_id AND limit_type = p_limit_type AND is_active = TRUE;

  INSERT INTO public.responsible_gaming_limits (
    user_id, limit_type, limit_value, period_start, period_end,
    current_usage, is_active
  ) VALUES (
    v_user_id, p_limit_type, p_limit_value, v_start, v_end,
    COALESCE(v_existing.current_usage, 0), TRUE
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_responsible_limit(TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_responsible_limit(TEXT, NUMERIC) TO authenticated;

CREATE OR REPLACE FUNCTION public.start_my_self_exclusion(
  p_exclusion_type TEXT,
  p_duration_days INTEGER DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_end TIMESTAMPTZ;
  v_id UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_exclusion_type NOT IN ('timeout', 'self_exclusion', 'permanent') THEN
    RAISE EXCEPTION 'Invalid exclusion type';
  END IF;
  IF p_exclusion_type = 'timeout' AND (p_duration_days IS NULL OR p_duration_days < 1 OR p_duration_days > 30) THEN
    RAISE EXCEPTION 'Timeout must be between 1 and 30 days';
  END IF;
  IF p_exclusion_type = 'self_exclusion' AND (p_duration_days IS NULL OR p_duration_days < 180) THEN
    RAISE EXCEPTION 'Self-exclusion must be at least 180 days';
  END IF;

  v_end := CASE
    WHEN p_exclusion_type = 'permanent' THEN NULL
    ELSE NOW() + make_interval(days => p_duration_days)
  END;

  INSERT INTO public.self_exclusions (
    user_id, exclusion_type, start_date, end_date, reason, is_active
  ) VALUES (
    v_user_id, p_exclusion_type, NOW(), v_end, NULLIF(trim(p_reason), ''), TRUE
  )
  ON CONFLICT (user_id) DO UPDATE SET
    exclusion_type = CASE
      WHEN self_exclusions.is_active AND self_exclusions.end_date IS NULL THEN self_exclusions.exclusion_type
      ELSE EXCLUDED.exclusion_type
    END,
    start_date = CASE
      WHEN self_exclusions.is_active AND self_exclusions.end_date IS NULL THEN self_exclusions.start_date
      ELSE NOW()
    END,
    end_date = CASE
      WHEN self_exclusions.is_active AND self_exclusions.end_date IS NULL THEN NULL
      WHEN EXCLUDED.end_date IS NULL THEN NULL
      ELSE GREATEST(COALESCE(self_exclusions.end_date, EXCLUDED.end_date), EXCLUDED.end_date)
    END,
    reason = COALESCE(EXCLUDED.reason, self_exclusions.reason),
    is_active = TRUE
  RETURNING id INTO v_id;

  UPDATE public.profiles
  SET self_exclusion_until = COALESCE(v_end, TIMESTAMPTZ '9999-12-31 23:59:59+00'),
      updated_at = NOW()
  WHERE id = v_user_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.start_my_self_exclusion(TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_my_self_exclusion(TEXT, INTEGER, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_responsible_gaming_before_bet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit public.responsible_gaming_limits%ROWTYPE;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.self_exclusions
    WHERE user_id = NEW.user_id AND is_active = TRUE
      AND (end_date IS NULL OR end_date > NOW())
  ) THEN
    RAISE EXCEPTION 'Account is self-excluded';
  END IF;

  FOR v_limit IN
    SELECT * FROM public.responsible_gaming_limits
    WHERE user_id = NEW.user_id
      AND limit_type IN ('daily_stake', 'weekly_stake', 'monthly_stake')
      AND is_active = TRUE
      AND period_start <= NOW() AND period_end > NOW()
    FOR UPDATE
  LOOP
    IF COALESCE(v_limit.current_usage, 0) + NEW.stake > v_limit.limit_value THEN
      RAISE EXCEPTION '% limit exceeded', replace(v_limit.limit_type, '_', ' ');
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_responsible_gaming_usage_after_bet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.responsible_gaming_limits
  SET current_usage = COALESCE(current_usage, 0) + NEW.stake,
      updated_at = NOW()
  WHERE user_id = NEW.user_id
    AND limit_type IN ('daily_stake', 'weekly_stake', 'monthly_stake')
    AND is_active = TRUE
    AND period_start <= NOW() AND period_end > NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_responsible_gaming_before_bet ON public.bets;
CREATE TRIGGER enforce_responsible_gaming_before_bet
BEFORE INSERT ON public.bets
FOR EACH ROW EXECUTE FUNCTION public.enforce_responsible_gaming_before_bet();

DROP TRIGGER IF EXISTS record_responsible_gaming_usage_after_bet ON public.bets;
CREATE TRIGGER record_responsible_gaming_usage_after_bet
AFTER INSERT ON public.bets
FOR EACH ROW EXECUTE FUNCTION public.record_responsible_gaming_usage_after_bet();

DROP POLICY IF EXISTS "Users manage own RG limits" ON public.responsible_gaming_limits;
CREATE POLICY "users_read_own_rg_limits" ON public.responsible_gaming_limits
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users see own exclusions" ON public.self_exclusions;
CREATE POLICY "users_read_own_exclusions" ON public.self_exclusions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- END MIGRATION: 20261019090000_enforce_responsible_gaming.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261019091000_notifications.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  bet_results BOOLEAN NOT NULL DEFAULT TRUE,
  promotions BOOLEAN NOT NULL DEFAULT TRUE,
  account_updates BOOLEAN NOT NULL DEFAULT TRUE,
  live_events BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, is_read) WHERE is_read = FALSE;

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_notification_preferences"
  ON public.notification_preferences FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_read_own_notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "users_mark_own_notifications_read"
  ON public.notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.notify_bet_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('won', 'lost', 'void', 'cancelled')
     AND COALESCE((SELECT bet_results FROM public.notification_preferences WHERE user_id = NEW.user_id), TRUE)
  THEN
    INSERT INTO public.notifications (user_id, type, title, message, metadata)
    VALUES (
      NEW.user_id,
      'bet_' || NEW.status,
      CASE NEW.status WHEN 'won' THEN 'Bet won' WHEN 'lost' THEN 'Bet settled' WHEN 'void' THEN 'Bet voided' ELSE 'Bet cancelled' END,
      CASE NEW.status
        WHEN 'won' THEN 'Your bet was settled as won. Payout: ' || COALESCE(NEW.payout, 0)::TEXT
        WHEN 'lost' THEN 'Your bet was settled as lost.'
        WHEN 'void' THEN 'Your bet was voided and handled according to the settlement rules.'
        ELSE 'Your pending bet was cancelled.'
      END,
      jsonb_build_object('bet_id', NEW.id, 'status', NEW.status, 'payout', NEW.payout)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_bet_status_change ON public.bets;
CREATE TRIGGER notify_bet_status_change
AFTER UPDATE OF status ON public.bets
FOR EACH ROW EXECUTE FUNCTION public.notify_bet_status_change();

CREATE OR REPLACE FUNCTION public.notify_kyc_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('approved', 'rejected')
     AND COALESCE((SELECT account_updates FROM public.notification_preferences WHERE user_id = NEW.user_id), TRUE)
  THEN
    INSERT INTO public.notifications (user_id, type, title, message, metadata)
    VALUES (
      NEW.user_id,
      'kyc_' || NEW.status,
      CASE NEW.status WHEN 'approved' THEN 'Verification approved' ELSE 'Verification needs attention' END,
      CASE NEW.status WHEN 'approved' THEN 'Your identity document was approved.' ELSE 'A verification document was rejected. Review your account verification page.' END,
      jsonb_build_object('document_id', NEW.id, 'status', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_kyc_status_change ON public.kyc_documents;
CREATE TRIGGER notify_kyc_status_change
AFTER UPDATE OF status ON public.kyc_documents
FOR EACH ROW EXECUTE FUNCTION public.notify_kyc_status_change();

-- END MIGRATION: 20261019091000_notifications.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261019092000_secure_kyc_storage.sql
-- ============================================================================

UPDATE storage.buckets
SET public = FALSE,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
WHERE id = 'kyc-documents';

DROP POLICY IF EXISTS "Admins can read all KYC documents" ON storage.objects;
CREATE POLICY "kyc_reviewers_read_all_documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'kyc-documents'
    AND public.has_admin_role(ARRAY['kyc'])
  );

-- END MIGRATION: 20261019092000_secure_kyc_storage.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261019100000_automated_settlement_pipeline.sql
-- ============================================================================

-- Server-controlled, idempotent event settlement queue.
-- Provider callbacks enqueue a result once; a service-role worker processes it
-- with wallet credits and bet state changes in the same database transaction.

ALTER TABLE public.background_jobs
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS background_jobs_dedupe_key_unique
  ON public.background_jobs (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS background_jobs_claimable_idx
  ON public.background_jobs (priority, scheduled_at, created_at)
  WHERE status IN ('pending', 'retry');

ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view background jobs" ON public.background_jobs;
CREATE POLICY "Admins can view background jobs"
  ON public.background_jobs FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.record_event_result_and_queue(
  p_event_id UUID,
  p_status TEXT,
  p_home_score INTEGER,
  p_away_score INTEGER,
  p_market_results JSONB,
  p_provider_reference TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id UUID;
  v_result JSONB;
  v_market_id UUID;
  v_winning_selection TEXT;
BEGIN
  IF NOT public.is_service_role()
    AND NOT public.has_admin_role(ARRAY['sports_trader']) THEN
    RAISE EXCEPTION 'Settlement ingestion authorization required';
  END IF;
  IF p_status NOT IN ('finished', 'cancelled') THEN
    RAISE EXCEPTION 'Only finished or cancelled events can be settled';
  END IF;
  IF p_status = 'finished' AND (p_home_score IS NULL OR p_away_score IS NULL) THEN
    RAISE EXCEPTION 'Finished events require final scores';
  END IF;
  IF p_provider_reference IS NULL OR length(trim(p_provider_reference)) < 3 THEN
    RAISE EXCEPTION 'Provider reference is required';
  END IF;
  IF jsonb_typeof(COALESCE(p_market_results, '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'Market results must be a JSON array';
  END IF;

  -- Serialize duplicate callbacks before checking the idempotency key.
  PERFORM pg_advisory_xact_lock(hashtext('settlement:' || p_provider_reference));

  -- A repeated provider callback must be a no-op, including after the job has
  -- completed. This prevents a changed duplicate payload from mutating scores.
  SELECT id INTO v_job_id
  FROM public.background_jobs
  WHERE dedupe_key = 'settlement:' || p_provider_reference;
  IF v_job_id IS NOT NULL THEN
    RETURN v_job_id;
  END IF;

  PERFORM 1 FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF p_status = 'finished' AND jsonb_array_length(p_market_results) = 0 THEN
    RAISE EXCEPTION 'A finished event requires at least one market result';
  END IF;

  FOR v_result IN SELECT value FROM jsonb_array_elements(p_market_results)
  LOOP
    v_market_id := NULLIF(v_result->>'market_id', '')::UUID;
    v_winning_selection := NULLIF(trim(v_result->>'winning_selection'), '');

    IF v_market_id IS NULL OR v_winning_selection IS NULL THEN
      RAISE EXCEPTION 'Each market result requires market_id and winning_selection';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.markets
      WHERE id = v_market_id AND event_id = p_event_id
    ) THEN
      RAISE EXCEPTION 'Market % does not belong to event', v_market_id;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.odds
      WHERE market_id = v_market_id
        AND lower(trim(selection)) = lower(v_winning_selection)
    ) THEN
      RAISE EXCEPTION 'Winning selection % is not valid for market %', v_winning_selection, v_market_id;
    END IF;
  END LOOP;

  UPDATE public.events
  SET status = p_status,
      live_score_home = p_home_score,
      live_score_away = p_away_score,
      is_suspended = TRUE,
      updated_at = NOW()
  WHERE id = p_event_id;

  INSERT INTO public.background_jobs (
    job_type, status, priority, payload, dedupe_key, scheduled_at
  ) VALUES (
    'settlement',
    'pending',
    1,
    jsonb_build_object(
      'event_id', p_event_id,
      'event_status', p_status,
      'home_score', p_home_score,
      'away_score', p_away_score,
      'market_results', COALESCE(p_market_results, '[]'::JSONB),
      'provider_reference', p_provider_reference
    ),
    'settlement:' || p_provider_reference,
    NOW()
  )
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_job_id;

  IF v_job_id IS NULL THEN
    SELECT id INTO v_job_id
    FROM public.background_jobs
    WHERE dedupe_key = 'settlement:' || p_provider_reference;
  END IF;

  RETURN v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_event_result_and_queue(UUID, TEXT, INTEGER, INTEGER, JSONB, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_event_result_and_queue(UUID, TEXT, INTEGER, INTEGER, JSONB, TEXT)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.process_next_settlement_job()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.background_jobs%ROWTYPE;
  v_event_id UUID;
  v_event_status TEXT;
  v_result JSONB;
  v_market_id UUID;
  v_winning_selection TEXT;
  v_bet RECORD;
  v_selection RECORD;
  v_bet_status TEXT;
  v_settlement_type TEXT;
  v_payout_factor NUMERIC;
  v_payout NUMERIC;
  v_balance NUMERIC;
  v_transaction_id UUID;
  v_settled_count INTEGER := 0;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Settlement worker authorization required';
  END IF;

  SELECT * INTO v_job
  FROM public.background_jobs
  WHERE job_type = 'settlement'
    AND status IN ('pending', 'retry')
    AND scheduled_at <= NOW()
    AND retry_count < COALESCE(max_retries, 3)
  ORDER BY priority ASC, scheduled_at ASC, created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('processed', FALSE);
  END IF;

  UPDATE public.background_jobs
  SET status = 'processing', started_at = NOW(), error_message = NULL
  WHERE id = v_job.id;

  BEGIN
    v_event_id := (v_job.payload->>'event_id')::UUID;
    v_event_status := v_job.payload->>'event_status';

    IF v_event_status = 'cancelled' THEN
      UPDATE public.markets
      SET status = 'settled', result = 'void', settled_at = NOW()
      WHERE event_id = v_event_id AND status <> 'settled';

      UPDATE public.bet_selections
      SET result = 'void'
      WHERE event_id = v_event_id AND result = 'pending';
    ELSE
      FOR v_result IN
        SELECT value FROM jsonb_array_elements(v_job.payload->'market_results')
      LOOP
        v_market_id := (v_result->>'market_id')::UUID;
        v_winning_selection := trim(v_result->>'winning_selection');

        UPDATE public.markets
        SET status = 'settled', result = v_winning_selection, settled_at = NOW()
        WHERE id = v_market_id AND event_id = v_event_id;

        UPDATE public.bet_selections
        SET result = CASE
          WHEN lower(trim(selection)) = lower(v_winning_selection) THEN 'won'
          ELSE 'lost'
        END
        WHERE market_id = v_market_id AND event_id = v_event_id AND result = 'pending';
      END LOOP;
    END IF;

    FOR v_bet IN
      SELECT b.id, b.user_id, b.stake
      FROM public.bets b
      WHERE b.status = 'pending'
        AND EXISTS (
          SELECT 1 FROM public.bet_selections bs
          WHERE bs.bet_id = b.id AND bs.event_id = v_event_id
        )
      FOR UPDATE OF b
    LOOP
      IF EXISTS (
        SELECT 1 FROM public.bet_selections
        WHERE bet_id = v_bet.id AND result = 'lost'
      ) THEN
        v_bet_status := 'lost';
        v_settlement_type := 'loss';
        v_payout := 0;
      ELSIF EXISTS (
        SELECT 1 FROM public.bet_selections
        WHERE bet_id = v_bet.id AND result = 'pending'
      ) THEN
        CONTINUE;
      ELSE
        v_payout_factor := 1;
        FOR v_selection IN
          SELECT result, odds_value
          FROM public.bet_selections
          WHERE bet_id = v_bet.id
        LOOP
          IF v_selection.result = 'won' THEN
            v_payout_factor := v_payout_factor * v_selection.odds_value;
          END IF;
        END LOOP;

        IF NOT EXISTS (
          SELECT 1 FROM public.bet_selections
          WHERE bet_id = v_bet.id AND result = 'won'
        ) THEN
          v_bet_status := 'void';
          v_settlement_type := 'void';
          v_payout := v_bet.stake;
        ELSE
          v_bet_status := 'won';
          v_settlement_type := 'win';
          v_payout := ROUND(v_bet.stake * v_payout_factor, 2);
        END IF;
      END IF;

      SELECT COALESCE(demo_balance, 0) INTO v_balance
      FROM public.profiles WHERE id = v_bet.user_id FOR UPDATE;

      IF v_payout > 0 THEN
        UPDATE public.profiles
        SET demo_balance = v_balance + v_payout, updated_at = NOW()
        WHERE id = v_bet.user_id;
      END IF;

      INSERT INTO public.wallet_transactions (
        user_id, type, amount, balance_before, balance_after,
        description, reference_id, status
      ) VALUES (
        v_bet.user_id,
        CASE
          WHEN v_bet_status = 'won' THEN 'bet_won'
          WHEN v_bet_status = 'void' THEN 'adjustment'
          ELSE 'bet_lost'
        END,
        v_payout,
        v_balance,
        v_balance + v_payout,
        'Automatic event settlement - ' || v_bet_status,
        v_bet.id,
        'completed'
      ) RETURNING id INTO v_transaction_id;

      UPDATE public.bets
      SET status = v_bet_status,
          payout = v_payout,
          settled_at = NOW()
      WHERE id = v_bet.id;

      INSERT INTO public.settlements (
        bet_id, settlement_type, original_stake, settlement_amount,
        settlement_reason, is_manual, wallet_transaction_id
      ) VALUES (
        v_bet.id, v_settlement_type, v_bet.stake, v_payout,
        'Provider result: ' || COALESCE(v_job.payload->>'provider_reference', 'unknown'),
        FALSE, v_transaction_id
      );

      v_settled_count := v_settled_count + 1;
    END LOOP;

    UPDATE public.background_jobs
    SET status = 'completed',
        completed_at = NOW(),
        result = jsonb_build_object(
          'event_id', v_event_id,
          'settled_bets', v_settled_count
        )
    WHERE id = v_job.id;

    RETURN jsonb_build_object(
      'processed', TRUE,
      'job_id', v_job.id,
      'event_id', v_event_id,
      'settled_bets', v_settled_count
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.background_jobs
    SET status = CASE
          WHEN COALESCE(retry_count, 0) + 1 >= COALESCE(max_retries, 3) THEN 'failed'
          ELSE 'retry'
        END,
        retry_count = COALESCE(retry_count, 0) + 1,
        scheduled_at = NOW() + make_interval(mins => LEAST(30, power(2, LEAST(COALESCE(retry_count, 0) + 1, 4)))),
        error_message = SQLERRM,
        completed_at = CASE
          WHEN COALESCE(retry_count, 0) + 1 >= COALESCE(max_retries, 3) THEN NOW()
          ELSE NULL
        END
    WHERE id = v_job.id;

    RETURN jsonb_build_object(
      'processed', TRUE,
      'job_id', v_job.id,
      'failed', TRUE,
      'error', SQLERRM
    );
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.process_next_settlement_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_next_settlement_job() TO service_role;

-- END MIGRATION: 20261019100000_automated_settlement_pipeline.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261019101000_live_feed_ingestion.sql
-- ============================================================================

-- Transactional provider feed ingestion with canonical event mapping,
-- idempotent updates, odds history and incident-based suspension.

CREATE TABLE IF NOT EXISTS public.provider_event_map (
  provider_id TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider_id, provider_event_id)
);

CREATE TABLE IF NOT EXISTS public.feed_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id TEXT NOT NULL,
  update_id TEXT NOT NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, update_id)
);

ALTER TABLE public.provider_event_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view provider event mappings"
  ON public.provider_event_map FOR SELECT TO authenticated
  USING (public.has_admin_role(ARRAY['sports_trader']));
CREATE POLICY "Admins can view feed updates"
  ON public.feed_updates FOR SELECT TO authenticated
  USING (public.has_admin_role(ARRAY['sports_trader']));

CREATE OR REPLACE FUNCTION public.ingest_sports_feed_event(
  p_update_id TEXT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider TEXT := trim(p_payload->>'provider_id');
  v_provider_event TEXT := trim(p_payload->>'provider_event_id');
  v_sport_id UUID;
  v_league_id UUID;
  v_event_id UUID;
  v_market_id UUID;
  v_odds_id UUID;
  v_market JSONB;
  v_outcome JSONB;
  v_previous_odds NUMERIC;
  v_incident TEXT := lower(COALESCE(p_payload->>'incident', ''));
  v_critical_incident BOOLEAN;
  v_should_suspend BOOLEAN;
  v_duplicate UUID;
  v_market_count INTEGER := 0;
  v_odds_count INTEGER := 0;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Feed ingestion authorization required';
  END IF;
  IF p_update_id IS NULL OR length(trim(p_update_id)) < 3
    OR v_provider = '' OR v_provider_event = '' THEN
    RAISE EXCEPTION 'Provider and update identifiers are required';
  END IF;
  IF COALESCE(p_payload->>'sport_slug', '') = ''
    OR COALESCE(p_payload->>'league_slug', '') = ''
    OR COALESCE(p_payload->>'home_team', '') = ''
    OR COALESCE(p_payload->>'away_team', '') = '' THEN
    RAISE EXCEPTION 'Sport, league and team identifiers are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_provider || ':' || p_update_id));
  SELECT id INTO v_duplicate FROM public.feed_updates
  WHERE provider_id = v_provider AND update_id = p_update_id;
  IF v_duplicate IS NOT NULL THEN
    SELECT event_id INTO v_event_id FROM public.feed_updates WHERE id = v_duplicate;
    RETURN jsonb_build_object('duplicate', TRUE, 'event_id', v_event_id);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_provider || ':' || v_provider_event));

  INSERT INTO public.sports (name, slug, icon, is_active)
  VALUES (p_payload->>'sport_name', p_payload->>'sport_slug', p_payload->>'sport_icon', TRUE)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, is_active = TRUE
  RETURNING id INTO v_sport_id;

  INSERT INTO public.leagues (sport_id, name, slug, country, is_active)
  VALUES (v_sport_id, p_payload->>'league_name', p_payload->>'league_slug', p_payload->>'country', TRUE)
  ON CONFLICT (sport_id, slug) DO UPDATE SET name = EXCLUDED.name, country = EXCLUDED.country, is_active = TRUE
  RETURNING id INTO v_league_id;

  SELECT event_id INTO v_event_id FROM public.provider_event_map
  WHERE provider_id = v_provider AND provider_event_id = v_provider_event;

  IF v_event_id IS NULL THEN
    SELECT id INTO v_event_id FROM public.events
    WHERE provider_id = v_provider AND provider_event_id = v_provider_event
    ORDER BY created_at ASC LIMIT 1;
  END IF;

  -- Cross-provider reconciliation: use the same canonical event when normalized
  -- teams and kickoff are effectively identical. Multiple providers may map to
  -- one event, enabling failover without duplicating the public fixture.
  IF v_event_id IS NULL THEN
    SELECT id INTO v_event_id FROM public.events
    WHERE sport_id = v_sport_id
      AND lower(trim(home_team)) = lower(trim(p_payload->>'home_team'))
      AND lower(trim(away_team)) = lower(trim(p_payload->>'away_team'))
      AND abs(extract(epoch FROM (start_time - (p_payload->>'start_time')::TIMESTAMPTZ))) <= 900
    ORDER BY created_at ASC LIMIT 1;
  END IF;

  IF v_event_id IS NULL THEN
    INSERT INTO public.events (
      sport_id, league_id, home_team, away_team, start_time, status,
      provider_id, provider_event_id, is_suspended
    ) VALUES (
      v_sport_id, v_league_id, p_payload->>'home_team', p_payload->>'away_team',
      (p_payload->>'start_time')::TIMESTAMPTZ, COALESCE(p_payload->>'status', 'upcoming'),
      v_provider, v_provider_event, FALSE
    ) RETURNING id INTO v_event_id;
  END IF;

  INSERT INTO public.provider_event_map (provider_id, provider_event_id, event_id)
  VALUES (v_provider, v_provider_event, v_event_id)
  ON CONFLICT (provider_id, provider_event_id) DO UPDATE
    SET updated_at = NOW();

  v_critical_incident := v_incident = ANY(ARRAY['goal', 'penalty', 'red_card', 'var', 'wicket', 'match_point']);
  v_should_suspend := v_critical_incident OR COALESCE(p_payload->>'status', '') IN ('postponed', 'cancelled', 'finished');

  UPDATE public.events SET
    sport_id = v_sport_id,
    league_id = v_league_id,
    home_team = p_payload->>'home_team',
    away_team = p_payload->>'away_team',
    start_time = (p_payload->>'start_time')::TIMESTAMPTZ,
    status = COALESCE(p_payload->>'status', status),
    live_score_home = CASE WHEN p_payload ? 'home_score' THEN (p_payload->>'home_score')::INTEGER ELSE live_score_home END,
    live_score_away = CASE WHEN p_payload ? 'away_score' THEN (p_payload->>'away_score')::INTEGER ELSE live_score_away END,
    live_minute = CASE WHEN p_payload ? 'live_minute' THEN (p_payload->>'live_minute')::INTEGER ELSE live_minute END,
    is_suspended = CASE WHEN v_should_suspend THEN TRUE WHEN COALESCE((p_payload->>'resume_markets')::BOOLEAN, FALSE) THEN FALSE ELSE is_suspended END,
    updated_at = NOW()
  WHERE id = v_event_id;

  IF v_should_suspend THEN
    UPDATE public.markets SET status = 'suspended'
    WHERE event_id = v_event_id AND status = 'active';
  END IF;

  FOR v_market IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'markets', '[]'::JSONB))
  LOOP
    SELECT id INTO v_market_id FROM public.markets
    WHERE event_id = v_event_id
      AND type = v_market->>'type'
      AND line IS NOT DISTINCT FROM NULLIF(v_market->>'line', '')::NUMERIC
    ORDER BY created_at ASC LIMIT 1;

    IF v_market_id IS NULL THEN
      INSERT INTO public.markets (event_id, name, type, line, status)
      VALUES (
        v_event_id, v_market->>'name', v_market->>'type', NULLIF(v_market->>'line', '')::NUMERIC,
        CASE WHEN v_should_suspend THEN 'suspended' ELSE COALESCE(v_market->>'status', 'active') END
      ) RETURNING id INTO v_market_id;
    ELSE
      UPDATE public.markets SET
        name = v_market->>'name',
        status = CASE WHEN v_should_suspend THEN 'suspended' ELSE COALESCE(v_market->>'status', status) END
      WHERE id = v_market_id;
    END IF;
    v_market_count := v_market_count + 1;

    FOR v_outcome IN SELECT value FROM jsonb_array_elements(COALESCE(v_market->'outcomes', '[]'::JSONB))
    LOOP
      SELECT id, value INTO v_odds_id, v_previous_odds FROM public.odds
      WHERE market_id = v_market_id AND lower(trim(selection)) = lower(trim(v_outcome->>'selection'))
      ORDER BY created_at ASC LIMIT 1;

      IF v_odds_id IS NULL THEN
        INSERT INTO public.odds (market_id, selection, value, is_active, is_locked, provider_id, provider_odds, last_provider_update)
        VALUES (v_market_id, v_outcome->>'selection', (v_outcome->>'value')::NUMERIC, TRUE, v_should_suspend, v_provider, (v_outcome->>'value')::NUMERIC, NOW())
        RETURNING id INTO v_odds_id;
      ELSE
        IF v_previous_odds IS DISTINCT FROM (v_outcome->>'value')::NUMERIC THEN
          INSERT INTO public.odds_history (odds_id, market_id, selection, previous_value, new_value, provider_odds, change_type)
          VALUES (v_odds_id, v_market_id, v_outcome->>'selection', v_previous_odds, (v_outcome->>'value')::NUMERIC, (v_outcome->>'value')::NUMERIC, 'provider_update');
        END IF;
        UPDATE public.odds SET
          value = (v_outcome->>'value')::NUMERIC,
          provider_odds = (v_outcome->>'value')::NUMERIC,
          provider_id = v_provider,
          is_active = COALESCE((v_outcome->>'active')::BOOLEAN, TRUE),
          is_locked = v_should_suspend,
          last_provider_update = NOW(), updated_at = NOW()
        WHERE id = v_odds_id;
      END IF;
      v_odds_count := v_odds_count + 1;
    END LOOP;
  END LOOP;

  IF COALESCE((p_payload->>'resume_markets')::BOOLEAN, FALSE) AND NOT v_should_suspend THEN
    UPDATE public.markets SET status = 'active' WHERE event_id = v_event_id AND status = 'suspended';
    UPDATE public.odds SET is_locked = FALSE WHERE market_id IN (SELECT id FROM public.markets WHERE event_id = v_event_id);
  END IF;

  INSERT INTO public.feed_updates (provider_id, update_id, event_id, payload)
  VALUES (v_provider, p_update_id, v_event_id, p_payload);

  RETURN jsonb_build_object('duplicate', FALSE, 'event_id', v_event_id, 'markets', v_market_count, 'odds', v_odds_count, 'suspended', v_should_suspend);
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_sports_feed_event(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_sports_feed_event(TEXT, JSONB) TO service_role;

-- END MIGRATION: 20261019101000_live_feed_ingestion.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261019102000_enforce_risk_and_exposure.sql
-- ============================================================================

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

-- END MIGRATION: 20261019102000_enforce_risk_and_exposure.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261019103000_double_entry_wallet_ledger.sql
-- ============================================================================

-- Double-entry play-money wallet ledger. Existing wallet_transactions remain
-- the compatibility event stream; this trigger mirrors every new event into a
-- balanced, immutable cash/bonus/locked ledger.

CREATE TABLE IF NOT EXISTS public.ledger_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL CHECK (account_code IN ('cash', 'bonus', 'locked', 'sportsbook_clearing', 'bonus_reserve')),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((is_system AND user_id IS NULL) OR (NOT is_system AND user_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_user_account_unique
  ON public.ledger_accounts (user_id, currency, account_code)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ledger_system_account_unique
  ON public.ledger_accounts (currency, account_code)
  WHERE user_id IS NULL;

CREATE TABLE IF NOT EXISTS public.ledger_journals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL,
  source_transaction_id UUID UNIQUE REFERENCES public.wallet_transactions(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ledger_postings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id UUID NOT NULL REFERENCES public.ledger_journals(id) ON DELETE RESTRICT,
  account_id UUID NOT NULL REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT,
  amount NUMERIC(18,2) NOT NULL CHECK (amount <> 0),
  balance_after NUMERIC(18,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ledger_postings_account_created_idx
  ON public.ledger_postings (account_id, created_at DESC);

REVOKE INSERT, UPDATE, DELETE ON public.ledger_accounts FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.ledger_journals FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.ledger_postings FROM PUBLIC, anon, authenticated;

ALTER TABLE public.ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_postings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own ledger accounts" ON public.ledger_accounts
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Finance staff can view all ledger accounts" ON public.ledger_accounts
  FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['finance']));
CREATE POLICY "Users can view own ledger postings" ON public.ledger_postings
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.ledger_accounts a WHERE a.id=account_id AND a.user_id=auth.uid())
  );
CREATE POLICY "Finance staff can view all ledger postings" ON public.ledger_postings
  FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['finance']));
CREATE POLICY "Users can view own ledger journals" ON public.ledger_journals
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.ledger_postings p JOIN public.ledger_accounts a ON a.id=p.account_id
      WHERE p.journal_id=ledger_journals.id AND a.user_id=auth.uid()
    )
  );
CREATE POLICY "Finance staff can view all ledger journals" ON public.ledger_journals
  FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['finance']));

CREATE OR REPLACE FUNCTION public.verify_ledger_journal_balanced()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_journal UUID := COALESCE(NEW.journal_id,OLD.journal_id); v_total NUMERIC;
BEGIN
  SELECT COALESCE(SUM(amount),0) INTO v_total FROM public.ledger_postings WHERE journal_id=v_journal;
  IF v_total <> 0 THEN RAISE EXCEPTION 'Ledger journal % is unbalanced by %',v_journal,v_total; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS verify_ledger_journal_balanced_trigger ON public.ledger_postings;
CREATE CONSTRAINT TRIGGER verify_ledger_journal_balanced_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.ledger_postings
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.verify_ledger_journal_balanced();

INSERT INTO public.ledger_accounts (user_id, account_code, currency, balance, is_system)
VALUES (NULL,'sportsbook_clearing','USD',0,TRUE),(NULL,'bonus_reserve','USD',0,TRUE)
ON CONFLICT (currency, account_code) WHERE user_id IS NULL DO NOTHING;

CREATE OR REPLACE FUNCTION public.ensure_user_ledger_accounts_from_id(p_user_id UUID,p_cash_balance NUMERIC DEFAULT 0)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_cash_account UUID;
  v_system_account UUID;
  v_journal UUID;
  v_system_balance NUMERIC;
BEGIN
  INSERT INTO public.ledger_accounts(user_id,account_code,currency,balance,is_system)
  SELECT p_user_id,code,'USD',0,FALSE
  FROM (VALUES('cash'),('bonus'),('locked')) v(code)
  ON CONFLICT (user_id,currency,account_code) WHERE user_id IS NOT NULL DO NOTHING;

  IF COALESCE(p_cash_balance,0) <> 0
    AND NOT EXISTS (
      SELECT 1 FROM public.ledger_journals
      WHERE idempotency_key='profile-opening:'||p_user_id
    ) THEN
    SELECT id INTO v_cash_account
    FROM public.ledger_accounts
    WHERE user_id=p_user_id AND currency='USD' AND account_code='cash'
    FOR UPDATE;
    SELECT id INTO v_system_account
    FROM public.ledger_accounts
    WHERE user_id IS NULL AND currency='USD' AND account_code='sportsbook_clearing'
    FOR UPDATE;

    INSERT INTO public.ledger_journals(source_type,idempotency_key,description,metadata)
    VALUES('opening_balance','profile-opening:'||p_user_id,'Opening play-money balance',jsonb_build_object('user_id',p_user_id))
    RETURNING id INTO v_journal;

    UPDATE public.ledger_accounts
    SET balance=balance+p_cash_balance,updated_at=NOW()
    WHERE id=v_cash_account;
    UPDATE public.ledger_accounts
    SET balance=balance-p_cash_balance,updated_at=NOW()
    WHERE id=v_system_account
    RETURNING balance INTO v_system_balance;

    INSERT INTO public.ledger_postings(journal_id,account_id,amount,balance_after)
    VALUES
      (v_journal,v_cash_account,p_cash_balance,p_cash_balance),
      (v_journal,v_system_account,-p_cash_balance,v_system_balance);
  END IF;
END;
$$;

SELECT public.ensure_user_ledger_accounts_from_id(id,COALESCE(demo_balance,0))
FROM public.profiles;

CREATE OR REPLACE FUNCTION public.ensure_user_ledger_accounts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.ensure_user_ledger_accounts_from_id(NEW.id,COALESCE(NEW.demo_balance,0));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_user_ledger_accounts_trigger ON public.profiles;
CREATE TRIGGER ensure_user_ledger_accounts_trigger
AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.ensure_user_ledger_accounts();

CREATE OR REPLACE FUNCTION public.mirror_wallet_transaction_to_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_journal UUID;
  v_user_cash UUID; v_user_bonus UUID; v_target UUID; v_system UUID;
  v_cash_balance NUMERIC; v_bonus_balance NUMERIC;
  v_cash_part NUMERIC; v_bonus_part NUMERIC; v_amount NUMERIC := ABS(NEW.amount);
  v_balance NUMERIC;
BEGIN
  IF EXISTS (SELECT 1 FROM public.ledger_journals WHERE source_transaction_id=NEW.id) THEN RETURN NEW; END IF;
  PERFORM public.ensure_user_ledger_accounts_from_id(
    NEW.user_id,
    COALESCE(NEW.balance_before,(SELECT demo_balance FROM public.profiles WHERE id=NEW.user_id),0)
  );

  INSERT INTO public.ledger_journals(source_type,source_transaction_id,idempotency_key,description,metadata)
  VALUES ('wallet_transaction',NEW.id,'wallet:'||NEW.id,NEW.description,COALESCE(NEW.metadata,'{}'::JSONB))
  RETURNING id INTO v_journal;

  SELECT id,balance INTO v_user_cash,v_cash_balance FROM public.ledger_accounts WHERE user_id=NEW.user_id AND currency='USD' AND account_code='cash' FOR UPDATE;
  SELECT id,balance INTO v_user_bonus,v_bonus_balance FROM public.ledger_accounts WHERE user_id=NEW.user_id AND currency='USD' AND account_code='bonus' FOR UPDATE;
  SELECT id INTO v_system FROM public.ledger_accounts WHERE user_id IS NULL AND currency='USD' AND account_code=CASE WHEN NEW.type='bonus_awarded' THEN 'bonus_reserve' ELSE 'sportsbook_clearing' END FOR UPDATE;

  IF NEW.amount < 0 THEN
    v_cash_part := LEAST(v_amount,GREATEST(v_cash_balance,0));
    v_bonus_part := v_amount-v_cash_part;
    IF v_bonus_part > GREATEST(v_bonus_balance,0) THEN RAISE EXCEPTION 'Ledger funds are insufficient'; END IF;
    IF v_cash_part > 0 THEN
      UPDATE public.ledger_accounts SET balance=balance-v_cash_part,updated_at=NOW() WHERE id=v_user_cash RETURNING balance INTO v_balance;
      INSERT INTO public.ledger_postings(journal_id,account_id,amount,balance_after) VALUES(v_journal,v_user_cash,-v_cash_part,v_balance);
    END IF;
    IF v_bonus_part > 0 THEN
      UPDATE public.ledger_accounts SET balance=balance-v_bonus_part,updated_at=NOW() WHERE id=v_user_bonus RETURNING balance INTO v_balance;
      INSERT INTO public.ledger_postings(journal_id,account_id,amount,balance_after) VALUES(v_journal,v_user_bonus,-v_bonus_part,v_balance);
    END IF;
    UPDATE public.ledger_accounts SET balance=balance+v_amount,updated_at=NOW() WHERE id=v_system RETURNING balance INTO v_balance;
    INSERT INTO public.ledger_postings(journal_id,account_id,amount,balance_after) VALUES(v_journal,v_system,v_amount,v_balance);
  ELSIF NEW.amount > 0 THEN
    UPDATE public.ledger_accounts SET balance=balance-v_amount,updated_at=NOW() WHERE id=v_system RETURNING balance INTO v_balance;
    INSERT INTO public.ledger_postings(journal_id,account_id,amount,balance_after) VALUES(v_journal,v_system,-v_amount,v_balance);

    IF NEW.type='adjustment' AND NEW.reference_id IS NOT NULL THEN
      SELECT
        LEAST(v_amount,COALESCE(SUM(-p.amount) FILTER(WHERE a.account_code='cash' AND p.amount<0),0)),
        LEAST(v_amount,COALESCE(SUM(-p.amount) FILTER(WHERE a.account_code='bonus' AND p.amount<0),0))
      INTO v_cash_part,v_bonus_part
      FROM public.wallet_transactions wt
      JOIN public.ledger_journals j ON j.source_transaction_id=wt.id
      JOIN public.ledger_postings p ON p.journal_id=j.id
      JOIN public.ledger_accounts a ON a.id=p.account_id
      WHERE wt.reference_id=NEW.reference_id AND wt.type='bet_placed' AND wt.user_id=NEW.user_id;
      v_cash_part := LEAST(v_amount,COALESCE(v_cash_part,0));
      v_bonus_part := LEAST(v_amount-v_cash_part,COALESCE(v_bonus_part,0));
      v_cash_part := v_cash_part+(v_amount-v_cash_part-v_bonus_part);
    ELSE
      v_cash_part := CASE WHEN NEW.type='bonus_awarded' THEN 0 ELSE v_amount END;
      v_bonus_part := CASE WHEN NEW.type='bonus_awarded' THEN v_amount ELSE 0 END;
    END IF;

    IF v_cash_part>0 THEN
      UPDATE public.ledger_accounts SET balance=balance+v_cash_part,updated_at=NOW() WHERE id=v_user_cash RETURNING balance INTO v_balance;
      INSERT INTO public.ledger_postings(journal_id,account_id,amount,balance_after) VALUES(v_journal,v_user_cash,v_cash_part,v_balance);
    END IF;
    IF v_bonus_part>0 THEN
      UPDATE public.ledger_accounts SET balance=balance+v_bonus_part,updated_at=NOW() WHERE id=v_user_bonus RETURNING balance INTO v_balance;
      INSERT INTO public.ledger_postings(journal_id,account_id,amount,balance_after) VALUES(v_journal,v_user_bonus,v_bonus_part,v_balance);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mirror_wallet_transaction_to_ledger_trigger ON public.wallet_transactions;
CREATE TRIGGER mirror_wallet_transaction_to_ledger_trigger
AFTER INSERT ON public.wallet_transactions FOR EACH ROW EXECUTE FUNCTION public.mirror_wallet_transaction_to_ledger();

CREATE OR REPLACE FUNCTION public.get_my_wallet_balances()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object(
    'currency','USD',
    'cash',COALESCE(MAX(balance) FILTER(WHERE account_code='cash'),0),
    'bonus',COALESCE(MAX(balance) FILTER(WHERE account_code='bonus'),0),
    'locked',COALESCE(MAX(balance) FILTER(WHERE account_code='locked'),0),
    'available',COALESCE(MAX(balance) FILTER(WHERE account_code='cash'),0)+COALESCE(MAX(balance) FILTER(WHERE account_code='bonus'),0)
  ) FROM public.ledger_accounts WHERE user_id=auth.uid() AND currency='USD';
$$;

CREATE OR REPLACE FUNCTION public.get_wallet_reconciliation_report()
RETURNS TABLE(user_id UUID,profile_balance NUMERIC,ledger_available NUMERIC,difference NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_admin_role(ARRAY['finance']) THEN RAISE EXCEPTION 'Finance authorization required'; END IF;
  RETURN QUERY
  SELECT p.id,COALESCE(p.demo_balance,0),
    COALESCE(SUM(a.balance) FILTER(WHERE a.account_code IN('cash','bonus')),0),
    COALESCE(p.demo_balance,0)-COALESCE(SUM(a.balance) FILTER(WHERE a.account_code IN('cash','bonus')),0)
  FROM public.profiles p LEFT JOIN public.ledger_accounts a ON a.user_id=p.id AND a.currency='USD'
  GROUP BY p.id,p.demo_balance
  HAVING COALESCE(p.demo_balance,0)<>COALESCE(SUM(a.balance) FILTER(WHERE a.account_code IN('cash','bonus')),0)
  ORDER BY ABS(COALESCE(p.demo_balance,0)-COALESCE(SUM(a.balance) FILTER(WHERE a.account_code IN('cash','bonus')),0)) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_user_ledger_accounts() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ensure_user_ledger_accounts_from_id(UUID,NUMERIC) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mirror_wallet_transaction_to_ledger() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.verify_ledger_journal_balanced() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_my_wallet_balances() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_wallet_balances() TO authenticated;
REVOKE ALL ON FUNCTION public.get_wallet_reconciliation_report() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_wallet_reconciliation_report() TO authenticated;

-- END MIGRATION: 20261019103000_double_entry_wallet_ledger.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261019104000_bonus_vip_engine.sql
-- ============================================================================

-- Play-money promotion, wagering and loyalty engine. Real-money deposit and
-- cashback offers remain unavailable until a licensed payment provider is live.

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS promo_code TEXT,
  ADD COLUMN IF NOT EXISTS per_user_claim_limit INTEGER NOT NULL DEFAULT 1 CHECK (per_user_claim_limit > 0),
  ADD COLUMN IF NOT EXISTS total_claim_limit INTEGER CHECK (total_claim_limit IS NULL OR total_claim_limit > 0),
  ADD COLUMN IF NOT EXISTS expires_after_days INTEGER NOT NULL DEFAULT 30 CHECK (expires_after_days BETWEEN 1 AND 365),
  ADD COLUMN IF NOT EXISTS min_odds NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (min_odds >= 1),
  ADD COLUMN IF NOT EXISTS min_legs INTEGER NOT NULL DEFAULT 1 CHECK (min_legs BETWEEN 1 AND 25),
  ADD COLUMN IF NOT EXISTS loyalty_points_reward INTEGER NOT NULL DEFAULT 0 CHECK (loyalty_points_reward >= 0),
  ADD COLUMN IF NOT EXISTS requires_qualifying_deposit BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS promotions_promo_code_unique
  ON public.promotions (LOWER(promo_code)) WHERE promo_code IS NOT NULL;

ALTER TABLE public.user_bonuses
  ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS claim_source TEXT NOT NULL DEFAULT 'admin'
    CHECK (claim_source IN ('admin','promo_code','automatic','deposit','cashback')),
  ADD COLUMN IF NOT EXISTS forfeited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_wagered_at TIMESTAMPTZ;

UPDATE public.user_bonuses
SET remaining_amount=amount
WHERE remaining_amount IS NULL;

ALTER TABLE public.user_bonuses
  ALTER COLUMN remaining_amount SET DEFAULT 0,
  ALTER COLUMN remaining_amount SET NOT NULL;

ALTER TABLE public.user_bonuses DROP CONSTRAINT IF EXISTS user_bonuses_remaining_amount_nonnegative;
ALTER TABLE public.user_bonuses
  ADD CONSTRAINT user_bonuses_remaining_amount_nonnegative CHECK (remaining_amount >= 0);

CREATE INDEX IF NOT EXISTS user_bonuses_active_expiry_idx
  ON public.user_bonuses (expires_at, user_id) WHERE status='active';

CREATE TABLE IF NOT EXISTS public.loyalty_accounts (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  points BIGINT NOT NULL DEFAULT 0 CHECK (points >= 0),
  lifetime_points BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_points >= 0),
  tier TEXT NOT NULL DEFAULT 'bronze' CHECK (tier IN ('bronze','silver','gold','platinum')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.loyalty_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_read_own_loyalty" ON public.loyalty_accounts
  FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY "finance_read_loyalty" ON public.loyalty_accounts
  FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['finance']));
REVOKE INSERT,UPDATE,DELETE ON public.loyalty_accounts FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.set_loyalty_tier()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  NEW.tier := CASE
    WHEN NEW.lifetime_points >= 20000 THEN 'platinum'
    WHEN NEW.lifetime_points >= 5000 THEN 'gold'
    WHEN NEW.lifetime_points >= 1000 THEN 'silver'
    ELSE 'bronze'
  END;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_loyalty_tier_trigger ON public.loyalty_accounts;
CREATE TRIGGER set_loyalty_tier_trigger
BEFORE INSERT OR UPDATE OF lifetime_points ON public.loyalty_accounts
FOR EACH ROW EXECUTE FUNCTION public.set_loyalty_tier();

INSERT INTO public.loyalty_accounts(user_id)
SELECT id FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ensure_loyalty_account()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.loyalty_accounts(user_id) VALUES(NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_loyalty_account_trigger ON public.profiles;
CREATE TRIGGER ensure_loyalty_account_trigger
AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.ensure_loyalty_account();

CREATE OR REPLACE FUNCTION public.transfer_user_bonus_funds(
  p_user_id UUID,
  p_bonus_id UUID,
  p_requested_amount NUMERIC,
  p_destination TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_bonus_account UUID;
  v_destination_account UUID;
  v_journal UUID;
  v_bonus_balance NUMERIC;
  v_destination_balance NUMERIC;
  v_profile_balance NUMERIC;
  v_amount NUMERIC;
  v_key TEXT := 'bonus-'||p_destination||':'||p_bonus_id;
BEGIN
  IF p_destination NOT IN ('cash','reserve') THEN RAISE EXCEPTION 'Invalid bonus destination'; END IF;
  IF COALESCE(p_requested_amount,0) <= 0 THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.ledger_journals WHERE idempotency_key=v_key) THEN RETURN 0; END IF;

  SELECT id,balance INTO v_bonus_account,v_bonus_balance
  FROM public.ledger_accounts
  WHERE user_id=p_user_id AND currency='USD' AND account_code='bonus'
  FOR UPDATE;

  SELECT demo_balance INTO v_profile_balance FROM public.profiles WHERE id=p_user_id FOR UPDATE;

  IF p_destination='cash' THEN
    SELECT id,balance INTO v_destination_account,v_destination_balance
    FROM public.ledger_accounts
    WHERE user_id=p_user_id AND currency='USD' AND account_code='cash'
    FOR UPDATE;
    v_amount := LEAST(p_requested_amount,GREATEST(COALESCE(v_bonus_balance,0),0));
  ELSE
    SELECT id,balance INTO v_destination_account,v_destination_balance
    FROM public.ledger_accounts
    WHERE user_id IS NULL AND currency='USD' AND account_code='bonus_reserve'
    FOR UPDATE;
    v_amount := LEAST(p_requested_amount,GREATEST(COALESCE(v_bonus_balance,0),0),GREATEST(COALESCE(v_profile_balance,0),0));
  END IF;

  IF COALESCE(v_amount,0) <= 0 THEN RETURN 0; END IF;

  INSERT INTO public.ledger_journals(source_type,idempotency_key,description,metadata)
  VALUES(
    CASE WHEN p_destination='cash' THEN 'bonus_conversion' ELSE 'bonus_forfeiture' END,
    v_key,
    CASE WHEN p_destination='cash' THEN 'Bonus wagering completed' ELSE 'Expired bonus forfeited' END,
    jsonb_build_object('user_id',p_user_id,'bonus_id',p_bonus_id,'amount',v_amount)
  ) RETURNING id INTO v_journal;

  UPDATE public.ledger_accounts SET balance=balance-v_amount,updated_at=NOW()
  WHERE id=v_bonus_account RETURNING balance INTO v_bonus_balance;
  UPDATE public.ledger_accounts SET balance=balance+v_amount,updated_at=NOW()
  WHERE id=v_destination_account RETURNING balance INTO v_destination_balance;

  INSERT INTO public.ledger_postings(journal_id,account_id,amount,balance_after)
  VALUES
    (v_journal,v_bonus_account,-v_amount,v_bonus_balance),
    (v_journal,v_destination_account,v_amount,v_destination_balance);

  IF p_destination='reserve' THEN
    UPDATE public.profiles SET demo_balance=demo_balance-v_amount,updated_at=NOW() WHERE id=p_user_id;
  END IF;
  RETURN v_amount;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_promotion(p_promotion_id UUID,p_promo_code TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_promo public.promotions%ROWTYPE;
  v_balance NUMERIC;
  v_amount NUMERIC;
  v_wager_target NUMERIC;
  v_bonus_id UUID;
  v_claims INTEGER;
  v_total_claims INTEGER;
  v_recent_claims INTEGER;
  v_transferred NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::TEXT||':'||p_promotion_id::TEXT,0));

  SELECT * INTO v_promo FROM public.promotions WHERE id=p_promotion_id FOR UPDATE;
  IF NOT FOUND OR NOT COALESCE(v_promo.is_active,FALSE)
     OR NOW()<v_promo.valid_from OR NOW()>v_promo.valid_until THEN
    RAISE EXCEPTION 'Promotion is unavailable';
  END IF;
  IF v_promo.promo_code IS NOT NULL
     AND LOWER(TRIM(COALESCE(p_promo_code,'')))<>LOWER(v_promo.promo_code) THEN
    RAISE EXCEPTION 'A valid promo code is required';
  END IF;
  IF v_promo.requires_qualifying_deposit OR v_promo.type IN ('deposit_bonus','cashback') THEN
    RAISE EXCEPTION 'This offer requires a verified qualifying payment';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.fraud_flags
    WHERE user_id=v_user_id AND flag_type='bonus_abuse' AND severity IN ('high','critical') AND NOT COALESCE(is_reviewed,FALSE)
  ) THEN RAISE EXCEPTION 'Promotion claim requires review'; END IF;

  SELECT COUNT(*) INTO v_claims FROM public.user_bonuses
  WHERE user_id=v_user_id AND promotion_id=p_promotion_id;
  IF v_claims>=v_promo.per_user_claim_limit THEN RAISE EXCEPTION 'Promotion claim limit reached'; END IF;
  SELECT COUNT(*) INTO v_total_claims FROM public.user_bonuses WHERE promotion_id=p_promotion_id;
  IF v_promo.total_claim_limit IS NOT NULL AND v_total_claims>=v_promo.total_claim_limit THEN
    RAISE EXCEPTION 'Promotion is fully claimed';
  END IF;

  SELECT COALESCE(demo_balance,0) INTO v_balance
  FROM public.profiles
  WHERE id=v_user_id AND COALESCE(is_suspended,FALSE)=FALSE
    AND (self_exclusion_until IS NULL OR self_exclusion_until<=NOW())
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account is unavailable'; END IF;

  v_amount := LEAST(COALESCE(v_promo.bonus_amount,0),COALESCE(v_promo.max_bonus,v_promo.bonus_amount,0));
  IF v_amount<=0 THEN RAISE EXCEPTION 'Promotion has no claimable fixed bonus'; END IF;
  v_wager_target := ROUND(v_amount*GREATEST(COALESCE(v_promo.wagering_requirement,0),0),2);

  INSERT INTO public.user_bonuses(
    user_id,promotion_id,amount,remaining_amount,wagering_requirement,
    wagering_completed,status,expires_at,claim_source
  ) VALUES(
    v_user_id,p_promotion_id,v_amount,v_amount,v_wager_target,
    0,'active',NOW()+make_interval(days=>v_promo.expires_after_days),
    CASE WHEN v_promo.promo_code IS NULL THEN 'automatic' ELSE 'promo_code' END
  ) RETURNING id INTO v_bonus_id;

  UPDATE public.profiles SET demo_balance=v_balance+v_amount,updated_at=NOW() WHERE id=v_user_id;
  INSERT INTO public.wallet_transactions(
    user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata
  ) VALUES(
    v_user_id,'bonus_awarded',v_amount,v_balance,v_balance+v_amount,
    'Promotion claimed: '||v_promo.title,v_bonus_id,'completed',jsonb_build_object('promotion_id',p_promotion_id)
  );

  INSERT INTO public.loyalty_accounts(user_id,points,lifetime_points)
  VALUES(v_user_id,v_promo.loyalty_points_reward,v_promo.loyalty_points_reward)
  ON CONFLICT(user_id) DO UPDATE SET
    points=public.loyalty_accounts.points+EXCLUDED.points,
    lifetime_points=public.loyalty_accounts.lifetime_points+EXCLUDED.lifetime_points;

  SELECT COUNT(*) INTO v_recent_claims FROM public.user_bonuses
  WHERE user_id=v_user_id AND awarded_at>=NOW()-INTERVAL '24 hours';
  IF v_recent_claims>=3 AND NOT EXISTS(
    SELECT 1 FROM public.fraud_flags
    WHERE user_id=v_user_id AND flag_type='bonus_abuse' AND created_at>=NOW()-INTERVAL '24 hours'
  ) THEN
    INSERT INTO public.fraud_flags(user_id,flag_type,severity,description,metadata)
    VALUES(v_user_id,'bonus_abuse','medium','Multiple promotion claims within 24 hours',jsonb_build_object('claims',v_recent_claims));
  END IF;

  IF COALESCE((SELECT promotions FROM public.notification_preferences WHERE user_id=v_user_id),TRUE) THEN
    INSERT INTO public.notifications(user_id,type,title,message,metadata)
    VALUES(v_user_id,'promotion_claimed','Bonus claimed',v_promo.title||' was added to your demo bonus balance.',jsonb_build_object('bonus_id',v_bonus_id,'amount',v_amount));
  END IF;

  IF v_wager_target=0 THEN
    v_transferred := public.transfer_user_bonus_funds(v_user_id,v_bonus_id,v_amount,'cash');
    UPDATE public.user_bonuses SET status='completed',remaining_amount=GREATEST(remaining_amount-v_transferred,0),completed_at=NOW()
    WHERE id=v_bonus_id;
  END IF;

  RETURN jsonb_build_object('success',TRUE,'bonus_id',v_bonus_id,'amount',v_amount,'wagering_required',v_wager_target);
END;
$$;

CREATE OR REPLACE FUNCTION public.track_bonus_fund_consumption()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_bonus_spent NUMERIC := 0;
  v_spend_remaining NUMERIC;
  v_spend_apply NUMERIC;
  v_new_remaining NUMERIC;
  v_bonus RECORD;
BEGIN
  IF NEW.type<>'bet_placed' OR NEW.reference_id IS NULL OR NEW.amount>=0 THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(-p.amount),0) INTO v_bonus_spent
  FROM public.ledger_journals j
  JOIN public.ledger_postings p ON p.journal_id=j.id
  JOIN public.ledger_accounts a ON a.id=p.account_id
  WHERE j.source_transaction_id=NEW.id AND a.user_id=NEW.user_id
    AND a.account_code='bonus' AND p.amount<0;
  v_spend_remaining := v_bonus_spent;

  FOR v_bonus IN
    SELECT * FROM public.user_bonuses
    WHERE user_id=NEW.user_id AND status='active' AND remaining_amount>0
    ORDER BY expires_at NULLS LAST,awarded_at,id FOR UPDATE
  LOOP
    v_new_remaining := v_bonus.remaining_amount;
    IF v_spend_remaining>0 AND v_new_remaining>0 THEN
      v_spend_apply := LEAST(v_spend_remaining,v_new_remaining);
      v_new_remaining := v_new_remaining-v_spend_apply;
      v_spend_remaining := v_spend_remaining-v_spend_apply;
    END IF;
    UPDATE public.user_bonuses SET remaining_amount=v_new_remaining WHERE id=v_bonus.id;
    EXIT WHEN v_spend_remaining<=0;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_track_bonus_fund_consumption_trigger ON public.wallet_transactions;
CREATE TRIGGER zz_track_bonus_fund_consumption_trigger
AFTER INSERT ON public.wallet_transactions
FOR EACH ROW EXECUTE FUNCTION public.track_bonus_fund_consumption();

CREATE OR REPLACE FUNCTION public.settle_bonus_wagering()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_wager_remaining NUMERIC := NEW.stake;
  v_legs INTEGER;
  v_apply NUMERIC;
  v_new_progress NUMERIC;
  v_transferred NUMERIC;
  v_points BIGINT := FLOOR(NEW.stake);
  v_bonus RECORD;
BEGIN
  IF OLD.status<>'pending' OR NEW.status NOT IN ('won','lost') THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO v_legs FROM public.bet_selections WHERE bet_id=NEW.id;

  FOR v_bonus IN
    SELECT ub.*,COALESCE(pr.min_odds,1) AS required_odds,COALESCE(pr.min_legs,1) AS required_legs
    FROM public.user_bonuses ub
    LEFT JOIN public.promotions pr ON pr.id=ub.promotion_id
    WHERE ub.user_id=NEW.user_id AND ub.status='active'
      AND (ub.expires_at IS NULL OR ub.expires_at>NOW())
    ORDER BY ub.expires_at NULLS LAST,ub.awarded_at,ub.id
    FOR UPDATE OF ub
  LOOP
    v_new_progress := COALESCE(v_bonus.wagering_completed,0);
    IF v_wager_remaining>0 AND NEW.total_odds>=v_bonus.required_odds AND v_legs>=v_bonus.required_legs THEN
      v_apply := LEAST(v_wager_remaining,GREATEST(v_bonus.wagering_requirement-v_new_progress,0));
      v_new_progress := v_new_progress+v_apply;
      v_wager_remaining := v_wager_remaining-v_apply;
      UPDATE public.user_bonuses SET wagering_completed=v_new_progress,last_wagered_at=NOW() WHERE id=v_bonus.id;
    END IF;
    IF v_new_progress>=v_bonus.wagering_requirement THEN
      v_transferred := public.transfer_user_bonus_funds(NEW.user_id,v_bonus.id,v_bonus.remaining_amount,'cash');
      UPDATE public.user_bonuses SET status='completed',completed_at=NOW(),remaining_amount=GREATEST(remaining_amount-v_transferred,0) WHERE id=v_bonus.id;
      INSERT INTO public.notifications(user_id,type,title,message,metadata)
      VALUES(NEW.user_id,'bonus_completed','Bonus unlocked','Your wagering requirement is complete.',jsonb_build_object('bonus_id',v_bonus.id));
    END IF;
  END LOOP;

  IF v_points>0 THEN
    INSERT INTO public.loyalty_accounts(user_id,points,lifetime_points)
    VALUES(NEW.user_id,v_points,v_points)
    ON CONFLICT(user_id) DO UPDATE SET
      points=public.loyalty_accounts.points+EXCLUDED.points,
      lifetime_points=public.loyalty_accounts.lifetime_points+EXCLUDED.lifetime_points;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS settle_bonus_wagering_trigger ON public.bets;
CREATE TRIGGER settle_bonus_wagering_trigger
AFTER UPDATE OF status ON public.bets
FOR EACH ROW EXECUTE FUNCTION public.settle_bonus_wagering();

CREATE OR REPLACE FUNCTION public.expire_user_bonuses(p_batch_size INTEGER DEFAULT 250)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_bonus RECORD;
  v_forfeited NUMERIC;
  v_count INTEGER := 0;
  v_total NUMERIC := 0;
BEGIN
  IF NOT public.is_service_role() AND NOT public.has_admin_role(ARRAY['finance']) THEN
    RAISE EXCEPTION 'Finance authorization required';
  END IF;
  FOR v_bonus IN
    SELECT * FROM public.user_bonuses
    WHERE status='active' AND expires_at<=NOW()
    ORDER BY expires_at,id LIMIT LEAST(GREATEST(p_batch_size,1),1000)
    FOR UPDATE SKIP LOCKED
  LOOP
    v_forfeited := public.transfer_user_bonus_funds(v_bonus.user_id,v_bonus.id,v_bonus.remaining_amount,'reserve');
    UPDATE public.user_bonuses SET status='expired',remaining_amount=GREATEST(remaining_amount-v_forfeited,0),forfeited_at=NOW()
    WHERE id=v_bonus.id;
    INSERT INTO public.notifications(user_id,type,title,message,metadata)
    VALUES(v_bonus.user_id,'bonus_expired','Bonus expired','An unused demo bonus expired.',jsonb_build_object('bonus_id',v_bonus.id,'forfeited',v_forfeited));
    v_count := v_count+1;
    v_total := v_total+v_forfeited;
  END LOOP;
  RETURN jsonb_build_object('processed',v_count,'forfeited',v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.set_loyalty_tier() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ensure_loyalty_account() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.transfer_user_bonus_funds(UUID,UUID,NUMERIC,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.track_bonus_fund_consumption() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.settle_bonus_wagering() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_promotion(UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.claim_promotion(UUID,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.expire_user_bonuses(INTEGER) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.expire_user_bonuses(INTEGER) TO authenticated,service_role;

-- END MIGRATION: 20261019104000_bonus_vip_engine.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261019105000_require_admin_mfa.sql
-- ============================================================================

-- Require an Authenticator Assurance Level 2 JWT for every browser-authenticated
-- admin capability. Service-role workers remain authorized through their
-- explicit is_service_role() checks and bypass RLS as intended.

CREATE OR REPLACE FUNCTION public.is_aal2()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(auth.jwt()->>'aal','')='aal2';
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.is_aal2() AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id=auth.uid() AND is_admin=TRUE AND admin_role IS NOT NULL
      AND COALESCE(is_suspended,FALSE)=FALSE
  );
$$;

CREATE OR REPLACE FUNCTION public.has_admin_role(p_allowed_roles TEXT[] DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.is_aal2() AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id=auth.uid() AND is_admin=TRUE AND COALESCE(is_suspended,FALSE)=FALSE
      AND admin_role IS NOT NULL
      AND (admin_role IN ('super_admin','admin') OR p_allowed_roles IS NULL OR admin_role=ANY(p_allowed_roles))
  );
$$;

REVOKE ALL ON FUNCTION public.is_aal2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_aal2() TO authenticated;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon,authenticated;
REVOKE ALL ON FUNCTION public.has_admin_role(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_admin_role(TEXT[]) TO anon,authenticated;

-- END MIGRATION: 20261019105000_require_admin_mfa.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261020120000_atomic_cashout.sql
-- ============================================================================

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

-- END MIGRATION: 20261020120000_atomic_cashout.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261020130000_crypto_deposits_and_brokers.sql
-- ============================================================================

-- Provider-controlled crypto deposits and agent/broker revenue-share accounts.
-- Real-money activation remains an operational decision: provider merchant
-- approval, KYC/AML and licensing must be complete before enabling the API.

CREATE TABLE IF NOT EXISTS public.crypto_deposit_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL DEFAULT 'nowpayments',
  provider_payment_id TEXT,
  idempotency_key TEXT NOT NULL,
  fiat_amount NUMERIC(15,2) NOT NULL CHECK (fiat_amount >= 10 AND fiat_amount <= 100000),
  fiat_currency TEXT NOT NULL DEFAULT 'USD' CHECK (fiat_currency ~ '^[A-Z]{3}$'),
  pay_currency TEXT NOT NULL CHECK (pay_currency ~ '^[a-z0-9]{2,20}$'),
  pay_amount NUMERIC(36,18),
  actually_paid NUMERIC(36,18) NOT NULL DEFAULT 0,
  pay_address TEXT,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'creating' CHECK (status IN (
    'creating','waiting','confirming','partially_paid','completed',
    'expired','failed','refunded'
  )),
  expires_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  wallet_transaction_id UUID REFERENCES public.wallet_transactions(id),
  reversal_transaction_id UUID REFERENCES public.wallet_transactions(id),
  provider_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, idempotency_key),
  UNIQUE (provider, provider_payment_id)
);

CREATE INDEX IF NOT EXISTS crypto_deposit_user_created_idx
  ON public.crypto_deposit_invoices(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS crypto_deposit_status_idx
  ON public.crypto_deposit_invoices(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.crypto_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_key TEXT NOT NULL,
  provider_payment_id TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
  payload_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, event_key)
);

ALTER TABLE public.crypto_deposit_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crypto_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_crypto_deposits" ON public.crypto_deposit_invoices
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "finance_read_crypto_deposits" ON public.crypto_deposit_invoices
  FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['finance']));
CREATE POLICY "finance_read_crypto_webhooks" ON public.crypto_webhook_events
  FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['finance']));

REVOKE INSERT, UPDATE, DELETE ON public.crypto_deposit_invoices FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.crypto_webhook_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_crypto_deposit_update(
  p_provider TEXT,
  p_event_key TEXT,
  p_provider_payment_id TEXT,
  p_invoice_id UUID,
  p_payment_status TEXT,
  p_price_amount NUMERIC,
  p_price_currency TEXT,
  p_pay_currency TEXT,
  p_pay_amount NUMERIC,
  p_actually_paid NUMERIC,
  p_tx_hash TEXT,
  p_payload_hash TEXT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_invoice public.crypto_deposit_invoices%ROWTYPE;
  v_balance NUMERIC(15,2);
  v_deposit_limit NUMERIC(15,2);
  v_month_deposits NUMERIC(15,2);
  v_transaction UUID;
  v_status TEXT;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Service authorization required';
  END IF;
  IF p_provider <> 'nowpayments' OR p_event_key IS NULL OR p_provider_payment_id IS NULL THEN
    RAISE EXCEPTION 'Invalid provider event';
  END IF;

  INSERT INTO public.crypto_webhook_events (
    provider,event_key,provider_payment_id,payment_status,
    signature_verified,payload_hash,payload
  ) VALUES (
    p_provider,p_event_key,p_provider_payment_id,p_payment_status,
    TRUE,p_payload_hash,p_payload
  ) ON CONFLICT (provider,event_key) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',TRUE,'duplicate',TRUE);
  END IF;

  SELECT * INTO v_invoice
  FROM public.crypto_deposit_invoices
  WHERE id=p_invoice_id AND provider=p_provider
    AND provider_payment_id=p_provider_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Deposit invoice not found'; END IF;
  IF upper(p_price_currency) <> v_invoice.fiat_currency
     OR ABS(p_price_amount-v_invoice.fiat_amount) > 0.01
     OR lower(p_pay_currency) <> v_invoice.pay_currency THEN
    RAISE EXCEPTION 'Provider payment does not match the deposit invoice';
  END IF;

  v_status := CASE lower(p_payment_status)
    WHEN 'waiting' THEN 'waiting'
    WHEN 'confirming' THEN 'confirming'
    WHEN 'confirmed' THEN 'confirming'
    WHEN 'partially_paid' THEN 'partially_paid'
    WHEN 'finished' THEN 'completed'
    WHEN 'expired' THEN 'expired'
    WHEN 'failed' THEN 'failed'
    WHEN 'refunded' THEN 'refunded'
    ELSE NULL
  END;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Unsupported payment status'; END IF;

  IF v_status='completed' AND v_invoice.wallet_transaction_id IS NULL THEN
    IF COALESCE(p_actually_paid,0) + 0.000000000000000001 < COALESCE(v_invoice.pay_amount,p_pay_amount) THEN
      RAISE EXCEPTION 'Provider marked an underpaid invoice as finished';
    END IF;

    SELECT COALESCE(demo_balance,0),deposit_limit INTO v_balance,v_deposit_limit
    FROM public.profiles
    WHERE id=v_invoice.user_id
      AND kyc_status='approved'
      AND COALESCE(is_suspended,FALSE)=FALSE
      AND (self_exclusion_until IS NULL OR self_exclusion_until <= NOW())
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Account is not eligible for deposits'; END IF;

    SELECT COALESCE(SUM(fiat_amount),0) INTO v_month_deposits
    FROM public.crypto_deposit_invoices
    WHERE user_id=v_invoice.user_id AND status='completed'
      AND completed_at>=date_trunc('month',NOW());
    IF v_deposit_limit IS NOT NULL AND v_month_deposits+v_invoice.fiat_amount>v_deposit_limit THEN
      RAISE EXCEPTION 'Monthly deposit limit would be exceeded';
    END IF;

    UPDATE public.profiles
    SET demo_balance=v_balance+v_invoice.fiat_amount,updated_at=NOW()
    WHERE id=v_invoice.user_id;

    INSERT INTO public.wallet_transactions(
      user_id,type,amount,balance_before,balance_after,description,
      reference_id,status,metadata
    ) VALUES (
      v_invoice.user_id,'deposit',v_invoice.fiat_amount,v_balance,
      v_balance+v_invoice.fiat_amount,'Verified crypto deposit',v_invoice.id,
      'completed',jsonb_build_object('provider',p_provider,'asset',p_pay_currency,'provider_payment_id',p_provider_payment_id,'tx_hash',p_tx_hash)
    ) RETURNING id INTO v_transaction;

    UPDATE public.crypto_deposit_invoices
    SET status='completed',actually_paid=COALESCE(p_actually_paid,0),
        pay_amount=COALESCE(pay_amount,p_pay_amount),tx_hash=NULLIF(p_tx_hash,''),
        wallet_transaction_id=v_transaction,completed_at=NOW(),
        provider_payload=p_payload,updated_at=NOW()
    WHERE id=v_invoice.id;
  ELSIF v_status='refunded' AND v_invoice.wallet_transaction_id IS NOT NULL
        AND v_invoice.reversal_transaction_id IS NULL THEN
    SELECT COALESCE(demo_balance,0) INTO v_balance
    FROM public.profiles WHERE id=v_invoice.user_id FOR UPDATE;
    UPDATE public.profiles
    SET demo_balance=v_balance-v_invoice.fiat_amount,updated_at=NOW()
    WHERE id=v_invoice.user_id;
    INSERT INTO public.wallet_transactions(
      user_id,type,amount,balance_before,balance_after,description,
      reference_id,status,metadata
    ) VALUES (
      v_invoice.user_id,'adjustment',-v_invoice.fiat_amount,v_balance,
      v_balance-v_invoice.fiat_amount,'Crypto deposit refund reversal',
      v_invoice.id,'completed',jsonb_build_object('provider',p_provider,'provider_payment_id',p_provider_payment_id)
    ) RETURNING id INTO v_transaction;
    UPDATE public.crypto_deposit_invoices
    SET status='refunded',reversal_transaction_id=v_transaction,
        refunded_at=NOW(),provider_payload=p_payload,updated_at=NOW()
    WHERE id=v_invoice.id;
  ELSIF v_invoice.status NOT IN ('completed','refunded') THEN
    UPDATE public.crypto_deposit_invoices
    SET status=v_status,actually_paid=COALESCE(p_actually_paid,actually_paid),
        pay_amount=COALESCE(pay_amount,p_pay_amount),tx_hash=COALESCE(NULLIF(p_tx_hash,''),tx_hash),
        provider_payload=p_payload,updated_at=NOW()
    WHERE id=v_invoice.id;
  END IF;

  RETURN jsonb_build_object('success',TRUE,'duplicate',FALSE,'status',v_status,'invoiceId',v_invoice.id);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_crypto_deposit_update(TEXT,TEXT,TEXT,UUID,TEXT,NUMERIC,TEXT,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_crypto_deposit_update(TEXT,TEXT,TEXT,UUID,TEXT,NUMERIC,TEXT,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,JSONB) TO service_role;

CREATE TABLE IF NOT EXISTS public.brokers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE RESTRICT,
  company_name TEXT NOT NULL CHECK (length(trim(company_name)) BETWEEN 2 AND 120),
  broker_code TEXT NOT NULL UNIQUE CHECK (broker_code ~ '^[A-Z0-9]{6,16}$'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected','suspended')),
  commission_bps INTEGER NOT NULL DEFAULT 1500 CHECK (commission_bps BETWEEN 0 AND 5000),
  settlement_model TEXT NOT NULL DEFAULT 'revenue_share' CHECK (settlement_model IN ('revenue_share','turnover')),
  notes TEXT,
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.broker_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id UUID NOT NULL REFERENCES public.brokers(id) ON DELETE RESTRICT,
  player_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE RESTRICT,
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attribution_source TEXT NOT NULL DEFAULT 'broker_code',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (attribution_source IN ('broker_code','admin','campaign'))
);

CREATE TABLE IF NOT EXISTS public.broker_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id UUID NOT NULL REFERENCES public.brokers(id) ON DELETE RESTRICT,
  player_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  bet_id UUID NOT NULL UNIQUE REFERENCES public.bets(id) ON DELETE RESTRICT,
  gross_revenue NUMERIC(15,2) NOT NULL,
  commission_bps INTEGER NOT NULL,
  commission_amount NUMERIC(15,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'accrued' CHECK (status IN ('accrued','approved','paid','reversed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.broker_payout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id UUID NOT NULL REFERENCES public.brokers(id) ON DELETE RESTRICT,
  amount NUMERIC(15,2) NOT NULL CHECK (amount >= 100),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','rejected')),
  destination_reference TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS broker_players_broker_idx ON public.broker_players(broker_id,is_active);
CREATE INDEX IF NOT EXISTS broker_commissions_broker_idx ON public.broker_commissions(broker_id,created_at DESC);
CREATE INDEX IF NOT EXISTS broker_payout_status_idx ON public.broker_payout_requests(status,requested_at);

ALTER TABLE public.brokers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broker_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broker_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broker_payout_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brokers_read_own_record" ON public.brokers
  FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY "brokers_read_own_players" ON public.broker_players
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.brokers b WHERE b.id=broker_id AND b.user_id=auth.uid()));
CREATE POLICY "players_read_own_broker" ON public.broker_players
  FOR SELECT TO authenticated USING (player_id=auth.uid());
CREATE POLICY "brokers_read_own_commissions" ON public.broker_commissions
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.brokers b WHERE b.id=broker_id AND b.user_id=auth.uid()));
CREATE POLICY "brokers_read_own_payouts" ON public.broker_payout_requests
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.brokers b WHERE b.id=broker_id AND b.user_id=auth.uid()));
CREATE POLICY "finance_manage_brokers" ON public.brokers
  FOR ALL TO authenticated USING (public.has_admin_role(ARRAY['finance'])) WITH CHECK (public.has_admin_role(ARRAY['finance']));
CREATE POLICY "finance_read_broker_players" ON public.broker_players
  FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['finance']));
CREATE POLICY "finance_manage_broker_commissions" ON public.broker_commissions
  FOR ALL TO authenticated USING (public.has_admin_role(ARRAY['finance'])) WITH CHECK (public.has_admin_role(ARRAY['finance']));
CREATE POLICY "finance_manage_broker_payouts" ON public.broker_payout_requests
  FOR ALL TO authenticated USING (public.has_admin_role(ARRAY['finance'])) WITH CHECK (public.has_admin_role(ARRAY['finance']));

REVOKE INSERT,UPDATE,DELETE ON public.brokers FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.broker_players FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.broker_commissions FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.broker_payout_requests FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.apply_for_broker(p_company_name TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user UUID:=auth.uid(); v_broker public.brokers%ROWTYPE; v_code TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF length(trim(COALESCE(p_company_name,'')))<2 THEN RAISE EXCEPTION 'Company or broker name is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_user AND kyc_status='approved' AND COALESCE(is_suspended,FALSE)=FALSE) THEN
    RAISE EXCEPTION 'Approved KYC is required for broker applications';
  END IF;
  SELECT * INTO v_broker FROM public.brokers WHERE user_id=v_user;
  IF FOUND THEN RETURN jsonb_build_object('success',TRUE,'brokerId',v_broker.id,'status',v_broker.status,'brokerCode',v_broker.broker_code); END IF;
  LOOP
    v_code:=upper(substr(md5(gen_random_uuid()::TEXT),1,8));
    EXIT WHEN NOT EXISTS(SELECT 1 FROM public.brokers WHERE broker_code=v_code);
  END LOOP;
  INSERT INTO public.brokers(user_id,company_name,broker_code)
  VALUES(v_user,trim(p_company_name),v_code) RETURNING * INTO v_broker;
  RETURN jsonb_build_object('success',TRUE,'brokerId',v_broker.id,'status',v_broker.status,'brokerCode',v_broker.broker_code);
END; $$;

CREATE OR REPLACE FUNCTION public.link_my_broker(p_broker_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user UUID:=auth.uid(); v_broker public.brokers%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF EXISTS(SELECT 1 FROM public.bets WHERE user_id=v_user) THEN RAISE EXCEPTION 'A broker can only be linked before the first bet'; END IF;
  IF EXISTS(SELECT 1 FROM public.broker_players WHERE player_id=v_user) THEN RAISE EXCEPTION 'A broker is already linked'; END IF;
  SELECT * INTO v_broker FROM public.brokers WHERE broker_code=upper(trim(p_broker_code)) AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Active broker code not found'; END IF;
  IF v_broker.user_id=v_user THEN RAISE EXCEPTION 'A broker cannot refer their own account'; END IF;
  INSERT INTO public.broker_players(broker_id,player_id) VALUES(v_broker.id,v_user);
  RETURN jsonb_build_object('success',TRUE,'broker',v_broker.company_name);
END; $$;

CREATE OR REPLACE FUNCTION public.accrue_broker_commission()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_link public.broker_players%ROWTYPE; v_broker public.brokers%ROWTYPE; v_ggr NUMERIC; v_commission NUMERIC;
BEGIN
  IF OLD.status='pending' AND NEW.status IN('won','lost','cashout') THEN
    SELECT * INTO v_link FROM public.broker_players WHERE player_id=NEW.user_id AND is_active=TRUE;
    IF FOUND THEN
      SELECT * INTO v_broker FROM public.brokers WHERE id=v_link.broker_id AND status='active';
      IF FOUND THEN
        v_ggr:=ROUND(NEW.stake-COALESCE(NEW.payout,0),2);
        v_commission:=CASE WHEN v_broker.settlement_model='turnover' THEN ROUND(NEW.stake*v_broker.commission_bps/10000.0,2) ELSE ROUND(v_ggr*v_broker.commission_bps/10000.0,2) END;
        INSERT INTO public.broker_commissions(broker_id,player_id,bet_id,gross_revenue,commission_bps,commission_amount)
        VALUES(v_broker.id,NEW.user_id,NEW.id,v_ggr,v_broker.commission_bps,v_commission)
        ON CONFLICT(bet_id) DO NOTHING;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS accrue_broker_commission_trigger ON public.bets;
CREATE TRIGGER accrue_broker_commission_trigger AFTER UPDATE OF status,payout ON public.bets
FOR EACH ROW EXECUTE FUNCTION public.accrue_broker_commission();

CREATE OR REPLACE FUNCTION public.get_my_broker_dashboard()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH mine AS (SELECT * FROM public.brokers WHERE user_id=auth.uid()),
  totals AS (
    SELECT COUNT(DISTINCT bp.player_id) AS players,
      COALESCE(SUM(bc.gross_revenue),0) AS gross_revenue,
      COALESCE(SUM(bc.commission_amount) FILTER(WHERE bc.status IN('accrued','approved')),0) AS commission_available,
      COALESCE(SUM(bc.commission_amount) FILTER(WHERE bc.status='paid'),0) AS commission_paid
    FROM mine m LEFT JOIN public.broker_players bp ON bp.broker_id=m.id AND bp.is_active=TRUE
    LEFT JOIN public.broker_commissions bc ON bc.broker_id=m.id
  )
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM mine) THEN NULL ELSE jsonb_build_object(
    'id',(SELECT id FROM mine),'companyName',(SELECT company_name FROM mine),
    'brokerCode',(SELECT broker_code FROM mine),'status',(SELECT status FROM mine),
    'commissionBps',(SELECT commission_bps FROM mine),'players',totals.players,
    'grossRevenue',totals.gross_revenue,'commissionAvailable',totals.commission_available,
    'commissionPaid',totals.commission_paid) END FROM totals;
$$;

CREATE OR REPLACE FUNCTION public.request_broker_payout(p_amount NUMERIC,p_destination_reference TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user UUID:=auth.uid(); v_broker public.brokers%ROWTYPE; v_available NUMERIC; v_reserved NUMERIC; v_id UUID;
BEGIN
  SELECT * INTO v_broker FROM public.brokers WHERE user_id=v_user AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active broker account required'; END IF;
  IF p_amount<100 THEN RAISE EXCEPTION 'Minimum broker payout is 100'; END IF;
  SELECT COALESCE(SUM(commission_amount),0) INTO v_available FROM public.broker_commissions WHERE broker_id=v_broker.id AND status IN('accrued','approved');
  SELECT COALESCE(SUM(amount),0) INTO v_reserved FROM public.broker_payout_requests WHERE broker_id=v_broker.id AND status IN('pending','approved');
  IF p_amount>v_available-v_reserved THEN RAISE EXCEPTION 'Payout amount exceeds available commission'; END IF;
  INSERT INTO public.broker_payout_requests(broker_id,amount,destination_reference)
  VALUES(v_broker.id,p_amount,NULLIF(trim(p_destination_reference),'')) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.review_broker_application(p_broker_id UUID,p_status TEXT,p_commission_bps INTEGER,p_notes TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_admin_role(ARRAY['finance']) THEN RAISE EXCEPTION 'Finance authorization required'; END IF;
  IF p_status NOT IN('active','rejected','suspended') OR p_commission_bps<0 OR p_commission_bps>5000 THEN RAISE EXCEPTION 'Invalid broker review'; END IF;
  UPDATE public.brokers SET status=p_status,commission_bps=p_commission_bps,notes=NULLIF(trim(p_notes),''),reviewed_by=auth.uid(),reviewed_at=NOW(),updated_at=NOW() WHERE id=p_broker_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Broker not found'; END IF;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes)
  VALUES(auth.uid(),'broker_review','broker',p_broker_id,jsonb_build_object('status',p_status,'commission_bps',p_commission_bps,'notes',p_notes));
END; $$;

REVOKE ALL ON FUNCTION public.apply_for_broker(TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.apply_for_broker(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.link_my_broker(TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_my_broker(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.accrue_broker_commission() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_my_broker_dashboard() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_broker_dashboard() TO authenticated;
REVOKE ALL ON FUNCTION public.request_broker_payout(NUMERIC,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_broker_payout(NUMERIC,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.review_broker_application(UUID,TEXT,INTEGER,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_broker_application(UUID,TEXT,INTEGER,TEXT) TO authenticated;

-- END MIGRATION: 20261020130000_crypto_deposits_and_brokers.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261020140000_broker_payout_operations.sql
-- ============================================================================

-- Complete the broker payout lifecycle and close the double-payout gap.

ALTER TABLE public.broker_payout_requests
  ADD COLUMN IF NOT EXISTS payment_reference TEXT;

CREATE OR REPLACE FUNCTION public.get_my_broker_dashboard()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH mine AS (SELECT * FROM public.brokers WHERE user_id=auth.uid()),
  commission_totals AS (
    SELECT COALESCE(SUM(bc.gross_revenue),0) AS gross_revenue,
      COALESCE(SUM(bc.commission_amount) FILTER(WHERE bc.status IN('accrued','approved','paid')),0) AS commission_earned
    FROM mine m LEFT JOIN public.broker_commissions bc ON bc.broker_id=m.id
  ),
  player_totals AS (
    SELECT COUNT(*) FILTER (WHERE bp.is_active) AS players
    FROM mine m LEFT JOIN public.broker_players bp ON bp.broker_id=m.id
  ),
  payout_totals AS (
    SELECT
      COALESCE(SUM(pr.amount) FILTER(WHERE pr.status IN('pending','approved')),0) AS commission_reserved,
      COALESCE(SUM(pr.amount) FILTER(WHERE pr.status='paid'),0) AS commission_paid
    FROM mine m LEFT JOIN public.broker_payout_requests pr ON pr.broker_id=m.id
  )
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM mine) THEN NULL ELSE jsonb_build_object(
    'id',(SELECT id FROM mine),'companyName',(SELECT company_name FROM mine),
    'brokerCode',(SELECT broker_code FROM mine),'status',(SELECT status FROM mine),
    'commissionBps',(SELECT commission_bps FROM mine),'players',player_totals.players,
    'grossRevenue',commission_totals.gross_revenue,
    'commissionAvailable',GREATEST(commission_totals.commission_earned-payout_totals.commission_reserved-payout_totals.commission_paid,0),
    'commissionReserved',payout_totals.commission_reserved,
    'commissionPaid',payout_totals.commission_paid) END
  FROM commission_totals,player_totals,payout_totals;
$$;

CREATE OR REPLACE FUNCTION public.request_broker_payout(p_amount NUMERIC,p_destination_reference TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user UUID:=auth.uid(); v_broker public.brokers%ROWTYPE; v_earned NUMERIC; v_committed NUMERIC; v_id UUID;
BEGIN
  SELECT * INTO v_broker FROM public.brokers WHERE user_id=v_user AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active broker account required'; END IF;
  IF p_amount<100 THEN RAISE EXCEPTION 'Minimum broker payout is 100'; END IF;
  IF length(trim(COALESCE(p_destination_reference,'')))<3 THEN RAISE EXCEPTION 'Approved payout destination is required'; END IF;
  SELECT COALESCE(SUM(commission_amount),0) INTO v_earned
  FROM public.broker_commissions WHERE broker_id=v_broker.id AND status IN('accrued','approved','paid');
  SELECT COALESCE(SUM(amount),0) INTO v_committed
  FROM public.broker_payout_requests WHERE broker_id=v_broker.id AND status IN('pending','approved','paid');
  IF p_amount>v_earned-v_committed THEN RAISE EXCEPTION 'Payout amount exceeds available commission'; END IF;
  INSERT INTO public.broker_payout_requests(broker_id,amount,destination_reference)
  VALUES(v_broker.id,p_amount,trim(p_destination_reference)) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.review_broker_payout(
  p_request_id UUID,
  p_status TEXT,
  p_payment_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request public.broker_payout_requests%ROWTYPE;
BEGIN
  IF NOT public.has_admin_role(ARRAY['finance']) THEN RAISE EXCEPTION 'Finance authorization required'; END IF;
  IF COALESCE(auth.jwt()->>'aal','aal1') <> 'aal2' THEN RAISE EXCEPTION 'Two-factor verification required'; END IF;
  IF p_status NOT IN('approved','paid','rejected') THEN RAISE EXCEPTION 'Invalid payout review status'; END IF;
  SELECT * INTO v_request FROM public.broker_payout_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payout request not found'; END IF;
  IF v_request.status='pending' AND p_status NOT IN('approved','rejected') THEN RAISE EXCEPTION 'Pending payout must be approved before payment'; END IF;
  IF v_request.status='approved' AND p_status<>'paid' THEN RAISE EXCEPTION 'Approved payout can only be marked paid'; END IF;
  IF v_request.status IN('paid','rejected') THEN RAISE EXCEPTION 'Final payout decision cannot be changed'; END IF;
  IF p_status='paid' AND length(trim(COALESCE(p_payment_reference,'')))<3 THEN RAISE EXCEPTION 'Payment reference is required'; END IF;
  UPDATE public.broker_payout_requests
  SET status=p_status,reviewed_by=auth.uid(),reviewed_at=NOW(),
      paid_at=CASE WHEN p_status='paid' THEN NOW() ELSE paid_at END,
      payment_reference=CASE WHEN p_status='paid' THEN trim(p_payment_reference) ELSE payment_reference END,
      notes=NULLIF(trim(p_notes),'')
  WHERE id=p_request_id;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes)
  VALUES(auth.uid(),'broker_payout_review','broker_payout',p_request_id,
    jsonb_build_object('previous_status',v_request.status,'status',p_status,'payment_reference',p_payment_reference,'notes',p_notes));
END; $$;

REVOKE ALL ON FUNCTION public.get_my_broker_dashboard() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_broker_dashboard() TO authenticated;
REVOKE ALL ON FUNCTION public.request_broker_payout(NUMERIC,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_broker_payout(NUMERIC,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.review_broker_payout(UUID,TEXT,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_broker_payout(UUID,TEXT,TEXT,TEXT) TO authenticated;

-- END MIGRATION: 20261020140000_broker_payout_operations.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261020150000_payment_method_management.sql
-- ============================================================================

-- Admin-managed payment methods and review-only manual deposits.
-- Provider secrets remain server environment variables and are never stored here.

CREATE TABLE IF NOT EXISTS public.payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_]{2,40}$'),
  method_type TEXT NOT NULL CHECK (method_type IN ('provider','manual_crypto','bank','ewallet')),
  provider_code TEXT,
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z0-9]{2,12}$'),
  network TEXT,
  destination_reference TEXT,
  instructions TEXT,
  min_amount NUMERIC(15,2) NOT NULL DEFAULT 10 CHECK (min_amount >= 0),
  max_amount NUMERIC(15,2) NOT NULL DEFAULT 100000 CHECK (max_amount >= min_amount),
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INTEGER NOT NULL DEFAULT 100 CHECK (display_order BETWEEN 0 AND 10000),
  created_by UUID REFERENCES public.profiles(id),
  updated_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CHECK (method_type = 'provider' OR length(trim(COALESCE(destination_reference,''))) >= 3)
);

CREATE TABLE IF NOT EXISTS public.manual_deposit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  payment_method_id UUID NOT NULL REFERENCES public.payment_methods(id) ON DELETE RESTRICT,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  transaction_reference TEXT NOT NULL CHECK (length(trim(transaction_reference)) BETWEEN 4 AND 180),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  user_note TEXT,
  review_note TEXT,
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  wallet_transaction_id UUID REFERENCES public.wallet_transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS manual_deposit_reference_unique
  ON public.manual_deposit_requests(payment_method_id, lower(transaction_reference));
CREATE INDEX IF NOT EXISTS manual_deposit_user_created_idx
  ON public.manual_deposit_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS manual_deposit_review_queue_idx
  ON public.manual_deposit_requests(status, created_at);
CREATE INDEX IF NOT EXISTS payment_methods_active_order_idx
  ON public.payment_methods(is_enabled, display_order) WHERE archived_at IS NULL;

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_deposit_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_enabled_payment_methods" ON public.payment_methods
  FOR SELECT TO authenticated
  USING ((is_enabled=TRUE AND archived_at IS NULL) OR public.has_admin_role(ARRAY['finance']));
CREATE POLICY "users_read_own_manual_deposits" ON public.manual_deposit_requests
  FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY "finance_read_manual_deposits" ON public.manual_deposit_requests
  FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['finance']));

REVOKE INSERT,UPDATE,DELETE ON public.payment_methods FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.manual_deposit_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.payment_methods TO authenticated;
GRANT SELECT ON public.manual_deposit_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.save_payment_method(
  p_id UUID,
  p_name TEXT,
  p_code TEXT,
  p_method_type TEXT,
  p_provider_code TEXT,
  p_currency TEXT,
  p_network TEXT,
  p_destination_reference TEXT,
  p_instructions TEXT,
  p_min_amount NUMERIC,
  p_max_amount NUMERIC,
  p_is_enabled BOOLEAN,
  p_display_order INTEGER
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID; v_previous JSONB;
BEGIN
  IF NOT public.has_admin_role(ARRAY['finance']) THEN RAISE EXCEPTION 'Finance authorization required'; END IF;
  IF COALESCE(auth.jwt()->>'aal','aal1') <> 'aal2' THEN RAISE EXCEPTION 'Two-factor verification required'; END IF;
  IF p_method_type NOT IN ('provider','manual_crypto','bank','ewallet') THEN RAISE EXCEPTION 'Invalid payment method type'; END IF;
  IF p_min_amount<0 OR p_max_amount<p_min_amount THEN RAISE EXCEPTION 'Invalid payment limits'; END IF;
  IF p_method_type<>'provider' AND length(trim(COALESCE(p_destination_reference,'')))<3 THEN RAISE EXCEPTION 'Destination details are required'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.payment_methods(
      name,code,method_type,provider_code,currency,network,destination_reference,
      instructions,min_amount,max_amount,is_enabled,display_order,created_by,updated_by
    ) VALUES (
      trim(p_name),lower(trim(p_code)),p_method_type,NULLIF(lower(trim(COALESCE(p_provider_code,''))),''),
      upper(trim(p_currency)),NULLIF(trim(COALESCE(p_network,'')),''),NULLIF(trim(COALESCE(p_destination_reference,'')),''),
      NULLIF(trim(COALESCE(p_instructions,'')),''),p_min_amount,p_max_amount,p_is_enabled,p_display_order,auth.uid(),auth.uid()
    ) RETURNING id INTO v_id;
  ELSE
    SELECT to_jsonb(pm) INTO v_previous FROM public.payment_methods pm WHERE id=p_id AND archived_at IS NULL FOR UPDATE;
    IF v_previous IS NULL THEN RAISE EXCEPTION 'Payment method not found'; END IF;
    UPDATE public.payment_methods SET
      name=trim(p_name),code=lower(trim(p_code)),method_type=p_method_type,
      provider_code=NULLIF(lower(trim(COALESCE(p_provider_code,''))),''),currency=upper(trim(p_currency)),
      network=NULLIF(trim(COALESCE(p_network,'')),''),destination_reference=NULLIF(trim(COALESCE(p_destination_reference,'')),''),
      instructions=NULLIF(trim(COALESCE(p_instructions,'')),''),min_amount=p_min_amount,max_amount=p_max_amount,
      is_enabled=p_is_enabled,display_order=p_display_order,updated_by=auth.uid(),updated_at=NOW()
    WHERE id=p_id RETURNING id INTO v_id;
  END IF;

  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes)
  VALUES(auth.uid(),CASE WHEN p_id IS NULL THEN 'payment_method_create' ELSE 'payment_method_update' END,
    'payment_method',v_id,jsonb_build_object('previous',v_previous,'name',p_name,'code',p_code,'enabled',p_is_enabled));
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.archive_payment_method(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_method public.payment_methods%ROWTYPE;
BEGIN
  IF NOT public.has_admin_role(ARRAY['finance']) THEN RAISE EXCEPTION 'Finance authorization required'; END IF;
  IF COALESCE(auth.jwt()->>'aal','aal1') <> 'aal2' THEN RAISE EXCEPTION 'Two-factor verification required'; END IF;
  SELECT * INTO v_method FROM public.payment_methods WHERE id=p_id AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment method not found'; END IF;
  UPDATE public.payment_methods SET is_enabled=FALSE,archived_at=NOW(),updated_by=auth.uid(),updated_at=NOW() WHERE id=p_id;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes)
  VALUES(auth.uid(),'payment_method_archive','payment_method',p_id,to_jsonb(v_method));
END; $$;

CREATE OR REPLACE FUNCTION public.submit_manual_deposit_request(
  p_payment_method_id UUID,
  p_amount NUMERIC,
  p_transaction_reference TEXT,
  p_user_note TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user UUID:=auth.uid(); v_method public.payment_methods%ROWTYPE; v_id UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_method FROM public.payment_methods
  WHERE id=p_payment_method_id AND is_enabled=TRUE AND archived_at IS NULL AND method_type<>'provider';
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment method is unavailable'; END IF;
  IF p_amount<v_method.min_amount OR p_amount>v_method.max_amount THEN RAISE EXCEPTION 'Amount is outside the allowed limits'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_user AND kyc_status='approved' AND COALESCE(is_suspended,FALSE)=FALSE AND (self_exclusion_until IS NULL OR self_exclusion_until<=NOW())) THEN
    RAISE EXCEPTION 'Approved KYC and an active account are required';
  END IF;
  INSERT INTO public.manual_deposit_requests(user_id,payment_method_id,amount,transaction_reference,user_note)
  VALUES(v_user,p_payment_method_id,p_amount,trim(p_transaction_reference),NULLIF(trim(COALESCE(p_user_note,'')),''))
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This transaction reference has already been submitted';
END; $$;

CREATE OR REPLACE FUNCTION public.review_manual_deposit_request(
  p_request_id UUID,
  p_status TEXT,
  p_review_note TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request public.manual_deposit_requests%ROWTYPE; v_balance NUMERIC(15,2); v_limit NUMERIC(15,2); v_month_total NUMERIC(15,2); v_tx UUID;
BEGIN
  IF NOT public.has_admin_role(ARRAY['finance']) THEN RAISE EXCEPTION 'Finance authorization required'; END IF;
  IF COALESCE(auth.jwt()->>'aal','aal1') <> 'aal2' THEN RAISE EXCEPTION 'Two-factor verification required'; END IF;
  IF p_status NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Invalid review status'; END IF;
  SELECT * INTO v_request FROM public.manual_deposit_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deposit request not found'; END IF;
  IF v_request.status<>'pending' THEN RAISE EXCEPTION 'Deposit request has already been reviewed'; END IF;

  IF p_status='approved' THEN
    SELECT COALESCE(demo_balance,0),deposit_limit INTO v_balance,v_limit FROM public.profiles
    WHERE id=v_request.user_id AND kyc_status='approved' AND COALESCE(is_suspended,FALSE)=FALSE
      AND (self_exclusion_until IS NULL OR self_exclusion_until<=NOW()) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Account is not eligible for deposits'; END IF;
    SELECT COALESCE((SELECT SUM(fiat_amount) FROM public.crypto_deposit_invoices WHERE user_id=v_request.user_id AND status='completed' AND completed_at>=date_trunc('month',NOW())),0)
      + COALESCE((SELECT SUM(amount) FROM public.manual_deposit_requests WHERE user_id=v_request.user_id AND status='approved' AND reviewed_at>=date_trunc('month',NOW())),0)
      INTO v_month_total;
    IF v_limit IS NOT NULL AND v_month_total+v_request.amount>v_limit THEN RAISE EXCEPTION 'Monthly deposit limit would be exceeded'; END IF;
    UPDATE public.profiles SET demo_balance=v_balance+v_request.amount,updated_at=NOW() WHERE id=v_request.user_id;
    INSERT INTO public.wallet_transactions(user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata)
    VALUES(v_request.user_id,'deposit',v_request.amount,v_balance,v_balance+v_request.amount,'Approved manual deposit',v_request.id,'completed',
      jsonb_build_object('payment_method_id',v_request.payment_method_id,'transaction_reference',v_request.transaction_reference)) RETURNING id INTO v_tx;
  END IF;

  UPDATE public.manual_deposit_requests SET status=p_status,review_note=NULLIF(trim(COALESCE(p_review_note,'')),''),
    reviewed_by=auth.uid(),reviewed_at=NOW(),wallet_transaction_id=v_tx,updated_at=NOW() WHERE id=p_request_id;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes)
  VALUES(auth.uid(),'manual_deposit_review','manual_deposit',p_request_id,jsonb_build_object('status',p_status,'note',p_review_note));
END; $$;

REVOKE ALL ON FUNCTION public.save_payment_method(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,BOOLEAN,INTEGER) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_payment_method(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,BOOLEAN,INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.archive_payment_method(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.archive_payment_method(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.submit_manual_deposit_request(UUID,NUMERIC,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_manual_deposit_request(UUID,NUMERIC,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.review_manual_deposit_request(UUID,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_manual_deposit_request(UUID,TEXT,TEXT) TO authenticated;

INSERT INTO public.payment_methods(name,code,method_type,provider_code,currency,network,instructions,min_amount,max_amount,is_enabled,display_order)
VALUES('NOWPayments Crypto','nowpayments','provider','nowpayments','USD',NULL,'Automatic invoice and signed callback processing.',10,100000,FALSE,10)
ON CONFLICT(code) DO NOTHING;

-- END MIGRATION: 20261020150000_payment_method_management.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261020160000_sports_provider_management.sql
-- ============================================================================

-- Server-managed sports data providers. API credentials are encrypted by the
-- application before they reach this table and are never exposed by RLS.

CREATE TABLE IF NOT EXISTS public.sports_feed_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 100),
  provider_type TEXT NOT NULL CHECK (provider_type IN (
    'thesportsdb_demo',
    'thesportsdb_live',
    'sportmonks'
  )),
  encrypted_api_key TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::JSONB,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  priority INTEGER NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 1000),
  sync_interval_seconds INTEGER NOT NULL DEFAULT 10 CHECK (sync_interval_seconds BETWEEN 5 AND 3600),
  status TEXT NOT NULL DEFAULT 'not_tested' CHECK (status IN ('not_tested', 'healthy', 'degraded', 'error', 'disabled')),
  last_sync_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  last_event_count INTEGER NOT NULL DEFAULT 0 CHECK (last_event_count >= 0),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sports_feed_providers_enabled_priority
  ON public.sports_feed_providers (is_enabled, priority);

ALTER TABLE public.sports_feed_providers ENABLE ROW LEVEL SECURITY;

-- Provider configuration, especially encrypted credentials, is intentionally
-- service-role only. Admin access goes through authenticated API routes.
REVOKE ALL ON public.sports_feed_providers FROM anon, authenticated;

INSERT INTO public.sports_feed_providers (
  name,
  provider_type,
  settings,
  is_enabled,
  is_demo,
  priority,
  sync_interval_seconds,
  status
)
SELECT
  'TheSportsDB Demo Schedule',
  'thesportsdb_demo',
  '{"leagueId":"4328","sport":"Soccer"}'::JSONB,
  TRUE,
  TRUE,
  100,
  300,
  'not_tested'
WHERE NOT EXISTS (
  SELECT 1 FROM public.sports_feed_providers
  WHERE provider_type = 'thesportsdb_demo' AND is_demo = TRUE
);

COMMENT ON TABLE public.sports_feed_providers IS
  'Server-only registry for live score/schedule providers. Secrets are AES-GCM ciphertext.';
COMMENT ON COLUMN public.sports_feed_providers.encrypted_api_key IS
  'AES-256-GCM ciphertext produced with SPORTS_PROVIDER_ENCRYPTION_KEY; never return to clients.';

-- END MIGRATION: 20261020160000_sports_provider_management.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261020161000_openligadb_provider.sql
-- ============================================================================

-- Add a no-key, community live-score provider for safe product previews.
-- OpenLigaDB must not be used as a certified betting settlement source.

ALTER TABLE public.sports_feed_providers
  DROP CONSTRAINT IF EXISTS sports_feed_providers_provider_type_check;

ALTER TABLE public.sports_feed_providers
  ADD CONSTRAINT sports_feed_providers_provider_type_check
  CHECK (provider_type IN (
    'openligadb',
    'thesportsdb_demo',
    'thesportsdb_live',
    'sportmonks'
  ));

INSERT INTO public.sports_feed_providers (
  name,
  provider_type,
  settings,
  is_enabled,
  is_demo,
  priority,
  sync_interval_seconds,
  status
)
SELECT
  'OpenLigaDB Bundesliga Live Scores',
  'openligadb',
  '{"leagueShortcut":"bl1","sport":"Soccer"}'::JSONB,
  TRUE,
  TRUE,
  50,
  60,
  'not_tested'
WHERE NOT EXISTS (
  SELECT 1 FROM public.sports_feed_providers
  WHERE provider_type = 'openligadb' AND settings->>'leagueShortcut' = 'bl1'
);

-- END MIGRATION: 20261020161000_openligadb_provider.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261024120000_round_robin_system_bets.sql
-- ============================================================================

-- Atomic round-robin system bets (for example 2-from-3 or 3-from-5).
-- Every line is stored separately so partial wins and void legs settle correctly.

CREATE TABLE IF NOT EXISTS public.system_bet_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id UUID NOT NULL REFERENCES public.bets(id) ON DELETE CASCADE,
  combination_size INTEGER NOT NULL CHECK (combination_size BETWEEN 2 AND 10),
  line_stake NUMERIC(15,2) NOT NULL CHECK (line_stake > 0),
  line_odds NUMERIC(15,4) NOT NULL CHECK (line_odds >= 1),
  potential_return NUMERIC(15,2) NOT NULL CHECK (potential_return >= 0),
  result TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('pending','won','lost','void')),
  payout NUMERIC(15,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.system_bet_line_selections (
  line_id UUID NOT NULL REFERENCES public.system_bet_lines(id) ON DELETE CASCADE,
  bet_selection_id UUID NOT NULL REFERENCES public.bet_selections(id) ON DELETE CASCADE,
  PRIMARY KEY(line_id, bet_selection_id)
);

CREATE INDEX IF NOT EXISTS system_bet_lines_bet_idx ON public.system_bet_lines(bet_id);
ALTER TABLE public.system_bet_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_bet_line_selections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_read_own_system_lines" ON public.system_bet_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bets b WHERE b.id=bet_id AND (b.user_id=auth.uid() OR public.is_admin())));
CREATE POLICY "users_read_own_system_line_selections" ON public.system_bet_line_selections FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.system_bet_lines l JOIN public.bets b ON b.id=l.bet_id WHERE l.id=line_id AND (b.user_id=auth.uid() OR public.is_admin())));
GRANT SELECT ON public.system_bet_lines, public.system_bet_line_selections TO authenticated;

CREATE OR REPLACE FUNCTION public.place_system_bet_atomic(
  p_stake NUMERIC,
  p_selections JSONB,
  p_combination_size INTEGER,
  p_idempotency_key TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_user UUID:=auth.uid(); v_balance NUMERIC; v_bet UUID; v_tx UUID;
  v_item JSONB; v_prices JSONB:='[]'::JSONB; v_current NUMERIC; v_name TEXT;
  v_count INTEGER; v_line_count INTEGER; v_line_stake NUMERIC; v_sum_odds NUMERIC;
  v_potential NUMERIC; v_average_odds NUMERIC; v_response JSONB; v_cached JSONB;
  v_combo RECORD; v_line UUID; v_selection_id UUID; v_line_index INTEGER:=0; v_this_line_stake NUMERIC;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key))<8 THEN RAISE EXCEPTION 'A valid idempotency key is required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::TEXT||':'||p_idempotency_key,0));
  SELECT response_data INTO v_cached FROM public.idempotency_keys WHERE user_id=v_user AND key=p_idempotency_key AND expires_at>NOW();
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_stake IS NULL OR p_stake<=0 OR p_stake>100000 THEN RAISE EXCEPTION 'Invalid stake'; END IF;
  IF jsonb_typeof(p_selections)<>'array' THEN RAISE EXCEPTION 'Selections must be an array'; END IF;
  v_count:=jsonb_array_length(p_selections);
  IF v_count<3 OR v_count>10 OR p_combination_size<2 OR p_combination_size>=v_count THEN
    RAISE EXCEPTION 'System bets require 3-10 selections and a valid combination size';
  END IF;
  IF (SELECT COUNT(DISTINCT value->>'event_id') FROM jsonb_array_elements(p_selections))<>v_count THEN
    RAISE EXCEPTION 'A system bet can contain only one selection per event';
  END IF;

  SELECT COALESCE(demo_balance,0) INTO v_balance FROM public.profiles
  WHERE id=v_user AND COALESCE(is_suspended,FALSE)=FALSE AND (self_exclusion_until IS NULL OR self_exclusion_until<=NOW()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account is unavailable or self-excluded'; END IF;
  IF v_balance<p_stake THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_selections) LOOP
    SELECT o.value,o.selection INTO v_current,v_name FROM public.odds o
    JOIN public.markets m ON m.id=o.market_id JOIN public.events e ON e.id=m.event_id
    WHERE o.id=(v_item->>'odds_id')::UUID AND m.id=(v_item->>'market_id')::UUID
      AND e.id=(v_item->>'event_id')::UUID AND o.is_active=TRUE AND COALESCE(o.is_locked,FALSE)=FALSE
      AND m.status='active' AND e.status IN ('upcoming','live') AND COALESCE(e.is_suspended,FALSE)=FALSE FOR SHARE OF o,m,e;
    IF NOT FOUND THEN RAISE EXCEPTION 'A selection is unavailable'; END IF;
    IF v_name IS DISTINCT FROM v_item->>'selection' THEN RAISE EXCEPTION 'Selection does not match current market data'; END IF;
    IF abs(v_current-(v_item->>'odds_value')::NUMERIC)>0.01 THEN RAISE EXCEPTION 'Odds changed. Current odds: %',v_current; END IF;
    v_prices:=v_prices||jsonb_build_array(v_item||jsonb_build_object('accepted_odds',v_current));
  END LOOP;

  WITH RECURSIVE items AS (
    SELECT row_number() OVER()::INTEGER rn,(value->>'accepted_odds')::NUMERIC odds FROM jsonb_array_elements(v_prices)
  ), combos(last_rn,depth,product) AS (
    SELECT rn,1,odds FROM items UNION ALL
    SELECT i.rn,c.depth+1,c.product*i.odds FROM combos c JOIN items i ON i.rn>c.last_rn WHERE c.depth<p_combination_size
  ) SELECT COUNT(*),COALESCE(SUM(product),0) INTO v_line_count,v_sum_odds FROM combos WHERE depth=p_combination_size;
  v_line_stake:=round(p_stake/v_line_count,2);
  IF v_line_stake<=0 THEN RAISE EXCEPTION 'Stake is too small for % system lines',v_line_count; END IF;
  v_potential:=round(v_line_stake*v_sum_odds,2); v_average_odds:=round(v_potential/p_stake,2);

  INSERT INTO public.bets(user_id,type,stake,total_odds,potential_return,status)
  VALUES(v_user,'system',p_stake,v_average_odds,v_potential,'pending') RETURNING id INTO v_bet;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_prices) LOOP
    INSERT INTO public.bet_selections(bet_id,event_id,market_id,odds_id,selection,odds_value,result)
    VALUES(v_bet,(v_item->>'event_id')::UUID,(v_item->>'market_id')::UUID,(v_item->>'odds_id')::UUID,v_item->>'selection',(v_item->>'accepted_odds')::NUMERIC,'pending');
  END LOOP;

  FOR v_combo IN
    WITH RECURSIVE items AS (
      SELECT row_number() OVER(ORDER BY created_at,id)::INTEGER rn,id,odds_value FROM public.bet_selections WHERE bet_id=v_bet
    ), combos(ids,last_rn,depth,product) AS (
      SELECT ARRAY[id],rn,1,odds_value FROM items UNION ALL
      SELECT c.ids||i.id,i.rn,c.depth+1,c.product*i.odds_value FROM combos c JOIN items i ON i.rn>c.last_rn WHERE c.depth<p_combination_size
    ) SELECT ids,product FROM combos WHERE depth=p_combination_size ORDER BY ids
  LOOP
    v_line_index:=v_line_index+1;
    v_this_line_stake:=CASE WHEN v_line_index=1 THEN p_stake-(v_line_stake*(v_line_count-1)) ELSE v_line_stake END;
    INSERT INTO public.system_bet_lines(bet_id,combination_size,line_stake,line_odds,potential_return)
    VALUES(v_bet,p_combination_size,v_this_line_stake,v_combo.product,round(v_this_line_stake*v_combo.product,2)) RETURNING id INTO v_line;
    FOREACH v_selection_id IN ARRAY v_combo.ids LOOP
      INSERT INTO public.system_bet_line_selections(line_id,bet_selection_id) VALUES(v_line,v_selection_id);
    END LOOP;
  END LOOP;

  SELECT COALESCE(SUM(potential_return),0) INTO v_potential FROM public.system_bet_lines WHERE bet_id=v_bet;
  v_average_odds:=round(v_potential/p_stake,2);
  UPDATE public.bets SET total_odds=v_average_odds,potential_return=v_potential WHERE id=v_bet;
  UPDATE public.bet_selections SET result=result WHERE bet_id=v_bet;

  UPDATE public.profiles SET demo_balance=v_balance-p_stake,updated_at=NOW() WHERE id=v_user;
  INSERT INTO public.wallet_transactions(user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata)
  VALUES(v_user,'bet_placed',-p_stake,v_balance,v_balance-p_stake,'System bet placed',v_bet,'completed',jsonb_build_object('combination_size',p_combination_size,'lines',v_line_count)) RETURNING id INTO v_tx;
  UPDATE public.bets SET wallet_transaction_id=v_tx WHERE id=v_bet;
  v_response:=jsonb_build_object('success',TRUE,'result','accepted','bet',jsonb_build_object('id',v_bet,'type','system','stake',p_stake,'totalOdds',v_average_odds,'potentialReturn',v_potential,'status','pending','lineCount',v_line_count,'combinationSize',p_combination_size));
  INSERT INTO public.idempotency_keys(user_id,key,request_data,response_data,expires_at)
  VALUES(v_user,p_idempotency_key,jsonb_build_object('betType','system','stake',p_stake,'selections',p_selections,'combinationSize',p_combination_size),v_response,NOW()+INTERVAL '24 hours');
  RETURN v_response;
END; $$;

CREATE OR REPLACE FUNCTION public.settle_ready_system_bet()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_bet public.bets%ROWTYPE; v_line RECORD; v_payout NUMERIC:=0; v_balance NUMERIC; v_tx UUID; v_won INTEGER:=0; v_void INTEGER:=0;
BEGIN
  SELECT b.* INTO v_bet FROM public.bets b WHERE b.id=NEW.bet_id AND b.type='system' FOR UPDATE;
  IF NOT FOUND OR v_bet.status<>'pending' OR EXISTS(SELECT 1 FROM public.bet_selections WHERE bet_id=v_bet.id AND result='pending') THEN RETURN NEW; END IF;
  FOR v_line IN
    SELECT l.id,l.line_stake,
      bool_or(bs.result='lost') lost,bool_and(bs.result='void') all_void,
      COALESCE(exp(sum(CASE WHEN bs.result='won' THEN ln(bs.odds_value) ELSE 0 END)),1) factor
    FROM public.system_bet_lines l JOIN public.system_bet_line_selections x ON x.line_id=l.id
    JOIN public.bet_selections bs ON bs.id=x.bet_selection_id WHERE l.bet_id=v_bet.id GROUP BY l.id,l.line_stake
  LOOP
    IF v_line.lost THEN UPDATE public.system_bet_lines SET result='lost',payout=0 WHERE id=v_line.id;
    ELSIF v_line.all_void THEN v_payout:=v_payout+v_line.line_stake; v_void:=v_void+1; UPDATE public.system_bet_lines SET result='void',payout=line_stake WHERE id=v_line.id;
    ELSE v_payout:=v_payout+round(v_line.line_stake*v_line.factor,2); v_won:=v_won+1; UPDATE public.system_bet_lines SET result='won',payout=round(line_stake*v_line.factor,2) WHERE id=v_line.id; END IF;
  END LOOP;
  SELECT COALESCE(demo_balance,0) INTO v_balance FROM public.profiles WHERE id=v_bet.user_id FOR UPDATE;
  UPDATE public.profiles SET demo_balance=v_balance+v_payout,updated_at=NOW() WHERE id=v_bet.user_id;
  INSERT INTO public.wallet_transactions(user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata)
  VALUES(v_bet.user_id,CASE WHEN v_won>0 THEN 'bet_won' WHEN v_void>0 THEN 'adjustment' ELSE 'bet_lost' END,v_payout,v_balance,v_balance+v_payout,'System bet settled',v_bet.id,'completed',jsonb_build_object('winning_lines',v_won,'void_lines',v_void)) RETURNING id INTO v_tx;
  UPDATE public.bets SET status=CASE WHEN v_won>0 THEN 'won' WHEN v_void>0 THEN 'void' ELSE 'lost' END,payout=v_payout,settled_at=NOW() WHERE id=v_bet.id;
  INSERT INTO public.settlements(bet_id,settlement_type,original_stake,settlement_amount,settlement_reason,is_manual,wallet_transaction_id)
  VALUES(v_bet.id,CASE WHEN v_won>0 THEN 'win' WHEN v_void>0 THEN 'void' ELSE 'loss' END,v_bet.stake,v_payout,'Automatic system-line settlement',FALSE,v_tx);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS settle_ready_system_bet_trigger ON public.bet_selections;
CREATE TRIGGER settle_ready_system_bet_trigger AFTER UPDATE OF result ON public.bet_selections
FOR EACH ROW WHEN (NEW.result IS DISTINCT FROM OLD.result) EXECUTE FUNCTION public.settle_ready_system_bet();

REVOKE ALL ON FUNCTION public.place_system_bet_atomic(NUMERIC,JSONB,INTEGER,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.place_system_bet_atomic(NUMERIC,JSONB,INTEGER,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.settle_ready_system_bet() FROM PUBLIC,anon,authenticated;

-- END MIGRATION: 20261024120000_round_robin_system_bets.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261024123000_manual_operations_maker_checker.sql
-- ============================================================================

-- Manual finance/KYC operations with maker-checker approval and user notices.

ALTER TABLE public.manual_deposit_requests ADD COLUMN IF NOT EXISTS proof_file_path TEXT;
ALTER TABLE public.manual_deposit_requests ADD COLUMN IF NOT EXISTS risk_score INTEGER NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100);
ALTER TABLE public.manual_deposit_requests DROP CONSTRAINT IF EXISTS manual_deposit_requests_status_check;
ALTER TABLE public.manual_deposit_requests ADD CONSTRAINT manual_deposit_requests_status_check
  CHECK (status IN ('pending','on_hold','awaiting_approval','approved','rejected'));

ALTER TABLE public.kyc_documents ADD COLUMN IF NOT EXISTS admin_note TEXT;
ALTER TABLE public.kyc_documents ADD COLUMN IF NOT EXISTS risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high'));
ALTER TABLE public.kyc_documents ADD COLUMN IF NOT EXISTS source_of_funds_status TEXT NOT NULL DEFAULT 'not_required'
  CHECK (source_of_funds_status IN ('not_required','requested','submitted','approved','rejected'));

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('payment-proofs','payment-proofs',FALSE,5242880,ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
ON CONFLICT(id) DO UPDATE SET public=FALSE,file_size_limit=5242880,allowed_mime_types=EXCLUDED.allowed_mime_types;
CREATE POLICY "users_upload_own_payment_proofs" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='payment-proofs' AND (storage.foldername(name))[1]=auth.uid()::TEXT);
CREATE POLICY "users_read_own_payment_proofs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='payment-proofs' AND ((storage.foldername(name))[1]=auth.uid()::TEXT OR public.has_admin_role(ARRAY['finance'])));

DROP FUNCTION IF EXISTS public.submit_manual_deposit_request(UUID,NUMERIC,TEXT,TEXT);
CREATE OR REPLACE FUNCTION public.submit_manual_deposit_request(
  p_payment_method_id UUID,p_amount NUMERIC,p_transaction_reference TEXT,p_user_note TEXT DEFAULT NULL,p_proof_file_path TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user UUID:=auth.uid(); v_method public.payment_methods%ROWTYPE; v_id UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_method FROM public.payment_methods WHERE id=p_payment_method_id AND is_enabled=TRUE AND archived_at IS NULL AND method_type<>'provider';
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment method is unavailable'; END IF;
  IF p_amount<v_method.min_amount OR p_amount>v_method.max_amount THEN RAISE EXCEPTION 'Amount is outside the allowed limits'; END IF;
  IF p_proof_file_path IS NOT NULL AND split_part(p_proof_file_path,'/',1)<>v_user::TEXT THEN RAISE EXCEPTION 'Invalid proof file path'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_user AND kyc_status='approved' AND COALESCE(is_suspended,FALSE)=FALSE AND (self_exclusion_until IS NULL OR self_exclusion_until<=NOW())) THEN RAISE EXCEPTION 'Approved KYC and an active account are required'; END IF;
  INSERT INTO public.manual_deposit_requests(user_id,payment_method_id,amount,transaction_reference,user_note,proof_file_path,risk_score)
  VALUES(v_user,p_payment_method_id,p_amount,trim(p_transaction_reference),NULLIF(trim(COALESCE(p_user_note,'')),''),p_proof_file_path,
    CASE WHEN p_amount>=5000 THEN 70 WHEN p_amount>=1000 THEN 40 ELSE 10 END) RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'This transaction reference has already been submitted';
END; $$;
REVOKE ALL ON FUNCTION public.submit_manual_deposit_request(UUID,NUMERIC,TEXT,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_manual_deposit_request(UUID,NUMERIC,TEXT,TEXT,TEXT) TO authenticated;

CREATE TABLE IF NOT EXISTS public.admin_approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL CHECK (action_type IN ('manual_deposit','wallet_adjustment','broker_payout','large_withdrawal')),
  entity_id UUID NOT NULL,
  requested_by UUID NOT NULL REFERENCES public.profiles(id),
  request_note TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by UUID REFERENCES public.profiles(id),
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  UNIQUE(action_type,entity_id,status)
);
CREATE INDEX IF NOT EXISTS admin_approval_queue_idx ON public.admin_approval_requests(status,created_at);
ALTER TABLE public.admin_approval_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance_staff_read_approvals" ON public.admin_approval_requests FOR SELECT TO authenticated
  USING (public.has_admin_role(ARRAY['finance']));
GRANT SELECT ON public.admin_approval_requests TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.admin_approval_requests FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.finalize_manual_deposit_approval(p_request_id UUID,p_admin UUID,p_note TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request public.manual_deposit_requests%ROWTYPE; v_balance NUMERIC; v_limit NUMERIC; v_month NUMERIC; v_tx UUID;
BEGIN
  SELECT * INTO v_request FROM public.manual_deposit_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status NOT IN ('pending','awaiting_approval','on_hold') THEN RAISE EXCEPTION 'Deposit request is not reviewable'; END IF;
  SELECT COALESCE(demo_balance,0),deposit_limit INTO v_balance,v_limit FROM public.profiles
    WHERE id=v_request.user_id AND kyc_status='approved' AND COALESCE(is_suspended,FALSE)=FALSE
      AND (self_exclusion_until IS NULL OR self_exclusion_until<=NOW()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account is not eligible for deposits'; END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_month FROM public.manual_deposit_requests
    WHERE user_id=v_request.user_id AND status='approved' AND reviewed_at>=date_trunc('month',NOW());
  IF v_limit IS NOT NULL AND v_month+v_request.amount>v_limit THEN RAISE EXCEPTION 'Monthly deposit limit would be exceeded'; END IF;
  UPDATE public.profiles SET demo_balance=v_balance+v_request.amount,updated_at=NOW() WHERE id=v_request.user_id;
  INSERT INTO public.wallet_transactions(user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata)
  VALUES(v_request.user_id,'deposit',v_request.amount,v_balance,v_balance+v_request.amount,'Maker-checker approved manual deposit',v_request.id,'completed',
    jsonb_build_object('payment_method_id',v_request.payment_method_id,'transaction_reference',v_request.transaction_reference)) RETURNING id INTO v_tx;
  UPDATE public.manual_deposit_requests SET status='approved',review_note=NULLIF(trim(COALESCE(p_note,'')),''),reviewed_by=p_admin,reviewed_at=NOW(),wallet_transaction_id=v_tx,updated_at=NOW() WHERE id=p_request_id;
END; $$;
REVOKE ALL ON FUNCTION public.finalize_manual_deposit_approval(UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.review_manual_deposit_request(p_request_id UUID,p_status TEXT,p_review_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request public.manual_deposit_requests%ROWTYPE;
BEGIN
  IF NOT public.has_admin_role(ARRAY['finance']) OR COALESCE(auth.jwt()->>'aal','aal1')<>'aal2' THEN RAISE EXCEPTION 'Finance AAL2 authorization required'; END IF;
  IF p_status NOT IN ('approved','rejected','on_hold') THEN RAISE EXCEPTION 'Invalid review status'; END IF;
  SELECT * INTO v_request FROM public.manual_deposit_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status NOT IN ('pending','on_hold') THEN RAISE EXCEPTION 'Deposit request has already been reviewed'; END IF;
  IF p_status='approved' THEN
    INSERT INTO public.admin_approval_requests(action_type,entity_id,requested_by,request_note,payload)
    VALUES('manual_deposit',p_request_id,auth.uid(),NULLIF(trim(COALESCE(p_review_note,'')),''),jsonb_build_object('amount',v_request.amount,'user_id',v_request.user_id));
    UPDATE public.manual_deposit_requests SET status='awaiting_approval',review_note=p_review_note,reviewed_by=auth.uid(),updated_at=NOW() WHERE id=p_request_id;
  ELSE
    IF p_status='rejected' AND length(trim(COALESCE(p_review_note,'')))<3 THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
    UPDATE public.manual_deposit_requests SET status=p_status,review_note=NULLIF(trim(COALESCE(p_review_note,'')),''),reviewed_by=auth.uid(),reviewed_at=CASE WHEN p_status='rejected' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=p_request_id;
  END IF;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes)
  VALUES(auth.uid(),'manual_deposit_'||p_status,'manual_deposit',p_request_id,jsonb_build_object('note',p_review_note));
END; $$;

CREATE OR REPLACE FUNCTION public.decide_admin_approval(p_approval_id UUID,p_decision TEXT,p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request public.admin_approval_requests%ROWTYPE;
BEGIN
  IF NOT public.has_admin_role(ARRAY['finance']) OR COALESCE(auth.jwt()->>'aal','aal1')<>'aal2' THEN RAISE EXCEPTION 'Finance AAL2 authorization required'; END IF;
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  SELECT * INTO v_request FROM public.admin_approval_requests WHERE id=p_approval_id FOR UPDATE;
  IF NOT FOUND OR v_request.status<>'pending' THEN RAISE EXCEPTION 'Approval is no longer pending'; END IF;
  IF v_request.requested_by=auth.uid() THEN RAISE EXCEPTION 'Maker cannot approve their own request'; END IF;
  IF p_decision='approved' AND v_request.action_type='manual_deposit' THEN
    PERFORM public.finalize_manual_deposit_approval(v_request.entity_id,auth.uid(),p_note);
  ELSIF p_decision='rejected' AND v_request.action_type='manual_deposit' THEN
    UPDATE public.manual_deposit_requests SET status='rejected',review_note=COALESCE(NULLIF(trim(p_note),''),'Rejected by checker'),reviewed_by=auth.uid(),reviewed_at=NOW(),updated_at=NOW() WHERE id=v_request.entity_id;
  END IF;
  UPDATE public.admin_approval_requests SET status=p_decision,decided_by=auth.uid(),decision_note=NULLIF(trim(COALESCE(p_note,'')),''),decided_at=NOW() WHERE id=p_approval_id;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes)
  VALUES(auth.uid(),'maker_checker_'||p_decision,'admin_approval',p_approval_id,jsonb_build_object('action_type',v_request.action_type,'entity_id',v_request.entity_id,'note',p_note));
END; $$;

CREATE OR REPLACE FUNCTION public.review_kyc_document_manual(p_document_id UUID,p_action TEXT,p_note TEXT,p_risk_level TEXT DEFAULT 'low',p_source_of_funds_status TEXT DEFAULT 'not_required')
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_doc public.kyc_documents%ROWTYPE; v_status TEXT;
BEGIN
  IF NOT public.has_admin_role(ARRAY['kyc']) OR COALESCE(auth.jwt()->>'aal','aal1')<>'aal2' THEN RAISE EXCEPTION 'KYC AAL2 authorization required'; END IF;
  IF p_action NOT IN ('approve','reject','request_documents','hold') OR p_risk_level NOT IN ('low','medium','high') OR p_source_of_funds_status NOT IN ('not_required','requested','submitted','approved','rejected') THEN RAISE EXCEPTION 'Invalid KYC review values'; END IF;
  IF p_action IN ('reject','request_documents','hold') AND length(trim(COALESCE(p_note,'')))<3 THEN RAISE EXCEPTION 'A review note is required'; END IF;
  SELECT * INTO v_doc FROM public.kyc_documents WHERE id=p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KYC document not found'; END IF;
  v_status:=CASE WHEN p_action='approve' THEN 'approved' WHEN p_action='reject' THEN 'rejected' ELSE 'pending' END;
  UPDATE public.kyc_documents SET status=v_status,rejection_reason=CASE WHEN p_action IN ('reject','request_documents') THEN p_note ELSE NULL END,
    admin_note=NULLIF(trim(COALESCE(p_note,'')),''),risk_level=p_risk_level,source_of_funds_status=p_source_of_funds_status,reviewed_by=auth.uid(),reviewed_at=NOW() WHERE id=p_document_id;
  UPDATE public.profiles SET kyc_status=CASE
    WHEN p_action='reject' THEN 'rejected'
    WHEN p_action='approve'
      AND EXISTS(SELECT 1 FROM public.kyc_documents WHERE user_id=v_doc.user_id AND status='approved' AND document_type IN ('national_id','passport','drivers_license'))
      AND EXISTS(SELECT 1 FROM public.kyc_documents WHERE user_id=v_doc.user_id AND status='approved' AND document_type='proof_of_address') THEN 'approved'
    ELSE 'pending' END, updated_at=NOW() WHERE id=v_doc.user_id;
  INSERT INTO public.notifications(user_id,type,title,message,metadata) VALUES(v_doc.user_id,'kyc_'||p_action,'Verification update',
    CASE WHEN p_action='approve' THEN 'A verification document was approved.' WHEN p_action='reject' THEN 'A verification document was rejected.' WHEN p_action='request_documents' THEN 'Additional verification documents are required.' ELSE 'Your verification is under enhanced review.' END,
    jsonb_build_object('document_id',p_document_id,'note',p_note,'risk_level',p_risk_level));
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes) VALUES(auth.uid(),'kyc_'||p_action,'kyc_document',p_document_id,jsonb_build_object('note',p_note,'risk_level',p_risk_level,'source_of_funds_status',p_source_of_funds_status));
END; $$;

CREATE OR REPLACE FUNCTION public.notify_manual_deposit_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.notifications(user_id,type,title,message,metadata) VALUES(NEW.user_id,'deposit_'||NEW.status,'Deposit update',
      CASE NEW.status WHEN 'approved' THEN 'Your manual deposit was approved and credited.' WHEN 'rejected' THEN 'Your manual deposit was rejected.' WHEN 'on_hold' THEN 'Your deposit needs additional review.' WHEN 'awaiting_approval' THEN 'Your deposit passed initial review and awaits final approval.' ELSE 'Your deposit status changed.' END,
      jsonb_build_object('deposit_id',NEW.id,'amount',NEW.amount,'status',NEW.status,'note',NEW.review_note));
  END IF; RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS notify_manual_deposit_status_trigger ON public.manual_deposit_requests;
CREATE TRIGGER notify_manual_deposit_status_trigger AFTER UPDATE OF status ON public.manual_deposit_requests FOR EACH ROW EXECUTE FUNCTION public.notify_manual_deposit_status();

REVOKE ALL ON FUNCTION public.decide_admin_approval(UUID,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.decide_admin_approval(UUID,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.review_kyc_document_manual(UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_kyc_document_manual(UUID,TEXT,TEXT,TEXT,TEXT) TO authenticated;

-- END MIGRATION: 20261024123000_manual_operations_maker_checker.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261024130000_user_display_preferences.sql
-- ============================================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en','ur'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_currency TEXT NOT NULL DEFAULT 'USD' CHECK (display_currency IN ('USD','PKR'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Karachi';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS odds_format TEXT NOT NULL DEFAULT 'decimal' CHECK (odds_format IN ('decimal','fractional','american'));

CREATE OR REPLACE FUNCTION public.update_my_display_preferences(p_locale TEXT,p_currency TEXT,p_timezone TEXT,p_odds_format TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_locale NOT IN ('en','ur') OR p_currency NOT IN ('USD','PKR') OR p_odds_format NOT IN ('decimal','fractional','american') THEN RAISE EXCEPTION 'Invalid display preference'; END IF;
  IF length(trim(COALESCE(p_timezone,'')))<3 OR length(p_timezone)>80 THEN RAISE EXCEPTION 'Invalid timezone'; END IF;
  UPDATE public.profiles SET locale=p_locale,display_currency=p_currency,timezone=trim(p_timezone),odds_format=p_odds_format,updated_at=NOW() WHERE id=auth.uid();
END; $$;
REVOKE ALL ON FUNCTION public.update_my_display_preferences(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_my_display_preferences(TEXT,TEXT,TEXT,TEXT) TO authenticated;

-- END MIGRATION: 20261024130000_user_display_preferences.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261024140000_manual_withdrawals.sql
-- ============================================================================

-- Manual withdrawal workflow. Customer funds are atomically reserved in the
-- locked ledger account and every payout requires maker-checker approval.

CREATE TABLE IF NOT EXISTS public.manual_withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  payment_method_id UUID NOT NULL REFERENCES public.payment_methods(id) ON DELETE RESTRICT,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  destination_reference TEXT NOT NULL CHECK (length(trim(destination_reference)) >= 6),
  user_note TEXT,
  risk_score INTEGER NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','on_hold','awaiting_approval','approved','rejected','cancelled')),
  review_note TEXT,
  payment_reference TEXT,
  wallet_transaction_id UUID REFERENCES public.wallet_transactions(id) ON DELETE RESTRICT,
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS manual_withdrawal_user_created_idx
  ON public.manual_withdrawal_requests(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS manual_withdrawal_review_queue_idx
  ON public.manual_withdrawal_requests(status,created_at);

ALTER TABLE public.manual_withdrawal_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_read_own_manual_withdrawals" ON public.manual_withdrawal_requests;
CREATE POLICY "users_read_own_manual_withdrawals" ON public.manual_withdrawal_requests
  FOR SELECT TO authenticated USING (user_id=auth.uid());
DROP POLICY IF EXISTS "finance_read_manual_withdrawals" ON public.manual_withdrawal_requests;
CREATE POLICY "finance_read_manual_withdrawals" ON public.manual_withdrawal_requests
  FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['finance']));
GRANT SELECT ON public.manual_withdrawal_requests TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.manual_withdrawal_requests FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.submit_manual_withdrawal_request(
  p_payment_method_id UUID,
  p_amount NUMERIC,
  p_destination_reference TEXT,
  p_user_note TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_user UUID:=auth.uid();
  v_method public.payment_methods%ROWTYPE;
  v_request UUID:=gen_random_uuid();
  v_tx UUID;
  v_balance NUMERIC;
  v_cash NUMERIC;
  v_cash_account UUID;
  v_locked_account UUID;
  v_system_account UUID;
  v_system_balance NUMERIC;
  v_locked_balance NUMERIC;
  v_journal UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'Withdrawal amount must be positive'; END IF;
  IF length(trim(COALESCE(p_destination_reference,'')))<6 THEN RAISE EXCEPTION 'A valid payout destination is required'; END IF;

  SELECT * INTO v_method FROM public.payment_methods
  WHERE id=p_payment_method_id AND is_enabled=TRUE AND archived_at IS NULL AND method_type<>'provider';
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal method is unavailable'; END IF;
  IF p_amount<v_method.min_amount OR p_amount>v_method.max_amount THEN RAISE EXCEPTION 'Amount is outside the allowed limits'; END IF;

  SELECT demo_balance INTO v_balance FROM public.profiles
  WHERE id=v_user AND kyc_status='approved' AND COALESCE(is_suspended,FALSE)=FALSE
    AND (self_exclusion_until IS NULL OR self_exclusion_until<=NOW()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approved KYC and an active account are required'; END IF;

  PERFORM public.ensure_user_ledger_accounts_from_id(v_user,COALESCE(v_balance,0));
  SELECT id,balance INTO v_cash_account,v_cash FROM public.ledger_accounts
  WHERE user_id=v_user AND currency='USD' AND account_code='cash' FOR UPDATE;
  SELECT id,balance INTO v_locked_account,v_locked_balance FROM public.ledger_accounts
  WHERE user_id=v_user AND currency='USD' AND account_code='locked' FOR UPDATE;
  SELECT id,balance INTO v_system_account,v_system_balance FROM public.ledger_accounts
  WHERE user_id IS NULL AND currency='USD' AND account_code='sportsbook_clearing' FOR UPDATE;
  IF COALESCE(v_cash,0)<p_amount OR COALESCE(v_balance,0)<p_amount THEN RAISE EXCEPTION 'Withdrawable cash balance is insufficient'; END IF;

  INSERT INTO public.manual_withdrawal_requests(
    id,user_id,payment_method_id,amount,destination_reference,user_note,risk_score
  ) VALUES (
    v_request,v_user,p_payment_method_id,ROUND(p_amount,2),trim(p_destination_reference),
    NULLIF(trim(COALESCE(p_user_note,'')),''),
    CASE WHEN p_amount>=5000 THEN 85 WHEN p_amount>=1000 THEN 60 ELSE 25 END
  );

  UPDATE public.profiles SET demo_balance=v_balance-ROUND(p_amount,2),updated_at=NOW() WHERE id=v_user;
  INSERT INTO public.wallet_transactions(
    user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata
  ) VALUES (
    v_user,'withdrawal',-ROUND(p_amount,2),v_balance,v_balance-ROUND(p_amount,2),
    'Manual withdrawal funds reserved',v_request,'pending',
    jsonb_build_object('payment_method_id',p_payment_method_id,'destination_masked',right(trim(p_destination_reference),6))
  ) RETURNING id INTO v_tx;

  -- The wallet transaction moved cash to clearing. Move that amount from
  -- clearing into the customer locked account until the checker decides it.
  INSERT INTO public.ledger_journals(source_type,idempotency_key,description,metadata)
  VALUES('withdrawal_lock','withdrawal-lock:'||v_request,'Reserve manual withdrawal',jsonb_build_object('withdrawal_id',v_request))
  RETURNING id INTO v_journal;
  UPDATE public.ledger_accounts SET balance=balance-ROUND(p_amount,2),updated_at=NOW()
  WHERE id=v_system_account RETURNING balance INTO v_system_balance;
  UPDATE public.ledger_accounts SET balance=balance+ROUND(p_amount,2),updated_at=NOW()
  WHERE id=v_locked_account RETURNING balance INTO v_locked_balance;
  INSERT INTO public.ledger_postings(journal_id,account_id,amount,balance_after) VALUES
    (v_journal,v_system_account,-ROUND(p_amount,2),v_system_balance),
    (v_journal,v_locked_account,ROUND(p_amount,2),v_locked_balance);

  UPDATE public.manual_withdrawal_requests SET wallet_transaction_id=v_tx WHERE id=v_request;
  RETURN v_request;
END; $$;

CREATE OR REPLACE FUNCTION public.finalize_manual_withdrawal_approval(
  p_request_id UUID,p_admin UUID,p_note TEXT,p_payment_reference TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_request public.manual_withdrawal_requests%ROWTYPE;
  v_locked UUID; v_system UUID; v_locked_balance NUMERIC; v_system_balance NUMERIC; v_journal UUID;
BEGIN
  SELECT * INTO v_request FROM public.manual_withdrawal_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status<>'awaiting_approval' THEN RAISE EXCEPTION 'Withdrawal is not awaiting approval'; END IF;
  SELECT id,balance INTO v_locked,v_locked_balance FROM public.ledger_accounts WHERE user_id=v_request.user_id AND currency='USD' AND account_code='locked' FOR UPDATE;
  SELECT id,balance INTO v_system,v_system_balance FROM public.ledger_accounts WHERE user_id IS NULL AND currency='USD' AND account_code='sportsbook_clearing' FOR UPDATE;
  IF COALESCE(v_locked_balance,0)<v_request.amount THEN RAISE EXCEPTION 'Locked withdrawal funds are inconsistent'; END IF;
  INSERT INTO public.ledger_journals(source_type,idempotency_key,description,metadata)
  VALUES('withdrawal_complete','withdrawal-complete:'||p_request_id,'Complete manual withdrawal',jsonb_build_object('withdrawal_id',p_request_id)) RETURNING id INTO v_journal;
  UPDATE public.ledger_accounts SET balance=balance-v_request.amount,updated_at=NOW() WHERE id=v_locked RETURNING balance INTO v_locked_balance;
  UPDATE public.ledger_accounts SET balance=balance+v_request.amount,updated_at=NOW() WHERE id=v_system RETURNING balance INTO v_system_balance;
  INSERT INTO public.ledger_postings(journal_id,account_id,amount,balance_after) VALUES
    (v_journal,v_locked,-v_request.amount,v_locked_balance),(v_journal,v_system,v_request.amount,v_system_balance);
  UPDATE public.wallet_transactions SET status='completed',description='Manual withdrawal approved' WHERE id=v_request.wallet_transaction_id;
  UPDATE public.manual_withdrawal_requests SET status='approved',review_note=NULLIF(trim(COALESCE(p_note,'')),''),payment_reference=NULLIF(trim(COALESCE(p_payment_reference,'')),''),reviewed_by=p_admin,reviewed_at=NOW(),updated_at=NOW() WHERE id=p_request_id;
END; $$;

CREATE OR REPLACE FUNCTION public.reject_manual_withdrawal(
  p_request_id UUID,p_admin UUID,p_note TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_request public.manual_withdrawal_requests%ROWTYPE;
  v_locked UUID; v_system UUID; v_locked_balance NUMERIC; v_system_balance NUMERIC; v_journal UUID;
  v_balance NUMERIC; v_refund UUID;
BEGIN
  SELECT * INTO v_request FROM public.manual_withdrawal_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status NOT IN ('pending','on_hold','awaiting_approval') THEN RAISE EXCEPTION 'Withdrawal cannot be rejected'; END IF;
  IF length(trim(COALESCE(p_note,'')))<3 THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
  SELECT id,balance INTO v_locked,v_locked_balance FROM public.ledger_accounts WHERE user_id=v_request.user_id AND currency='USD' AND account_code='locked' FOR UPDATE;
  SELECT id,balance INTO v_system,v_system_balance FROM public.ledger_accounts WHERE user_id IS NULL AND currency='USD' AND account_code='sportsbook_clearing' FOR UPDATE;
  IF COALESCE(v_locked_balance,0)<v_request.amount THEN RAISE EXCEPTION 'Locked withdrawal funds are inconsistent'; END IF;
  INSERT INTO public.ledger_journals(source_type,idempotency_key,description,metadata)
  VALUES('withdrawal_release','withdrawal-release:'||p_request_id,'Release rejected withdrawal',jsonb_build_object('withdrawal_id',p_request_id)) RETURNING id INTO v_journal;
  UPDATE public.ledger_accounts SET balance=balance-v_request.amount,updated_at=NOW() WHERE id=v_locked RETURNING balance INTO v_locked_balance;
  UPDATE public.ledger_accounts SET balance=balance+v_request.amount,updated_at=NOW() WHERE id=v_system RETURNING balance INTO v_system_balance;
  INSERT INTO public.ledger_postings(journal_id,account_id,amount,balance_after) VALUES
    (v_journal,v_locked,-v_request.amount,v_locked_balance),(v_journal,v_system,v_request.amount,v_system_balance);

  SELECT demo_balance INTO v_balance FROM public.profiles WHERE id=v_request.user_id FOR UPDATE;
  UPDATE public.profiles SET demo_balance=v_balance+v_request.amount,updated_at=NOW() WHERE id=v_request.user_id;
  INSERT INTO public.wallet_transactions(user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata)
  VALUES(v_request.user_id,'adjustment',v_request.amount,v_balance,v_balance+v_request.amount,'Rejected withdrawal refund',p_request_id,'completed',jsonb_build_object('reason',trim(p_note))) RETURNING id INTO v_refund;
  UPDATE public.wallet_transactions SET status='cancelled' WHERE id=v_request.wallet_transaction_id;
  UPDATE public.manual_withdrawal_requests SET status='rejected',review_note=trim(p_note),reviewed_by=p_admin,reviewed_at=NOW(),updated_at=NOW() WHERE id=p_request_id;
END; $$;

CREATE OR REPLACE FUNCTION public.review_manual_withdrawal_request(p_request_id UUID,p_status TEXT,p_review_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request public.manual_withdrawal_requests%ROWTYPE;
BEGIN
  IF NOT public.has_admin_role(ARRAY['finance']) OR COALESCE(auth.jwt()->>'aal','aal1')<>'aal2' THEN RAISE EXCEPTION 'Finance AAL2 authorization required'; END IF;
  IF p_status NOT IN ('approved','rejected','on_hold') THEN RAISE EXCEPTION 'Invalid review status'; END IF;
  SELECT * INTO v_request FROM public.manual_withdrawal_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status NOT IN ('pending','on_hold') THEN RAISE EXCEPTION 'Withdrawal request has already been reviewed'; END IF;
  IF p_status='approved' THEN
    INSERT INTO public.admin_approval_requests(action_type,entity_id,requested_by,request_note,payload)
    VALUES('large_withdrawal',p_request_id,auth.uid(),NULLIF(trim(COALESCE(p_review_note,'')),''),jsonb_build_object('amount',v_request.amount,'user_id',v_request.user_id,'destination',right(v_request.destination_reference,6)));
    UPDATE public.manual_withdrawal_requests SET status='awaiting_approval',review_note=p_review_note,reviewed_by=auth.uid(),updated_at=NOW() WHERE id=p_request_id;
  ELSIF p_status='rejected' THEN
    PERFORM public.reject_manual_withdrawal(p_request_id,auth.uid(),p_review_note);
  ELSE
    UPDATE public.manual_withdrawal_requests SET status='on_hold',review_note=NULLIF(trim(COALESCE(p_review_note,'')),''),reviewed_by=auth.uid(),updated_at=NOW() WHERE id=p_request_id;
  END IF;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes)
  VALUES(auth.uid(),'manual_withdrawal_'||p_status,'manual_withdrawal',p_request_id,jsonb_build_object('note',p_review_note));
END; $$;

CREATE OR REPLACE FUNCTION public.decide_admin_approval(p_approval_id UUID,p_decision TEXT,p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request public.admin_approval_requests%ROWTYPE; v_reference TEXT;
BEGIN
  IF NOT public.has_admin_role(ARRAY['finance']) OR COALESCE(auth.jwt()->>'aal','aal1')<>'aal2' THEN RAISE EXCEPTION 'Finance AAL2 authorization required'; END IF;
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  SELECT * INTO v_request FROM public.admin_approval_requests WHERE id=p_approval_id FOR UPDATE;
  IF NOT FOUND OR v_request.status<>'pending' THEN RAISE EXCEPTION 'Approval is no longer pending'; END IF;
  IF v_request.requested_by=auth.uid() THEN RAISE EXCEPTION 'Maker cannot approve their own request'; END IF;
  v_reference:=NULLIF(trim(COALESCE(v_request.payload->>'payment_reference','')), '');
  IF v_request.action_type='manual_deposit' THEN
    IF p_decision='approved' THEN PERFORM public.finalize_manual_deposit_approval(v_request.entity_id,auth.uid(),p_note);
    ELSE UPDATE public.manual_deposit_requests SET status='rejected',review_note=COALESCE(NULLIF(trim(p_note),''),'Rejected by checker'),reviewed_by=auth.uid(),reviewed_at=NOW(),updated_at=NOW() WHERE id=v_request.entity_id; END IF;
  ELSIF v_request.action_type='large_withdrawal' THEN
    IF p_decision='approved' THEN PERFORM public.finalize_manual_withdrawal_approval(v_request.entity_id,auth.uid(),p_note,v_reference);
    ELSE PERFORM public.reject_manual_withdrawal(v_request.entity_id,auth.uid(),COALESCE(NULLIF(trim(p_note),''),'Rejected by checker')); END IF;
  END IF;
  UPDATE public.admin_approval_requests SET status=p_decision,decided_by=auth.uid(),decision_note=NULLIF(trim(COALESCE(p_note,'')),''),decided_at=NOW() WHERE id=p_approval_id;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes)
  VALUES(auth.uid(),'maker_checker_'||p_decision,'admin_approval',p_approval_id,jsonb_build_object('action_type',v_request.action_type,'entity_id',v_request.entity_id,'note',p_note));
END; $$;

CREATE OR REPLACE FUNCTION public.notify_manual_withdrawal_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.notifications(user_id,type,title,message,metadata) VALUES(NEW.user_id,'withdrawal_'||NEW.status,'Withdrawal update',
      CASE NEW.status WHEN 'approved' THEN 'Your manual withdrawal was approved.' WHEN 'rejected' THEN 'Your withdrawal was rejected and the reserved funds were returned.' WHEN 'on_hold' THEN 'Your withdrawal needs additional review.' WHEN 'awaiting_approval' THEN 'Your withdrawal passed initial review and awaits final approval.' ELSE 'Your withdrawal status changed.' END,
      jsonb_build_object('withdrawal_id',NEW.id,'amount',NEW.amount,'status',NEW.status,'note',NEW.review_note));
  END IF; RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS notify_manual_withdrawal_status_trigger ON public.manual_withdrawal_requests;
CREATE TRIGGER notify_manual_withdrawal_status_trigger AFTER UPDATE OF status ON public.manual_withdrawal_requests FOR EACH ROW EXECUTE FUNCTION public.notify_manual_withdrawal_status();

REVOKE ALL ON FUNCTION public.submit_manual_withdrawal_request(UUID,NUMERIC,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_manual_withdrawal_request(UUID,NUMERIC,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.review_manual_withdrawal_request(UUID,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_manual_withdrawal_request(UUID,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.finalize_manual_withdrawal_approval(UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reject_manual_withdrawal(UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;

-- END MIGRATION: 20261024140000_manual_withdrawals.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261024143000_early_payout_engine.sql
-- ============================================================================

-- Configurable early-payout engine. Rules are deliberately disabled until a
-- trusted live-score feed is connected and a trader enables them.

CREATE TABLE IF NOT EXISTS public.early_payout_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sport_slug TEXT NOT NULL,
  market_type TEXT NOT NULL DEFAULT 'match_result',
  minimum_lead INTEGER NOT NULL CHECK (minimum_lead BETWEEN 1 AND 20),
  minimum_minute INTEGER NOT NULL CHECK (minimum_minute BETWEEN 1 AND 200),
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS early_payout_rule_unique
  ON public.early_payout_rules(sport_slug,market_type,minimum_lead,minimum_minute);

CREATE TABLE IF NOT EXISTS public.early_payout_awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES public.early_payout_rules(id) ON DELETE RESTRICT,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  bet_selection_id UUID NOT NULL REFERENCES public.bet_selections(id) ON DELETE RESTRICT,
  score TEXT NOT NULL,
  match_minute INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(bet_selection_id)
);

ALTER TABLE public.early_payout_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.early_payout_awards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read_early_payout_rules" ON public.early_payout_rules FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "traders_read_early_payout_awards" ON public.early_payout_awards FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['sports_trader','risk_manager']));
GRANT SELECT ON public.early_payout_rules TO authenticated;
GRANT SELECT ON public.early_payout_awards TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.early_payout_rules FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.early_payout_awards FROM PUBLIC,anon,authenticated;

INSERT INTO public.early_payout_rules(name,sport_slug,market_type,minimum_lead,minimum_minute,is_enabled)
VALUES('Football two-goal lead after 75 minutes','football','match_result',2,75,FALSE)
ON CONFLICT(sport_slug,market_type,minimum_lead,minimum_minute) DO NOTHING;

CREATE OR REPLACE FUNCTION public.save_early_payout_rule(
  p_id UUID,p_name TEXT,p_sport_slug TEXT,p_market_type TEXT,p_minimum_lead INTEGER,p_minimum_minute INTEGER,p_is_enabled BOOLEAN
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.has_admin_role(ARRAY['sports_trader','risk_manager']) OR COALESCE(auth.jwt()->>'aal','aal1')<>'aal2' THEN RAISE EXCEPTION 'Trader AAL2 authorization required'; END IF;
  IF length(trim(COALESCE(p_name,'')))<3 OR length(trim(COALESCE(p_sport_slug,'')))<2 OR p_market_type<>'match_result' OR p_minimum_lead NOT BETWEEN 1 AND 20 OR p_minimum_minute NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid early-payout rule'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.early_payout_rules(name,sport_slug,market_type,minimum_lead,minimum_minute,is_enabled,created_by)
    VALUES(trim(p_name),lower(trim(p_sport_slug)),p_market_type,p_minimum_lead,p_minimum_minute,p_is_enabled,auth.uid()) RETURNING id INTO v_id;
  ELSE
    UPDATE public.early_payout_rules SET name=trim(p_name),sport_slug=lower(trim(p_sport_slug)),market_type=p_market_type,minimum_lead=p_minimum_lead,minimum_minute=p_minimum_minute,is_enabled=p_is_enabled,updated_at=NOW() WHERE id=p_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Early-payout rule not found'; END IF;
  END IF;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes) VALUES(auth.uid(),'early_payout_rule_saved','early_payout_rule',v_id,jsonb_build_object('enabled',p_is_enabled,'minimum_lead',p_minimum_lead,'minimum_minute',p_minimum_minute));
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.delete_early_payout_rule(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_admin_role(ARRAY['sports_trader','risk_manager']) OR COALESCE(auth.jwt()->>'aal','aal1')<>'aal2' THEN RAISE EXCEPTION 'Trader AAL2 authorization required'; END IF;
  IF EXISTS(SELECT 1 FROM public.early_payout_awards WHERE rule_id=p_id) THEN
    UPDATE public.early_payout_rules SET is_enabled=FALSE,updated_at=NOW() WHERE id=p_id;
  ELSE DELETE FROM public.early_payout_rules WHERE id=p_id; END IF;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes) VALUES(auth.uid(),'early_payout_rule_removed','early_payout_rule',p_id,'{}'::jsonb);
END; $$;

CREATE OR REPLACE FUNCTION public.process_early_payout_for_event(p_event_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_event RECORD; v_rule public.early_payout_rules%ROWTYPE; v_leader TEXT; v_awarded INTEGER:=0;
  v_bet RECORD; v_selection RECORD; v_factor NUMERIC; v_payout NUMERIC; v_balance NUMERIC; v_tx UUID;
BEGIN
  SELECT e.*,s.slug AS sport_slug INTO v_event FROM public.events e JOIN public.sports s ON s.id=e.sport_id WHERE e.id=p_event_id FOR SHARE OF e;
  IF NOT FOUND OR v_event.status<>'live' OR v_event.live_score_home IS NULL OR v_event.live_score_away IS NULL OR v_event.live_minute IS NULL THEN RETURN 0; END IF;

  FOR v_rule IN SELECT * FROM public.early_payout_rules WHERE is_enabled=TRUE AND sport_slug=v_event.sport_slug AND market_type='match_result' AND minimum_minute<=v_event.live_minute ORDER BY minimum_lead DESC
  LOOP
    IF v_event.live_score_home-v_event.live_score_away>=v_rule.minimum_lead THEN v_leader:='home';
    ELSIF v_event.live_score_away-v_event.live_score_home>=v_rule.minimum_lead THEN v_leader:='away';
    ELSE CONTINUE; END IF;

    WITH awarded AS (
      INSERT INTO public.early_payout_awards(rule_id,event_id,bet_selection_id,score,match_minute)
      SELECT v_rule.id,p_event_id,bs.id,v_event.live_score_home||'-'||v_event.live_score_away,v_event.live_minute
      FROM public.bet_selections bs
      JOIN public.bets b ON b.id=bs.bet_id AND b.status='pending'
      JOIN public.markets m ON m.id=bs.market_id AND m.event_id=p_event_id AND m.type='match_result'
      WHERE bs.event_id=p_event_id AND COALESCE(bs.result,'pending')='pending'
        AND ((v_leader='home' AND lower(trim(bs.selection)) IN ('home',lower(trim(v_event.home_team))))
          OR (v_leader='away' AND lower(trim(bs.selection)) IN ('away',lower(trim(v_event.away_team)))))
      ON CONFLICT(bet_selection_id) DO NOTHING RETURNING bet_selection_id
    )
    UPDATE public.bet_selections bs SET result='won' FROM awarded a WHERE bs.id=a.bet_selection_id;
    GET DIAGNOSTICS v_awarded = ROW_COUNT;
    EXIT WHEN v_awarded>0;
  END LOOP;

  IF v_awarded=0 THEN RETURN 0; END IF;

  FOR v_bet IN
    SELECT b.id,b.user_id,b.stake FROM public.bets b
    WHERE b.status='pending' AND b.type<>'system'
      AND EXISTS(SELECT 1 FROM public.bet_selections bs WHERE bs.bet_id=b.id AND bs.event_id=p_event_id)
    FOR UPDATE OF b
  LOOP
    IF EXISTS(SELECT 1 FROM public.bet_selections WHERE bet_id=v_bet.id AND result='lost') OR EXISTS(SELECT 1 FROM public.bet_selections WHERE bet_id=v_bet.id AND COALESCE(result,'pending')='pending') THEN CONTINUE; END IF;
    v_factor:=1;
    FOR v_selection IN SELECT result,odds_value FROM public.bet_selections WHERE bet_id=v_bet.id LOOP
      IF v_selection.result='won' THEN v_factor:=v_factor*v_selection.odds_value; END IF;
    END LOOP;
    v_payout:=ROUND(v_bet.stake*v_factor,2);
    SELECT demo_balance INTO v_balance FROM public.profiles WHERE id=v_bet.user_id FOR UPDATE;
    UPDATE public.profiles SET demo_balance=v_balance+v_payout,updated_at=NOW() WHERE id=v_bet.user_id;
    INSERT INTO public.wallet_transactions(user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata)
    VALUES(v_bet.user_id,'bet_won',v_payout,v_balance,v_balance+v_payout,'Early payout settlement',v_bet.id,'completed',jsonb_build_object('event_id',p_event_id)) RETURNING id INTO v_tx;
    UPDATE public.bets SET status='won',payout=v_payout,settled_at=NOW() WHERE id=v_bet.id;
    INSERT INTO public.settlements(bet_id,settlement_type,original_stake,settlement_amount,settlement_reason,is_manual,wallet_transaction_id)
    VALUES(v_bet.id,'win',v_bet.stake,v_payout,'Configured early-payout rule',FALSE,v_tx);
    INSERT INTO public.notifications(user_id,type,title,message,metadata) VALUES(v_bet.user_id,'early_payout','Early payout awarded','Your qualifying bet was settled early as a winner.',jsonb_build_object('bet_id',v_bet.id,'event_id',p_event_id,'payout',v_payout));
  END LOOP;
  RETURN v_awarded;
END; $$;

CREATE OR REPLACE FUNCTION public.trigger_early_payout_on_live_score()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status='live' AND (NEW.live_score_home IS DISTINCT FROM OLD.live_score_home OR NEW.live_score_away IS DISTINCT FROM OLD.live_score_away OR NEW.live_minute IS DISTINCT FROM OLD.live_minute) THEN
    PERFORM public.process_early_payout_for_event(NEW.id);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS process_early_payout_live_score_trigger ON public.events;
CREATE TRIGGER process_early_payout_live_score_trigger AFTER UPDATE OF live_score_home,live_score_away,live_minute,status ON public.events FOR EACH ROW EXECUTE FUNCTION public.trigger_early_payout_on_live_score();

REVOKE ALL ON FUNCTION public.save_early_payout_rule(UUID,TEXT,TEXT,TEXT,INTEGER,INTEGER,BOOLEAN) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_early_payout_rule(UUID,TEXT,TEXT,TEXT,INTEGER,INTEGER,BOOLEAN) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_early_payout_rule(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_early_payout_rule(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.process_early_payout_for_event(UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.trigger_early_payout_on_live_score() FROM PUBLIC,anon,authenticated;

-- END MIGRATION: 20261024143000_early_payout_engine.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261024150000_live_match_timeline.sql
-- ============================================================================

-- Customer-facing live incident timeline populated from idempotent feed updates.

CREATE TABLE IF NOT EXISTS public.event_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  feed_update_id UUID REFERENCES public.feed_updates(id) ON DELETE SET NULL,
  incident_type TEXT NOT NULL,
  match_minute INTEGER,
  team_side TEXT CHECK (team_side IN ('home','away','neutral')),
  score_home INTEGER,
  score_away INTEGER,
  description TEXT,
  provider_id TEXT,
  provider_incident_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider_id,provider_incident_id)
);
CREATE INDEX IF NOT EXISTS event_timeline_event_minute_idx ON public.event_timeline(event_id,match_minute DESC,created_at DESC);
ALTER TABLE public.event_timeline ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_event_timeline" ON public.event_timeline FOR SELECT TO anon,authenticated USING (TRUE);
GRANT SELECT ON public.event_timeline TO anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.event_timeline FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.capture_feed_incident_timeline()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_incident TEXT:=lower(trim(COALESCE(NEW.payload->>'incident',''))); v_incident_id TEXT;
BEGIN
  IF v_incident='' OR NEW.event_id IS NULL THEN RETURN NEW; END IF;
  v_incident_id:=COALESCE(NULLIF(trim(NEW.payload->>'incident_id'),''),NEW.update_id);
  INSERT INTO public.event_timeline(event_id,feed_update_id,incident_type,match_minute,team_side,score_home,score_away,description,provider_id,provider_incident_id)
  VALUES(NEW.event_id,NEW.id,v_incident,NULLIF(NEW.payload->>'live_minute','')::INTEGER,
    CASE WHEN lower(COALESCE(NEW.payload->>'team_side','neutral')) IN ('home','away') THEN lower(NEW.payload->>'team_side') ELSE 'neutral' END,
    NULLIF(NEW.payload->>'home_score','')::INTEGER,NULLIF(NEW.payload->>'away_score','')::INTEGER,
    NULLIF(trim(COALESCE(NEW.payload->>'incident_description',NEW.payload->>'description','')),''),NEW.provider_id,v_incident_id)
  ON CONFLICT(provider_id,provider_incident_id) DO NOTHING;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS capture_feed_incident_timeline_trigger ON public.feed_updates;
CREATE TRIGGER capture_feed_incident_timeline_trigger AFTER INSERT ON public.feed_updates FOR EACH ROW EXECUTE FUNCTION public.capture_feed_incident_timeline();
REVOKE ALL ON FUNCTION public.capture_feed_incident_timeline() FROM PUBLIC,anon,authenticated;

-- END MIGRATION: 20261024150000_live_match_timeline.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261024160000_platform_experience_upgrades.sql
-- ============================================================================

-- Product experience upgrades: feature flags, maintenance control, withdrawal
-- address cooling, provider match statistics, missions and public leaderboard.

CREATE TABLE IF NOT EXISTS public.feature_flags (
  key TEXT PRIMARY KEY CHECK (key ~ '^[a-z0-9_]+$'),
  name TEXT NOT NULL,
  description TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_by UUID REFERENCES public.profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_feature_flags" ON public.feature_flags FOR SELECT TO anon,authenticated USING (TRUE);
GRANT SELECT ON public.feature_flags TO anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.feature_flags FROM PUBLIC,anon,authenticated;
INSERT INTO public.feature_flags(key,name,description,is_enabled,config) VALUES
  ('maintenance_mode','Maintenance mode','Show a controlled maintenance screen to customers',FALSE,'{"message":"PrimeBet is receiving an upgrade. Please check back shortly."}'),
  ('missions','Missions','Enable customer missions and loyalty rewards',TRUE,'{}'),
  ('leaderboards','Leaderboards','Enable the anonymized weekly leaderboard',TRUE,'{}'),
  ('match_statistics','Match statistics','Display provider-supplied match statistics and lineups',TRUE,'{}'),
  ('withdrawal_address_whitelist','Withdrawal address whitelist','Require a cooled-down saved payout destination',TRUE,'{"cooldown_hours":24}'),
  ('web_push','Browser push','Allow browser push enrollment after a provider is configured',FALSE,'{}'),
  ('telegram_notifications','Telegram notifications','Allow Telegram delivery after bot credentials are configured',FALSE,'{}')
ON CONFLICT(key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.save_feature_flag(p_key TEXT,p_enabled BOOLEAN,p_config JSONB DEFAULT '{}'::JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_admin() OR COALESCE(auth.jwt()->>'aal','aal1')<>'aal2' THEN RAISE EXCEPTION 'Admin AAL2 authorization required'; END IF;
  UPDATE public.feature_flags SET is_enabled=p_enabled,config=COALESCE(p_config,'{}'::JSONB),updated_by=auth.uid(),updated_at=NOW() WHERE key=p_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'Feature flag not found'; END IF;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes) VALUES(auth.uid(),'feature_flag_updated','feature_flag',NULL,jsonb_build_object('key',p_key,'enabled',p_enabled,'config',p_config));
END; $$;

CREATE TABLE IF NOT EXISTS public.withdrawal_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  payment_method_id UUID NOT NULL REFERENCES public.payment_methods(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  destination_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','blocked')),
  activates_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id,payment_method_id,destination_reference)
);
ALTER TABLE public.withdrawal_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_read_own_withdrawal_addresses" ON public.withdrawal_addresses FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY "finance_read_withdrawal_addresses" ON public.withdrawal_addresses FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['finance']));
GRANT SELECT ON public.withdrawal_addresses TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.withdrawal_addresses FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.add_my_withdrawal_address(p_payment_method_id UUID,p_label TEXT,p_destination TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID; v_hours INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF length(trim(COALESCE(p_label,'')))<2 OR length(trim(COALESCE(p_destination,'')))<6 THEN RAISE EXCEPTION 'A label and valid destination are required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.payment_methods WHERE id=p_payment_method_id AND is_enabled=TRUE AND archived_at IS NULL AND method_type<>'provider') THEN RAISE EXCEPTION 'Payment method is unavailable'; END IF;
  SELECT COALESCE((config->>'cooldown_hours')::INTEGER,24) INTO v_hours FROM public.feature_flags WHERE key='withdrawal_address_whitelist';
  INSERT INTO public.withdrawal_addresses(user_id,payment_method_id,label,destination_reference,activates_at)
  VALUES(auth.uid(),p_payment_method_id,trim(p_label),trim(p_destination),NOW()+make_interval(hours=>GREATEST(COALESCE(v_hours,24),0)))
  ON CONFLICT(user_id,payment_method_id,destination_reference) DO UPDATE SET label=EXCLUDED.label,status='pending',activates_at=EXCLUDED.activates_at,updated_at=NOW()
  RETURNING id INTO v_id;
  INSERT INTO public.notifications(user_id,type,title,message,metadata) VALUES(auth.uid(),'withdrawal_address_added','New payout destination','A new payout destination was added and is in its security cooling period.',jsonb_build_object('address_id',v_id,'activates_at',NOW()+make_interval(hours=>GREATEST(COALESCE(v_hours,24),0))));
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.remove_my_withdrawal_address(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  DELETE FROM public.withdrawal_addresses WHERE id=p_id AND user_id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Payout destination not found'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.validate_manual_withdrawal_destination()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_enabled BOOLEAN;
BEGIN
  SELECT is_enabled INTO v_enabled FROM public.feature_flags WHERE key='withdrawal_address_whitelist';
  IF COALESCE(v_enabled,FALSE) AND NOT EXISTS(
    SELECT 1 FROM public.withdrawal_addresses a WHERE a.user_id=NEW.user_id AND a.payment_method_id=NEW.payment_method_id
      AND a.destination_reference=NEW.destination_reference AND a.status<>'blocked' AND a.activates_at<=NOW()
  ) THEN RAISE EXCEPTION 'Use an active saved payout destination. New destinations have a security cooling period'; END IF;
  UPDATE public.withdrawal_addresses SET status='active',last_used_at=NOW(),updated_at=NOW()
  WHERE user_id=NEW.user_id AND payment_method_id=NEW.payment_method_id AND destination_reference=NEW.destination_reference AND activates_at<=NOW() AND status<>'blocked';
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_manual_withdrawal_destination_trigger ON public.manual_withdrawal_requests;
CREATE TRIGGER validate_manual_withdrawal_destination_trigger BEFORE INSERT ON public.manual_withdrawal_requests FOR EACH ROW EXECUTE FUNCTION public.validate_manual_withdrawal_destination();

CREATE TABLE IF NOT EXISTS public.event_statistics (
  event_id UUID PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  possession_home NUMERIC(5,2), possession_away NUMERIC(5,2),
  shots_home INTEGER, shots_away INTEGER, shots_on_target_home INTEGER, shots_on_target_away INTEGER,
  corners_home INTEGER, corners_away INTEGER, fouls_home INTEGER, fouls_away INTEGER,
  yellow_cards_home INTEGER, yellow_cards_away INTEGER, red_cards_home INTEGER, red_cards_away INTEGER,
  provider_id TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.event_lineups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  team_side TEXT NOT NULL CHECK(team_side IN ('home','away')), formation TEXT, coach TEXT, players JSONB NOT NULL DEFAULT '[]'::JSONB,
  provider_id TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(event_id,team_side)
);
ALTER TABLE public.event_statistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_lineups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_event_statistics" ON public.event_statistics FOR SELECT TO anon,authenticated USING(TRUE);
CREATE POLICY "public_read_event_lineups" ON public.event_lineups FOR SELECT TO anon,authenticated USING(TRUE);
GRANT SELECT ON public.event_statistics,public.event_lineups TO anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.event_statistics,public.event_lineups FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.capture_feed_match_details()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_stats JSONB:=NEW.payload->'statistics'; v_lineups JSONB:=NEW.payload->'lineups';
BEGIN
  IF NEW.event_id IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(v_stats)='object' THEN
    INSERT INTO public.event_statistics(event_id,possession_home,possession_away,shots_home,shots_away,shots_on_target_home,shots_on_target_away,corners_home,corners_away,fouls_home,fouls_away,yellow_cards_home,yellow_cards_away,red_cards_home,red_cards_away,provider_id)
    VALUES(NEW.event_id,NULLIF(v_stats->>'possession_home','')::NUMERIC,NULLIF(v_stats->>'possession_away','')::NUMERIC,NULLIF(v_stats->>'shots_home','')::INTEGER,NULLIF(v_stats->>'shots_away','')::INTEGER,NULLIF(v_stats->>'shots_on_target_home','')::INTEGER,NULLIF(v_stats->>'shots_on_target_away','')::INTEGER,NULLIF(v_stats->>'corners_home','')::INTEGER,NULLIF(v_stats->>'corners_away','')::INTEGER,NULLIF(v_stats->>'fouls_home','')::INTEGER,NULLIF(v_stats->>'fouls_away','')::INTEGER,NULLIF(v_stats->>'yellow_cards_home','')::INTEGER,NULLIF(v_stats->>'yellow_cards_away','')::INTEGER,NULLIF(v_stats->>'red_cards_home','')::INTEGER,NULLIF(v_stats->>'red_cards_away','')::INTEGER,NEW.provider_id)
    ON CONFLICT(event_id) DO UPDATE SET possession_home=EXCLUDED.possession_home,possession_away=EXCLUDED.possession_away,shots_home=EXCLUDED.shots_home,shots_away=EXCLUDED.shots_away,shots_on_target_home=EXCLUDED.shots_on_target_home,shots_on_target_away=EXCLUDED.shots_on_target_away,corners_home=EXCLUDED.corners_home,corners_away=EXCLUDED.corners_away,fouls_home=EXCLUDED.fouls_home,fouls_away=EXCLUDED.fouls_away,yellow_cards_home=EXCLUDED.yellow_cards_home,yellow_cards_away=EXCLUDED.yellow_cards_away,red_cards_home=EXCLUDED.red_cards_home,red_cards_away=EXCLUDED.red_cards_away,provider_id=EXCLUDED.provider_id,updated_at=NOW();
  END IF;
  IF jsonb_typeof(v_lineups)='object' THEN
    INSERT INTO public.event_lineups(event_id,team_side,formation,coach,players,provider_id) VALUES
      (NEW.event_id,'home',v_lineups->'home'->>'formation',v_lineups->'home'->>'coach',COALESCE(v_lineups->'home'->'players','[]'::JSONB),NEW.provider_id),
      (NEW.event_id,'away',v_lineups->'away'->>'formation',v_lineups->'away'->>'coach',COALESCE(v_lineups->'away'->'players','[]'::JSONB),NEW.provider_id)
    ON CONFLICT(event_id,team_side) DO UPDATE SET formation=EXCLUDED.formation,coach=EXCLUDED.coach,players=EXCLUDED.players,provider_id=EXCLUDED.provider_id,updated_at=NOW();
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS capture_feed_match_details_trigger ON public.feed_updates;
CREATE TRIGGER capture_feed_match_details_trigger AFTER INSERT ON public.feed_updates FOR EACH ROW EXECUTE FUNCTION public.capture_feed_match_details();

CREATE TABLE IF NOT EXISTS public.missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), title TEXT NOT NULL, description TEXT NOT NULL,
  metric TEXT NOT NULL CHECK(metric IN ('bets_placed','settled_wins','total_stake')), target_value NUMERIC NOT NULL CHECK(target_value>0),
  reward_points INTEGER NOT NULL CHECK(reward_points>0), starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CHECK(ends_at>starts_at)
);
CREATE TABLE IF NOT EXISTS public.mission_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), mission_id UUID NOT NULL REFERENCES public.missions(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, progress_at_claim NUMERIC NOT NULL,
  reward_points INTEGER NOT NULL, claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(mission_id,user_id)
);
ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.mission_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_active_missions" ON public.missions FOR SELECT TO anon,authenticated USING(is_enabled=TRUE);
CREATE POLICY "users_read_own_mission_claims" ON public.mission_claims FOR SELECT TO authenticated USING(user_id=auth.uid());
GRANT SELECT ON public.missions TO anon,authenticated; GRANT SELECT ON public.mission_claims TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.missions,public.mission_claims FROM PUBLIC,anon,authenticated;
INSERT INTO public.missions(title,description,metric,target_value,reward_points,starts_at,ends_at) VALUES
  ('First Steps','Place 3 sportsbook bets','bets_placed',3,100,date_trunc('week',NOW()),date_trunc('week',NOW())+INTERVAL '7 days'),
  ('Winning Form','Settle 2 winning bets','settled_wins',2,250,date_trunc('week',NOW()),date_trunc('week',NOW())+INTERVAL '7 days'),
  ('Weekend Action','Place 250 demo credits in total stake','total_stake',250,400,date_trunc('week',NOW()),date_trunc('week',NOW())+INTERVAL '7 days')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.mission_progress(p_mission public.missions,p_user UUID)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_progress NUMERIC;
BEGIN
  IF p_mission.metric='bets_placed' THEN SELECT COUNT(*) INTO v_progress FROM public.bets WHERE user_id=p_user AND created_at BETWEEN p_mission.starts_at AND p_mission.ends_at;
  ELSIF p_mission.metric='settled_wins' THEN SELECT COUNT(*) INTO v_progress FROM public.bets WHERE user_id=p_user AND status='won' AND settled_at BETWEEN p_mission.starts_at AND p_mission.ends_at;
  ELSE SELECT COALESCE(SUM(stake),0) INTO v_progress FROM public.bets WHERE user_id=p_user AND created_at BETWEEN p_mission.starts_at AND p_mission.ends_at; END IF;
  RETURN COALESCE(v_progress,0);
END; $$;

CREATE OR REPLACE FUNCTION public.get_my_missions()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',m.id,'name',m.title,'description',m.description,'metric',m.metric,'target_value',m.target_value,'progress',LEAST(public.mission_progress(m,auth.uid()),m.target_value),'reward_points',m.reward_points,'ends_at',m.ends_at,'completed',public.mission_progress(m,auth.uid())>=m.target_value,'claimed',c.id IS NOT NULL) ORDER BY m.ends_at,m.reward_points),'[]'::JSONB)
  FROM public.missions m LEFT JOIN public.mission_claims c ON c.mission_id=m.id AND c.user_id=auth.uid()
  WHERE m.is_enabled=TRUE AND NOW() BETWEEN m.starts_at AND m.ends_at;
$$;

CREATE OR REPLACE FUNCTION public.claim_mission_reward(p_mission_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_mission public.missions%ROWTYPE; v_progress NUMERIC; v_points BIGINT; v_tier TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_mission FROM public.missions WHERE id=p_mission_id AND is_enabled=TRUE AND NOW() BETWEEN starts_at AND ends_at FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mission is unavailable'; END IF;
  v_progress:=public.mission_progress(v_mission,auth.uid()); IF v_progress<v_mission.target_value THEN RAISE EXCEPTION 'Mission is not complete'; END IF;
  INSERT INTO public.mission_claims(mission_id,user_id,progress_at_claim,reward_points) VALUES(p_mission_id,auth.uid(),v_progress,v_mission.reward_points);
  INSERT INTO public.loyalty_accounts(user_id,points,lifetime_points) VALUES(auth.uid(),v_mission.reward_points,v_mission.reward_points)
  ON CONFLICT(user_id) DO UPDATE SET points=public.loyalty_accounts.points+EXCLUDED.points,lifetime_points=public.loyalty_accounts.lifetime_points+EXCLUDED.lifetime_points,updated_at=NOW();
  SELECT points,tier INTO v_points,v_tier FROM public.loyalty_accounts WHERE user_id=auth.uid();
  INSERT INTO public.notifications(user_id,type,title,message,metadata) VALUES(auth.uid(),'mission_reward','Mission reward claimed','Loyalty points were added to your account.',jsonb_build_object('mission_id',p_mission_id,'points',v_mission.reward_points));
  RETURN jsonb_build_object('success',TRUE,'points_awarded',v_mission.reward_points,'total_points',v_points,'tier',v_tier);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Mission reward was already claimed';
END; $$;

CREATE OR REPLACE FUNCTION public.get_public_leaderboard(p_limit INTEGER DEFAULT 20)
RETURNS TABLE(rank BIGINT,display_name TEXT,points BIGINT,tier TEXT,is_current BOOLEAN) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH ranked AS (
    SELECT l.user_id,l.points,l.tier,left(COALESCE(NULLIF(p.username,''),NULLIF(p.full_name,''),split_part(p.email,'@',1)),2)||'***' display_name
    FROM public.loyalty_accounts l JOIN public.profiles p ON p.id=l.user_id WHERE COALESCE(p.is_admin,FALSE)=FALSE
  ) SELECT row_number() OVER(ORDER BY points DESC,user_id),display_name,points,tier,user_id=auth.uid()
  FROM ranked ORDER BY points DESC,user_id LIMIT LEAST(GREATEST(p_limit,1),100);
$$;

REVOKE ALL ON FUNCTION public.save_feature_flag(TEXT,BOOLEAN,JSONB) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.save_feature_flag(TEXT,BOOLEAN,JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.add_my_withdrawal_address(UUID,TEXT,TEXT) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.add_my_withdrawal_address(UUID,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.remove_my_withdrawal_address(UUID) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.remove_my_withdrawal_address(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_missions() FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.get_my_missions() TO authenticated;
REVOKE ALL ON FUNCTION public.claim_mission_reward(UUID) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.claim_mission_reward(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.get_public_leaderboard(INTEGER) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.get_public_leaderboard(INTEGER) TO anon,authenticated;
REVOKE ALL ON FUNCTION public.validate_manual_withdrawal_destination() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.capture_feed_match_details() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mission_progress(public.missions,UUID) FROM PUBLIC,anon,authenticated;

-- END MIGRATION: 20261024160000_platform_experience_upgrades.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261024173000_push_subscriptions.sql
-- ============================================================================

-- Browser push enrollment. Message delivery stays disabled until VAPID keys and
-- a trusted push sender are configured on the production server.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth_secret TEXT NOT NULL,
  user_agent TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK(failure_count>=0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id,endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_read_own_push_subscriptions" ON public.push_subscriptions FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY "monitoring_read_push_subscriptions" ON public.push_subscriptions FOR SELECT TO authenticated USING(public.has_admin_role(ARRAY['monitoring']));
GRANT SELECT ON public.push_subscriptions TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.push_subscriptions FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.save_my_push_subscription(p_endpoint TEXT,p_p256dh TEXT,p_auth_secret TEXT,p_user_agent TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF length(trim(COALESCE(p_endpoint,'')))<20 OR length(trim(COALESCE(p_p256dh,'')))<20 OR length(trim(COALESCE(p_auth_secret,'')))<8 THEN RAISE EXCEPTION 'Invalid push subscription'; END IF;
  INSERT INTO public.push_subscriptions(user_id,endpoint,p256dh,auth_secret,user_agent)
  VALUES(auth.uid(),trim(p_endpoint),trim(p_p256dh),trim(p_auth_secret),left(p_user_agent,500))
  ON CONFLICT(user_id,endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh,auth_secret=EXCLUDED.auth_secret,user_agent=EXCLUDED.user_agent,is_active=TRUE,failure_count=0,updated_at=NOW()
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.remove_my_push_subscription(p_endpoint TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.push_subscriptions SET is_active=FALSE,updated_at=NOW() WHERE user_id=auth.uid() AND endpoint=p_endpoint;
END; $$;

REVOKE ALL ON FUNCTION public.save_my_push_subscription(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.save_my_push_subscription(TEXT,TEXT,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.remove_my_push_subscription(TEXT) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.remove_my_push_subscription(TEXT) TO authenticated;

-- END MIGRATION: 20261024173000_push_subscriptions.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261024190000_operational_hardening.sql
-- ============================================================================

-- Operational hardening: observable errors and provider-neutral casino ledger.
-- Casino remains disabled until a licensed aggregator and compliance approvals exist.

CREATE TABLE IF NOT EXISTS public.error_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fingerprint TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('browser','api','worker','provider')),
  severity TEXT NOT NULL DEFAULT 'error' CHECK (severity IN ('warning','error','fatal')),
  message TEXT NOT NULL,
  route TEXT,
  stack TEXT,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  context JSONB NOT NULL DEFAULT '{}'::JSONB,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS error_events_created_idx ON public.error_events(created_at DESC);
CREATE INDEX IF NOT EXISTS error_events_fingerprint_idx ON public.error_events(fingerprint,created_at DESC);
ALTER TABLE public.error_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Monitoring admins read error events" ON public.error_events;
CREATE POLICY "Monitoring admins read error events" ON public.error_events FOR SELECT TO authenticated
USING (public.has_admin_role(ARRAY[]::TEXT[]));
REVOKE ALL ON public.error_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.error_events TO authenticated;

CREATE TABLE IF NOT EXISTS public.casino_providers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  is_demo BOOLEAN NOT NULL DEFAULT TRUE,
  settings JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'not_tested' CHECK (status IN ('not_tested','healthy','degraded','offline')),
  last_health_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.casino_games (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id UUID NOT NULL REFERENCES public.casino_providers(id) ON DELETE CASCADE,
  external_game_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('slots','live','table','jackpot','instant','other')),
  thumbnail_url TEXT,
  is_popular BOOLEAN NOT NULL DEFAULT FALSE,
  is_new BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider_id,external_game_id)
);

CREATE TABLE IF NOT EXISTS public.casino_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES public.casino_providers(id) ON DELETE RESTRICT,
  game_id UUID NOT NULL REFERENCES public.casino_games(id) ON DELETE RESTRICT,
  provider_session_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'creating' CHECK (status IN ('creating','active','closed','failed')),
  currency TEXT NOT NULL DEFAULT 'USD',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS casino_sessions_user_idx ON public.casino_sessions(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.casino_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id UUID NOT NULL REFERENCES public.casino_providers(id) ON DELETE RESTRICT,
  session_id UUID NOT NULL REFERENCES public.casino_sessions(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  game_id UUID NOT NULL REFERENCES public.casino_games(id) ON DELETE RESTRICT,
  provider_event_id TEXT NOT NULL,
  provider_round_id TEXT,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('bet','win','refund')),
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  balance_after NUMERIC(15,2) NOT NULL,
  payload_hash TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider_id,provider_event_id)
);
CREATE INDEX IF NOT EXISTS casino_transactions_user_idx ON public.casino_transactions(user_id,created_at DESC);

ALTER TABLE public.casino_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casino_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casino_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casino_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public reads active casino games" ON public.casino_games;
CREATE POLICY "Public reads active casino games" ON public.casino_games FOR SELECT USING (is_active=TRUE);
DROP POLICY IF EXISTS "Public reads enabled casino providers" ON public.casino_providers;
CREATE POLICY "Public reads enabled casino providers" ON public.casino_providers FOR SELECT USING (is_enabled=TRUE);
DROP POLICY IF EXISTS "Admins manage casino providers" ON public.casino_providers;
CREATE POLICY "Admins manage casino providers" ON public.casino_providers FOR ALL TO authenticated USING (public.has_admin_role(NULL)) WITH CHECK (public.has_admin_role(NULL));
DROP POLICY IF EXISTS "Admins manage casino games" ON public.casino_games;
CREATE POLICY "Admins manage casino games" ON public.casino_games FOR ALL TO authenticated USING (public.has_admin_role(NULL)) WITH CHECK (public.has_admin_role(NULL));
DROP POLICY IF EXISTS "Users read own casino sessions" ON public.casino_sessions;
CREATE POLICY "Users read own casino sessions" ON public.casino_sessions FOR SELECT TO authenticated USING (user_id=auth.uid());
DROP POLICY IF EXISTS "Users read own casino transactions" ON public.casino_transactions;
CREATE POLICY "Users read own casino transactions" ON public.casino_transactions FOR SELECT TO authenticated USING (user_id=auth.uid());

ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_type_check CHECK (
  type IN ('deposit','withdrawal','bet_placed','bet_won','bet_lost','bonus_awarded','bonus_wagered','referral_bonus','adjustment','casino_bet','casino_win','casino_refund')
);

CREATE OR REPLACE FUNCTION public.apply_casino_transaction(
  p_provider_code TEXT,p_session_id UUID,p_provider_event_id TEXT,p_provider_round_id TEXT,
  p_transaction_type TEXT,p_amount NUMERIC,p_currency TEXT,p_payload_hash TEXT,p_metadata JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_provider UUID; v_user UUID; v_game UUID; v_balance NUMERIC; v_before NUMERIC;
  v_transaction UUID; v_wallet_type TEXT; v_signed_amount NUMERIC;
BEGIN
  IF p_transaction_type NOT IN ('bet','win','refund') OR p_amount<=0 OR UPPER(p_currency)<>'USD' THEN
    RAISE EXCEPTION 'Invalid casino transaction';
  END IF;
  SELECT id INTO v_provider FROM public.casino_providers WHERE code=p_provider_code AND is_enabled=TRUE FOR UPDATE;
  IF v_provider IS NULL THEN RAISE EXCEPTION 'Casino provider is unavailable'; END IF;
  SELECT user_id,game_id INTO v_user,v_game FROM public.casino_sessions
  WHERE id=p_session_id AND provider_id=v_provider AND status='active' FOR UPDATE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'Casino session is unavailable'; END IF;
  SELECT id,balance_after INTO v_transaction,v_balance FROM public.casino_transactions
  WHERE provider_id=v_provider AND provider_event_id=p_provider_event_id;
  IF v_transaction IS NOT NULL THEN RETURN jsonb_build_object('transaction_id',v_transaction,'balance',v_balance,'replayed',TRUE); END IF;

  SELECT demo_balance INTO v_before FROM public.profiles WHERE id=v_user FOR UPDATE;
  IF p_transaction_type='bet' AND v_before<p_amount THEN RAISE EXCEPTION 'Insufficient wallet balance'; END IF;
  v_signed_amount:=CASE WHEN p_transaction_type='bet' THEN -p_amount ELSE p_amount END;
  v_balance:=v_before+v_signed_amount;
  v_wallet_type:=CASE p_transaction_type WHEN 'bet' THEN 'casino_bet' WHEN 'win' THEN 'casino_win' ELSE 'casino_refund' END;

  INSERT INTO public.casino_transactions(provider_id,session_id,user_id,game_id,provider_event_id,provider_round_id,transaction_type,amount,currency,balance_after,payload_hash,metadata)
  VALUES(v_provider,p_session_id,v_user,v_game,p_provider_event_id,p_provider_round_id,p_transaction_type,p_amount,'USD',v_balance,p_payload_hash,COALESCE(p_metadata,'{}'::JSONB))
  RETURNING id INTO v_transaction;
  UPDATE public.profiles SET demo_balance=v_balance,updated_at=NOW() WHERE id=v_user;
  INSERT INTO public.wallet_transactions(user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata)
  VALUES(v_user,v_wallet_type,v_signed_amount,v_before,v_balance,'Casino '||p_transaction_type,v_transaction,'completed',jsonb_build_object('provider',p_provider_code,'round_id',p_provider_round_id));
  RETURN jsonb_build_object('transaction_id',v_transaction,'balance',v_balance,'replayed',FALSE);
END;
$$;

REVOKE ALL ON public.casino_providers,public.casino_games,public.casino_sessions,public.casino_transactions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.casino_providers,public.casino_games TO anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.casino_providers,public.casino_games TO authenticated;
GRANT SELECT ON public.casino_sessions,public.casino_transactions TO authenticated;
REVOKE ALL ON FUNCTION public.apply_casino_transaction(TEXT,UUID,TEXT,TEXT,TEXT,NUMERIC,TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated;

INSERT INTO public.casino_providers(code,name,is_enabled,is_demo,status)
VALUES('demo','PrimeBet Demo Casino',FALSE,TRUE,'not_tested') ON CONFLICT(code) DO NOTHING;

-- END MIGRATION: 20261024190000_operational_hardening.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261026100000_support_conversations.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  author_role TEXT NOT NULL CHECK (author_role IN ('customer', 'staff')),
  message TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 5000),
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket_created
  ON public.support_ticket_messages(ticket_id, created_at);

ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_customers_read_messages ON public.support_ticket_messages;
CREATE POLICY support_customers_read_messages ON public.support_ticket_messages
  FOR SELECT TO authenticated
  USING (
    is_internal = FALSE
    AND EXISTS (
      SELECT 1 FROM public.support_tickets ticket
      WHERE ticket.id = ticket_id AND ticket.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS support_staff_read_messages ON public.support_ticket_messages;
CREATE POLICY support_staff_read_messages ON public.support_ticket_messages
  FOR SELECT TO authenticated
  USING (public.has_admin_role(ARRAY['support']));

DROP POLICY IF EXISTS support_customers_add_messages ON public.support_ticket_messages;
CREATE POLICY support_customers_add_messages ON public.support_ticket_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND author_role = 'customer'
    AND is_internal = FALSE
    AND EXISTS (
      SELECT 1 FROM public.support_tickets ticket
      WHERE ticket.id = ticket_id AND ticket.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT ON public.support_ticket_messages TO authenticated;

CREATE OR REPLACE FUNCTION public.create_support_ticket(
  p_subject TEXT,
  p_message TEXT,
  p_priority TEXT DEFAULT 'medium'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_ticket UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF char_length(btrim(COALESCE(p_subject, ''))) NOT BETWEEN 3 AND 160 THEN
    RAISE EXCEPTION 'Subject must be between 3 and 160 characters';
  END IF;
  IF char_length(btrim(COALESCE(p_message, ''))) NOT BETWEEN 10 AND 5000 THEN
    RAISE EXCEPTION 'Message must be between 10 and 5000 characters';
  END IF;
  IF p_priority NOT IN ('low', 'medium', 'high', 'urgent') THEN
    RAISE EXCEPTION 'Invalid ticket priority';
  END IF;

  INSERT INTO public.support_tickets (user_id, subject, message, priority)
  VALUES (v_user, btrim(p_subject), btrim(p_message), p_priority)
  RETURNING id INTO v_ticket;

  INSERT INTO public.support_ticket_messages (ticket_id, author_id, author_role, message)
  VALUES (v_ticket, v_user, 'customer', btrim(p_message));

  RETURN v_ticket;
END;
$$;

CREATE OR REPLACE FUNCTION public.reply_support_ticket(
  p_ticket_id UUID,
  p_message TEXT,
  p_internal BOOLEAN DEFAULT FALSE,
  p_status TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_ticket public.support_tickets%ROWTYPE;
  v_is_staff BOOLEAN;
  v_message UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF char_length(btrim(COALESCE(p_message, ''))) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'Reply must be between 1 and 5000 characters';
  END IF;

  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support ticket not found'; END IF;

  v_is_staff := public.has_admin_role(ARRAY['support']);
  IF NOT v_is_staff AND v_ticket.user_id <> v_user THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF NOT v_is_staff AND p_internal THEN RAISE EXCEPTION 'Internal notes are staff only'; END IF;
  IF p_status IS NOT NULL AND (NOT v_is_staff OR p_status NOT IN ('open', 'in_progress', 'resolved', 'closed')) THEN
    RAISE EXCEPTION 'Invalid status change';
  END IF;

  INSERT INTO public.support_ticket_messages (ticket_id, author_id, author_role, message, is_internal)
  VALUES (p_ticket_id, v_user, CASE WHEN v_is_staff THEN 'staff' ELSE 'customer' END, btrim(p_message), COALESCE(p_internal, FALSE))
  RETURNING id INTO v_message;

  UPDATE public.support_tickets
  SET status = CASE
        WHEN p_status IS NOT NULL THEN p_status
        WHEN v_is_staff THEN 'in_progress'
        WHEN status IN ('resolved', 'closed') THEN 'open'
        ELSE status
      END,
      assigned_to = CASE WHEN v_is_staff THEN COALESCE(assigned_to, v_user) ELSE assigned_to END,
      updated_at = NOW()
  WHERE id = p_ticket_id;

  IF v_is_staff AND NOT COALESCE(p_internal, FALSE) THEN
    INSERT INTO public.notifications (user_id, type, title, message, metadata)
    VALUES (v_ticket.user_id, 'support_reply', 'Support replied', left(btrim(p_message), 240), jsonb_build_object('ticket_id', p_ticket_id));
  END IF;

  IF v_is_staff THEN
    INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, changes)
    VALUES (v_user, 'support_reply', 'support_ticket', p_ticket_id, jsonb_build_object('internal', COALESCE(p_internal, FALSE), 'status', p_status));
  END IF;

  RETURN v_message;
END;
$$;

REVOKE ALL ON FUNCTION public.create_support_ticket(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(TEXT, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.reply_support_ticket(UUID, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reply_support_ticket(UUID, TEXT, BOOLEAN, TEXT) TO authenticated;

-- END MIGRATION: 20261026100000_support_conversations.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261026100057_migration_c4d5f4a0.sql
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.wallet_accounts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance NUMERIC(15,2) NOT NULL DEFAULT 10000.00,
  bonus_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'bet_placed', 'bet_won', 'bet_lost', 'bonus_awarded', 'bonus_wagered', 'referral_bonus', 'adjustment')),
  amount NUMERIC(15,2) NOT NULL,
  balance_before NUMERIC(15,2) NOT NULL DEFAULT 0,
  balance_after NUMERIC(15,2) NOT NULL DEFAULT 0,
  description TEXT,
  reference_id UUID,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id UUID NOT NULL REFERENCES public.sports(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  country TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sport_id, slug)
);

CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id UUID NOT NULL REFERENCES public.sports(id) ON DELETE CASCADE,
  league_id UUID REFERENCES public.leagues(id) ON DELETE SET NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'live', 'finished', 'cancelled', 'postponed')),
  live_score_home INTEGER,
  live_score_away INTEGER,
  live_minute INTEGER,
  venue TEXT,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
  provider_event_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('match_result', 'over_under', 'handicap', 'both_teams_score', 'correct_score', 'double_chance', 'draw_no_bet', 'first_half', 'total_goals')),
  line NUMERIC(10,2),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'settled')),
  result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.odds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  selection TEXT NOT NULL,
  value NUMERIC(10,2) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  last_provider_update TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('single', 'multiple', 'system')),
  stake NUMERIC(15,2) NOT NULL CHECK (stake > 0),
  total_odds NUMERIC(10,2) NOT NULL CHECK (total_odds >= 1),
  potential_return NUMERIC(15,2) NOT NULL CHECK (potential_return >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost', 'void', 'cashout', 'cancelled')),
  settled_at TIMESTAMPTZ,
  payout NUMERIC(15,2),
  wallet_transaction_id UUID REFERENCES public.wallet_transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bet_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id UUID NOT NULL REFERENCES public.bets(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id),
  market_id UUID NOT NULL REFERENCES public.markets(id),
  odds_id UUID NOT NULL REFERENCES public.odds(id),
  selection TEXT NOT NULL,
  odds_value NUMERIC(10,2) NOT NULL CHECK (odds_value >= 1),
  result TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('won', 'lost', 'void', 'pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('account', 'betting', 'payments', 'technical', 'other')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_response', 'resolved', 'closed')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assigned_to UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_role TEXT NOT NULL CHECK (author_role IN ('customer', 'staff')),
  message TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 5000),
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('info', 'warning', 'success', 'urgent')),
  priority INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_announcement_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, announcement_id)
);

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  bet_results BOOLEAN NOT NULL DEFAULT TRUE,
  promotions BOOLEAN NOT NULL DEFAULT TRUE,
  account_updates BOOLEAN NOT NULL DEFAULT TRUE,
  live_events BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_created ON public.wallet_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_status_start ON public.events(status, start_time);
CREATE INDEX IF NOT EXISTS idx_markets_event_id ON public.markets(event_id);
CREATE INDEX IF NOT EXISTS idx_odds_market_active ON public.odds(market_id, is_active);
CREATE INDEX IF NOT EXISTS idx_bets_user_created ON public.bets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bet_selections_bet_id ON public.bet_selections(bet_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_created ON public.support_tickets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_created ON public.support_ticket_messages(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_active ON public.announcements(is_active, starts_at DESC);

ALTER TABLE public.wallet_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.odds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bet_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_announcement_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_wallet_account" ON public.wallet_accounts;
CREATE POLICY "select_own_wallet_account" ON public.wallet_accounts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_wallet_account" ON public.wallet_accounts;
CREATE POLICY "update_own_wallet_account" ON public.wallet_accounts
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "select_own_wallet_transactions" ON public.wallet_transactions;
CREATE POLICY "select_own_wallet_transactions" ON public.wallet_transactions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "public_read_sports" ON public.sports;
CREATE POLICY "public_read_sports" ON public.sports
  FOR SELECT TO anon, authenticated
  USING (is_active = TRUE);

DROP POLICY IF EXISTS "public_read_leagues" ON public.leagues;
CREATE POLICY "public_read_leagues" ON public.leagues
  FOR SELECT TO anon, authenticated
  USING (is_active = TRUE);

DROP POLICY IF EXISTS "public_read_events" ON public.events;
CREATE POLICY "public_read_events" ON public.events
  FOR SELECT TO anon, authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "public_read_markets" ON public.markets;
CREATE POLICY "public_read_markets" ON public.markets
  FOR SELECT TO anon, authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "public_read_odds" ON public.odds;
CREATE POLICY "public_read_odds" ON public.odds
  FOR SELECT TO anon, authenticated
  USING (is_active = TRUE);

DROP POLICY IF EXISTS "select_own_bets" ON public.bets;
CREATE POLICY "select_own_bets" ON public.bets
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "select_own_bet_selections" ON public.bet_selections;
CREATE POLICY "select_own_bet_selections" ON public.bet_selections
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bets b
      WHERE b.id = bet_id AND b.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "select_own_support_tickets" ON public.support_tickets;
CREATE POLICY "select_own_support_tickets" ON public.support_tickets
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_support_tickets" ON public.support_tickets;
CREATE POLICY "insert_own_support_tickets" ON public.support_tickets
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_support_tickets" ON public.support_tickets;
CREATE POLICY "update_own_support_tickets" ON public.support_tickets
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "select_own_support_messages" ON public.support_ticket_messages;
CREATE POLICY "select_own_support_messages" ON public.support_ticket_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = ticket_id AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "insert_own_support_messages" ON public.support_ticket_messages;
CREATE POLICY "insert_own_support_messages" ON public.support_ticket_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND author_role = 'customer'
    AND is_internal = FALSE
    AND EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = ticket_id AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "public_read_announcements" ON public.announcements;
CREATE POLICY "public_read_announcements" ON public.announcements
  FOR SELECT TO anon, authenticated
  USING (
    is_active = TRUE
    AND starts_at <= NOW()
    AND (expires_at IS NULL OR expires_at > NOW())
  );

DROP POLICY IF EXISTS "manage_own_announcement_dismissals" ON public.user_announcement_dismissals;
CREATE POLICY "manage_own_announcement_dismissals" ON public.user_announcement_dismissals
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "manage_own_notification_preferences" ON public.notification_preferences;
CREATE POLICY "manage_own_notification_preferences" ON public.notification_preferences
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "select_own_notifications" ON public.notifications;
CREATE POLICY "select_own_notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_notifications" ON public.notifications;
CREATE POLICY "update_own_notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.create_support_ticket(
  p_subject TEXT,
  p_message TEXT,
  p_priority TEXT DEFAULT 'medium',
  p_category TEXT DEFAULT 'other'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_ticket_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO public.support_tickets (user_id, subject, category, priority, message)
  VALUES (v_user_id, btrim(p_subject), p_category, p_priority, btrim(p_message))
  RETURNING id INTO v_ticket_id;

  INSERT INTO public.support_ticket_messages (ticket_id, author_id, author_role, message)
  VALUES (v_ticket_id, v_user_id, 'customer', btrim(p_message));

  RETURN v_ticket_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_support_ticket(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.reply_support_ticket(
  p_ticket_id UUID,
  p_message TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_message_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.support_tickets
    WHERE id = p_ticket_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  INSERT INTO public.support_ticket_messages (ticket_id, author_id, author_role, message)
  VALUES (p_ticket_id, v_user_id, 'customer', btrim(p_message))
  RETURNING id INTO v_message_id;

  UPDATE public.support_tickets
  SET status = 'waiting_response',
      updated_at = NOW()
  WHERE id = p_ticket_id AND user_id = v_user_id;

  RETURN v_message_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reply_support_ticket(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reply_support_ticket(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_support_ticket(
  p_ticket_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.support_tickets
  SET status = 'closed',
      updated_at = NOW()
  WHERE id = p_ticket_id AND user_id = v_user_id;

  RETURN p_ticket_id;
END;
$$;

REVOKE ALL ON FUNCTION public.close_support_ticket(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_support_ticket(UUID) TO authenticated;

INSERT INTO public.wallet_accounts (user_id)
SELECT id
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.notification_preferences (user_id)
SELECT id
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.sports (name, slug, icon, display_order, is_active)
SELECT 'Football', 'football', 'Trophy', 1, TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.sports WHERE slug = 'football');

INSERT INTO public.sports (name, slug, icon, display_order, is_active)
SELECT 'Cricket', 'cricket', 'Activity', 2, TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.sports WHERE slug = 'cricket');

WITH football AS (
  SELECT id FROM public.sports WHERE slug = 'football' LIMIT 1
)
INSERT INTO public.leagues (sport_id, name, slug, country, display_order, is_active)
SELECT football.id, 'Premier League', 'premier-league', 'England', 1, TRUE
FROM football
WHERE NOT EXISTS (
  SELECT 1 FROM public.leagues WHERE slug = 'premier-league'
);

WITH football AS (
  SELECT id FROM public.sports WHERE slug = 'football' LIMIT 1
), league AS (
  SELECT id FROM public.leagues WHERE slug = 'premier-league' LIMIT 1
)
INSERT INTO public.events (sport_id, league_id, home_team, away_team, start_time, status, is_featured)
SELECT football.id, league.id, 'Manchester City', 'Liverpool', NOW() + INTERVAL '2 hours', 'upcoming', TRUE
FROM football, league
WHERE NOT EXISTS (
  SELECT 1 FROM public.events WHERE home_team = 'Manchester City' AND away_team = 'Liverpool'
);

WITH event_row AS (
  SELECT id FROM public.events WHERE home_team = 'Manchester City' AND away_team = 'Liverpool' LIMIT 1
)
INSERT INTO public.markets (event_id, name, type, status)
SELECT event_row.id, 'Match Result', 'match_result', 'active'
FROM event_row
WHERE NOT EXISTS (
  SELECT 1 FROM public.markets WHERE event_id = event_row.id AND name = 'Match Result'
);

WITH market_row AS (
  SELECT m.id
  FROM public.markets m
  JOIN public.events e ON e.id = m.event_id
  WHERE e.home_team = 'Manchester City' AND e.away_team = 'Liverpool' AND m.name = 'Match Result'
  LIMIT 1
)
INSERT INTO public.odds (market_id, selection, value, is_active, is_locked)
SELECT market_row.id, values_row.selection, values_row.value, TRUE, FALSE
FROM market_row,
LATERAL (
  VALUES
    ('Manchester City', 1.95::NUMERIC),
    ('Draw', 3.45::NUMERIC),
    ('Liverpool', 3.75::NUMERIC)
) AS values_row(selection, value)
WHERE NOT EXISTS (
  SELECT 1 FROM public.odds o WHERE o.market_id = market_row.id AND o.selection = values_row.selection
);

INSERT INTO public.announcements (title, message, type, priority, is_active)
SELECT 'Welcome to PrimeBet', 'Your Supabase data layer is now active for support, notifications, and live odds.', 'success', 10, TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.announcements WHERE title = 'Welcome to PrimeBet'
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.markets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.odds;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_ticket_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

COMMIT;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'wallet_accounts',
    'wallet_transactions',
    'sports',
    'leagues',
    'events',
    'markets',
    'odds',
    'bets',
    'bet_selections',
    'support_tickets',
    'support_ticket_messages',
    'announcements',
    'user_announcement_dismissals',
    'notification_preferences',
    'notifications'
  )
ORDER BY table_name;

-- END MIGRATION: 20261026100057_migration_c4d5f4a0.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261026100858_migration_d16c9286.sql
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS demo_balance NUMERIC(15,2) NOT NULL DEFAULT 10000.00;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS kyc_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS kyc_verified_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_self_excluded BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS self_exclusion_until TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS admin_role TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS suspension_reason TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deposit_limit NUMERIC(15,2);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS loss_limit NUMERIC(15,2);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Karachi';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS odds_format TEXT NOT NULL DEFAULT 'decimal';

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_admin_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_admin_role_check
CHECK (
  admin_role IN ('super_admin', 'admin', 'finance', 'kyc', 'support', 'risk_manager', 'sports_trader')
  OR admin_role IS NULL
);

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_kyc_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_kyc_status_check
CHECK (
  kyc_status IN ('not_submitted', 'pending', 'submitted', 'approved', 'rejected')
);

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_locale_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_locale_check
CHECK (locale IN ('en', 'ur'));

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_display_currency_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_display_currency_check
CHECK (display_currency IN ('USD', 'PKR'));

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_odds_format_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_odds_format_check
CHECK (odds_format IN ('decimal', 'fractional', 'american'));

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND is_admin = TRUE
      AND admin_role IS NOT NULL
      AND COALESCE(is_suspended, FALSE) = FALSE
  );
$$;

CREATE OR REPLACE FUNCTION public.has_admin_role(p_allowed_roles TEXT[] DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND is_admin = TRUE
      AND admin_role IS NOT NULL
      AND COALESCE(is_suspended, FALSE) = FALSE
      AND (
        admin_role IN ('super_admin', 'admin')
        OR p_allowed_roles IS NULL
        OR admin_role = ANY(p_allowed_roles)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_admin_role(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_admin_role(TEXT[]) TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('welcome_bonus', 'deposit_bonus', 'free_bet', 'cashback', 'referral')),
  bonus_amount NUMERIC(15,2),
  bonus_percentage NUMERIC(5,2),
  wagering_requirement NUMERIC(15,2) NOT NULL DEFAULT 0,
  min_deposit NUMERIC(15,2),
  max_bonus NUMERIC(15,2),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '90 days',
  terms_and_conditions TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  promo_code TEXT,
  per_user_claim_limit INTEGER NOT NULL DEFAULT 1,
  total_claim_limit INTEGER,
  expires_after_days INTEGER NOT NULL DEFAULT 30,
  min_odds NUMERIC(10,2) NOT NULL DEFAULT 1,
  min_legs INTEGER NOT NULL DEFAULT 1,
  loyalty_points_reward INTEGER NOT NULL DEFAULT 0,
  requires_qualifying_deposit BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_bonuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  promotion_id UUID REFERENCES public.promotions(id) ON DELETE SET NULL,
  amount NUMERIC(15,2) NOT NULL,
  remaining_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  wagering_requirement NUMERIC(15,2) NOT NULL DEFAULT 0,
  wagering_completed NUMERIC(15,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired', 'forfeited')),
  claim_source TEXT NOT NULL DEFAULT 'admin',
  expires_at TIMESTAMPTZ,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  forfeited_at TIMESTAMPTZ,
  last_wagered_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.loyalty_accounts (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  points BIGINT NOT NULL DEFAULT 0,
  lifetime_points BIGINT NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'bronze' CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.kyc_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('passport', 'national_id', 'drivers_license', 'proof_of_address', 'selfie')),
  file_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  admin_note TEXT,
  risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
  source_of_funds_status TEXT NOT NULL DEFAULT 'not_required' CHECK (source_of_funds_status IN ('not_required', 'requested', 'submitted', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, event_id)
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  changes JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.odds_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  odds_id UUID NOT NULL REFERENCES public.odds(id) ON DELETE CASCADE,
  market_id UUID NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  selection TEXT NOT NULL,
  previous_value NUMERIC(10,2) NOT NULL,
  new_value NUMERIC(10,2) NOT NULL,
  provider_odds NUMERIC(10,2),
  margin_applied NUMERIC(5,2),
  changed_by UUID REFERENCES public.profiles(id),
  change_type TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sport_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id UUID NOT NULL UNIQUE REFERENCES public.sports(id) ON DELETE CASCADE,
  default_margin NUMERIC(5,2) NOT NULL DEFAULT 5.00,
  max_stake NUMERIC(15,2) NOT NULL DEFAULT 10000.00,
  max_payout NUMERIC(15,2) NOT NULL DEFAULT 100000.00,
  live_bet_delay_seconds INTEGER NOT NULL DEFAULT 5,
  risk_threshold NUMERIC(15,2) NOT NULL DEFAULT 50000.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.market_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL UNIQUE REFERENCES public.markets(id) ON DELETE CASCADE,
  margin_override NUMERIC(5,2),
  max_stake_override NUMERIC(15,2),
  max_payout_override NUMERIC(15,2),
  risk_factor NUMERIC(3,2) NOT NULL DEFAULT 1.00,
  auto_suspend_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.market_correlations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_type_1 TEXT NOT NULL,
  market_type_2 TEXT NOT NULL,
  correlation_type TEXT NOT NULL,
  rule_description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.market_correlation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  market_id_1 UUID NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  market_id_2 UUID NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  correlation_type TEXT NOT NULL,
  is_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  adjustment_factor NUMERIC(5,2) NOT NULL DEFAULT 1.00,
  rule_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.risk_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'restricted')),
  risk_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  total_bets INTEGER NOT NULL DEFAULT 0,
  total_wagered NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_won NUMERIC(15,2) NOT NULL DEFAULT 0,
  win_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  avg_stake NUMERIC(15,2) NOT NULL DEFAULT 0,
  max_stake NUMERIC(15,2) NOT NULL DEFAULT 10000,
  max_payout NUMERIC(15,2) NOT NULL DEFAULT 100000,
  unusual_bet_count INTEGER NOT NULL DEFAULT 0,
  last_bet_at TIMESTAMPTZ,
  flagged_at TIMESTAMPTZ,
  flagged_reason TEXT,
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sport_id UUID REFERENCES public.sports(id) ON DELETE CASCADE,
  limit_type TEXT NOT NULL CHECK (limit_type IN ('stake', 'payout', 'daily_loss', 'weekly_loss')),
  limit_value NUMERIC(15,2) NOT NULL,
  current_usage NUMERIC(15,2) NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, sport_id, limit_type)
);

CREATE TABLE IF NOT EXISTS public.event_exposure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL UNIQUE REFERENCES public.events(id) ON DELETE CASCADE,
  total_stake NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_liability NUMERIC(15,2) NOT NULL DEFAULT 0,
  max_potential_payout NUMERIC(15,2) NOT NULL DEFAULT 0,
  home_liability NUMERIC(15,2) NOT NULL DEFAULT 0,
  draw_liability NUMERIC(15,2) NOT NULL DEFAULT 0,
  away_liability NUMERIC(15,2) NOT NULL DEFAULT 0,
  bet_count INTEGER NOT NULL DEFAULT 0,
  unique_users INTEGER NOT NULL DEFAULT 0,
  risk_level TEXT NOT NULL DEFAULT 'low',
  last_bet_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.market_exposure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL UNIQUE REFERENCES public.markets(id) ON DELETE CASCADE,
  total_stake NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_liability NUMERIC(15,2) NOT NULL DEFAULT 0,
  max_potential_payout NUMERIC(15,2) NOT NULL DEFAULT 0,
  bet_count INTEGER NOT NULL DEFAULT 0,
  unique_users INTEGER NOT NULL DEFAULT 0,
  selection_exposure JSONB NOT NULL DEFAULT '{}'::JSONB,
  risk_level TEXT NOT NULL DEFAULT 'low',
  last_bet_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id UUID NOT NULL REFERENCES public.bets(id) ON DELETE CASCADE,
  bet_selection_id UUID REFERENCES public.bet_selections(id) ON DELETE CASCADE,
  settlement_type TEXT NOT NULL,
  original_stake NUMERIC(15,2) NOT NULL,
  settlement_amount NUMERIC(15,2) NOT NULL,
  settled_by UUID REFERENCES public.profiles(id),
  settlement_reason TEXT,
  is_manual BOOLEAN NOT NULL DEFAULT FALSE,
  wallet_transaction_id UUID REFERENCES public.wallet_transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.trader_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  previous_value JSONB,
  new_value JSONB,
  reason TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bet_validations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id UUID REFERENCES public.bets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  validation_result TEXT NOT NULL,
  rejection_reason TEXT,
  stake_requested NUMERIC(15,2) NOT NULL,
  odds_requested NUMERIC(10,2) NOT NULL,
  odds_at_validation NUMERIC(10,2),
  market_status_at_validation TEXT,
  event_status_at_validation TEXT,
  balance_at_validation NUMERIC(15,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cashout_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id UUID NOT NULL REFERENCES public.bets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  offer_type TEXT NOT NULL,
  original_stake NUMERIC(15,2) NOT NULL,
  original_odds NUMERIC(10,2) NOT NULL,
  current_odds NUMERIC(10,2) NOT NULL,
  cashout_amount NUMERIC(15,2) NOT NULL,
  cashout_percentage NUMERIC(5,2) NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 seconds',
  accepted_at TIMESTAMPTZ,
  wallet_transaction_id UUID REFERENCES public.wallet_transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.provider_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_successful_fetch TIMESTAMPTZ,
  last_failed_fetch TIMESTAMPTZ,
  success_rate NUMERIC NOT NULL DEFAULT 100,
  avg_latency_ms INTEGER NOT NULL DEFAULT 0,
  total_requests INTEGER NOT NULL DEFAULT 0,
  failed_requests INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  key TEXT NOT NULL UNIQUE,
  request_data JSONB NOT NULL DEFAULT '{}'::JSONB,
  response_data JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS public.responsible_gaming_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  limit_type TEXT NOT NULL,
  limit_value NUMERIC NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  current_usage NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.self_exclusions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  exclusion_type TEXT NOT NULL,
  start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_date TIMESTAMPTZ,
  reason TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.fraud_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  flag_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  is_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.background_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 5,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  result JSONB,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  dedupe_key TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_bonuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.odds_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sport_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_correlations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_correlation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_exposure ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_exposure ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bet_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashout_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responsible_gaming_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.self_exclusions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fraud_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_active_promotions" ON public.promotions;
CREATE POLICY "public_read_active_promotions" ON public.promotions
FOR SELECT TO anon, authenticated
USING (is_active = TRUE AND valid_from <= NOW() AND valid_until >= NOW());

DROP POLICY IF EXISTS "finance_manage_promotions" ON public.promotions;
CREATE POLICY "finance_manage_promotions" ON public.promotions
FOR ALL TO authenticated
USING (public.has_admin_role(ARRAY['finance']))
WITH CHECK (public.has_admin_role(ARRAY['finance']));

DROP POLICY IF EXISTS "users_read_own_user_bonuses" ON public.user_bonuses;
CREATE POLICY "users_read_own_user_bonuses" ON public.user_bonuses
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "finance_read_user_bonuses" ON public.user_bonuses;
CREATE POLICY "finance_read_user_bonuses" ON public.user_bonuses
FOR SELECT TO authenticated
USING (public.has_admin_role(ARRAY['finance']));

DROP POLICY IF EXISTS "users_read_own_loyalty_accounts" ON public.loyalty_accounts;
CREATE POLICY "users_read_own_loyalty_accounts" ON public.loyalty_accounts
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_read_own_kyc_documents" ON public.kyc_documents;
CREATE POLICY "users_read_own_kyc_documents" ON public.kyc_documents
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_insert_own_kyc_documents" ON public.kyc_documents;
CREATE POLICY "users_insert_own_kyc_documents" ON public.kyc_documents
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "kyc_manage_documents" ON public.kyc_documents;
CREATE POLICY "kyc_manage_documents" ON public.kyc_documents
FOR ALL TO authenticated
USING (public.has_admin_role(ARRAY['kyc']))
WITH CHECK (public.has_admin_role(ARRAY['kyc']));

DROP POLICY IF EXISTS "users_manage_own_favorites" ON public.favorites;
CREATE POLICY "users_manage_own_favorites" ON public.favorites
FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "admins_read_audit_logs" ON public.audit_logs;
CREATE POLICY "admins_read_audit_logs" ON public.audit_logs
FOR SELECT TO authenticated
USING (public.has_admin_role(NULL));

DROP POLICY IF EXISTS "admins_insert_audit_logs" ON public.audit_logs;
CREATE POLICY "admins_insert_audit_logs" ON public.audit_logs
FOR INSERT TO authenticated
WITH CHECK (public.has_admin_role(NULL));

DROP POLICY IF EXISTS "public_read_odds_history" ON public.odds_history;
CREATE POLICY "public_read_odds_history" ON public.odds_history
FOR SELECT TO anon, authenticated
USING (TRUE);

DROP POLICY IF EXISTS "public_read_sport_config" ON public.sport_config;
CREATE POLICY "public_read_sport_config" ON public.sport_config
FOR SELECT TO anon, authenticated
USING (TRUE);

DROP POLICY IF EXISTS "public_read_market_config" ON public.market_config;
CREATE POLICY "public_read_market_config" ON public.market_config
FOR SELECT TO anon, authenticated
USING (TRUE);

DROP POLICY IF EXISTS "public_read_market_correlations" ON public.market_correlations;
CREATE POLICY "public_read_market_correlations" ON public.market_correlations
FOR SELECT TO anon, authenticated
USING (TRUE);

DROP POLICY IF EXISTS "authenticated_read_market_correlation_rules" ON public.market_correlation_rules;
CREATE POLICY "authenticated_read_market_correlation_rules" ON public.market_correlation_rules
FOR SELECT TO authenticated
USING (TRUE);

DROP POLICY IF EXISTS "users_read_own_risk_profiles" ON public.risk_profiles;
CREATE POLICY "users_read_own_risk_profiles" ON public.risk_profiles
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "admins_manage_risk_profiles" ON public.risk_profiles;
CREATE POLICY "admins_manage_risk_profiles" ON public.risk_profiles
FOR ALL TO authenticated
USING (public.has_admin_role(ARRAY['risk_manager']))
WITH CHECK (public.has_admin_role(ARRAY['risk_manager']));

DROP POLICY IF EXISTS "users_read_own_user_limits" ON public.user_limits;
CREATE POLICY "users_read_own_user_limits" ON public.user_limits
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "admins_manage_user_limits" ON public.user_limits;
CREATE POLICY "admins_manage_user_limits" ON public.user_limits
FOR ALL TO authenticated
USING (public.has_admin_role(ARRAY['risk_manager', 'sports_trader']))
WITH CHECK (public.has_admin_role(ARRAY['risk_manager', 'sports_trader']));

DROP POLICY IF EXISTS "admins_read_event_exposure" ON public.event_exposure;
CREATE POLICY "admins_read_event_exposure" ON public.event_exposure
FOR SELECT TO authenticated
USING (public.has_admin_role(ARRAY['risk_manager', 'sports_trader']));

DROP POLICY IF EXISTS "admins_read_market_exposure" ON public.market_exposure;
CREATE POLICY "admins_read_market_exposure" ON public.market_exposure
FOR SELECT TO authenticated
USING (public.has_admin_role(ARRAY['risk_manager', 'sports_trader']));

DROP POLICY IF EXISTS "users_read_own_settlements" ON public.settlements;
CREATE POLICY "users_read_own_settlements" ON public.settlements
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.bets
    WHERE bets.id = settlements.bet_id
      AND bets.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "admins_manage_settlements" ON public.settlements;
CREATE POLICY "admins_manage_settlements" ON public.settlements
FOR ALL TO authenticated
USING (public.has_admin_role(ARRAY['risk_manager', 'sports_trader']))
WITH CHECK (public.has_admin_role(ARRAY['risk_manager', 'sports_trader']));

DROP POLICY IF EXISTS "admins_read_trader_actions" ON public.trader_actions;
CREATE POLICY "admins_read_trader_actions" ON public.trader_actions
FOR SELECT TO authenticated
USING (public.has_admin_role(ARRAY['sports_trader', 'risk_manager']));

DROP POLICY IF EXISTS "admins_insert_trader_actions" ON public.trader_actions;
CREATE POLICY "admins_insert_trader_actions" ON public.trader_actions
FOR INSERT TO authenticated
WITH CHECK (public.has_admin_role(ARRAY['sports_trader', 'risk_manager']));

DROP POLICY IF EXISTS "users_read_own_bet_validations" ON public.bet_validations;
CREATE POLICY "users_read_own_bet_validations" ON public.bet_validations
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_read_own_cashout_offers" ON public.cashout_offers;
CREATE POLICY "users_read_own_cashout_offers" ON public.cashout_offers
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "admins_read_provider_health" ON public.provider_health;
CREATE POLICY "admins_read_provider_health" ON public.provider_health
FOR SELECT TO authenticated
USING (public.has_admin_role(ARRAY['sports_trader', 'support']));

DROP POLICY IF EXISTS "admins_write_provider_health" ON public.provider_health;
CREATE POLICY "admins_write_provider_health" ON public.provider_health
FOR ALL TO authenticated
USING (public.has_admin_role(ARRAY['sports_trader']))
WITH CHECK (public.has_admin_role(ARRAY['sports_trader']));

DROP POLICY IF EXISTS "users_read_own_idempotency_keys" ON public.idempotency_keys;
CREATE POLICY "users_read_own_idempotency_keys" ON public.idempotency_keys
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_insert_own_idempotency_keys" ON public.idempotency_keys;
CREATE POLICY "users_insert_own_idempotency_keys" ON public.idempotency_keys
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_delete_own_idempotency_keys" ON public.idempotency_keys;
CREATE POLICY "users_delete_own_idempotency_keys" ON public.idempotency_keys
FOR DELETE TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_read_own_rg_limits" ON public.responsible_gaming_limits;
CREATE POLICY "users_read_own_rg_limits" ON public.responsible_gaming_limits
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_insert_own_rg_limits" ON public.responsible_gaming_limits;
CREATE POLICY "users_insert_own_rg_limits" ON public.responsible_gaming_limits
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_update_own_rg_limits" ON public.responsible_gaming_limits;
CREATE POLICY "users_update_own_rg_limits" ON public.responsible_gaming_limits
FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_read_own_self_exclusions" ON public.self_exclusions;
CREATE POLICY "users_read_own_self_exclusions" ON public.self_exclusions
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_insert_own_self_exclusions" ON public.self_exclusions;
CREATE POLICY "users_insert_own_self_exclusions" ON public.self_exclusions
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_update_own_self_exclusions" ON public.self_exclusions;
CREATE POLICY "users_update_own_self_exclusions" ON public.self_exclusions
FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "admins_manage_fraud_flags" ON public.fraud_flags;
CREATE POLICY "admins_manage_fraud_flags" ON public.fraud_flags
FOR ALL TO authenticated
USING (public.has_admin_role(ARRAY['risk_manager']))
WITH CHECK (public.has_admin_role(ARRAY['risk_manager']));

DROP POLICY IF EXISTS "admins_manage_background_jobs" ON public.background_jobs;
CREATE POLICY "admins_manage_background_jobs" ON public.background_jobs
FOR ALL TO authenticated
USING (public.has_admin_role(ARRAY['sports_trader', 'risk_manager', 'support']))
WITH CHECK (public.has_admin_role(ARRAY['sports_trader', 'risk_manager', 'support']));

CREATE OR REPLACE FUNCTION public.get_my_wallet_balances()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'currency', COALESCE(wa.currency, 'USD'),
    'cash', COALESCE(p.demo_balance, COALESCE(wa.balance, 0)),
    'bonus', COALESCE(wa.bonus_balance, 0),
    'locked', 0,
    'available', COALESCE(p.demo_balance, COALESCE(wa.balance, 0)) + COALESCE(wa.bonus_balance, 0)
  )
  FROM public.profiles p
  LEFT JOIN public.wallet_accounts wa ON wa.user_id = p.id
  WHERE p.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.place_bet_atomic(
  p_bet_type TEXT,
  p_stake NUMERIC,
  p_selections JSONB,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_balance NUMERIC;
  v_bet_id UUID;
  v_tx_id UUID;
  v_selection JSONB;
  v_total_odds NUMERIC := 1;
  v_current_odds NUMERIC;
  v_cached JSONB;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_bet_type NOT IN ('single', 'multiple', 'system') THEN
    RAISE EXCEPTION 'Invalid bet type';
  END IF;
  IF p_stake IS NULL OR p_stake <= 0 THEN
    RAISE EXCEPTION 'Invalid stake';
  END IF;
  IF p_selections IS NULL OR jsonb_typeof(p_selections) <> 'array' OR jsonb_array_length(p_selections) = 0 THEN
    RAISE EXCEPTION 'Selections are required';
  END IF;
  IF p_idempotency_key IS NULL OR char_length(trim(p_idempotency_key)) < 8 THEN
    RAISE EXCEPTION 'A valid idempotency key is required';
  END IF;

  SELECT response_data INTO v_cached
  FROM public.idempotency_keys
  WHERE user_id = v_user
    AND key = p_idempotency_key
    AND expires_at > NOW();

  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  SELECT demo_balance INTO v_balance
  FROM public.profiles
  WHERE id = v_user
    AND COALESCE(is_suspended, FALSE) = FALSE
    AND (self_exclusion_until IS NULL OR self_exclusion_until <= NOW())
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account is unavailable';
  END IF;
  IF v_balance < p_stake THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  FOR v_selection IN SELECT value FROM jsonb_array_elements(p_selections)
  LOOP
    SELECT value INTO v_current_odds
    FROM public.odds
    WHERE id = (v_selection->>'odds_id')::UUID
      AND is_active = TRUE
      AND COALESCE(is_locked, FALSE) = FALSE;

    IF v_current_odds IS NULL THEN
      RAISE EXCEPTION 'A selected odd is unavailable';
    END IF;

    v_total_odds := v_total_odds * v_current_odds;
  END LOOP;

  INSERT INTO public.bets (user_id, type, stake, total_odds, potential_return, status)
  VALUES (v_user, p_bet_type, p_stake, ROUND(v_total_odds, 2), ROUND(p_stake * v_total_odds, 2), 'pending')
  RETURNING id INTO v_bet_id;

  FOR v_selection IN SELECT value FROM jsonb_array_elements(p_selections)
  LOOP
    INSERT INTO public.bet_selections (
      bet_id, event_id, market_id, odds_id, selection, odds_value, result
    )
    VALUES (
      v_bet_id,
      (v_selection->>'event_id')::UUID,
      (v_selection->>'market_id')::UUID,
      (v_selection->>'odds_id')::UUID,
      v_selection->>'selection',
      COALESCE((v_selection->>'odds_value')::NUMERIC, 1),
      'pending'
    );
  END LOOP;

  UPDATE public.profiles
  SET demo_balance = demo_balance - p_stake,
      updated_at = NOW()
  WHERE id = v_user;

  INSERT INTO public.wallet_transactions (
    user_id, type, amount, balance_before, balance_after, description, reference_id, status, metadata
  )
  VALUES (
    v_user,
    'bet_placed',
    -p_stake,
    v_balance,
    v_balance - p_stake,
    'Bet placed',
    v_bet_id,
    'completed',
    jsonb_build_object('bet_type', p_bet_type)
  )
  RETURNING id INTO v_tx_id;

  UPDATE public.bets
  SET wallet_transaction_id = v_tx_id
  WHERE id = v_bet_id;

  INSERT INTO public.idempotency_keys (user_id, key, request_data, response_data, expires_at)
  VALUES (
    v_user,
    p_idempotency_key,
    jsonb_build_object('bet_type', p_bet_type, 'stake', p_stake, 'selections', p_selections),
    jsonb_build_object(
      'success', TRUE,
      'result', 'accepted',
      'bet', jsonb_build_object(
        'id', v_bet_id,
        'type', p_bet_type,
        'stake', p_stake,
        'totalOdds', ROUND(v_total_odds, 2),
        'potentialReturn', ROUND(p_stake * v_total_odds, 2),
        'status', 'pending'
      )
    ),
    NOW() + INTERVAL '24 hours'
  );

  RETURN (
    SELECT response_data
    FROM public.idempotency_keys
    WHERE user_id = v_user AND key = p_idempotency_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.place_system_bet_atomic(
  p_stake NUMERIC,
  p_selections JSONB,
  p_combination_size INTEGER,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_response JSONB;
BEGIN
  IF p_combination_size IS NULL OR p_combination_size < 2 THEN
    RAISE EXCEPTION 'Invalid combination size';
  END IF;

  v_response := public.place_bet_atomic('system', p_stake, p_selections, p_idempotency_key);
  RETURN jsonb_set(v_response, '{bet,combinationSize}', to_jsonb(p_combination_size), TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_bet_atomic(p_bet_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_bet public.bets%ROWTYPE;
  v_balance NUMERIC;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_bet
  FROM public.bets
  WHERE id = p_bet_id AND user_id = v_user
  FOR UPDATE;

  IF NOT FOUND OR v_bet.status <> 'pending' THEN
    RAISE EXCEPTION 'Bet is not cancellable';
  END IF;

  SELECT demo_balance INTO v_balance
  FROM public.profiles
  WHERE id = v_user
  FOR UPDATE;

  UPDATE public.profiles
  SET demo_balance = demo_balance + v_bet.stake,
      updated_at = NOW()
  WHERE id = v_user;

  UPDATE public.bets
  SET status = 'cancelled',
      payout = v_bet.stake,
      settled_at = NOW()
  WHERE id = p_bet_id;

  INSERT INTO public.wallet_transactions (
    user_id, type, amount, balance_before, balance_after, description, reference_id, status
  )
  VALUES (
    v_user,
    'adjustment',
    v_bet.stake,
    v_balance,
    v_balance + v_bet.stake,
    'Bet cancellation refund',
    p_bet_id,
    'completed'
  );

  RETURN jsonb_build_object('success', TRUE, 'betId', p_bet_id);
END;
$$;

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
  v_user UUID := auth.uid();
  v_bet public.bets%ROWTYPE;
  v_balance NUMERIC;
  v_full_offer NUMERIC;
  v_credit NUMERIC;
  v_tx_id UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_bet
  FROM public.bets
  WHERE id = p_bet_id AND user_id = v_user
  FOR UPDATE;

  IF NOT FOUND OR v_bet.status <> 'pending' THEN
    RAISE EXCEPTION 'Cashout is unavailable';
  END IF;

  v_full_offer := ROUND(COALESCE(v_bet.potential_return, v_bet.stake) * 0.60, 2);

  IF p_cashout_type = 'partial' THEN
    IF p_partial_amount IS NULL OR p_partial_amount <= 0 OR p_partial_amount >= v_full_offer THEN
      RAISE EXCEPTION 'Invalid partial cashout amount';
    END IF;
    v_credit := p_partial_amount;
  ELSE
    v_credit := v_full_offer;
  END IF;

  SELECT demo_balance INTO v_balance
  FROM public.profiles
  WHERE id = v_user
  FOR UPDATE;

  UPDATE public.profiles
  SET demo_balance = demo_balance + v_credit,
      updated_at = NOW()
  WHERE id = v_user;

  INSERT INTO public.wallet_transactions (
    user_id, type, amount, balance_before, balance_after, description, reference_id, status
  )
  VALUES (
    v_user,
    'adjustment',
    v_credit,
    v_balance,
    v_balance + v_credit,
    'Cashout accepted',
    p_bet_id,
    'completed'
  )
  RETURNING id INTO v_tx_id;

  INSERT INTO public.cashout_offers (
    bet_id, user_id, offer_type, original_stake, original_odds, current_odds,
    cashout_amount, cashout_percentage, is_available, expires_at, accepted_at, wallet_transaction_id
  )
  VALUES (
    p_bet_id,
    v_user,
    p_cashout_type,
    v_bet.stake,
    v_bet.total_odds,
    v_bet.total_odds,
    v_credit,
    CASE WHEN v_full_offer = 0 THEN 0 ELSE ROUND((v_credit / v_full_offer) * 100, 2) END,
    FALSE,
    NOW(),
    NOW(),
    v_tx_id
  );

  IF p_cashout_type = 'full' THEN
    UPDATE public.bets
    SET status = 'cashout',
        payout = v_credit,
        settled_at = NOW()
    WHERE id = p_bet_id;
  ELSE
    UPDATE public.bets
    SET stake = ROUND(v_bet.stake - v_credit, 2),
        potential_return = ROUND(GREATEST(v_bet.potential_return - v_credit, 0), 2)
    WHERE id = p_bet_id;
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'betId', p_bet_id, 'cashoutAmount', v_credit);
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_bet(
  p_bet_id UUID,
  p_result TEXT,
  p_payout NUMERIC DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bet public.bets%ROWTYPE;
  v_balance NUMERIC;
  v_credit NUMERIC := 0;
BEGIN
  IF NOT public.has_admin_role(ARRAY['risk_manager', 'sports_trader']) THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  SELECT * INTO v_bet
  FROM public.bets
  WHERE id = p_bet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;

  SELECT demo_balance INTO v_balance
  FROM public.profiles
  WHERE id = v_bet.user_id
  FOR UPDATE;

  IF p_result = 'won' THEN
    v_credit := COALESCE(p_payout, v_bet.potential_return);
  ELSIF p_result = 'void' THEN
    v_credit := v_bet.stake;
  ELSE
    v_credit := 0;
  END IF;

  UPDATE public.profiles
  SET demo_balance = demo_balance + v_credit,
      updated_at = NOW()
  WHERE id = v_bet.user_id;

  UPDATE public.bets
  SET status = p_result,
      payout = v_credit,
      settled_at = NOW()
  WHERE id = p_bet_id;

  INSERT INTO public.wallet_transactions (
    user_id, type, amount, balance_before, balance_after, description, reference_id, status
  )
  VALUES (
    v_bet.user_id,
    CASE WHEN p_result = 'won' THEN 'bet_won' WHEN p_result = 'lost' THEN 'bet_lost' ELSE 'adjustment' END,
    v_credit,
    v_balance,
    v_balance + v_credit,
    'Bet settled',
    p_bet_id,
    'completed'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_promotion(
  p_promotion_id UUID,
  p_promo_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_promo public.promotions%ROWTYPE;
  v_claim_count INTEGER;
  v_bonus_id UUID;
  v_amount NUMERIC;
  v_balance NUMERIC;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_promo
  FROM public.promotions
  WHERE id = p_promotion_id
    AND is_active = TRUE
    AND valid_from <= NOW()
    AND valid_until >= NOW();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promotion is unavailable';
  END IF;

  IF v_promo.promo_code IS NOT NULL
     AND lower(trim(COALESCE(p_promo_code, ''))) <> lower(v_promo.promo_code) THEN
    RAISE EXCEPTION 'Invalid promo code';
  END IF;

  SELECT COUNT(*) INTO v_claim_count
  FROM public.user_bonuses
  WHERE user_id = v_user AND promotion_id = p_promotion_id;

  IF v_claim_count >= COALESCE(v_promo.per_user_claim_limit, 1) THEN
    RAISE EXCEPTION 'Promotion claim limit reached';
  END IF;

  v_amount := COALESCE(v_promo.bonus_amount, v_promo.max_bonus, 0);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Promotion has no claimable amount';
  END IF;

  SELECT demo_balance INTO v_balance
  FROM public.profiles
  WHERE id = v_user
  FOR UPDATE;

  INSERT INTO public.user_bonuses (
    user_id, promotion_id, amount, remaining_amount, wagering_requirement,
    wagering_completed, status, expires_at, claim_source
  )
  VALUES (
    v_user,
    p_promotion_id,
    v_amount,
    v_amount,
    COALESCE(v_promo.wagering_requirement, 0),
    0,
    'active',
    NOW() + make_interval(days => COALESCE(v_promo.expires_after_days, 30)),
    CASE WHEN v_promo.promo_code IS NULL THEN 'automatic' ELSE 'promo_code' END
  )
  RETURNING id INTO v_bonus_id;

  UPDATE public.profiles
  SET demo_balance = demo_balance + v_amount,
      updated_at = NOW()
  WHERE id = v_user;

  INSERT INTO public.wallet_transactions (
    user_id, type, amount, balance_before, balance_after, description, reference_id, status, metadata
  )
  VALUES (
    v_user,
    'bonus_awarded',
    v_amount,
    v_balance,
    v_balance + v_amount,
    'Promotion claimed',
    v_bonus_id,
    'completed',
    jsonb_build_object('promotion_id', p_promotion_id)
  );

  INSERT INTO public.loyalty_accounts (user_id, points, lifetime_points)
  VALUES (v_user, COALESCE(v_promo.loyalty_points_reward, 0), COALESCE(v_promo.loyalty_points_reward, 0))
  ON CONFLICT (user_id) DO UPDATE SET
    points = public.loyalty_accounts.points + EXCLUDED.points,
    lifetime_points = public.loyalty_accounts.lifetime_points + EXCLUDED.lifetime_points,
    updated_at = NOW();

  RETURN jsonb_build_object('success', TRUE, 'bonus_id', v_bonus_id, 'amount', v_amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_user_bonuses(p_batch_size INTEGER DEFAULT 250)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  IF NOT public.has_admin_role(ARRAY['finance']) THEN
    RAISE EXCEPTION 'Finance authorization required';
  END IF;

  UPDATE public.user_bonuses
  SET status = 'expired',
      forfeited_at = NOW()
  WHERE id IN (
    SELECT id
    FROM public.user_bonuses
    WHERE status = 'active'
      AND expires_at IS NOT NULL
      AND expires_at <= NOW()
    ORDER BY expires_at
    LIMIT GREATEST(COALESCE(p_batch_size, 250), 1)
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('processed', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_my_responsible_limit(
  p_limit_type TEXT,
  p_limit_value NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_id UUID;
  v_start TIMESTAMPTZ := NOW();
  v_end TIMESTAMPTZ := NOW() + INTERVAL '30 days';
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_limit_type = 'daily_stake' THEN
    v_start := date_trunc('day', NOW());
    v_end := v_start + INTERVAL '1 day';
  ELSIF p_limit_type = 'weekly_stake' THEN
    v_start := date_trunc('week', NOW());
    v_end := v_start + INTERVAL '1 week';
  ELSIF p_limit_type = 'monthly_stake' THEN
    v_start := date_trunc('month', NOW());
    v_end := v_start + INTERVAL '1 month';
  END IF;

  UPDATE public.responsible_gaming_limits
  SET is_active = FALSE,
      updated_at = NOW()
  WHERE user_id = v_user
    AND limit_type = p_limit_type
    AND is_active = TRUE;

  INSERT INTO public.responsible_gaming_limits (
    user_id, limit_type, limit_value, period_start, period_end, current_usage, is_active
  )
  VALUES (v_user, p_limit_type, p_limit_value, v_start, v_end, 0, TRUE)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_my_self_exclusion(
  p_exclusion_type TEXT,
  p_duration_days INTEGER DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_id UUID;
  v_end TIMESTAMPTZ;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_end := CASE
    WHEN p_exclusion_type = 'permanent' THEN NULL
    ELSE NOW() + make_interval(days => GREATEST(COALESCE(p_duration_days, 1), 1))
  END;

  INSERT INTO public.self_exclusions (user_id, exclusion_type, start_date, end_date, reason, is_active)
  VALUES (v_user, p_exclusion_type, NOW(), v_end, p_reason, TRUE)
  ON CONFLICT (user_id) DO UPDATE SET
    exclusion_type = EXCLUDED.exclusion_type,
    start_date = NOW(),
    end_date = EXCLUDED.end_date,
    reason = EXCLUDED.reason,
    is_active = TRUE
  RETURNING id INTO v_id;

  UPDATE public.profiles
  SET self_exclusion_until = COALESCE(v_end, TIMESTAMPTZ '9999-12-31 23:59:59+00'),
      is_self_excluded = TRUE,
      updated_at = NOW()
  WHERE id = v_user;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_event_result_and_queue(
  p_event_id UUID,
  p_status TEXT,
  p_home_score INTEGER,
  p_away_score INTEGER,
  p_market_results JSONB,
  p_provider_reference TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id UUID;
BEGIN
  IF NOT public.has_admin_role(ARRAY['sports_trader']) THEN
    RAISE EXCEPTION 'Settlement authorization required';
  END IF;

  UPDATE public.events
  SET status = p_status,
      live_score_home = p_home_score,
      live_score_away = p_away_score,
      updated_at = NOW()
  WHERE id = p_event_id;

  INSERT INTO public.background_jobs (job_type, status, priority, payload, scheduled_at)
  VALUES (
    'settlement',
    'pending',
    1,
    jsonb_build_object(
      'event_id', p_event_id,
      'event_status', p_status,
      'home_score', p_home_score,
      'away_score', p_away_score,
      'market_results', COALESCE(p_market_results, '[]'::JSONB),
      'provider_reference', p_provider_reference
    ),
    NOW()
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_next_settlement_job()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.background_jobs%ROWTYPE;
BEGIN
  IF NOT public.has_admin_role(ARRAY['sports_trader', 'risk_manager']) THEN
    RAISE EXCEPTION 'Settlement worker authorization required';
  END IF;

  SELECT * INTO v_job
  FROM public.background_jobs
  WHERE job_type = 'settlement'
    AND status IN ('pending', 'retry')
  ORDER BY priority ASC, scheduled_at ASC, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('processed', FALSE);
  END IF;

  UPDATE public.background_jobs
  SET status = 'completed',
      started_at = COALESCE(started_at, NOW()),
      completed_at = NOW(),
      result = jsonb_build_object('message', 'Settlement job completed')
  WHERE id = v_job.id;

  RETURN jsonb_build_object('processed', TRUE, 'job_id', v_job.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.ingest_sports_feed_event(
  p_update_id TEXT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider_name TEXT := COALESCE(NULLIF(trim(p_payload->>'provider_name'), ''), 'default-provider');
  v_provider_type TEXT := COALESCE(NULLIF(trim(p_payload->>'provider_type'), ''), 'odds');
BEGIN
  IF NOT public.has_admin_role(ARRAY['sports_trader']) THEN
    RAISE EXCEPTION 'Feed ingestion authorization required';
  END IF;

  INSERT INTO public.provider_health (
    provider_name, provider_type, status, last_successful_fetch, total_requests, updated_at
  )
  VALUES (v_provider_name, v_provider_type, 'active', NOW(), 1, NOW())
  ON CONFLICT DO NOTHING;

  UPDATE public.provider_health
  SET total_requests = total_requests + 1,
      last_successful_fetch = NOW(),
      status = 'active',
      updated_at = NOW()
  WHERE provider_name = v_provider_name
    AND provider_type = v_provider_type;

  RETURN jsonb_build_object('duplicate', FALSE, 'update_id', p_update_id, 'provider', v_provider_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_wallet_reconciliation_report()
RETURNS TABLE(user_id UUID, profile_balance NUMERIC, ledger_available NUMERIC, difference NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    COALESCE(p.demo_balance, 0) AS profile_balance,
    COALESCE(wa.balance, 0) + COALESCE(wa.bonus_balance, 0) AS ledger_available,
    COALESCE(p.demo_balance, 0) - (COALESCE(wa.balance, 0) + COALESCE(wa.bonus_balance, 0)) AS difference
  FROM public.profiles p
  LEFT JOIN public.wallet_accounts wa ON wa.user_id = p.id
  WHERE public.has_admin_role(ARRAY['finance']);
$$;

INSERT INTO public.wallet_accounts (user_id)
SELECT id FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.notification_preferences (user_id)
SELECT id FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.loyalty_accounts (user_id)
SELECT id FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

COMMIT;

-- END MIGRATION: 20261026100858_migration_d16c9286.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261026115902_migration_23518a7c.sql
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'support_tickets'
      AND policyname = 'admins_read_support_tickets'
  ) THEN
    CREATE POLICY "admins_read_support_tickets"
    ON public.support_tickets
    FOR SELECT
    TO authenticated
    USING (has_admin_role(ARRAY['support'::text, 'admin'::text, 'super_admin'::text]));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'support_tickets'
      AND policyname = 'admins_update_support_tickets'
  ) THEN
    CREATE POLICY "admins_update_support_tickets"
    ON public.support_tickets
    FOR UPDATE
    TO authenticated
    USING (has_admin_role(ARRAY['support'::text, 'admin'::text, 'super_admin'::text]))
    WITH CHECK (has_admin_role(ARRAY['support'::text, 'admin'::text, 'super_admin'::text]));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'support_ticket_messages'
      AND policyname = 'admins_read_support_messages'
  ) THEN
    CREATE POLICY "admins_read_support_messages"
    ON public.support_ticket_messages
    FOR SELECT
    TO authenticated
    USING (has_admin_role(ARRAY['support'::text, 'admin'::text, 'super_admin'::text]));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'support_ticket_messages'
      AND policyname = 'admins_insert_support_messages'
  ) THEN
    CREATE POLICY "admins_insert_support_messages"
    ON public.support_ticket_messages
    FOR INSERT
    TO authenticated
    WITH CHECK (
      has_admin_role(ARRAY['support'::text, 'admin'::text, 'super_admin'::text])
      AND author_role = 'staff'::text
    );
  END IF;
END $$;

SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('support_tickets', 'support_ticket_messages')
ORDER BY tablename, policyname;

-- END MIGRATION: 20261026115902_migration_23518a7c.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261026121802_migration_a5aa730a.sql
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'admins_update_profiles'
  ) THEN
    CREATE POLICY "admins_update_profiles"
      ON public.profiles
      FOR UPDATE
      TO authenticated
      USING (has_admin_role(NULL::text[]))
      WITH CHECK (has_admin_role(NULL::text[]));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'wallet_accounts'
      AND policyname = 'admins_read_wallet_accounts'
  ) THEN
    CREATE POLICY "admins_read_wallet_accounts"
      ON public.wallet_accounts
      FOR SELECT
      TO authenticated
      USING (has_admin_role(NULL::text[]));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'wallet_transactions'
      AND policyname = 'admins_read_wallet_transactions'
  ) THEN
    CREATE POLICY "admins_read_wallet_transactions"
      ON public.wallet_transactions
      FOR SELECT
      TO authenticated
      USING (has_admin_role(NULL::text[]));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'bets'
      AND policyname = 'admins_read_bets'
  ) THEN
    CREATE POLICY "admins_read_bets"
      ON public.bets
      FOR SELECT
      TO authenticated
      USING (has_admin_role(NULL::text[]));
  END IF;
END $$;

SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles', 'wallet_accounts', 'wallet_transactions', 'bets')
ORDER BY tablename, policyname;

-- END MIGRATION: 20261026121802_migration_a5aa730a.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261026122245_migration_a2a83809.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.sports_feed_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  provider_type text NOT NULL CHECK (provider_type IN ('openligadb', 'thesportsdb_demo', 'thesportsdb_live', 'sportmonks')),
  encrypted_api_key text NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_enabled boolean NOT NULL DEFAULT false,
  is_demo boolean NOT NULL DEFAULT false,
  priority integer NOT NULL DEFAULT 100 CHECK (priority >= 1 AND priority <= 1000),
  sync_interval_seconds integer NOT NULL DEFAULT 10 CHECK (sync_interval_seconds >= 5 AND sync_interval_seconds <= 3600),
  status text NOT NULL DEFAULT 'not_tested' CHECK (status IN ('not_tested', 'healthy', 'error', 'disabled')),
  last_sync_at timestamp with time zone NULL,
  last_success_at timestamp with time zone NULL,
  last_error text NULL,
  last_event_count integer NOT NULL DEFAULT 0,
  created_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sports_feed_providers_priority
  ON public.sports_feed_providers (is_enabled DESC, priority ASC);

CREATE INDEX IF NOT EXISTS idx_sports_feed_providers_status
  ON public.sports_feed_providers (status);

ALTER TABLE public.sports_feed_providers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sports_feed_providers'
      AND policyname = 'admins_read_sports_feed_providers'
  ) THEN
    CREATE POLICY "admins_read_sports_feed_providers"
      ON public.sports_feed_providers
      FOR SELECT
      TO authenticated
      USING (has_admin_role(ARRAY['sports_trader'::text, 'admin'::text, 'super_admin'::text]));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sports_feed_providers'
      AND policyname = 'admins_insert_sports_feed_providers'
  ) THEN
    CREATE POLICY "admins_insert_sports_feed_providers"
      ON public.sports_feed_providers
      FOR INSERT
      TO authenticated
      WITH CHECK (has_admin_role(ARRAY['sports_trader'::text, 'admin'::text, 'super_admin'::text]));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sports_feed_providers'
      AND policyname = 'admins_update_sports_feed_providers'
  ) THEN
    CREATE POLICY "admins_update_sports_feed_providers"
      ON public.sports_feed_providers
      FOR UPDATE
      TO authenticated
      USING (has_admin_role(ARRAY['sports_trader'::text, 'admin'::text, 'super_admin'::text]))
      WITH CHECK (has_admin_role(ARRAY['sports_trader'::text, 'admin'::text, 'super_admin'::text]));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sports_feed_providers'
      AND policyname = 'admins_delete_sports_feed_providers'
  ) THEN
    CREATE POLICY "admins_delete_sports_feed_providers"
      ON public.sports_feed_providers
      FOR DELETE
      TO authenticated
      USING (has_admin_role(ARRAY['sports_trader'::text, 'admin'::text, 'super_admin'::text]));
  END IF;
END
$$;

COMMIT;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'sports_feed_providers';

SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'sports_feed_providers'
ORDER BY policyname;

SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'ingest_sports_feed_event';

-- END MIGRATION: 20261026122245_migration_a2a83809.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261026135200_fix_feed_ingestion_for_live_schema.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.provider_event_map (
  provider_id text NOT NULL,
  provider_event_id text NOT NULL,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, provider_event_id)
);

CREATE TABLE IF NOT EXISTS public.feed_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id text NOT NULL,
  update_id text NOT NULL,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, update_id)
);

ALTER TABLE public.provider_event_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_updates ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.ingest_sports_feed_event(
  p_update_id text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_provider text := trim(COALESCE(p_payload->>'provider_id', ''));
  v_provider_event text := trim(COALESCE(p_payload->>'provider_event_id', ''));
  v_provider_name text;
  v_provider_type text;
  v_provider_health_id uuid;
  v_sport_id uuid;
  v_league_id uuid;
  v_event_id uuid;
  v_existing_event_id uuid;
  v_market_id uuid;
  v_odds_id uuid;
  v_market jsonb;
  v_outcome jsonb;
  v_previous_odds numeric(10,2);
  v_should_suspend boolean := COALESCE(p_payload->>'status', '') IN ('postponed', 'cancelled', 'finished');
  v_market_count integer := 0;
  v_odds_count integer := 0;
BEGIN
  IF p_update_id IS NULL OR length(trim(p_update_id)) < 3 OR v_provider = '' OR v_provider_event = '' THEN
    RAISE EXCEPTION 'Provider and update identifiers are required';
  END IF;

  IF COALESCE(p_payload->>'sport_slug', '') = ''
    OR COALESCE(p_payload->>'league_slug', '') = ''
    OR COALESCE(p_payload->>'home_team', '') = ''
    OR COALESCE(p_payload->>'away_team', '') = ''
    OR COALESCE(p_payload->>'start_time', '') = '' THEN
    RAISE EXCEPTION 'Sport, league, team, and kickoff values are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_provider || ':' || p_update_id));

  SELECT event_id
  INTO v_existing_event_id
  FROM public.feed_updates
  WHERE provider_id = v_provider
    AND update_id = p_update_id
  LIMIT 1;

  IF v_existing_event_id IS NOT NULL THEN
    RETURN jsonb_build_object('duplicate', TRUE, 'event_id', v_existing_event_id);
  END IF;

  SELECT name, provider_type
  INTO v_provider_name, v_provider_type
  FROM public.sports_feed_providers
  WHERE id::text = v_provider
  ORDER BY created_at ASC
  LIMIT 1;

  v_provider_name := COALESCE(v_provider_name, NULLIF(trim(p_payload->>'provider_name'), ''), v_provider);
  v_provider_type := COALESCE(v_provider_type, NULLIF(trim(p_payload->>'provider_type'), ''), 'odds');

  INSERT INTO public.sports (name, slug, icon, is_active)
  VALUES (
    p_payload->>'sport_name',
    p_payload->>'sport_slug',
    NULLIF(p_payload->>'sport_icon', ''),
    TRUE
  )
  ON CONFLICT (slug) DO UPDATE
    SET name = EXCLUDED.name,
        icon = COALESCE(EXCLUDED.icon, public.sports.icon),
        is_active = TRUE
  RETURNING id INTO v_sport_id;

  INSERT INTO public.leagues (sport_id, name, slug, country, is_active)
  VALUES (
    v_sport_id,
    p_payload->>'league_name',
    p_payload->>'league_slug',
    NULLIF(p_payload->>'country', ''),
    TRUE
  )
  ON CONFLICT (sport_id, slug) DO UPDATE
    SET name = EXCLUDED.name,
        country = EXCLUDED.country,
        is_active = TRUE
  RETURNING id INTO v_league_id;

  SELECT event_id
  INTO v_event_id
  FROM public.provider_event_map
  WHERE provider_id = v_provider
    AND provider_event_id = v_provider_event
  LIMIT 1;

  IF v_event_id IS NULL THEN
    SELECT id
    INTO v_event_id
    FROM public.events
    WHERE provider_event_id = v_provider_event
      AND COALESCE(metadata->>'providerId', '') = v_provider
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_event_id IS NULL THEN
    SELECT id
    INTO v_event_id
    FROM public.events
    WHERE sport_id = v_sport_id
      AND lower(trim(home_team)) = lower(trim(p_payload->>'home_team'))
      AND lower(trim(away_team)) = lower(trim(p_payload->>'away_team'))
      AND abs(extract(epoch FROM (start_time - (p_payload->>'start_time')::timestamptz))) <= 900
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_event_id IS NULL THEN
    INSERT INTO public.events (
      sport_id,
      league_id,
      home_team,
      away_team,
      start_time,
      status,
      live_score_home,
      live_score_away,
      live_minute,
      provider_event_id,
      is_suspended,
      metadata
    )
    VALUES (
      v_sport_id,
      v_league_id,
      p_payload->>'home_team',
      p_payload->>'away_team',
      (p_payload->>'start_time')::timestamptz,
      COALESCE(p_payload->>'status', 'upcoming'),
      CASE WHEN p_payload ? 'home_score' THEN (p_payload->>'home_score')::integer ELSE NULL END,
      CASE WHEN p_payload ? 'away_score' THEN (p_payload->>'away_score')::integer ELSE NULL END,
      CASE WHEN p_payload ? 'live_minute' THEN (p_payload->>'live_minute')::integer ELSE NULL END,
      v_provider_event,
      v_should_suspend,
      jsonb_build_object(
        'providerId', v_provider,
        'providerEventId', v_provider_event,
        'providerType', v_provider_type,
        'providerName', v_provider_name,
        'source', 'score-feed'
      )
    )
    RETURNING id INTO v_event_id;
  ELSE
    UPDATE public.events
    SET sport_id = v_sport_id,
        league_id = v_league_id,
        home_team = p_payload->>'home_team',
        away_team = p_payload->>'away_team',
        start_time = (p_payload->>'start_time')::timestamptz,
        status = COALESCE(p_payload->>'status', status),
        live_score_home = CASE WHEN p_payload ? 'home_score' THEN (p_payload->>'home_score')::integer ELSE live_score_home END,
        live_score_away = CASE WHEN p_payload ? 'away_score' THEN (p_payload->>'away_score')::integer ELSE live_score_away END,
        live_minute = CASE WHEN p_payload ? 'live_minute' THEN (p_payload->>'live_minute')::integer ELSE live_minute END,
        provider_event_id = COALESCE(public.events.provider_event_id, v_provider_event),
        is_suspended = CASE
          WHEN v_should_suspend THEN TRUE
          WHEN COALESCE((p_payload->>'resume_markets')::boolean, FALSE) THEN FALSE
          ELSE is_suspended
        END,
        metadata = COALESCE(public.events.metadata, '{}'::jsonb) || jsonb_build_object(
          'providerId', v_provider,
          'providerEventId', v_provider_event,
          'providerType', v_provider_type,
          'providerName', v_provider_name,
          'source', 'score-feed'
        ),
        updated_at = now()
    WHERE id = v_event_id;
  END IF;

  INSERT INTO public.provider_event_map (provider_id, provider_event_id, event_id)
  VALUES (v_provider, v_provider_event, v_event_id)
  ON CONFLICT (provider_id, provider_event_id) DO UPDATE
    SET event_id = EXCLUDED.event_id,
        updated_at = now();

  IF v_should_suspend THEN
    UPDATE public.markets
    SET status = 'suspended'
    WHERE event_id = v_event_id
      AND status = 'active';
  END IF;

  FOR v_market IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_payload->'markets', '[]'::jsonb))
  LOOP
    SELECT id
    INTO v_market_id
    FROM public.markets
    WHERE event_id = v_event_id
      AND type = v_market->>'type'
      AND line IS NOT DISTINCT FROM NULLIF(v_market->>'line', '')::numeric
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_market_id IS NULL THEN
      INSERT INTO public.markets (event_id, name, type, line, status)
      VALUES (
        v_event_id,
        v_market->>'name',
        v_market->>'type',
        NULLIF(v_market->>'line', '')::numeric,
        CASE WHEN v_should_suspend THEN 'suspended' ELSE COALESCE(v_market->>'status', 'active') END
      )
      RETURNING id INTO v_market_id;
    ELSE
      UPDATE public.markets
      SET name = v_market->>'name',
          status = CASE WHEN v_should_suspend THEN 'suspended' ELSE COALESCE(v_market->>'status', status) END
      WHERE id = v_market_id;
    END IF;

    v_market_count := v_market_count + 1;

    FOR v_outcome IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(v_market->'outcomes', '[]'::jsonb))
    LOOP
      SELECT id, value
      INTO v_odds_id, v_previous_odds
      FROM public.odds
      WHERE market_id = v_market_id
        AND lower(trim(selection)) = lower(trim(v_outcome->>'selection'))
      ORDER BY created_at ASC
      LIMIT 1;

      IF v_odds_id IS NULL THEN
        INSERT INTO public.odds (
          market_id,
          selection,
          value,
          is_active,
          is_locked,
          last_provider_update
        )
        VALUES (
          v_market_id,
          v_outcome->>'selection',
          (v_outcome->>'value')::numeric,
          COALESCE((v_outcome->>'active')::boolean, TRUE),
          v_should_suspend,
          now()
        )
        RETURNING id INTO v_odds_id;
      ELSE
        IF v_previous_odds IS DISTINCT FROM (v_outcome->>'value')::numeric THEN
          INSERT INTO public.odds_history (
            odds_id,
            market_id,
            selection,
            previous_value,
            new_value,
            provider_odds,
            change_type
          )
          VALUES (
            v_odds_id,
            v_market_id,
            v_outcome->>'selection',
            v_previous_odds,
            (v_outcome->>'value')::numeric,
            (v_outcome->>'value')::numeric,
            'provider_update'
          );
        END IF;

        UPDATE public.odds
        SET value = (v_outcome->>'value')::numeric,
            is_active = COALESCE((v_outcome->>'active')::boolean, TRUE),
            is_locked = v_should_suspend,
            last_provider_update = now(),
            updated_at = now()
        WHERE id = v_odds_id;
      END IF;

      v_odds_count := v_odds_count + 1;
    END LOOP;
  END LOOP;

  IF COALESCE((p_payload->>'resume_markets')::boolean, FALSE) AND NOT v_should_suspend THEN
    UPDATE public.markets
    SET status = 'active'
    WHERE event_id = v_event_id
      AND status = 'suspended';

    UPDATE public.odds
    SET is_locked = FALSE,
        updated_at = now()
    WHERE market_id IN (
      SELECT id
      FROM public.markets
      WHERE event_id = v_event_id
    );
  END IF;

  INSERT INTO public.feed_updates (provider_id, update_id, event_id, payload)
  VALUES (v_provider, p_update_id, v_event_id, p_payload);

  SELECT id
  INTO v_provider_health_id
  FROM public.provider_health
  WHERE provider_name = v_provider_name
    AND provider_type = v_provider_type
  ORDER BY updated_at ASC
  LIMIT 1;

  IF v_provider_health_id IS NULL THEN
    INSERT INTO public.provider_health (
      provider_name,
      provider_type,
      status,
      last_successful_fetch,
      total_requests,
      failed_requests,
      consecutive_failures,
      error_message,
      updated_at
    )
    VALUES (
      v_provider_name,
      v_provider_type,
      'active',
      now(),
      1,
      0,
      0,
      NULL,
      now()
    );
  ELSE
    UPDATE public.provider_health
    SET status = 'active',
        last_successful_fetch = now(),
        total_requests = COALESCE(total_requests, 0) + 1,
        consecutive_failures = 0,
        error_message = NULL,
        updated_at = now()
    WHERE id = v_provider_health_id;
  END IF;

  RETURN jsonb_build_object(
    'duplicate', FALSE,
    'event_id', v_event_id,
    'markets', v_market_count,
    'odds', v_odds_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ingest_sports_feed_event(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_sports_feed_event(text, jsonb) TO service_role;

-- END MIGRATION: 20261026135200_fix_feed_ingestion_for_live_schema.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261026135347_migration_a93b1a1c.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.provider_event_map (
  provider_id text NOT NULL,
  provider_event_id text NOT NULL,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, provider_event_id)
);

CREATE TABLE IF NOT EXISTS public.feed_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id text NOT NULL,
  update_id text NOT NULL,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, update_id)
);

ALTER TABLE public.provider_event_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_updates ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.ingest_sports_feed_event(
  p_update_id text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_provider text := trim(COALESCE(p_payload->>'provider_id', ''));
  v_provider_event text := trim(COALESCE(p_payload->>'provider_event_id', ''));
  v_provider_name text;
  v_provider_type text;
  v_provider_health_id uuid;
  v_sport_id uuid;
  v_league_id uuid;
  v_event_id uuid;
  v_existing_event_id uuid;
  v_market_id uuid;
  v_odds_id uuid;
  v_market jsonb;
  v_outcome jsonb;
  v_previous_odds numeric(10,2);
  v_should_suspend boolean := COALESCE(p_payload->>'status', '') IN ('postponed', 'cancelled', 'finished');
  v_market_count integer := 0;
  v_odds_count integer := 0;
BEGIN
  IF p_update_id IS NULL OR length(trim(p_update_id)) < 3 OR v_provider = '' OR v_provider_event = '' THEN
    RAISE EXCEPTION 'Provider and update identifiers are required';
  END IF;

  IF COALESCE(p_payload->>'sport_slug', '') = ''
    OR COALESCE(p_payload->>'league_slug', '') = ''
    OR COALESCE(p_payload->>'home_team', '') = ''
    OR COALESCE(p_payload->>'away_team', '') = ''
    OR COALESCE(p_payload->>'start_time', '') = '' THEN
    RAISE EXCEPTION 'Sport, league, team, and kickoff values are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_provider || ':' || p_update_id));

  SELECT event_id
  INTO v_existing_event_id
  FROM public.feed_updates
  WHERE provider_id = v_provider
    AND update_id = p_update_id
  LIMIT 1;

  IF v_existing_event_id IS NOT NULL THEN
    RETURN jsonb_build_object('duplicate', TRUE, 'event_id', v_existing_event_id);
  END IF;

  SELECT name, provider_type
  INTO v_provider_name, v_provider_type
  FROM public.sports_feed_providers
  WHERE id::text = v_provider
  ORDER BY created_at ASC
  LIMIT 1;

  v_provider_name := COALESCE(v_provider_name, NULLIF(trim(p_payload->>'provider_name'), ''), v_provider);
  v_provider_type := COALESCE(v_provider_type, NULLIF(trim(p_payload->>'provider_type'), ''), 'odds');

  INSERT INTO public.sports (name, slug, icon, is_active)
  VALUES (
    p_payload->>'sport_name',
    p_payload->>'sport_slug',
    NULLIF(p_payload->>'sport_icon', ''),
    TRUE
  )
  ON CONFLICT (slug) DO UPDATE
    SET name = EXCLUDED.name,
        icon = COALESCE(EXCLUDED.icon, public.sports.icon),
        is_active = TRUE
  RETURNING id INTO v_sport_id;

  INSERT INTO public.leagues (sport_id, name, slug, country, is_active)
  VALUES (
    v_sport_id,
    p_payload->>'league_name',
    p_payload->>'league_slug',
    NULLIF(p_payload->>'country', ''),
    TRUE
  )
  ON CONFLICT (sport_id, slug) DO UPDATE
    SET name = EXCLUDED.name,
        country = EXCLUDED.country,
        is_active = TRUE
  RETURNING id INTO v_league_id;

  SELECT event_id
  INTO v_event_id
  FROM public.provider_event_map
  WHERE provider_id = v_provider
    AND provider_event_id = v_provider_event
  LIMIT 1;

  IF v_event_id IS NULL THEN
    SELECT id
    INTO v_event_id
    FROM public.events
    WHERE provider_event_id = v_provider_event
      AND COALESCE(metadata->>'providerId', '') = v_provider
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_event_id IS NULL THEN
    SELECT id
    INTO v_event_id
    FROM public.events
    WHERE sport_id = v_sport_id
      AND lower(trim(home_team)) = lower(trim(p_payload->>'home_team'))
      AND lower(trim(away_team)) = lower(trim(p_payload->>'away_team'))
      AND abs(extract(epoch FROM (start_time - (p_payload->>'start_time')::timestamptz))) <= 900
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_event_id IS NULL THEN
    INSERT INTO public.events (
      sport_id,
      league_id,
      home_team,
      away_team,
      start_time,
      status,
      live_score_home,
      live_score_away,
      live_minute,
      provider_event_id,
      is_suspended,
      metadata
    )
    VALUES (
      v_sport_id,
      v_league_id,
      p_payload->>'home_team',
      p_payload->>'away_team',
      (p_payload->>'start_time')::timestamptz,
      COALESCE(p_payload->>'status', 'upcoming'),
      CASE WHEN p_payload ? 'home_score' THEN (p_payload->>'home_score')::integer ELSE NULL END,
      CASE WHEN p_payload ? 'away_score' THEN (p_payload->>'away_score')::integer ELSE NULL END,
      CASE WHEN p_payload ? 'live_minute' THEN (p_payload->>'live_minute')::integer ELSE NULL END,
      v_provider_event,
      v_should_suspend,
      jsonb_build_object(
        'providerId', v_provider,
        'providerEventId', v_provider_event,
        'providerType', v_provider_type,
        'providerName', v_provider_name,
        'source', 'feed_ingestion'
      )
    )
    RETURNING id INTO v_event_id;
  ELSE
    UPDATE public.events
    SET sport_id = v_sport_id,
        league_id = v_league_id,
        home_team = p_payload->>'home_team',
        away_team = p_payload->>'away_team',
        start_time = (p_payload->>'start_time')::timestamptz,
        status = COALESCE(p_payload->>'status', status),
        live_score_home = CASE WHEN p_payload ? 'home_score' THEN (p_payload->>'home_score')::integer ELSE live_score_home END,
        live_score_away = CASE WHEN p_payload ? 'away_score' THEN (p_payload->>'away_score')::integer ELSE live_score_away END,
        live_minute = CASE WHEN p_payload ? 'live_minute' THEN (p_payload->>'live_minute')::integer ELSE live_minute END,
        provider_event_id = COALESCE(public.events.provider_event_id, v_provider_event),
        is_suspended = CASE
          WHEN v_should_suspend THEN TRUE
          WHEN COALESCE((p_payload->>'resume_markets')::boolean, FALSE) THEN FALSE
          ELSE is_suspended
        END,
        metadata = COALESCE(public.events.metadata, '{}'::jsonb) || jsonb_build_object(
          'providerId', v_provider,
          'providerEventId', v_provider_event,
          'providerType', v_provider_type,
          'providerName', v_provider_name,
          'source', 'feed_ingestion'
        ),
        updated_at = now()
    WHERE id = v_event_id;
  END IF;

  INSERT INTO public.provider_event_map (provider_id, provider_event_id, event_id)
  VALUES (v_provider, v_provider_event, v_event_id)
  ON CONFLICT (provider_id, provider_event_id) DO UPDATE
    SET event_id = EXCLUDED.event_id,
        updated_at = now();

  IF v_should_suspend THEN
    UPDATE public.markets
    SET status = 'suspended'
    WHERE event_id = v_event_id
      AND status = 'active';
  END IF;

  FOR v_market IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_payload->'markets', '[]'::jsonb))
  LOOP
    SELECT id
    INTO v_market_id
    FROM public.markets
    WHERE event_id = v_event_id
      AND type = v_market->>'type'
      AND line IS NOT DISTINCT FROM NULLIF(v_market->>'line', '')::numeric
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_market_id IS NULL THEN
      INSERT INTO public.markets (event_id, name, type, line, status)
      VALUES (
        v_event_id,
        v_market->>'name',
        v_market->>'type',
        NULLIF(v_market->>'line', '')::numeric,
        CASE WHEN v_should_suspend THEN 'suspended' ELSE COALESCE(v_market->>'status', 'active') END
      )
      RETURNING id INTO v_market_id;
    ELSE
      UPDATE public.markets
      SET name = v_market->>'name',
          status = CASE WHEN v_should_suspend THEN 'suspended' ELSE COALESCE(v_market->>'status', status) END
      WHERE id = v_market_id;
    END IF;

    v_market_count := v_market_count + 1;

    FOR v_outcome IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(v_market->'outcomes', '[]'::jsonb))
    LOOP
      SELECT id, value
      INTO v_odds_id, v_previous_odds
      FROM public.odds
      WHERE market_id = v_market_id
        AND lower(trim(selection)) = lower(trim(v_outcome->>'selection'))
      ORDER BY created_at ASC
      LIMIT 1;

      IF v_odds_id IS NULL THEN
        INSERT INTO public.odds (
          market_id,
          selection,
          value,
          is_active,
          is_locked,
          last_provider_update
        )
        VALUES (
          v_market_id,
          v_outcome->>'selection',
          (v_outcome->>'value')::numeric,
          COALESCE((v_outcome->>'active')::boolean, TRUE),
          v_should_suspend,
          now()
        )
        RETURNING id INTO v_odds_id;
      ELSE
        IF v_previous_odds IS DISTINCT FROM (v_outcome->>'value')::numeric THEN
          INSERT INTO public.odds_history (
            odds_id,
            market_id,
            selection,
            previous_value,
            new_value,
            provider_odds,
            change_type
          )
          VALUES (
            v_odds_id,
            v_market_id,
            v_outcome->>'selection',
            v_previous_odds,
            (v_outcome->>'value')::numeric,
            (v_outcome->>'value')::numeric,
            'provider_update'
          );
        END IF;

        UPDATE public.odds
        SET value = (v_outcome->>'value')::numeric,
            is_active = COALESCE((v_outcome->>'active')::boolean, TRUE),
            is_locked = v_should_suspend,
            last_provider_update = now(),
            updated_at = now()
        WHERE id = v_odds_id;
      END IF;

      v_odds_count := v_odds_count + 1;
    END LOOP;
  END LOOP;

  IF COALESCE((p_payload->>'resume_markets')::boolean, FALSE) AND NOT v_should_suspend THEN
    UPDATE public.markets
    SET status = 'active'
    WHERE event_id = v_event_id
      AND status = 'suspended';

    UPDATE public.odds
    SET is_locked = FALSE,
        updated_at = now()
    WHERE market_id IN (
      SELECT id
      FROM public.markets
      WHERE event_id = v_event_id
    );
  END IF;

  INSERT INTO public.feed_updates (provider_id, update_id, event_id, payload)
  VALUES (v_provider, p_update_id, v_event_id, p_payload);

  SELECT id
  INTO v_provider_health_id
  FROM public.provider_health
  WHERE provider_name = v_provider_name
    AND provider_type = v_provider_type
  ORDER BY updated_at ASC
  LIMIT 1;

  IF v_provider_health_id IS NULL THEN
    INSERT INTO public.provider_health (
      provider_name,
      provider_type,
      status,
      last_successful_fetch,
      total_requests,
      failed_requests,
      consecutive_failures,
      error_message,
      updated_at
    )
    VALUES (
      v_provider_name,
      v_provider_type,
      'active',
      now(),
      1,
      0,
      0,
      NULL,
      now()
    );
  ELSE
    UPDATE public.provider_health
    SET status = 'active',
        last_successful_fetch = now(),
        total_requests = COALESCE(total_requests, 0) + 1,
        consecutive_failures = 0,
        error_message = NULL,
        updated_at = now()
    WHERE id = v_provider_health_id;
  END IF;

  RETURN jsonb_build_object(
    'duplicate', FALSE,
    'event_id', v_event_id,
    'markets', v_market_count,
    'odds', v_odds_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ingest_sports_feed_event(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_sports_feed_event(text, jsonb) TO service_role;

COMMIT;

-- END MIGRATION: 20261026135347_migration_a93b1a1c.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261028033040_migration_976699b8.sql
-- ============================================================================

-- Change default balance from 10000 to 0 in wallet_accounts table
ALTER TABLE wallet_accounts
ALTER COLUMN balance SET DEFAULT 0.00;

-- END MIGRATION: 20261028033040_migration_976699b8.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261028033104_migration_c389e868.sql
-- ============================================================================

-- Change default demo_balance from 10000 to 0 in profiles table
ALTER TABLE profiles
ALTER COLUMN demo_balance SET DEFAULT 0.00;

-- END MIGRATION: 20261028033104_migration_c389e868.sql

-- ============================================================================
-- BEGIN MIGRATION: 20261029103000_admin_hierarchy_and_balance_credit.sql
-- ============================================================================

-- Enforce the admin hierarchy at the database layer and provide an atomic,
-- audited balance-credit operation for trusted server routes.

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND is_admin = TRUE
      AND admin_role = 'super_admin'
      AND COALESCE(is_suspended, FALSE) = FALSE
  );
$$;

REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

DROP POLICY IF EXISTS "admins_select_all_profiles" ON public.profiles;
CREATE POLICY "admins_select_non_super_profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.has_admin_role(NULL)
      AND COALESCE(admin_role, '') <> 'super_admin'
    )
  );

DROP POLICY IF EXISTS "admins_update_all_profiles" ON public.profiles;
DROP POLICY IF EXISTS "admins_update_profiles" ON public.profiles;
CREATE POLICY "admins_update_non_super_profiles"
  ON public.profiles FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.has_admin_role(NULL)
      AND COALESCE(admin_role, '') <> 'super_admin'
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      public.has_admin_role(NULL)
      AND COALESCE(admin_role, '') <> 'super_admin'
    )
  );

CREATE TABLE IF NOT EXISTS public.admin_balance_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key UUID NOT NULL UNIQUE,
  admin_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  amount NUMERIC(15,2) NOT NULL CHECK (amount BETWEEN 0.01 AND 100000),
  reason TEXT NOT NULL CHECK (char_length(trim(reason)) BETWEEN 5 AND 500),
  balance_before NUMERIC(15,2) NOT NULL,
  balance_after NUMERIC(15,2) NOT NULL,
  wallet_transaction_id UUID REFERENCES public.wallet_transactions(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_balance_adjustments_user_created_idx
  ON public.admin_balance_adjustments(user_id, created_at DESC);

ALTER TABLE public.admin_balance_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_balance_adjustments FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_credit_user_balance(
  p_user_id UUID,
  p_amount NUMERIC,
  p_reason TEXT,
  p_admin_id UUID,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_adjustment UUID;
  v_transaction UUID;
  v_before NUMERIC(15,2);
  v_after NUMERIC(15,2);
  v_existing public.admin_balance_adjustments%ROWTYPE;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Service authorization required';
  END IF;
  IF p_user_id IS NULL OR p_admin_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'User, admin and idempotency key are required';
  END IF;
  IF p_amount IS NULL OR ROUND(p_amount, 2) < 0.01 OR ROUND(p_amount, 2) > 100000 THEN
    RAISE EXCEPTION 'Credit amount must be between 0.01 and 100000.00';
  END IF;
  IF char_length(trim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'A meaningful adjustment reason is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_admin_id
      AND is_admin = TRUE
      AND admin_role IN ('super_admin', 'admin', 'finance')
      AND COALESCE(is_suspended, FALSE) = FALSE
  ) THEN
    RAISE EXCEPTION 'Balance adjustment authorization denied';
  END IF;

  SELECT * INTO v_existing
  FROM public.admin_balance_adjustments
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'adjustment_id', v_existing.id,
      'transaction_id', v_existing.wallet_transaction_id,
      'balance', v_existing.balance_after,
      'replayed', TRUE
    );
  END IF;

  SELECT COALESCE(demo_balance, 0) INTO v_before
  FROM public.profiles
  WHERE id = p_user_id
    AND COALESCE(is_admin, FALSE) = FALSE
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer account not found';
  END IF;

  v_after := v_before + ROUND(p_amount, 2);
  INSERT INTO public.admin_balance_adjustments(
    idempotency_key, admin_id, user_id, amount, reason, balance_before, balance_after
  ) VALUES (
    p_idempotency_key, p_admin_id, p_user_id, ROUND(p_amount, 2), trim(p_reason), v_before, v_after
  ) RETURNING id INTO v_adjustment;

  UPDATE public.profiles
  SET demo_balance = v_after, updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO public.wallet_transactions(
    user_id, type, amount, balance_before, balance_after,
    description, reference_id, status, metadata
  ) VALUES (
    p_user_id, 'adjustment', ROUND(p_amount, 2), v_before, v_after,
    'Admin balance credit: ' || trim(p_reason), v_adjustment, 'completed',
    jsonb_build_object('admin_id', p_admin_id, 'reason', trim(p_reason), 'idempotency_key', p_idempotency_key)
  ) RETURNING id INTO v_transaction;

  UPDATE public.admin_balance_adjustments
  SET wallet_transaction_id = v_transaction
  WHERE id = v_adjustment;

  INSERT INTO public.audit_logs(admin_id, action, entity_type, entity_id, changes)
  VALUES (
    p_admin_id,
    'user_balance_credit',
    'profile',
    p_user_id,
    jsonb_build_object(
      'adjustment_id', v_adjustment,
      'transaction_id', v_transaction,
      'amount', ROUND(p_amount, 2),
      'balance_before', v_before,
      'balance_after', v_after,
      'reason', trim(p_reason)
    )
  );

  RETURN jsonb_build_object(
    'adjustment_id', v_adjustment,
    'transaction_id', v_transaction,
    'balance', v_after,
    'replayed', FALSE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_credit_user_balance(UUID,NUMERIC,TEXT,UUID,UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_credit_user_balance(UUID,NUMERIC,TEXT,UUID,UUID)
  TO service_role;

COMMENT ON TABLE public.admin_balance_adjustments IS
  'Append-only audit records for server-authorized customer balance credits.';

-- END MIGRATION: 20261029103000_admin_hierarchy_and_balance_credit.sql


CREATE TABLE IF NOT EXISTS public.primebet_schema_meta (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  schema_version TEXT NOT NULL,
  migration_count INTEGER NOT NULL,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.primebet_schema_meta (singleton, schema_version, migration_count)
VALUES (TRUE, '20261029103000_admin_hierarchy_and_balance_credit', 54)
ON CONFLICT (singleton) DO UPDATE SET
  schema_version = EXCLUDED.schema_version,
  migration_count = EXCLUDED.migration_count,
  installed_at = NOW();

REVOKE ALL ON public.primebet_schema_meta FROM PUBLIC, anon, authenticated;

COMMIT;

SELECT schema_version, migration_count, installed_at
FROM public.primebet_schema_meta;
