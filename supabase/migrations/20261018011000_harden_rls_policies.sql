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
