-- Allow only explicitly approved SECURITY DEFINER wallet operations to update
-- the legacy profile balance mirror. Direct client updates remain blocked.
--
-- The authoritative balance is still the cash/bonus/locked ledger. Existing
-- betting, Aviator, settlement, deposit, withdrawal and cash-out RPCs maintain
-- the compatibility mirror inside their own atomic transactions.

CREATE OR REPLACE FUNCTION public.is_approved_wallet_operation()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_context TEXT;
BEGIN
  GET DIAGNOSTICS v_context = PG_CONTEXT;

  RETURN v_context ~
    'PL/pgSQL function (public\.)?(place_bet_atomic|place_system_bet_atomic|cancel_bet_atomic|settle_bet|process_next_settlement_job|settle_ready_system_bet|accept_cashout|process_early_payout_for_event|aviator_place_bet|aviator_cashout|aviator_admin_update_settings|transfer_user_bonus_funds|claim_promotion|award_bonus|apply_crypto_deposit_update|review_manual_deposit_request|finalize_manual_deposit_approval|submit_manual_withdrawal_request|reject_manual_withdrawal|apply_casino_transaction|admin_credit_user_balance|admin_adjust_user_balance)\(';
END;
$function$;

REVOKE ALL ON FUNCTION public.is_approved_wallet_operation()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.protect_profile_system_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF NOT public.is_service_role() THEN
    IF NEW.demo_balance IS DISTINCT FROM OLD.demo_balance
      AND NOT public.is_approved_wallet_operation()
    THEN
      RAISE EXCEPTION
        'Profile balance must be changed through an approved server operation';
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
$function$;

DROP TRIGGER IF EXISTS protect_profile_system_fields_trigger
  ON public.profiles;
CREATE TRIGGER protect_profile_system_fields_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_system_fields();

REVOKE ALL ON FUNCTION public.protect_profile_system_fields()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.is_approved_wallet_operation() IS
  'Allows the profile balance compatibility mirror to be changed only from whitelisted atomic wallet operations.';

NOTIFY pgrst, 'reload schema';
