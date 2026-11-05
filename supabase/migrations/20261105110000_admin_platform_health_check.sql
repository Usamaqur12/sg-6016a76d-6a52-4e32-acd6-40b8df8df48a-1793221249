-- Read-only schema diagnostics for the super-admin readiness page.
-- This does not expose data or secret values.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_platform_health_check()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_missing_tables JSONB;
  v_missing_functions JSONB;
  v_required_tables TEXT[] := ARRAY[
    'profiles',
    'audit_logs',
    'bets',
    'kyc_documents',
    'sports',
    'leagues',
    'events',
    'markets',
    'odds',
    'sports_feed_providers',
    'wallet_transactions',
    'ledger_accounts',
    'admin_balance_adjustments',
    'payment_methods',
    'manual_deposit_requests',
    'manual_withdrawal_requests',
    'support_tickets',
    'promotions',
    'casino_games',
    'feature_flags',
    'aviator_settings',
    'aviator_rounds'
  ];
  v_required_functions TEXT[] := ARRAY[
    'has_admin_role',
    'admin_adjust_user_balance',
    'get_user_wallet_balance',
    'review_kyc_document_manual',
    'hard_purge_customer',
    'aviator_get_state',
    'aviator_admin_get_dashboard',
    'save_payment_method',
    'reply_support_ticket',
    'get_finance_summary',
    'save_feature_flag'
  ];
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND is_admin = TRUE
        AND admin_role = 'super_admin'
        AND COALESCE(is_suspended, FALSE) = FALSE
    )
  THEN
    RAISE EXCEPTION 'Super admin authorization required';
  END IF;

  SELECT COALESCE(jsonb_agg(name ORDER BY name), '[]'::JSONB)
  INTO v_missing_tables
  FROM unnest(v_required_tables) AS name
  WHERE to_regclass(format('public.%I', name)) IS NULL;

  SELECT COALESCE(jsonb_agg(name ORDER BY name), '[]'::JSONB)
  INTO v_missing_functions
  FROM unnest(v_required_functions) AS name
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = name
  );

  RETURN jsonb_build_object(
    'schemaVersion', '20261105110000',
    'ready', jsonb_array_length(v_missing_tables) = 0
      AND jsonb_array_length(v_missing_functions) = 0,
    'missingTables', v_missing_tables,
    'missingFunctions', v_missing_functions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_platform_health_check() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_platform_health_check() TO authenticated, service_role;


NOTIFY pgrst, 'reload schema';

COMMIT;
