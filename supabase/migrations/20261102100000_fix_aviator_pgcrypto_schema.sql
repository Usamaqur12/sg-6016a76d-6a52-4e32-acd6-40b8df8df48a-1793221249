-- Supabase installs pgcrypto in the extensions schema.
-- Existing Aviator functions were created with search_path=public, so unqualified
-- pgcrypto calls could not resolve. This patch repairs already-applied databases.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER FUNCTION public.aviator_calculate_crash(TEXT,TEXT,BIGINT,NUMERIC,NUMERIC)
  SET search_path TO public, extensions;
ALTER FUNCTION public.aviator_sync_round()
  SET search_path TO public, extensions;

-- Fail fast now so deployment catches a missing extension immediately.
DO $$
BEGIN
  PERFORM extensions.gen_random_bytes(1);
  PERFORM extensions.digest('aviator-health-check','sha256');
  PERFORM extensions.hmac('aviator-health-check','primebet','sha256');
END $$;
