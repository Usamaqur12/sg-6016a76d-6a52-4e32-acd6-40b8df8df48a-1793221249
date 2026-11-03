-- Run in Supabase SQL Editor when admin customer pages always show $0 despite
-- successful balance adjustments.

CREATE OR REPLACE FUNCTION public.get_user_wallet_balance(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.is_service_role() AND NOT public.has_admin_role(NULL) THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = p_user_id
      AND COALESCE(is_admin, FALSE) = FALSE
  ) THEN
    RAISE EXCEPTION 'Customer account not found';
  END IF;

  PERFORM public.ensure_user_ledger_accounts_from_id(p_user_id, 0);

  SELECT jsonb_build_object(
    'currency', 'USD',
    'cash_balance', COALESCE(MAX(balance) FILTER (WHERE account_code = 'cash'), 0),
    'bonus_balance', COALESCE(MAX(balance) FILTER (WHERE account_code = 'bonus'), 0),
    'locked_balance', COALESCE(MAX(balance) FILTER (WHERE account_code = 'locked'), 0)
  )
  INTO v_result
  FROM public.ledger_accounts
  WHERE user_id = p_user_id
    AND currency = 'USD';

  RETURN COALESCE(
    v_result,
    jsonb_build_object(
      'currency', 'USD',
      'cash_balance', 0,
      'bonus_balance', 0,
      'locked_balance', 0
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_user_wallet_balance(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_wallet_balance(UUID)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_user_wallet_balance(UUID) IS
  'Returns authoritative wallet buckets for an authorized admin or trusted server.';
