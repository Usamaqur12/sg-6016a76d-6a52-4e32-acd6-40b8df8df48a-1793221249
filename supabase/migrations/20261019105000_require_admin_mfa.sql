-- Require an Authenticator Assurance Level 2 JWT for every browser-authenticated
-- admin capability. Service-role workers remain authorized through their
-- explicit is_service_role() checks and bypass RLS as intended.

CREATE OR REPLACE FUNCTION public.is_aal2()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(auth.jwt()->>'aal','')='aal2';
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.is_aal2() AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id=auth.uid() AND is_admin=TRUE AND admin_role IS NOT NULL
      AND COALESCE(is_suspended,FALSE)=FALSE
  );
$$;

CREATE OR REPLACE FUNCTION public.has_admin_role(p_allowed_roles TEXT[] DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.is_aal2() AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id=auth.uid() AND is_admin=TRUE AND COALESCE(is_suspended,FALSE)=FALSE
      AND admin_role IS NOT NULL
      AND (admin_role IN ('super_admin','admin') OR p_allowed_roles IS NULL OR admin_role=ANY(p_allowed_roles))
  );
$$;

REVOKE ALL ON FUNCTION public.is_aal2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_aal2() TO authenticated;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon,authenticated;
REVOKE ALL ON FUNCTION public.has_admin_role(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_admin_role(TEXT[]) TO anon,authenticated;
