-- Manual finance/KYC operations with maker-checker approval and user notices.

ALTER TABLE public.manual_deposit_requests ADD COLUMN IF NOT EXISTS proof_file_path TEXT;
ALTER TABLE public.manual_deposit_requests ADD COLUMN IF NOT EXISTS risk_score INTEGER NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100);
ALTER TABLE public.manual_deposit_requests DROP CONSTRAINT IF EXISTS manual_deposit_requests_status_check;
ALTER TABLE public.manual_deposit_requests ADD CONSTRAINT manual_deposit_requests_status_check
  CHECK (status IN ('pending','on_hold','awaiting_approval','approved','rejected'));

ALTER TABLE public.kyc_documents ADD COLUMN IF NOT EXISTS admin_note TEXT;
ALTER TABLE public.kyc_documents ADD COLUMN IF NOT EXISTS risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high'));
ALTER TABLE public.kyc_documents ADD COLUMN IF NOT EXISTS source_of_funds_status TEXT NOT NULL DEFAULT 'not_required'
  CHECK (source_of_funds_status IN ('not_required','requested','submitted','approved','rejected'));

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('payment-proofs','payment-proofs',FALSE,5242880,ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
ON CONFLICT(id) DO UPDATE SET public=FALSE,file_size_limit=5242880,allowed_mime_types=EXCLUDED.allowed_mime_types;
CREATE POLICY "users_upload_own_payment_proofs" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='payment-proofs' AND (storage.foldername(name))[1]=auth.uid()::TEXT);
CREATE POLICY "users_read_own_payment_proofs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='payment-proofs' AND ((storage.foldername(name))[1]=auth.uid()::TEXT OR public.has_admin_role(ARRAY['finance'])));

DROP FUNCTION IF EXISTS public.submit_manual_deposit_request(UUID,NUMERIC,TEXT,TEXT);
CREATE OR REPLACE FUNCTION public.submit_manual_deposit_request(
  p_payment_method_id UUID,p_amount NUMERIC,p_transaction_reference TEXT,p_user_note TEXT DEFAULT NULL,p_proof_file_path TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user UUID:=auth.uid(); v_method public.payment_methods%ROWTYPE; v_id UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_method FROM public.payment_methods WHERE id=p_payment_method_id AND is_enabled=TRUE AND archived_at IS NULL AND method_type<>'provider';
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment method is unavailable'; END IF;
  IF p_amount<v_method.min_amount OR p_amount>v_method.max_amount THEN RAISE EXCEPTION 'Amount is outside the allowed limits'; END IF;
  IF p_proof_file_path IS NOT NULL AND split_part(p_proof_file_path,'/',1)<>v_user::TEXT THEN RAISE EXCEPTION 'Invalid proof file path'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_user AND kyc_status='approved' AND COALESCE(is_suspended,FALSE)=FALSE AND (self_exclusion_until IS NULL OR self_exclusion_until<=NOW())) THEN RAISE EXCEPTION 'Approved KYC and an active account are required'; END IF;
  INSERT INTO public.manual_deposit_requests(user_id,payment_method_id,amount,transaction_reference,user_note,proof_file_path,risk_score)
  VALUES(v_user,p_payment_method_id,p_amount,trim(p_transaction_reference),NULLIF(trim(COALESCE(p_user_note,'')),''),p_proof_file_path,
    CASE WHEN p_amount>=5000 THEN 70 WHEN p_amount>=1000 THEN 40 ELSE 10 END) RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'This transaction reference has already been submitted';
END; $$;
REVOKE ALL ON FUNCTION public.submit_manual_deposit_request(UUID,NUMERIC,TEXT,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_manual_deposit_request(UUID,NUMERIC,TEXT,TEXT,TEXT) TO authenticated;

CREATE TABLE IF NOT EXISTS public.admin_approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL CHECK (action_type IN ('manual_deposit','wallet_adjustment','broker_payout','large_withdrawal')),
  entity_id UUID NOT NULL,
  requested_by UUID NOT NULL REFERENCES public.profiles(id),
  request_note TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by UUID REFERENCES public.profiles(id),
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  UNIQUE(action_type,entity_id,status)
);
CREATE INDEX IF NOT EXISTS admin_approval_queue_idx ON public.admin_approval_requests(status,created_at);
ALTER TABLE public.admin_approval_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance_staff_read_approvals" ON public.admin_approval_requests FOR SELECT TO authenticated
  USING (public.has_admin_role(ARRAY['finance']));
GRANT SELECT ON public.admin_approval_requests TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.admin_approval_requests FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.finalize_manual_deposit_approval(p_request_id UUID,p_admin UUID,p_note TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request public.manual_deposit_requests%ROWTYPE; v_balance NUMERIC; v_limit NUMERIC; v_month NUMERIC; v_tx UUID;
BEGIN
  SELECT * INTO v_request FROM public.manual_deposit_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status NOT IN ('pending','awaiting_approval','on_hold') THEN RAISE EXCEPTION 'Deposit request is not reviewable'; END IF;
  SELECT COALESCE(demo_balance,0),deposit_limit INTO v_balance,v_limit FROM public.profiles
    WHERE id=v_request.user_id AND kyc_status='approved' AND COALESCE(is_suspended,FALSE)=FALSE
      AND (self_exclusion_until IS NULL OR self_exclusion_until<=NOW()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account is not eligible for deposits'; END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_month FROM public.manual_deposit_requests
    WHERE user_id=v_request.user_id AND status='approved' AND reviewed_at>=date_trunc('month',NOW());
  IF v_limit IS NOT NULL AND v_month+v_request.amount>v_limit THEN RAISE EXCEPTION 'Monthly deposit limit would be exceeded'; END IF;
  UPDATE public.profiles SET demo_balance=v_balance+v_request.amount,updated_at=NOW() WHERE id=v_request.user_id;
  INSERT INTO public.wallet_transactions(user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata)
  VALUES(v_request.user_id,'deposit',v_request.amount,v_balance,v_balance+v_request.amount,'Maker-checker approved manual deposit',v_request.id,'completed',
    jsonb_build_object('payment_method_id',v_request.payment_method_id,'transaction_reference',v_request.transaction_reference)) RETURNING id INTO v_tx;
  UPDATE public.manual_deposit_requests SET status='approved',review_note=NULLIF(trim(COALESCE(p_note,'')),''),reviewed_by=p_admin,reviewed_at=NOW(),wallet_transaction_id=v_tx,updated_at=NOW() WHERE id=p_request_id;
END; $$;
REVOKE ALL ON FUNCTION public.finalize_manual_deposit_approval(UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.review_manual_deposit_request(p_request_id UUID,p_status TEXT,p_review_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request public.manual_deposit_requests%ROWTYPE;
BEGIN
  IF NOT public.has_admin_role(ARRAY['finance']) OR COALESCE(auth.jwt()->>'aal','aal1')<>'aal2' THEN RAISE EXCEPTION 'Finance AAL2 authorization required'; END IF;
  IF p_status NOT IN ('approved','rejected','on_hold') THEN RAISE EXCEPTION 'Invalid review status'; END IF;
  SELECT * INTO v_request FROM public.manual_deposit_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status NOT IN ('pending','on_hold') THEN RAISE EXCEPTION 'Deposit request has already been reviewed'; END IF;
  IF p_status='approved' THEN
    INSERT INTO public.admin_approval_requests(action_type,entity_id,requested_by,request_note,payload)
    VALUES('manual_deposit',p_request_id,auth.uid(),NULLIF(trim(COALESCE(p_review_note,'')),''),jsonb_build_object('amount',v_request.amount,'user_id',v_request.user_id));
    UPDATE public.manual_deposit_requests SET status='awaiting_approval',review_note=p_review_note,reviewed_by=auth.uid(),updated_at=NOW() WHERE id=p_request_id;
  ELSE
    IF p_status='rejected' AND length(trim(COALESCE(p_review_note,'')))<3 THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
    UPDATE public.manual_deposit_requests SET status=p_status,review_note=NULLIF(trim(COALESCE(p_review_note,'')),''),reviewed_by=auth.uid(),reviewed_at=CASE WHEN p_status='rejected' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=p_request_id;
  END IF;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes)
  VALUES(auth.uid(),'manual_deposit_'||p_status,'manual_deposit',p_request_id,jsonb_build_object('note',p_review_note));
END; $$;

CREATE OR REPLACE FUNCTION public.decide_admin_approval(p_approval_id UUID,p_decision TEXT,p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request public.admin_approval_requests%ROWTYPE;
BEGIN
  IF NOT public.has_admin_role(ARRAY['finance']) OR COALESCE(auth.jwt()->>'aal','aal1')<>'aal2' THEN RAISE EXCEPTION 'Finance AAL2 authorization required'; END IF;
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  SELECT * INTO v_request FROM public.admin_approval_requests WHERE id=p_approval_id FOR UPDATE;
  IF NOT FOUND OR v_request.status<>'pending' THEN RAISE EXCEPTION 'Approval is no longer pending'; END IF;
  IF v_request.requested_by=auth.uid() THEN RAISE EXCEPTION 'Maker cannot approve their own request'; END IF;
  IF p_decision='approved' AND v_request.action_type='manual_deposit' THEN
    PERFORM public.finalize_manual_deposit_approval(v_request.entity_id,auth.uid(),p_note);
  ELSIF p_decision='rejected' AND v_request.action_type='manual_deposit' THEN
    UPDATE public.manual_deposit_requests SET status='rejected',review_note=COALESCE(NULLIF(trim(p_note),''),'Rejected by checker'),reviewed_by=auth.uid(),reviewed_at=NOW(),updated_at=NOW() WHERE id=v_request.entity_id;
  END IF;
  UPDATE public.admin_approval_requests SET status=p_decision,decided_by=auth.uid(),decision_note=NULLIF(trim(COALESCE(p_note,'')),''),decided_at=NOW() WHERE id=p_approval_id;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes)
  VALUES(auth.uid(),'maker_checker_'||p_decision,'admin_approval',p_approval_id,jsonb_build_object('action_type',v_request.action_type,'entity_id',v_request.entity_id,'note',p_note));
END; $$;

CREATE OR REPLACE FUNCTION public.review_kyc_document_manual(p_document_id UUID,p_action TEXT,p_note TEXT,p_risk_level TEXT DEFAULT 'low',p_source_of_funds_status TEXT DEFAULT 'not_required')
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_doc public.kyc_documents%ROWTYPE; v_status TEXT;
BEGIN
  IF NOT public.has_admin_role(ARRAY['kyc']) OR COALESCE(auth.jwt()->>'aal','aal1')<>'aal2' THEN RAISE EXCEPTION 'KYC AAL2 authorization required'; END IF;
  IF p_action NOT IN ('approve','reject','request_documents','hold') OR p_risk_level NOT IN ('low','medium','high') OR p_source_of_funds_status NOT IN ('not_required','requested','submitted','approved','rejected') THEN RAISE EXCEPTION 'Invalid KYC review values'; END IF;
  IF p_action IN ('reject','request_documents','hold') AND length(trim(COALESCE(p_note,'')))<3 THEN RAISE EXCEPTION 'A review note is required'; END IF;
  SELECT * INTO v_doc FROM public.kyc_documents WHERE id=p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KYC document not found'; END IF;
  v_status:=CASE WHEN p_action='approve' THEN 'approved' WHEN p_action='reject' THEN 'rejected' ELSE 'pending' END;
  UPDATE public.kyc_documents SET status=v_status,rejection_reason=CASE WHEN p_action IN ('reject','request_documents') THEN p_note ELSE NULL END,
    admin_note=NULLIF(trim(COALESCE(p_note,'')),''),risk_level=p_risk_level,source_of_funds_status=p_source_of_funds_status,reviewed_by=auth.uid(),reviewed_at=NOW() WHERE id=p_document_id;
  UPDATE public.profiles SET kyc_status=CASE
    WHEN p_action='reject' THEN 'rejected'
    WHEN p_action='approve'
      AND EXISTS(SELECT 1 FROM public.kyc_documents WHERE user_id=v_doc.user_id AND status='approved' AND document_type IN ('national_id','passport','drivers_license'))
      AND EXISTS(SELECT 1 FROM public.kyc_documents WHERE user_id=v_doc.user_id AND status='approved' AND document_type='proof_of_address') THEN 'approved'
    ELSE 'pending' END, updated_at=NOW() WHERE id=v_doc.user_id;
  INSERT INTO public.notifications(user_id,type,title,message,metadata) VALUES(v_doc.user_id,'kyc_'||p_action,'Verification update',
    CASE WHEN p_action='approve' THEN 'A verification document was approved.' WHEN p_action='reject' THEN 'A verification document was rejected.' WHEN p_action='request_documents' THEN 'Additional verification documents are required.' ELSE 'Your verification is under enhanced review.' END,
    jsonb_build_object('document_id',p_document_id,'note',p_note,'risk_level',p_risk_level));
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes) VALUES(auth.uid(),'kyc_'||p_action,'kyc_document',p_document_id,jsonb_build_object('note',p_note,'risk_level',p_risk_level,'source_of_funds_status',p_source_of_funds_status));
END; $$;

CREATE OR REPLACE FUNCTION public.notify_manual_deposit_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.notifications(user_id,type,title,message,metadata) VALUES(NEW.user_id,'deposit_'||NEW.status,'Deposit update',
      CASE NEW.status WHEN 'approved' THEN 'Your manual deposit was approved and credited.' WHEN 'rejected' THEN 'Your manual deposit was rejected.' WHEN 'on_hold' THEN 'Your deposit needs additional review.' WHEN 'awaiting_approval' THEN 'Your deposit passed initial review and awaits final approval.' ELSE 'Your deposit status changed.' END,
      jsonb_build_object('deposit_id',NEW.id,'amount',NEW.amount,'status',NEW.status,'note',NEW.review_note));
  END IF; RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS notify_manual_deposit_status_trigger ON public.manual_deposit_requests;
CREATE TRIGGER notify_manual_deposit_status_trigger AFTER UPDATE OF status ON public.manual_deposit_requests FOR EACH ROW EXECUTE FUNCTION public.notify_manual_deposit_status();

REVOKE ALL ON FUNCTION public.decide_admin_approval(UUID,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.decide_admin_approval(UUID,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.review_kyc_document_manual(UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_kyc_document_manual(UUID,TEXT,TEXT,TEXT,TEXT) TO authenticated;
