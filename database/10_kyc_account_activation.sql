-- KYC-first customer activation with an audited admin override.
-- Apply after 09_remove_demo_account_and_money.sql.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS kyc_activation_override BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_account_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_account_status_check
  CHECK (account_status IN ('pending_kyc','active','closed'));

ALTER TABLE public.profiles ALTER COLUMN account_status SET DEFAULT 'pending_kyc';

UPDATE public.profiles
SET account_status = CASE
  WHEN COALESCE(is_admin,FALSE) THEN 'active'
  WHEN account_status='closed' THEN 'closed'
  WHEN kyc_status='approved' OR kyc_activation_override THEN 'active'
  ELSE 'pending_kyc'
END,
updated_at = NOW();

CREATE OR REPLACE FUNCTION public.protect_kyc_activation_fields()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_service_role() AND NOT public.is_admin() THEN
    IF NEW.kyc_activation_override IS DISTINCT FROM OLD.kyc_activation_override
      OR NEW.account_status IS DISTINCT FROM OLD.account_status THEN
      RAISE EXCEPTION 'Only an administrator can change customer activation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS a_protect_kyc_activation_fields ON public.profiles;
CREATE TRIGGER a_protect_kyc_activation_fields BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_kyc_activation_fields();

CREATE OR REPLACE FUNCTION public.sync_customer_kyc_activation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF COALESCE(NEW.is_admin,FALSE) THEN NEW.account_status := 'active'; RETURN NEW; END IF;
  IF NEW.account_status='closed' THEN RETURN NEW; END IF;
  IF NEW.kyc_status='approved' OR COALESCE(NEW.kyc_activation_override,FALSE) THEN
    NEW.account_status := 'active';
  ELSE
    NEW.account_status := 'pending_kyc';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS z_sync_customer_kyc_activation ON public.profiles;
CREATE TRIGGER z_sync_customer_kyc_activation
  BEFORE INSERT OR UPDATE OF kyc_status,kyc_activation_override,account_status,is_admin ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_customer_kyc_activation();

CREATE INDEX IF NOT EXISTS profiles_kyc_activation_idx
  ON public.profiles(account_status,kyc_status,kyc_activation_override)
  WHERE COALESCE(is_admin,FALSE)=FALSE;

COMMENT ON COLUMN public.profiles.kyc_activation_override IS
  'Audited administrator override allowing an unverified customer to use an active account.';
