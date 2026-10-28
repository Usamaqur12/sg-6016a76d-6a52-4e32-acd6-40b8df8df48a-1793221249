-- 1. Create and confirm this user in Supabase Authentication > Users first.
-- 2. Replace the placeholder email below in both occurrences.
-- 3. Run this file in Supabase SQL Editor.
-- 4. The admin must still enroll authenticator-app 2FA before admin RPC/RLS
--    permissions become available.

DO $primebet_admin$
DECLARE
  v_email TEXT := 'REPLACE_WITH_ADMIN_EMAIL@example.com';
  v_user_id UUID;
BEGIN
  IF v_email LIKE 'REPLACE_WITH_%' THEN
    RAISE EXCEPTION 'Replace the admin email placeholder before running this script';
  END IF;

  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(v_email)
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No Supabase Auth user exists for %', v_email;
  END IF;

  INSERT INTO public.profiles (id, email, is_admin, admin_role, demo_balance)
  VALUES (v_user_id, v_email, TRUE, 'super_admin', 0)
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    is_admin = TRUE,
    admin_role = 'super_admin',
    is_suspended = FALSE,
    updated_at = NOW();

  RAISE NOTICE 'Super admin enabled for %. Authenticator 2FA enrollment is still required.', v_email;
END
$primebet_admin$;

SELECT id, email, is_admin, admin_role, two_factor_enabled, is_suspended
FROM public.profiles
WHERE lower(email) = lower('REPLACE_WITH_ADMIN_EMAIL@example.com');

