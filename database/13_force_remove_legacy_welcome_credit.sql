-- Force-clean untouched legacy welcome-credit accounts that were skipped by earlier cleanup.
-- Targets only non-admin accounts whose only wallet history is the exact legacy welcome credit
-- and which have no bets. Both profile-opening and welcome-transaction ledger journals are reversed.

CREATE TEMP TABLE force_legacy_credit_users ON COMMIT DROP AS
SELECT DISTINCT p.id
FROM public.profiles p
JOIN public.wallet_transactions welcome
  ON welcome.user_id=p.id
 AND welcome.amount=10000.00
 AND welcome.description='Welcome bonus - Demo credits'
WHERE COALESCE(p.is_admin,FALSE)=FALSE
  AND NOT EXISTS (
    SELECT 1
    FROM public.wallet_transactions other_transaction
    WHERE other_transaction.user_id=p.id
      AND other_transaction.id<>welcome.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.bets bet WHERE bet.user_id=p.id
  );

DO $cleanup$
BEGIN
  IF to_regclass('public.ledger_accounts') IS NOT NULL
     AND to_regclass('public.ledger_journals') IS NOT NULL
     AND to_regclass('public.ledger_postings') IS NOT NULL THEN

    UPDATE public.ledger_accounts account
    SET balance=account.balance-posting_delta.total_amount,
        updated_at=NOW()
    FROM (
      SELECT posting.account_id,SUM(posting.amount) AS total_amount
      FROM public.ledger_postings posting
      JOIN public.ledger_journals journal ON journal.id=posting.journal_id
      WHERE journal.idempotency_key IN (
          SELECT 'profile-opening:'||legacy.id::TEXT
          FROM force_legacy_credit_users legacy
        )
        OR journal.source_transaction_id IN (
          SELECT transaction_record.id
          FROM public.wallet_transactions transaction_record
          JOIN force_legacy_credit_users legacy ON legacy.id=transaction_record.user_id
          WHERE transaction_record.amount=10000.00
            AND transaction_record.description='Welcome bonus - Demo credits'
        )
      GROUP BY posting.account_id
    ) posting_delta
    WHERE account.id=posting_delta.account_id;

    DELETE FROM public.ledger_postings posting
    USING public.ledger_journals journal
    WHERE posting.journal_id=journal.id
      AND (
        journal.idempotency_key IN (
          SELECT 'profile-opening:'||legacy.id::TEXT
          FROM force_legacy_credit_users legacy
        )
        OR journal.source_transaction_id IN (
          SELECT transaction_record.id
          FROM public.wallet_transactions transaction_record
          JOIN force_legacy_credit_users legacy ON legacy.id=transaction_record.user_id
          WHERE transaction_record.amount=10000.00
            AND transaction_record.description='Welcome bonus - Demo credits'
        )
      );

    DELETE FROM public.ledger_journals journal
    WHERE journal.idempotency_key IN (
        SELECT 'profile-opening:'||legacy.id::TEXT
        FROM force_legacy_credit_users legacy
      )
      OR journal.source_transaction_id IN (
        SELECT transaction_record.id
        FROM public.wallet_transactions transaction_record
        JOIN force_legacy_credit_users legacy ON legacy.id=transaction_record.user_id
        WHERE transaction_record.amount=10000.00
          AND transaction_record.description='Welcome bonus - Demo credits'
      );

    UPDATE public.ledger_accounts
    SET balance=0.00,updated_at=NOW()
    WHERE user_id IN (SELECT id FROM force_legacy_credit_users)
      AND account_code IN ('cash','bonus','locked');
  END IF;

  IF to_regclass('public.wallet_accounts') IS NOT NULL THEN
    BEGIN
      EXECUTE 'UPDATE public.wallet_accounts
        SET balance=0.00,bonus_balance=0.00,updated_at=NOW()
        WHERE user_id IN (SELECT id FROM force_legacy_credit_users)';
    EXCEPTION WHEN undefined_column THEN
      BEGIN
        EXECUTE 'UPDATE public.wallet_accounts
          SET balance=0.00,updated_at=NOW()
          WHERE user_id IN (SELECT id FROM force_legacy_credit_users)';
      EXCEPTION WHEN undefined_column THEN NULL;
      END;
    END;
  END IF;
END
$cleanup$;

DELETE FROM public.wallet_transactions transaction_record
USING force_legacy_credit_users legacy
WHERE transaction_record.user_id=legacy.id
  AND transaction_record.amount=10000.00
  AND transaction_record.description='Welcome bonus - Demo credits';

DROP TRIGGER IF EXISTS protect_profile_system_fields_trigger ON public.profiles;

UPDATE public.profiles profile
SET demo_balance=0.00,updated_at=NOW()
FROM force_legacy_credit_users legacy
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

SELECT COUNT(*) AS cleaned_legacy_accounts
FROM force_legacy_credit_users;
