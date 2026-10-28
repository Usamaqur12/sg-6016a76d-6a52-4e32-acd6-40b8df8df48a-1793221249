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