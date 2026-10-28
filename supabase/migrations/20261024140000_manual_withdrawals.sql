-- Manual withdrawal workflow. Customer funds are atomically reserved in the
-- locked ledger account and every payout requires maker-checker approval.

CREATE TABLE IF NOT EXISTS public.manual_withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  payment_method_id UUID NOT NULL REFERENCES public.payment_methods(id) ON DELETE RESTRICT,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  destination_reference TEXT NOT NULL CHECK (length(trim(destination_reference)) >= 6),
  user_note TEXT,
  risk_score INTEGER NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','on_hold','awaiting_approval','approved','rejected','cancelled')),
  review_note TEXT,
  payment_reference TEXT,
  wallet_transaction_id UUID REFERENCES public.wallet_transactions(id) ON DELETE RESTRICT,
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS manual_withdrawal_user_created_idx
  ON public.manual_withdrawal_requests(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS manual_withdrawal_review_queue_idx
  ON public.manual_withdrawal_requests(status,created_at);

ALTER TABLE public.manual_withdrawal_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_read_own_manual_withdrawals" ON public.manual_withdrawal_requests;
CREATE POLICY "users_read_own_manual_withdrawals" ON public.manual_withdrawal_requests
  FOR SELECT TO authenticated USING (user_id=auth.uid());
DROP POLICY IF EXISTS "finance_read_manual_withdrawals" ON public.manual_withdrawal_requests;
CREATE POLICY "finance_read_manual_withdrawals" ON public.manual_withdrawal_requests
  FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['finance']));
GRANT SELECT ON public.manual_withdrawal_requests TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.manual_withdrawal_requests FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.submit_manual_withdrawal_request(
  p_payment_method_id UUID,
  p_amount NUMERIC,
  p_destination_reference TEXT,
  p_user_note TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_user UUID:=auth.uid();
  v_method public.payment_methods%ROWTYPE;
  v_request UUID:=gen_random_uuid();
  v_tx UUID;
  v_balance NUMERIC;
  v_cash NUMERIC;
  v_cash_account UUID;
  v_locked_account UUID;
  v_system_account UUID;
  v_system_balance NUMERIC;
  v_locked_balance NUMERIC;
  v_journal UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'Withdrawal amount must be positive'; END IF;
  IF length(trim(COALESCE(p_destination_reference,'')))<6 THEN RAISE EXCEPTION 'A valid payout destination is required'; END IF;

  SELECT * INTO v_method FROM public.payment_methods
  WHERE id=p_payment_method_id AND is_enabled=TRUE AND archived_at IS NULL AND method_type<>'provider';
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal method is unavailable'; END IF;
  IF p_amount<v_method.min_amount OR p_amount>v_method.max_amount THEN RAISE EXCEPTION 'Amount is outside the allowed limits'; END IF;

  SELECT demo_balance INTO v_balance FROM public.profiles
  WHERE id=v_user AND kyc_status='approved' AND COALESCE(is_suspended,FALSE)=FALSE
    AND (self_exclusion_until IS NULL OR self_exclusion_until<=NOW()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approved KYC and an active account are required'; END IF;

  PERFORM public.ensure_user_ledger_accounts_from_id(v_user,COALESCE(v_balance,0));
  SELECT id,balance INTO v_cash_account,v_cash FROM public.ledger_accounts
  WHERE user_id=v_user AND currency='USD' AND account_code='cash' FOR UPDATE;
  SELECT id,balance INTO v_locked_account,v_locked_balance FROM public.ledger_accounts
  WHERE user_id=v_user AND currency='USD' AND account_code='locked' FOR UPDATE;
  SELECT id,balance INTO v_system_account,v_system_balance FROM public.ledger_accounts
  WHERE user_id IS NULL AND currency='USD' AND account_code='sportsbook_clearing' FOR UPDATE;
  IF COALESCE(v_cash,0)<p_amount OR COALESCE(v_balance,0)<p_amount THEN RAISE EXCEPTION 'Withdrawable cash balance is insufficient'; END IF;

  INSERT INTO public.manual_withdrawal_requests(
    id,user_id,payment_method_id,amount,destination_reference,user_note,risk_score
  ) VALUES (
    v_request,v_user,p_payment_method_id,ROUND(p_amount,2),trim(p_destination_reference),
    NULLIF(trim(COALESCE(p_user_note,'')),''),
    CASE WHEN p_amount>=5000 THEN 85 WHEN p_amount>=1000 THEN 60 ELSE 25 END
  );

  UPDATE public.profiles SET demo_balance=v_balance-ROUND(p_amount,2),updated_at=NOW() WHERE id=v_user;
  INSERT INTO public.wallet_transactions(
    user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata
  ) VALUES (
    v_user,'withdrawal',-ROUND(p_amount,2),v_balance,v_balance-ROUND(p_amount,2),
    'Manual withdrawal funds reserved',v_request,'pending',
    jsonb_build_object('payment_method_id',p_payment_method_id,'destination_masked',right(trim(p_destination_reference),6))
  ) RETURNING id INTO v_tx;

  -- The wallet transaction moved cash to clearing. Move that amount from
  -- clearing into the customer locked account until the checker decides it.
  INSERT INTO public.ledger_journals(source_type,idempotency_key,description,metadata)
  VALUES('withdrawal_lock','withdrawal-lock:'||v_request,'Reserve manual withdrawal',jsonb_build_object('withdrawal_id',v_request))
  RETURNING id INTO v_journal;
  UPDATE public.ledger_accounts SET balance=balance-ROUND(p_amount,2),updated_at=NOW()
  WHERE id=v_system_account RETURNING balance INTO v_system_balance;
  UPDATE public.ledger_accounts SET balance=balance+ROUND(p_amount,2),updated_at=NOW()
  WHERE id=v_locked_account RETURNING balance INTO v_locked_balance;
  INSERT INTO public.ledger_postings(journal_id,account_id,amount,balance_after) VALUES
    (v_journal,v_system_account,-ROUND(p_amount,2),v_system_balance),
    (v_journal,v_locked_account,ROUND(p_amount,2),v_locked_balance);

  UPDATE public.manual_withdrawal_requests SET wallet_transaction_id=v_tx WHERE id=v_request;
  RETURN v_request;
END; $$;

CREATE OR REPLACE FUNCTION public.finalize_manual_withdrawal_approval(
  p_request_id UUID,p_admin UUID,p_note TEXT,p_payment_reference TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_request public.manual_withdrawal_requests%ROWTYPE;
  v_locked UUID; v_system UUID; v_locked_balance NUMERIC; v_system_balance NUMERIC; v_journal UUID;
BEGIN
  SELECT * INTO v_request FROM public.manual_withdrawal_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status<>'awaiting_approval' THEN RAISE EXCEPTION 'Withdrawal is not awaiting approval'; END IF;
  SELECT id,balance INTO v_locked,v_locked_balance FROM public.ledger_accounts WHERE user_id=v_request.user_id AND currency='USD' AND account_code='locked' FOR UPDATE;
  SELECT id,balance INTO v_system,v_system_balance FROM public.ledger_accounts WHERE user_id IS NULL AND currency='USD' AND account_code='sportsbook_clearing' FOR UPDATE;
  IF COALESCE(v_locked_balance,0)<v_request.amount THEN RAISE EXCEPTION 'Locked withdrawal funds are inconsistent'; END IF;
  INSERT INTO public.ledger_journals(source_type,idempotency_key,description,metadata)
  VALUES('withdrawal_complete','withdrawal-complete:'||p_request_id,'Complete manual withdrawal',jsonb_build_object('withdrawal_id',p_request_id)) RETURNING id INTO v_journal;
  UPDATE public.ledger_accounts SET balance=balance-v_request.amount,updated_at=NOW() WHERE id=v_locked RETURNING balance INTO v_locked_balance;
  UPDATE public.ledger_accounts SET balance=balance+v_request.amount,updated_at=NOW() WHERE id=v_system RETURNING balance INTO v_system_balance;
  INSERT INTO public.ledger_postings(journal_id,account_id,amount,balance_after) VALUES
    (v_journal,v_locked,-v_request.amount,v_locked_balance),(v_journal,v_system,v_request.amount,v_system_balance);
  UPDATE public.wallet_transactions SET status='completed',description='Manual withdrawal approved' WHERE id=v_request.wallet_transaction_id;
  UPDATE public.manual_withdrawal_requests SET status='approved',review_note=NULLIF(trim(COALESCE(p_note,'')),''),payment_reference=NULLIF(trim(COALESCE(p_payment_reference,'')),''),reviewed_by=p_admin,reviewed_at=NOW(),updated_at=NOW() WHERE id=p_request_id;
END; $$;

CREATE OR REPLACE FUNCTION public.reject_manual_withdrawal(
  p_request_id UUID,p_admin UUID,p_note TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_request public.manual_withdrawal_requests%ROWTYPE;
  v_locked UUID; v_system UUID; v_locked_balance NUMERIC; v_system_balance NUMERIC; v_journal UUID;
  v_balance NUMERIC; v_refund UUID;
BEGIN
  SELECT * INTO v_request FROM public.manual_withdrawal_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status NOT IN ('pending','on_hold','awaiting_approval') THEN RAISE EXCEPTION 'Withdrawal cannot be rejected'; END IF;
  IF length(trim(COALESCE(p_note,'')))<3 THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
  SELECT id,balance INTO v_locked,v_locked_balance FROM public.ledger_accounts WHERE user_id=v_request.user_id AND currency='USD' AND account_code='locked' FOR UPDATE;
  SELECT id,balance INTO v_system,v_system_balance FROM public.ledger_accounts WHERE user_id IS NULL AND currency='USD' AND account_code='sportsbook_clearing' FOR UPDATE;
  IF COALESCE(v_locked_balance,0)<v_request.amount THEN RAISE EXCEPTION 'Locked withdrawal funds are inconsistent'; END IF;
  INSERT INTO public.ledger_journals(source_type,idempotency_key,description,metadata)
  VALUES('withdrawal_release','withdrawal-release:'||p_request_id,'Release rejected withdrawal',jsonb_build_object('withdrawal_id',p_request_id)) RETURNING id INTO v_journal;
  UPDATE public.ledger_accounts SET balance=balance-v_request.amount,updated_at=NOW() WHERE id=v_locked RETURNING balance INTO v_locked_balance;
  UPDATE public.ledger_accounts SET balance=balance+v_request.amount,updated_at=NOW() WHERE id=v_system RETURNING balance INTO v_system_balance;
  INSERT INTO public.ledger_postings(journal_id,account_id,amount,balance_after) VALUES
    (v_journal,v_locked,-v_request.amount,v_locked_balance),(v_journal,v_system,v_request.amount,v_system_balance);

  SELECT demo_balance INTO v_balance FROM public.profiles WHERE id=v_request.user_id FOR UPDATE;
  UPDATE public.profiles SET demo_balance=v_balance+v_request.amount,updated_at=NOW() WHERE id=v_request.user_id;
  INSERT INTO public.wallet_transactions(user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata)
  VALUES(v_request.user_id,'adjustment',v_request.amount,v_balance,v_balance+v_request.amount,'Rejected withdrawal refund',p_request_id,'completed',jsonb_build_object('reason',trim(p_note))) RETURNING id INTO v_refund;
  UPDATE public.wallet_transactions SET status='cancelled' WHERE id=v_request.wallet_transaction_id;
  UPDATE public.manual_withdrawal_requests SET status='rejected',review_note=trim(p_note),reviewed_by=p_admin,reviewed_at=NOW(),updated_at=NOW() WHERE id=p_request_id;
END; $$;

CREATE OR REPLACE FUNCTION public.review_manual_withdrawal_request(p_request_id UUID,p_status TEXT,p_review_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request public.manual_withdrawal_requests%ROWTYPE;
BEGIN
  IF NOT public.has_admin_role(ARRAY['finance']) OR COALESCE(auth.jwt()->>'aal','aal1')<>'aal2' THEN RAISE EXCEPTION 'Finance AAL2 authorization required'; END IF;
  IF p_status NOT IN ('approved','rejected','on_hold') THEN RAISE EXCEPTION 'Invalid review status'; END IF;
  SELECT * INTO v_request FROM public.manual_withdrawal_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status NOT IN ('pending','on_hold') THEN RAISE EXCEPTION 'Withdrawal request has already been reviewed'; END IF;
  IF p_status='approved' THEN
    INSERT INTO public.admin_approval_requests(action_type,entity_id,requested_by,request_note,payload)
    VALUES('large_withdrawal',p_request_id,auth.uid(),NULLIF(trim(COALESCE(p_review_note,'')),''),jsonb_build_object('amount',v_request.amount,'user_id',v_request.user_id,'destination',right(v_request.destination_reference,6)));
    UPDATE public.manual_withdrawal_requests SET status='awaiting_approval',review_note=p_review_note,reviewed_by=auth.uid(),updated_at=NOW() WHERE id=p_request_id;
  ELSIF p_status='rejected' THEN
    PERFORM public.reject_manual_withdrawal(p_request_id,auth.uid(),p_review_note);
  ELSE
    UPDATE public.manual_withdrawal_requests SET status='on_hold',review_note=NULLIF(trim(COALESCE(p_review_note,'')),''),reviewed_by=auth.uid(),updated_at=NOW() WHERE id=p_request_id;
  END IF;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes)
  VALUES(auth.uid(),'manual_withdrawal_'||p_status,'manual_withdrawal',p_request_id,jsonb_build_object('note',p_review_note));
END; $$;

CREATE OR REPLACE FUNCTION public.decide_admin_approval(p_approval_id UUID,p_decision TEXT,p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request public.admin_approval_requests%ROWTYPE; v_reference TEXT;
BEGIN
  IF NOT public.has_admin_role(ARRAY['finance']) OR COALESCE(auth.jwt()->>'aal','aal1')<>'aal2' THEN RAISE EXCEPTION 'Finance AAL2 authorization required'; END IF;
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  SELECT * INTO v_request FROM public.admin_approval_requests WHERE id=p_approval_id FOR UPDATE;
  IF NOT FOUND OR v_request.status<>'pending' THEN RAISE EXCEPTION 'Approval is no longer pending'; END IF;
  IF v_request.requested_by=auth.uid() THEN RAISE EXCEPTION 'Maker cannot approve their own request'; END IF;
  v_reference:=NULLIF(trim(COALESCE(v_request.payload->>'payment_reference','')), '');
  IF v_request.action_type='manual_deposit' THEN
    IF p_decision='approved' THEN PERFORM public.finalize_manual_deposit_approval(v_request.entity_id,auth.uid(),p_note);
    ELSE UPDATE public.manual_deposit_requests SET status='rejected',review_note=COALESCE(NULLIF(trim(p_note),''),'Rejected by checker'),reviewed_by=auth.uid(),reviewed_at=NOW(),updated_at=NOW() WHERE id=v_request.entity_id; END IF;
  ELSIF v_request.action_type='large_withdrawal' THEN
    IF p_decision='approved' THEN PERFORM public.finalize_manual_withdrawal_approval(v_request.entity_id,auth.uid(),p_note,v_reference);
    ELSE PERFORM public.reject_manual_withdrawal(v_request.entity_id,auth.uid(),COALESCE(NULLIF(trim(p_note),''),'Rejected by checker')); END IF;
  END IF;
  UPDATE public.admin_approval_requests SET status=p_decision,decided_by=auth.uid(),decision_note=NULLIF(trim(COALESCE(p_note,'')),''),decided_at=NOW() WHERE id=p_approval_id;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes)
  VALUES(auth.uid(),'maker_checker_'||p_decision,'admin_approval',p_approval_id,jsonb_build_object('action_type',v_request.action_type,'entity_id',v_request.entity_id,'note',p_note));
END; $$;

CREATE OR REPLACE FUNCTION public.notify_manual_withdrawal_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.notifications(user_id,type,title,message,metadata) VALUES(NEW.user_id,'withdrawal_'||NEW.status,'Withdrawal update',
      CASE NEW.status WHEN 'approved' THEN 'Your manual withdrawal was approved.' WHEN 'rejected' THEN 'Your withdrawal was rejected and the reserved funds were returned.' WHEN 'on_hold' THEN 'Your withdrawal needs additional review.' WHEN 'awaiting_approval' THEN 'Your withdrawal passed initial review and awaits final approval.' ELSE 'Your withdrawal status changed.' END,
      jsonb_build_object('withdrawal_id',NEW.id,'amount',NEW.amount,'status',NEW.status,'note',NEW.review_note));
  END IF; RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS notify_manual_withdrawal_status_trigger ON public.manual_withdrawal_requests;
CREATE TRIGGER notify_manual_withdrawal_status_trigger AFTER UPDATE OF status ON public.manual_withdrawal_requests FOR EACH ROW EXECUTE FUNCTION public.notify_manual_withdrawal_status();

REVOKE ALL ON FUNCTION public.submit_manual_withdrawal_request(UUID,NUMERIC,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_manual_withdrawal_request(UUID,NUMERIC,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.review_manual_withdrawal_request(UUID,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_manual_withdrawal_request(UUID,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.finalize_manual_withdrawal_approval(UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reject_manual_withdrawal(UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;

