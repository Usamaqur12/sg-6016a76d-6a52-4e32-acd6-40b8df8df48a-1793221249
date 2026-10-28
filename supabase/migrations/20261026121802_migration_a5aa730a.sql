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