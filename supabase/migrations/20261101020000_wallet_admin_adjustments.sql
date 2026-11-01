-- Remove unfunded legacy play-money balances and support audited signed adjustments.

ALTER TABLE public.profiles ALTER COLUMN demo_balance SET DEFAULT 0.00;

ALTER TABLE public.admin_balance_adjustments
  DROP CONSTRAINT IF EXISTS admin_balance_adjustments_amount_check;
ALTER TABLE public.admin_balance_adjustments
  ADD CONSTRAINT admin_balance_adjustments_amount_check
  CHECK (amount BETWEEN -100000 AND 100000 AND amount <> 0);

DO $$
DECLARE
  v_user RECORD;
  v_cash_account UUID;
  v_system_account UUID;
  v_journal UUID;
  v_cash_balance NUMERIC(18,2);
  v_system_balance NUMERIC(18,2);
BEGIN
  SELECT id INTO v_system_account
  FROM public.ledger_accounts
  WHERE user_id IS NULL AND currency = 'USD' AND account_code = 'sportsbook_clearing'
  FOR UPDATE;

  FOR v_user IN
    SELECT p.id
    FROM public.profiles p
    WHERE COALESCE(p.demo_balance, 0) <> 0
      AND NOT EXISTS (
        SELECT 1 FROM public.wallet_transactions wt
        WHERE wt.user_id = p.id
          AND wt.status = 'completed'
          AND wt.type = 'deposit'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.admin_balance_adjustments aba
        WHERE aba.user_id = p.id
      )
  LOOP
    v_cash_account := NULL;
    v_cash_balance := 0;
    v_journal := NULL;

    SELECT id, balance INTO v_cash_account, v_cash_balance
    FROM public.ledger_accounts
    WHERE user_id = v_user.id AND currency = 'USD' AND account_code = 'cash'
    FOR UPDATE;

    IF v_cash_account IS NOT NULL AND COALESCE(v_cash_balance, 0) <> 0 THEN
      INSERT INTO public.ledger_journals(source_type, idempotency_key, description, metadata)
      VALUES (
        'legacy_demo_cleanup',
        'legacy-demo-cleanup:' || v_user.id,
        'Removed unfunded legacy play-money balance',
        jsonb_build_object('user_id', v_user.id)
      )
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id INTO v_journal;

      IF v_journal IS NOT NULL THEN
        UPDATE public.ledger_accounts
        SET balance = 0, updated_at = NOW()
        WHERE id = v_cash_account;

        UPDATE public.ledger_accounts
        SET balance = balance + v_cash_balance, updated_at = NOW()
        WHERE id = v_system_account
        RETURNING balance INTO v_system_balance;

        INSERT INTO public.ledger_postings(journal_id, account_id, amount, balance_after)
        VALUES
          (v_journal, v_cash_account, -v_cash_balance, 0),
          (v_journal, v_system_account, v_cash_balance, v_system_balance);
      END IF;
    END IF;

    UPDATE public.profiles
    SET demo_balance = 0, updated_at = NOW()
    WHERE id = v_user.id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_adjust_user_balance(
  p_user_id UUID,
  p_amount NUMERIC,
  p_reason TEXT,
  p_admin_id UUID,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_adjustment UUID;
  v_transaction UUID;
  v_before NUMERIC(15,2);
  v_after NUMERIC(15,2);
  v_amount NUMERIC(15,2) := ROUND(p_amount, 2);
  v_existing public.admin_balance_adjustments%ROWTYPE;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Service authorization required';
  END IF;
  IF p_user_id IS NULL OR p_admin_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'User, admin and idempotency key are required';
  END IF;
  IF v_amount IS NULL OR v_amount = 0 OR ABS(v_amount) > 100000 THEN
    RAISE EXCEPTION 'Adjustment must be between -100000.00 and 100000.00 and cannot be zero';
  END IF;
  IF char_length(trim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'A meaningful adjustment reason is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_admin_id
      AND is_admin = TRUE
      AND admin_role IN ('super_admin', 'admin', 'finance')
      AND COALESCE(is_suspended, FALSE) = FALSE
  ) THEN
    RAISE EXCEPTION 'Balance adjustment authorization denied';
  END IF;

  SELECT * INTO v_existing
  FROM public.admin_balance_adjustments
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'adjustment_id', v_existing.id,
      'transaction_id', v_existing.wallet_transaction_id,
      'balance', v_existing.balance_after,
      'replayed', TRUE
    );
  END IF;

  SELECT COALESCE(demo_balance, 0) INTO v_before
  FROM public.profiles
  WHERE id = p_user_id AND COALESCE(is_admin, FALSE) = FALSE
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer account not found'; END IF;

  v_after := v_before + v_amount;
  IF v_after < 0 THEN RAISE EXCEPTION 'Balance cannot be reduced below zero'; END IF;

  INSERT INTO public.admin_balance_adjustments(
    idempotency_key, admin_id, user_id, amount, reason, balance_before, balance_after
  ) VALUES (
    p_idempotency_key, p_admin_id, p_user_id, v_amount, trim(p_reason), v_before, v_after
  ) RETURNING id INTO v_adjustment;

  UPDATE public.profiles
  SET demo_balance = v_after, updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO public.wallet_transactions(
    user_id, type, amount, balance_before, balance_after,
    description, reference_id, status, metadata
  ) VALUES (
    p_user_id,
    'adjustment',
    v_amount,
    v_before,
    v_after,
    CASE WHEN v_amount > 0 THEN 'Admin balance addition: ' ELSE 'Admin balance deduction: ' END || trim(p_reason),
    v_adjustment,
    'completed',
    jsonb_build_object('admin_id', p_admin_id, 'reason', trim(p_reason), 'idempotency_key', p_idempotency_key)
  ) RETURNING id INTO v_transaction;

  UPDATE public.admin_balance_adjustments
  SET wallet_transaction_id = v_transaction
  WHERE id = v_adjustment;

  INSERT INTO public.audit_logs(admin_id, action, entity_type, entity_id, changes)
  VALUES (
    p_admin_id,
    'user_balance_adjustment',
    'profile',
    p_user_id,
    jsonb_build_object(
      'adjustment_id', v_adjustment,
      'transaction_id', v_transaction,
      'amount', v_amount,
      'balance_before', v_before,
      'balance_after', v_after,
      'reason', trim(p_reason)
    )
  );

  RETURN jsonb_build_object(
    'adjustment_id', v_adjustment,
    'transaction_id', v_transaction,
    'balance', v_after,
    'replayed', FALSE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_user_balance(UUID,NUMERIC,TEXT,UUID,UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_user_balance(UUID,NUMERIC,TEXT,UUID,UUID)
  TO service_role;