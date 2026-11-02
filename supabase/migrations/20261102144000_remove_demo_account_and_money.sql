-- Remove legacy automatic account credit and seeded promotional money.
-- Internal compatibility columns remain temporarily, but all customer UI reads the real ledger RPC.

ALTER TABLE public.profiles
  ALTER COLUMN demo_balance SET DEFAULT 0.00;

DO $cleanup$
BEGIN
  IF to_regclass('public.wallet_accounts') IS NOT NULL THEN
    BEGIN
      EXECUTE 'ALTER TABLE public.wallet_accounts ALTER COLUMN balance SET DEFAULT 0.00';
    EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN
      EXECUTE 'ALTER TABLE public.wallet_accounts ALTER COLUMN bonus_balance SET DEFAULT 0.00';
    EXCEPTION WHEN undefined_column THEN NULL; END;
  END IF;
END
$cleanup$;

DROP TRIGGER IF EXISTS protect_profile_system_fields_trigger ON public.profiles;

CREATE TEMP TABLE legacy_automatic_credit_users ON COMMIT DROP AS
SELECT p.id
FROM public.profiles p
WHERE p.demo_balance=10000.00
  AND (
    to_regclass('public.wallet_transactions') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.wallet_transactions wt WHERE wt.user_id=p.id
    )
  );

UPDATE public.profiles p
SET demo_balance=0.00,updated_at=NOW()
FROM legacy_automatic_credit_users legacy
WHERE p.id=legacy.id;

DO $cleanup$
BEGIN
  IF to_regclass('public.ledger_accounts') IS NOT NULL THEN
    EXECUTE 'UPDATE public.ledger_accounts a
      SET balance=0.00,updated_at=NOW()
      WHERE a.user_id IN (SELECT id FROM legacy_automatic_credit_users)
        AND a.account_code IN (''cash'',''bonus'')
        AND a.balance=10000.00';
  END IF;
  IF to_regclass('public.wallet_accounts') IS NOT NULL THEN
    BEGIN
      EXECUTE 'UPDATE public.wallet_accounts a
        SET balance=0.00,updated_at=NOW()
        WHERE a.user_id IN (SELECT id FROM legacy_automatic_credit_users)
          AND a.balance=10000.00';
    EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN
      EXECUTE 'DELETE FROM public.wallet_accounts
        WHERE user_id=''00000000-0000-0000-0000-000000000001''::UUID
          AND COALESCE(balance,0)=0';
    EXCEPTION WHEN undefined_column THEN NULL; END;
  END IF;

  IF to_regclass('public.user_bonuses') IS NOT NULL THEN
    BEGIN
      EXECUTE 'DELETE FROM public.user_bonuses
        WHERE promotion_id=''60000000-0000-0000-0000-000000000001''::UUID';
    EXCEPTION WHEN undefined_column OR foreign_key_violation THEN NULL; END;
  END IF;
  IF to_regclass('public.promotions') IS NOT NULL THEN
    BEGIN
      EXECUTE 'DELETE FROM public.promotions
        WHERE id=''60000000-0000-0000-0000-000000000001''::UUID';
    EXCEPTION WHEN foreign_key_violation THEN
      EXECUTE 'UPDATE public.promotions
        SET is_active=FALSE,title=''Legacy promotion disabled'',description=''Disabled'',updated_at=NOW()
        WHERE id=''60000000-0000-0000-0000-000000000001''::UUID';
    END;
  END IF;
END
$cleanup$;

DO $trigger$
BEGIN
  IF to_regprocedure('public.protect_profile_system_fields()') IS NOT NULL THEN
    EXECUTE 'CREATE TRIGGER protect_profile_system_fields_trigger
      BEFORE UPDATE ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.protect_profile_system_fields()';
  END IF;
END
$trigger$;

COMMENT ON COLUMN public.profiles.demo_balance IS
  'Legacy compatibility mirror. New accounts start at zero; customer interfaces read the cash/bonus/locked ledger.';
