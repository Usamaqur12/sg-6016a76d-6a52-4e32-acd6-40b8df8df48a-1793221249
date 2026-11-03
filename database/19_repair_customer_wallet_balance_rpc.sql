-- Run in Supabase SQL Editor when the ledger contains funds but the signed-in
-- customer Wallet page displays zero.

CREATE OR REPLACE FUNCTION public.get_my_wallet_balances()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_cash NUMERIC(18,2);
  v_bonus NUMERIC(18,2);
  v_locked NUMERIC(18,2);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT
    COALESCE(MAX(balance) FILTER (WHERE account_code = 'cash'), 0),
    COALESCE(MAX(balance) FILTER (WHERE account_code = 'bonus'), 0),
    COALESCE(MAX(balance) FILTER (WHERE account_code = 'locked'), 0)
  INTO v_cash, v_bonus, v_locked
  FROM public.ledger_accounts
  WHERE user_id = v_user_id
    AND currency = 'USD';

  RETURN jsonb_build_object(
    'currency', 'USD',
    'cash', COALESCE(v_cash, 0),
    'bonus', COALESCE(v_bonus, 0),
    'locked', COALESCE(v_locked, 0),
    'available', COALESCE(v_cash, 0) + COALESCE(v_bonus, 0)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_wallet_balances()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_wallet_balances()
  TO authenticated;

COMMENT ON FUNCTION public.get_my_wallet_balances() IS
  'Returns the signed-in customer authoritative cash, bonus and locked ledger balances.';

NOTIFY pgrst, 'reload schema';
