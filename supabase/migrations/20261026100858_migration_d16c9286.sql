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