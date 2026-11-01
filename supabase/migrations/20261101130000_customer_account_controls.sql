-- Customer account controls, live-wallet cleanup, and enforcement.
-- Idempotent: preserves financial and audit history.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS wallet_frozen BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS betting_disabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deposits_disabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS withdrawals_disabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_deleted_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_deleted_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS control_reason TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS control_updated_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS control_updated_by UUID REFERENCES public.profiles(id);

DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_account_status_check CHECK (account_status IN ('active','closed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.profiles ALTER COLUMN demo_balance SET DEFAULT 0.00;

DO $$
DECLARE v_user RECORD; v_available NUMERIC(18,2);
BEGIN
  FOR v_user IN
    SELECT p.id
    FROM public.profiles p
    WHERE COALESCE(p.demo_balance,0)=10000
      AND COALESCE(p.is_admin,FALSE)=FALSE
      AND NOT EXISTS (
        SELECT 1 FROM public.wallet_transactions wt
        WHERE wt.user_id=p.id AND wt.type='deposit' AND wt.status='completed'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.admin_balance_adjustments aba
        WHERE aba.user_id=p.id
      )
  LOOP
    SELECT COALESCE(SUM(balance),0) INTO v_available
    FROM public.ledger_accounts
    WHERE user_id=v_user.id AND currency='USD' AND account_code IN ('cash','bonus');

    IF v_available > 0 THEN
      INSERT INTO public.wallet_transactions(
        user_id,type,amount,balance_before,balance_after,description,status,metadata
      ) VALUES (
        v_user.id,'adjustment',-v_available,v_available,0,
        'Legacy demo balance removed','completed',
        jsonb_build_object('reason','remove_legacy_demo_credit','migration','20261101130000')
      );
    END IF;

    UPDATE public.profiles SET demo_balance=0,updated_at=NOW() WHERE id=v_user.id;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_customer_account_controls()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_user UUID;
  v_profile public.profiles%ROWTYPE;
  v_operation TEXT;
BEGIN
  v_user:=NEW.user_id;
  SELECT * INTO v_profile FROM public.profiles WHERE id=v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer account not found'; END IF;
  IF COALESCE(v_profile.is_admin,FALSE) THEN RETURN NEW; END IF;
  IF COALESCE(v_profile.account_status,'active')<>'active' OR COALESCE(v_profile.is_suspended,FALSE) THEN
    RAISE EXCEPTION 'Customer account is disabled';
  END IF;

  v_operation:=CASE
    WHEN TG_TABLE_NAME='bets' THEN 'bet'
    WHEN TG_TABLE_NAME='manual_deposit_requests' THEN 'deposit'
    WHEN TG_TABLE_NAME='manual_withdrawal_requests' THEN 'withdrawal'
    WHEN TG_TABLE_NAME='wallet_transactions' THEN
      CASE
        WHEN NEW.type='bet_placed' THEN 'bet'
        WHEN NEW.type='deposit' THEN 'deposit'
        WHEN NEW.type='withdrawal' THEN 'withdrawal'
        ELSE 'system'
      END
    ELSE 'system'
  END;

  IF v_operation IN ('bet','deposit','withdrawal') AND COALESCE(v_profile.wallet_frozen,FALSE) THEN
    RAISE EXCEPTION 'Customer wallet is frozen';
  END IF;
  IF v_operation='bet' AND COALESCE(v_profile.betting_disabled,FALSE) THEN
    RAISE EXCEPTION 'Betting is disabled for this account';
  END IF;
  IF v_operation='deposit' AND COALESCE(v_profile.deposits_disabled,FALSE) THEN
    RAISE EXCEPTION 'Deposits are disabled for this account';
  END IF;
  IF v_operation='withdrawal' AND COALESCE(v_profile.withdrawals_disabled,FALSE) THEN
    RAISE EXCEPTION 'Withdrawals are disabled for this account';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.enforce_customer_account_controls() FROM PUBLIC,anon,authenticated;

DO $$ BEGIN
  IF to_regclass('public.bets') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS enforce_customer_controls_bets ON public.bets;
    CREATE TRIGGER enforce_customer_controls_bets BEFORE INSERT ON public.bets
      FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_account_controls();
  END IF;
  IF to_regclass('public.wallet_transactions') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS enforce_customer_controls_wallet ON public.wallet_transactions;
    CREATE TRIGGER enforce_customer_controls_wallet BEFORE INSERT ON public.wallet_transactions
      FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_account_controls();
  END IF;
  IF to_regclass('public.manual_deposit_requests') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS enforce_customer_controls_deposits ON public.manual_deposit_requests;
    CREATE TRIGGER enforce_customer_controls_deposits BEFORE INSERT ON public.manual_deposit_requests
      FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_account_controls();
  END IF;
  IF to_regclass('public.manual_withdrawal_requests') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS enforce_customer_controls_withdrawals ON public.manual_withdrawal_requests;
    CREATE TRIGGER enforce_customer_controls_withdrawals BEFORE INSERT ON public.manual_withdrawal_requests
      FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_account_controls();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS profiles_account_status_idx ON public.profiles(account_status,is_suspended)
WHERE COALESCE(is_admin,FALSE)=FALSE;
