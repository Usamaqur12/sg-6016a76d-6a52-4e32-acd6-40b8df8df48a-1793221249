-- Remove the historical automatic $10,000 play-money grant.
-- Only untouched legacy accounts are reset; accounts with any wallet activity are preserved.

ALTER TABLE public.profiles
  ALTER COLUMN demo_balance SET DEFAULT 0.00;

ALTER TABLE public.wallet_accounts
  ALTER COLUMN balance SET DEFAULT 0.00;

CREATE TEMP TABLE legacy_demo_balance_users ON COMMIT DROP AS
SELECT p.id
FROM public.profiles p
WHERE p.demo_balance = 10000.00
  AND NOT EXISTS (
    SELECT 1
    FROM public.wallet_transactions wt
    WHERE wt.user_id = p.id
  );

INSERT INTO public.wallet_transactions (
  user_id,
  type,
  amount,
  balance_before,
  balance_after,
  description,
  status,
  metadata
)
SELECT
  id,
  'adjustment',
  -10000.00,
  10000.00,
  0.00,
  'Legacy demo balance removed',
  'completed',
  jsonb_build_object('reason', 'remove_legacy_demo_credit', 'migration', '20261101010000')
FROM legacy_demo_balance_users;

UPDATE public.profiles p
SET demo_balance = 0.00,
    updated_at = NOW()
FROM legacy_demo_balance_users legacy
WHERE p.id = legacy.id;

UPDATE public.wallet_accounts wa
SET balance = 0.00,
    updated_at = NOW()
FROM legacy_demo_balance_users legacy
WHERE wa.user_id = legacy.id
  AND wa.balance = 10000.00;

COMMENT ON COLUMN public.profiles.demo_balance IS
  'Legacy balance column retained for compatibility. New accounts always start at zero.';
