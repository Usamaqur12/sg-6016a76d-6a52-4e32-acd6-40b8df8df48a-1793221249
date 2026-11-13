-- Normalize the CCPayment customer method without creating a duplicate row.
-- Existing enablement is preserved; a newly-created method starts disabled.

INSERT INTO public.payment_methods (
  name,
  code,
  method_type,
  provider_code,
  currency,
  network,
  destination_reference,
  instructions,
  min_amount,
  max_amount,
  is_enabled,
  display_order,
  archived_at,
  updated_at
)
VALUES (
  'CCPayment Crypto Checkout',
  'ccpayment',
  'provider',
  'ccpayment',
  'USD',
  'Multi-chain',
  NULL,
  'Choose your coin and network on the secure CCPayment checkout page.',
  10,
  100000,
  FALSE,
  10,
  NULL,
  NOW()
)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  method_type = EXCLUDED.method_type,
  provider_code = EXCLUDED.provider_code,
  currency = EXCLUDED.currency,
  network = EXCLUDED.network,
  destination_reference = NULL,
  instructions = EXCLUDED.instructions,
  min_amount = EXCLUDED.min_amount,
  max_amount = EXCLUDED.max_amount,
  display_order = EXCLUDED.display_order,
  archived_at = NULL,
  updated_at = NOW();

NOTIFY pgrst, 'reload schema';
