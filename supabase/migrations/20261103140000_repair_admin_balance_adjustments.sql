-- Repair admin add/deduct operations so the authoritative wallet ledger,
-- the compatibility profile mirror, wallet history and audit log move together.

CREATE TABLE IF NOT EXISTS public.admin_balance_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key UUID NOT NULL UNIQUE,
  admin_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  amount NUMERIC(15,2) NOT NULL,
  reason TEXT NOT NULL,
  balance_before NUMERIC(15,2) NOT NULL,
  balance_after NUMERIC(15,2) NOT NULL,
  wallet_transaction_id UUID REFERENCES public.wallet_transactions(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.admin_balance_adjustments
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.admin_balance_adjustments
  DROP CONSTRAINT IF EXISTS admin_balance_adjustments_amount_check;

ALTER TABLE public.admin_balance_adjustments
  ADD CONSTRAINT admin_balance_adjustments_amount_check
  CHECK (amount BETWEEN -100000 AND 100000 AND amount <> 0);

CREATE INDEX IF NOT EXISTS admin_balance_adjustments_user_created_idx
  ON public.admin_balance_adjustments(user_id, created_at DESC);

ALTER TABLE public.admin_balance_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_balance_adjustments FROM PUBLIC, anon, authenticated;

INSERT INTO public.ledger_accounts(user_id, account_code, currency, balance, is_system)
VALUES (NULL, 'sportsbook_clearing', 'USD', 0, TRUE)
ON CONFLICT (currency, account_code) WHERE user_id IS NULL DO NOTHING;

DO $trigger$
BEGIN
  IF to_regprocedure('public.mirror_wallet_transaction_to_ledger()') IS NULL THEN
    RAISE EXCEPTION 'Wallet ledger migration is not installed';
  END IF;

  DROP TRIGGER IF EXISTS mirror_wallet_transaction_to_ledger_trigger
    ON public.wallet_transactions;

  CREATE TRIGGER mirror_wallet_transaction_to_ledger_trigger
    AFTER INSERT ON public.wallet_transactions
    FOR EACH ROW EXECUTE FUNCTION public.mirror_wallet_transaction_to_ledger();
END
$trigger$;

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
AS $function$
DECLARE
  v_adjustment UUID;
  v_transaction UUID;
  v_cash_account UUID;
  v_bonus_account UUID;
  v_cash_balance NUMERIC(18,2);
  v_bonus_balance NUMERIC(18,2);
  v_before NUMERIC(18,2);
  v_after NUMERIC(18,2);
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
    SELECT 1
    FROM public.profiles
    WHERE id = p_admin_id
      AND is_admin = TRUE
      AND admin_role IN ('super_admin', 'admin', 'finance')
      AND COALESCE(is_suspended, FALSE) = FALSE
  ) THEN
    RAISE EXCEPTION 'Balance adjustment authorization denied';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = p_user_id
      AND COALESCE(is_admin, FALSE) = FALSE
  ) THEN
    RAISE EXCEPTION 'Customer account not found';
  END IF;

  SELECT *
  INTO v_existing
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

  -- Never seed from the legacy profile mirror. New accounts and missing
  -- account rows must start from the real ledger value only.
  PERFORM public.ensure_user_ledger_accounts_from_id(p_user_id, 0);

  SELECT id, balance
  INTO v_cash_account, v_cash_balance
  FROM public.ledger_accounts
  WHERE user_id = p_user_id
    AND currency = 'USD'
    AND account_code = 'cash'
  FOR UPDATE;

  SELECT id, balance
  INTO v_bonus_account, v_bonus_balance
  FROM public.ledger_accounts
  WHERE user_id = p_user_id
    AND currency = 'USD'
    AND account_code = 'bonus'
  FOR UPDATE;

  IF v_cash_account IS NULL OR v_bonus_account IS NULL THEN
    RAISE EXCEPTION 'Customer wallet accounts are unavailable';
  END IF;

  v_before := COALESCE(v_cash_balance, 0) + COALESCE(v_bonus_balance, 0);
  v_after := v_before + v_amount;

  IF v_after < 0 THEN
    RAISE EXCEPTION 'Balance cannot be reduced below zero';
  END IF;

  INSERT INTO public.admin_balance_adjustments(
    idempotency_key,
    admin_id,
    user_id,
    amount,
    reason,
    balance_before,
    balance_after
  )
  VALUES (
    p_idempotency_key,
    p_admin_id,
    p_user_id,
    v_amount,
    trim(p_reason),
    v_before,
    v_after
  )
  RETURNING id INTO v_adjustment;

  -- The existing wallet trigger posts the matching double-entry ledger
  -- journal atomically in this same database transaction.
  INSERT INTO public.wallet_transactions(
    user_id,
    type,
    amount,
    balance_before,
    balance_after,
    description,
    reference_id,
    status,
    metadata
  )
  VALUES (
    p_user_id,
    'adjustment',
    v_amount,
    v_before,
    v_after,
    CASE
      WHEN v_amount > 0 THEN 'Admin balance addition: '
      ELSE 'Admin balance deduction: '
    END || trim(p_reason),
    v_adjustment,
    'completed',
    jsonb_build_object(
      'admin_id', p_admin_id,
      'reason', trim(p_reason),
      'idempotency_key', p_idempotency_key
    )
  )
  RETURNING id INTO v_transaction;

  UPDATE public.admin_balance_adjustments
  SET wallet_transaction_id = v_transaction,
      updated_at = NOW()
  WHERE id = v_adjustment;

  -- Keep the legacy column as a compatibility mirror only. Customer-facing
  -- balances continue to read the authoritative cash/bonus ledger.
  UPDATE public.profiles
  SET demo_balance = v_after,
      updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO public.audit_logs(
    admin_id,
    action,
    entity_type,
    entity_id,
    changes
  )
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_credit_user_balance(
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
AS $function$
BEGIN
  IF p_amount IS NULL OR ROUND(p_amount, 2) <= 0 THEN
    RAISE EXCEPTION 'Credit amount must be greater than zero';
  END IF;

  RETURN public.admin_adjust_user_balance(
    p_user_id,
    ROUND(p_amount, 2),
    p_reason,
    p_admin_id,
    p_idempotency_key
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_adjust_user_balance(UUID, NUMERIC, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_user_balance(UUID, NUMERIC, TEXT, UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.admin_credit_user_balance(UUID, NUMERIC, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_credit_user_balance(UUID, NUMERIC, TEXT, UUID, UUID)
  TO service_role;

COMMENT ON FUNCTION public.admin_adjust_user_balance(UUID, NUMERIC, TEXT, UUID, UUID) IS
  'Atomically adds or deducts a customer wallet balance using the authoritative double-entry ledger.';
