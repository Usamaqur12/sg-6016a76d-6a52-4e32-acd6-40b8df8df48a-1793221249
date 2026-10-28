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