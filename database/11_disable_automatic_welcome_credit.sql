-- Deployment copy: disable the legacy automatic $10,000 signup credit.
-- Apply this file in the Supabase SQL Editor for an existing installation.

ALTER TABLE public.profiles
  ALTER COLUMN demo_balance SET DEFAULT 0.00;

CREATE TEMP TABLE legacy_welcome_credit_users ON COMMIT DROP AS
SELECT p.id
FROM public.profiles p
WHERE COALESCE(p.is_admin,FALSE)=FALSE
  AND COALESCE(p.demo_balance,0)=10000.00
  AND EXISTS (
    SELECT 1 FROM public.wallet_transactions wt
    WHERE wt.user_id=p.id
      AND wt.amount=10000.00
      AND wt.description='Welcome bonus - Demo credits'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.wallet_transactions wt
    WHERE wt.user_id=p.id
      AND NOT (wt.amount=10000.00 AND wt.description='Welcome bonus - Demo credits')
  )
  AND NOT EXISTS (SELECT 1 FROM public.bets b WHERE b.user_id=p.id)
  AND NOT EXISTS (
    SELECT 1 FROM public.admin_balance_adjustments aba WHERE aba.user_id=p.id
  );

DO $cleanup$
BEGIN
  IF to_regclass('public.ledger_accounts') IS NOT NULL
     AND to_regclass('public.ledger_journals') IS NOT NULL
     AND to_regclass('public.ledger_postings') IS NOT NULL THEN
    UPDATE public.ledger_accounts account
    SET balance=account.balance-posting_delta.total_amount,updated_at=NOW()
    FROM (
      SELECT posting.account_id,SUM(posting.amount) AS total_amount
      FROM public.ledger_postings posting
      JOIN public.ledger_journals journal ON journal.id=posting.journal_id
      JOIN public.wallet_transactions transaction_record
        ON transaction_record.id=journal.source_transaction_id
      JOIN legacy_welcome_credit_users legacy ON legacy.id=transaction_record.user_id
      WHERE transaction_record.amount=10000.00
        AND transaction_record.description='Welcome bonus - Demo credits'
      GROUP BY posting.account_id
    ) posting_delta
    WHERE account.id=posting_delta.account_id;

    DELETE FROM public.ledger_postings posting
    USING public.ledger_journals journal,
          public.wallet_transactions transaction_record,
          legacy_welcome_credit_users legacy
    WHERE posting.journal_id=journal.id
      AND journal.source_transaction_id=transaction_record.id
      AND transaction_record.user_id=legacy.id
      AND transaction_record.amount=10000.00
      AND transaction_record.description='Welcome bonus - Demo credits';

    DELETE FROM public.ledger_journals journal
    USING public.wallet_transactions transaction_record,
          legacy_welcome_credit_users legacy
    WHERE journal.source_transaction_id=transaction_record.id
      AND transaction_record.user_id=legacy.id
      AND transaction_record.amount=10000.00
      AND transaction_record.description='Welcome bonus - Demo credits';

    UPDATE public.ledger_accounts
    SET balance=0.00,updated_at=NOW()
    WHERE user_id IN (SELECT id FROM legacy_welcome_credit_users)
      AND account_code IN ('cash','bonus');
  END IF;

  IF to_regclass('public.wallet_accounts') IS NOT NULL THEN
    BEGIN
      EXECUTE 'UPDATE public.wallet_accounts
        SET balance=0.00,bonus_balance=0.00,updated_at=NOW()
        WHERE user_id IN (SELECT id FROM legacy_welcome_credit_users)';
    EXCEPTION WHEN undefined_column THEN
      BEGIN
        EXECUTE 'UPDATE public.wallet_accounts
          SET balance=0.00,updated_at=NOW()
          WHERE user_id IN (SELECT id FROM legacy_welcome_credit_users)';
      EXCEPTION WHEN undefined_column THEN NULL;
      END;
    END;
  END IF;
END
$cleanup$;

DELETE FROM public.wallet_transactions transaction_record
USING legacy_welcome_credit_users legacy
WHERE transaction_record.user_id=legacy.id
  AND transaction_record.amount=10000.00
  AND transaction_record.description='Welcome bonus - Demo credits';

DROP TRIGGER IF EXISTS protect_profile_system_fields_trigger ON public.profiles;

UPDATE public.profiles profile
SET demo_balance=0.00,updated_at=NOW()
FROM legacy_welcome_credit_users legacy
WHERE profile.id=legacy.id;

DO $protection$
BEGIN
  IF to_regprocedure('public.protect_profile_system_fields()') IS NOT NULL THEN
    EXECUTE 'CREATE TRIGGER protect_profile_system_fields_trigger
      BEFORE UPDATE ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.protect_profile_system_fields()';
  END IF;
END
$protection$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
  INSERT INTO public.profiles (id,email,full_name,demo_balance,referral_code)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name',NEW.raw_user_meta_data->>'name'),
    0.00,
    SUBSTRING(MD5(RANDOM()::TEXT || NEW.id::TEXT) FROM 1 FOR 8)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates a zero-balance customer profile. Automatic signup and demo credits are disabled.';

COMMENT ON COLUMN public.profiles.demo_balance IS
  'Legacy compatibility mirror. New customers start at zero; balances require an approved funding action.';
