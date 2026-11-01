-- Privacy-safe customer deletion: anonymize personal data while retaining financial/audit history.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_anonymized_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_anonymized_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS anonymization_reference UUID;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_anonymization_reference_idx
  ON public.profiles(anonymization_reference)
  WHERE anonymization_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.customer_anonymizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  anonymized_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  original_email_hash TEXT NOT NULL CHECK (original_email_hash ~ '^[a-f0-9]{64}$'),
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 500),
  retained_financial_history BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE public.customer_anonymizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_anonymizations FROM PUBLIC,anon,authenticated;

CREATE INDEX IF NOT EXISTS customer_anonymizations_created_idx
  ON public.customer_anonymizations(created_at DESC);
