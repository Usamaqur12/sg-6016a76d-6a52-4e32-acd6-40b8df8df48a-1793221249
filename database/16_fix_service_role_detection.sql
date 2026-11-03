-- Run this file in the Supabase SQL Editor when an sb_secret_* server key is
-- configured but privileged RPCs still report "Service authorization required".

CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    COALESCE(auth.role() = 'service_role', FALSE)
    OR COALESCE(auth.jwt() ->> 'role' = 'service_role', FALSE)
    OR COALESCE(
      NULLIF(current_setting('request.jwt.claim.role', TRUE), '') = 'service_role',
      FALSE
    )
    OR COALESCE(
      NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'role' = 'service_role',
      FALSE
    );
$function$;

REVOKE ALL ON FUNCTION public.is_service_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_service_role() TO service_role;

COMMENT ON FUNCTION public.is_service_role() IS
  'Recognizes server-only service authorization from current and legacy Supabase API-key claim formats.';
