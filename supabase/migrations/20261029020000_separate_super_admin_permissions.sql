-- Separate super-admin authority from ordinary admin access.
-- This migration removes the historical shortcut that treated both roles as identical.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND is_admin = TRUE
      AND COALESCE(is_suspended, FALSE) = FALSE
      AND admin_role = 'super_admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.has_admin_role(p_allowed_roles TEXT[] DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND is_admin = TRUE
      AND COALESCE(is_suspended, FALSE) = FALSE
      AND admin_role IS NOT NULL
      AND (
        admin_role = 'super_admin'
        OR p_allowed_roles IS NULL
        OR admin_role = ANY(p_allowed_roles)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.has_admin_role(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_admin_role(TEXT[]) TO anon, authenticated;

-- Ordinary admins may operate on customer profiles, but cannot discover or
-- mutate a super-admin profile through the client API.
DROP POLICY IF EXISTS "admins_select_all_profiles" ON public.profiles;
CREATE POLICY "admins_select_all_profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    public.has_admin_role(NULL)
    AND (
      admin_role IS DISTINCT FROM 'super_admin'
      OR public.is_super_admin()
      OR id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "admins_update_all_profiles" ON public.profiles;
CREATE POLICY "admins_update_all_profiles"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    public.has_admin_role(NULL)
    AND (
      admin_role IS DISTINCT FROM 'super_admin'
      OR public.is_super_admin()
      OR id = auth.uid()
    )
  )
  WITH CHECK (
    public.has_admin_role(NULL)
    AND (
      admin_role IS DISTINCT FROM 'super_admin'
      OR public.is_super_admin()
      OR id = auth.uid()
    )
  );

-- Only a super admin or the service role may change identity/admin authority.
-- Balance changes remain service-side so wallet ledger rules cannot be bypassed.
CREATE OR REPLACE FUNCTION public.protect_profile_system_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_service_role() THEN
    IF NEW.demo_balance IS DISTINCT FROM OLD.demo_balance THEN
      RAISE EXCEPTION 'Profile balance must be changed through an approved server operation';
    END IF;

    IF (
      NEW.id IS DISTINCT FROM OLD.id
      OR NEW.email IS DISTINCT FROM OLD.email
      OR NEW.is_admin IS DISTINCT FROM OLD.is_admin
      OR NEW.admin_role IS DISTINCT FROM OLD.admin_role
    ) AND NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Only a super admin can change admin authority';
    END IF;

    IF NOT public.is_admin() THEN
      IF NEW.kyc_status IS DISTINCT FROM OLD.kyc_status
        OR NEW.is_verified IS DISTINCT FROM OLD.is_verified
        OR NEW.is_suspended IS DISTINCT FROM OLD.is_suspended
        OR NEW.suspension_reason IS DISTINCT FROM OLD.suspension_reason
        OR NEW.referral_code IS DISTINCT FROM OLD.referral_code
        OR NEW.referred_by IS DISTINCT FROM OLD.referred_by
      THEN
        RAISE EXCEPTION 'Protected profile fields cannot be changed by this user';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
