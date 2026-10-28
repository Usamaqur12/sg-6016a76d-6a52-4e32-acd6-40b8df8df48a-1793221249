-- Enforce the admin hierarchy at the database layer and provide an atomic,
-- audited balance-credit operation for trusted server routes.

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND is_admin = TRUE
      AND admin_role = 'super_admin'
      AND COALESCE(is_suspended, FALSE) = FALSE
  );
$$;

REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

DROP POLICY IF EXISTS "admins_select_all_profiles" ON public.profiles;
CREATE POLICY "admins_select_non_super_profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.has_admin_role(NULL)
      AND COALESCE(admin_role, '') <> 'super_admin'
    )
  );

DROP POLICY IF EXISTS "admins_update_all_profiles" ON public.profiles;
DROP POLICY IF EXISTS "admins_update_profiles" ON public.profiles;
CREATE POLICY "admins_update_non_super_profiles"
  ON public.profiles FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.has_admin_role(NULL)
      AND COALESCE(admin_role, '') <> 'super_admin'
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      public.has_admin_role(NULL)
      AND COALESCE(admin_role, '') <> 'super_admin'
    )
  );

CREATE TABLE IF NOT EXISTS public.admin_balance_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key UUID NOT NULL UNIQUE,
  admin_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  amount NUMERIC(15,2) NOT NULL CHECK (amount BETWEEN 0.01 AND 100000),
  reason TEXT NOT NULL CHECK (char_length(trim(reason)) BETWEEN 5 AND 500),
  balance_before NUMERIC(15,2) NOT NULL,
  balance_after NUMERIC(15,2) NOT NULL,
  wallet_transaction_id UUID REFERENCES public.wallet_transactions(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_balance_adjustments_user_created_idx
  ON public.admin_balance_adjustments(user_id, created_at DESC);

ALTER TABLE public.admin_balance_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_balance_adjustments FROM PUBLIC, anon, authenticated;

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
AS $$
DECLARE
  v_adjustment UUID;
  v_transaction UUID;
  v_before NUMERIC(15,2);
  v_after NUMERIC(15,2);
  v_existing public.admin_balance_adjustments%ROWTYPE;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Service authorization required';
  END IF;
  IF p_user_id IS NULL OR p_admin_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'User, admin and idempotency key are required';
  END IF;
  IF p_amount IS NULL OR ROUND(p_amount, 2) < 0.01 OR ROUND(p_amount, 2) > 100000 THEN
    RAISE EXCEPTION 'Credit amount must be between 0.01 and 100000.00';
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
  WHERE id = p_user_id
    AND COALESCE(is_admin, FALSE) = FALSE
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer account not found';
  END IF;

  v_after := v_before + ROUND(p_amount, 2);
  INSERT INTO public.admin_balance_adjustments(
    idempotency_key, admin_id, user_id, amount, reason, balance_before, balance_after
  ) VALUES (
    p_idempotency_key, p_admin_id, p_user_id, ROUND(p_amount, 2), trim(p_reason), v_before, v_after
  ) RETURNING id INTO v_adjustment;

  UPDATE public.profiles
  SET demo_balance = v_after, updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO public.wallet_transactions(
    user_id, type, amount, balance_before, balance_after,
    description, reference_id, status, metadata
  ) VALUES (
    p_user_id, 'adjustment', ROUND(p_amount, 2), v_before, v_after,
    'Admin balance credit: ' || trim(p_reason), v_adjustment, 'completed',
    jsonb_build_object('admin_id', p_admin_id, 'reason', trim(p_reason), 'idempotency_key', p_idempotency_key)
  ) RETURNING id INTO v_transaction;

  UPDATE public.admin_balance_adjustments
  SET wallet_transaction_id = v_transaction
  WHERE id = v_adjustment;

  INSERT INTO public.audit_logs(admin_id, action, entity_type, entity_id, changes)
  VALUES (
    p_admin_id,
    'user_balance_credit',
    'profile',
    p_user_id,
    jsonb_build_object(
      'adjustment_id', v_adjustment,
      'transaction_id', v_transaction,
      'amount', ROUND(p_amount, 2),
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

REVOKE ALL ON FUNCTION public.admin_credit_user_balance(UUID,NUMERIC,TEXT,UUID,UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_credit_user_balance(UUID,NUMERIC,TEXT,UUID,UUID)
  TO service_role;

COMMENT ON TABLE public.admin_balance_adjustments IS
  'Append-only audit records for server-authorized customer balance credits.';
