-- Complete the broker payout lifecycle and close the double-payout gap.

ALTER TABLE public.broker_payout_requests
  ADD COLUMN IF NOT EXISTS payment_reference TEXT;

CREATE OR REPLACE FUNCTION public.get_my_broker_dashboard()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH mine AS (SELECT * FROM public.brokers WHERE user_id=auth.uid()),
  commission_totals AS (
    SELECT COALESCE(SUM(bc.gross_revenue),0) AS gross_revenue,
      COALESCE(SUM(bc.commission_amount) FILTER(WHERE bc.status IN('accrued','approved','paid')),0) AS commission_earned
    FROM mine m LEFT JOIN public.broker_commissions bc ON bc.broker_id=m.id
  ),
  player_totals AS (
    SELECT COUNT(*) FILTER (WHERE bp.is_active) AS players
    FROM mine m LEFT JOIN public.broker_players bp ON bp.broker_id=m.id
  ),
  payout_totals AS (
    SELECT
      COALESCE(SUM(pr.amount) FILTER(WHERE pr.status IN('pending','approved')),0) AS commission_reserved,
      COALESCE(SUM(pr.amount) FILTER(WHERE pr.status='paid'),0) AS commission_paid
    FROM mine m LEFT JOIN public.broker_payout_requests pr ON pr.broker_id=m.id
  )
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM mine) THEN NULL ELSE jsonb_build_object(
    'id',(SELECT id FROM mine),'companyName',(SELECT company_name FROM mine),
    'brokerCode',(SELECT broker_code FROM mine),'status',(SELECT status FROM mine),
    'commissionBps',(SELECT commission_bps FROM mine),'players',player_totals.players,
    'grossRevenue',commission_totals.gross_revenue,
    'commissionAvailable',GREATEST(commission_totals.commission_earned-payout_totals.commission_reserved-payout_totals.commission_paid,0),
    'commissionReserved',payout_totals.commission_reserved,
    'commissionPaid',payout_totals.commission_paid) END
  FROM commission_totals,player_totals,payout_totals;
$$;

CREATE OR REPLACE FUNCTION public.request_broker_payout(p_amount NUMERIC,p_destination_reference TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user UUID:=auth.uid(); v_broker public.brokers%ROWTYPE; v_earned NUMERIC; v_committed NUMERIC; v_id UUID;
BEGIN
  SELECT * INTO v_broker FROM public.brokers WHERE user_id=v_user AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active broker account required'; END IF;
  IF p_amount<100 THEN RAISE EXCEPTION 'Minimum broker payout is 100'; END IF;
  IF length(trim(COALESCE(p_destination_reference,'')))<3 THEN RAISE EXCEPTION 'Approved payout destination is required'; END IF;
  SELECT COALESCE(SUM(commission_amount),0) INTO v_earned
  FROM public.broker_commissions WHERE broker_id=v_broker.id AND status IN('accrued','approved','paid');
  SELECT COALESCE(SUM(amount),0) INTO v_committed
  FROM public.broker_payout_requests WHERE broker_id=v_broker.id AND status IN('pending','approved','paid');
  IF p_amount>v_earned-v_committed THEN RAISE EXCEPTION 'Payout amount exceeds available commission'; END IF;
  INSERT INTO public.broker_payout_requests(broker_id,amount,destination_reference)
  VALUES(v_broker.id,p_amount,trim(p_destination_reference)) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.review_broker_payout(
  p_request_id UUID,
  p_status TEXT,
  p_payment_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request public.broker_payout_requests%ROWTYPE;
BEGIN
  IF NOT public.has_admin_role(ARRAY['finance']) THEN RAISE EXCEPTION 'Finance authorization required'; END IF;
  IF COALESCE(auth.jwt()->>'aal','aal1') <> 'aal2' THEN RAISE EXCEPTION 'Two-factor verification required'; END IF;
  IF p_status NOT IN('approved','paid','rejected') THEN RAISE EXCEPTION 'Invalid payout review status'; END IF;
  SELECT * INTO v_request FROM public.broker_payout_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payout request not found'; END IF;
  IF v_request.status='pending' AND p_status NOT IN('approved','rejected') THEN RAISE EXCEPTION 'Pending payout must be approved before payment'; END IF;
  IF v_request.status='approved' AND p_status<>'paid' THEN RAISE EXCEPTION 'Approved payout can only be marked paid'; END IF;
  IF v_request.status IN('paid','rejected') THEN RAISE EXCEPTION 'Final payout decision cannot be changed'; END IF;
  IF p_status='paid' AND length(trim(COALESCE(p_payment_reference,'')))<3 THEN RAISE EXCEPTION 'Payment reference is required'; END IF;
  UPDATE public.broker_payout_requests
  SET status=p_status,reviewed_by=auth.uid(),reviewed_at=NOW(),
      paid_at=CASE WHEN p_status='paid' THEN NOW() ELSE paid_at END,
      payment_reference=CASE WHEN p_status='paid' THEN trim(p_payment_reference) ELSE payment_reference END,
      notes=NULLIF(trim(p_notes),'')
  WHERE id=p_request_id;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes)
  VALUES(auth.uid(),'broker_payout_review','broker_payout',p_request_id,
    jsonb_build_object('previous_status',v_request.status,'status',p_status,'payment_reference',p_payment_reference,'notes',p_notes));
END; $$;

REVOKE ALL ON FUNCTION public.get_my_broker_dashboard() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_broker_dashboard() TO authenticated;
REVOKE ALL ON FUNCTION public.request_broker_payout(NUMERIC,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_broker_payout(NUMERIC,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.review_broker_payout(UUID,TEXT,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_broker_payout(UUID,TEXT,TEXT,TEXT) TO authenticated;
