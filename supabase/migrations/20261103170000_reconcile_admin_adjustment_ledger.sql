-- Reconcile completed admin balance adjustments that were recorded before the
-- ledger mirror trigger was healthy. Existing ledger journals are excluded, so
-- each wallet transaction can be posted at most once.

INSERT INTO public.ledger_accounts(user_id, account_code, currency, balance, is_system)
VALUES (NULL, 'sportsbook_clearing', 'USD', 0, TRUE)
ON CONFLICT (currency, account_code) WHERE user_id IS NULL DO NOTHING;

DO $repair$
DECLARE
  v_tx RECORD;
  v_journal UUID;
  v_cash UUID;
  v_bonus UUID;
  v_system UUID;
  v_cash_balance NUMERIC(18,2);
  v_bonus_balance NUMERIC(18,2);
  v_balance NUMERIC(18,2);
  v_amount NUMERIC(18,2);
  v_cash_part NUMERIC(18,2);
  v_bonus_part NUMERIC(18,2);
BEGIN
  IF to_regprocedure('public.mirror_wallet_transaction_to_ledger()') IS NULL THEN
    RAISE EXCEPTION 'Wallet ledger migration is not installed';
  END IF;

  DROP TRIGGER IF EXISTS mirror_wallet_transaction_to_ledger_trigger
    ON public.wallet_transactions;
  CREATE TRIGGER mirror_wallet_transaction_to_ledger_trigger
    AFTER INSERT ON public.wallet_transactions
    FOR EACH ROW EXECUTE FUNCTION public.mirror_wallet_transaction_to_ledger();

  FOR v_tx IN
    SELECT wt.*
    FROM public.wallet_transactions wt
    JOIN public.admin_balance_adjustments aba
      ON aba.id = wt.reference_id
     AND aba.user_id = wt.user_id
    WHERE wt.type = 'adjustment'
      AND wt.status = 'completed'
      AND wt.amount <> 0
      AND NOT EXISTS (
        SELECT 1
        FROM public.ledger_journals lj
        WHERE lj.source_transaction_id = wt.id
      )
    ORDER BY wt.created_at, wt.id
  LOOP
    INSERT INTO public.ledger_accounts(user_id, account_code, currency, balance, is_system)
    SELECT v_tx.user_id, account_code, 'USD', 0, FALSE
    FROM (VALUES ('cash'), ('bonus'), ('locked')) AS accounts(account_code)
    ON CONFLICT (user_id, currency, account_code)
      WHERE user_id IS NOT NULL DO NOTHING;

    SELECT id, balance
    INTO v_cash, v_cash_balance
    FROM public.ledger_accounts
    WHERE user_id = v_tx.user_id
      AND currency = 'USD'
      AND account_code = 'cash'
    FOR UPDATE;

    SELECT id, balance
    INTO v_bonus, v_bonus_balance
    FROM public.ledger_accounts
    WHERE user_id = v_tx.user_id
      AND currency = 'USD'
      AND account_code = 'bonus'
    FOR UPDATE;

    SELECT id
    INTO v_system
    FROM public.ledger_accounts
    WHERE user_id IS NULL
      AND currency = 'USD'
      AND account_code = 'sportsbook_clearing'
    FOR UPDATE;

    IF v_cash IS NULL OR v_bonus IS NULL OR v_system IS NULL THEN
      RAISE EXCEPTION 'Wallet ledger accounts are unavailable for user %', v_tx.user_id;
    END IF;

    INSERT INTO public.ledger_journals(
      source_type,
      source_transaction_id,
      idempotency_key,
      description,
      metadata
    )
    VALUES (
      'wallet_transaction',
      v_tx.id,
      'wallet:' || v_tx.id,
      v_tx.description,
      COALESCE(v_tx.metadata, '{}'::JSONB) || jsonb_build_object('reconciled', TRUE)
    )
    RETURNING id INTO v_journal;

    v_amount := ABS(v_tx.amount);

    IF v_tx.amount > 0 THEN
      UPDATE public.ledger_accounts
      SET balance = balance - v_amount,
          updated_at = NOW()
      WHERE id = v_system
      RETURNING balance INTO v_balance;

      INSERT INTO public.ledger_postings(journal_id, account_id, amount, balance_after)
      VALUES (v_journal, v_system, -v_amount, v_balance);

      UPDATE public.ledger_accounts
      SET balance = balance + v_amount,
          updated_at = NOW()
      WHERE id = v_cash
      RETURNING balance INTO v_balance;

      INSERT INTO public.ledger_postings(journal_id, account_id, amount, balance_after)
      VALUES (v_journal, v_cash, v_amount, v_balance);
    ELSE
      v_cash_part := LEAST(v_amount, GREATEST(COALESCE(v_cash_balance, 0), 0));
      v_bonus_part := v_amount - v_cash_part;

      IF v_bonus_part > GREATEST(COALESCE(v_bonus_balance, 0), 0) THEN
        RAISE EXCEPTION 'Ledger funds are insufficient for reconciled adjustment %', v_tx.id;
      END IF;

      IF v_cash_part > 0 THEN
        UPDATE public.ledger_accounts
        SET balance = balance - v_cash_part,
            updated_at = NOW()
        WHERE id = v_cash
        RETURNING balance INTO v_balance;

        INSERT INTO public.ledger_postings(journal_id, account_id, amount, balance_after)
        VALUES (v_journal, v_cash, -v_cash_part, v_balance);
      END IF;

      IF v_bonus_part > 0 THEN
        UPDATE public.ledger_accounts
        SET balance = balance - v_bonus_part,
            updated_at = NOW()
        WHERE id = v_bonus
        RETURNING balance INTO v_balance;

        INSERT INTO public.ledger_postings(journal_id, account_id, amount, balance_after)
        VALUES (v_journal, v_bonus, -v_bonus_part, v_balance);
      END IF;

      UPDATE public.ledger_accounts
      SET balance = balance + v_amount,
          updated_at = NOW()
      WHERE id = v_system
      RETURNING balance INTO v_balance;

      INSERT INTO public.ledger_postings(journal_id, account_id, amount, balance_after)
      VALUES (v_journal, v_system, v_amount, v_balance);
    END IF;
  END LOOP;
END
$repair$;

UPDATE public.profiles p
SET demo_balance = balances.available,
    updated_at = NOW()
FROM (
  SELECT
    user_id,
    COALESCE(SUM(balance) FILTER (WHERE account_code IN ('cash', 'bonus')), 0) AS available
  FROM public.ledger_accounts
  WHERE user_id IS NOT NULL
    AND currency = 'USD'
  GROUP BY user_id
) balances
WHERE p.id = balances.user_id
  AND COALESCE(p.demo_balance, 0) IS DISTINCT FROM balances.available;

CREATE OR REPLACE FUNCTION public.verify_admin_adjustment_ledger_mirrored()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.type = 'adjustment'
    AND EXISTS (
      SELECT 1
      FROM public.admin_balance_adjustments aba
      WHERE aba.id = NEW.reference_id
        AND aba.user_id = NEW.user_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.ledger_journals lj
      WHERE lj.source_transaction_id = NEW.id
    )
  THEN
    RAISE EXCEPTION 'Admin adjustment ledger posting was not created';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS verify_admin_adjustment_ledger_mirrored_trigger
  ON public.wallet_transactions;
CREATE CONSTRAINT TRIGGER verify_admin_adjustment_ledger_mirrored_trigger
AFTER INSERT ON public.wallet_transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.verify_admin_adjustment_ledger_mirrored();

REVOKE ALL ON FUNCTION public.verify_admin_adjustment_ledger_mirrored()
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
