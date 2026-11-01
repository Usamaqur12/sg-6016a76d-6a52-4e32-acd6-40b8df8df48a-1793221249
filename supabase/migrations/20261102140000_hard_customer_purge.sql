-- Irreversible hard purge for explicitly confirmed customer deletion.
-- Restricted to service role + super admin and requires zero balance/no pending activity.

CREATE OR REPLACE FUNCTION public.hard_purge_customer(
  p_user_id UUID,
  p_admin_id UUID,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_balance NUMERIC:=0;
  v_pending INTEGER:=0;
  v_bets INTEGER:=0;
  v_transactions INTEGER:=0;
  v_broker_id UUID;
BEGIN
  IF NOT public.is_service_role() THEN RAISE EXCEPTION 'Service authorization required'; END IF;
  IF char_length(btrim(COALESCE(p_reason,'')))<5 THEN RAISE EXCEPTION 'A deletion reason is required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id=p_admin_id AND is_admin=TRUE AND admin_role='super_admin' AND COALESCE(is_suspended,FALSE)=FALSE
  ) THEN RAISE EXCEPTION 'Super admin authorization required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id=p_user_id AND COALESCE(is_admin,FALSE)=FALSE
  ) THEN RAISE EXCEPTION 'Customer account not found'; END IF;

  SELECT COALESCE(SUM(balance),0) INTO v_balance
  FROM public.ledger_accounts WHERE user_id=p_user_id;
  SELECT
    (SELECT COUNT(*) FROM public.bets WHERE user_id=p_user_id AND status IN('pending','placed'))
    +(SELECT COUNT(*) FROM public.manual_deposit_requests WHERE user_id=p_user_id AND status IN('pending','approved'))
    +(SELECT COUNT(*) FROM public.manual_withdrawal_requests WHERE user_id=p_user_id AND status IN('pending','approved'))
    +(SELECT COUNT(*) FROM public.aviator_bets WHERE user_id=p_user_id AND status='placed')
  INTO v_pending;
  IF ABS(v_balance)>0.000001 OR v_pending>0 THEN
    RAISE EXCEPTION 'Wallet balance and all pending activity must be settled before hard purge';
  END IF;

  SELECT COUNT(*) INTO v_bets FROM public.bets WHERE user_id=p_user_id;
  SELECT COUNT(*) INTO v_transactions FROM public.wallet_transactions WHERE user_id=p_user_id;

  DELETE FROM public.audit_logs
  WHERE entity_id=p_user_id
     OR entity_id IN (SELECT id FROM public.bets WHERE user_id=p_user_id)
     OR entity_id IN (SELECT id FROM public.wallet_transactions WHERE user_id=p_user_id)
     OR entity_id IN (SELECT id FROM public.kyc_documents WHERE user_id=p_user_id)
     OR entity_id IN (SELECT id FROM public.manual_deposit_requests WHERE user_id=p_user_id)
     OR entity_id IN (SELECT id FROM public.manual_withdrawal_requests WHERE user_id=p_user_id)
     OR entity_id IN (SELECT id FROM public.casino_transactions WHERE user_id=p_user_id)
     OR entity_id IN (SELECT id FROM public.aviator_bets WHERE user_id=p_user_id)
     OR entity_id IN (SELECT id FROM public.support_tickets WHERE user_id=p_user_id);

  DELETE FROM public.partner_vertical_commissions WHERE player_id=p_user_id;
  DELETE FROM public.broker_commissions WHERE player_id=p_user_id;
  DELETE FROM public.broker_players WHERE player_id=p_user_id;

  SELECT id INTO v_broker_id FROM public.brokers WHERE user_id=p_user_id;
  IF v_broker_id IS NOT NULL THEN
    DELETE FROM public.partner_vertical_commissions WHERE broker_id=v_broker_id;
    DELETE FROM public.broker_commissions WHERE broker_id=v_broker_id;
    DELETE FROM public.broker_payout_requests WHERE broker_id=v_broker_id;
    DELETE FROM public.broker_players WHERE broker_id=v_broker_id;
    DELETE FROM public.brokers WHERE id=v_broker_id;
  END IF;

  DELETE FROM public.early_payout_awards
  WHERE bet_selection_id IN (
    SELECT bs.id FROM public.bet_selections bs JOIN public.bets b ON b.id=bs.bet_id WHERE b.user_id=p_user_id
  );
  DELETE FROM public.settlements WHERE bet_id IN (SELECT id FROM public.bets WHERE user_id=p_user_id);
  DELETE FROM public.cashout_offers WHERE user_id=p_user_id;
  DELETE FROM public.bet_validations WHERE user_id=p_user_id;
  DELETE FROM public.bets WHERE user_id=p_user_id;

  DELETE FROM public.casino_transactions WHERE user_id=p_user_id;
  DELETE FROM public.casino_sessions WHERE user_id=p_user_id;
  DELETE FROM public.aviator_bets WHERE user_id=p_user_id;

  DELETE FROM public.crypto_deposit_invoices WHERE user_id=p_user_id;
  DELETE FROM public.manual_deposit_requests WHERE user_id=p_user_id;
  DELETE FROM public.manual_withdrawal_requests WHERE user_id=p_user_id;
  DELETE FROM public.withdrawal_addresses WHERE user_id=p_user_id;
  DELETE FROM public.admin_balance_adjustments WHERE user_id=p_user_id;

  DELETE FROM public.ledger_postings
  WHERE account_id IN (SELECT id FROM public.ledger_accounts WHERE user_id=p_user_id);
  DELETE FROM public.ledger_journals
  WHERE source_transaction_id IN (SELECT id FROM public.wallet_transactions WHERE user_id=p_user_id);
  DELETE FROM public.ledger_accounts WHERE user_id=p_user_id;
  DELETE FROM public.wallet_transactions WHERE user_id=p_user_id;
  DELETE FROM public.wallet_accounts WHERE user_id=p_user_id;

  DELETE FROM public.support_ticket_messages WHERE author_id=p_user_id;
  DELETE FROM public.support_tickets WHERE user_id=p_user_id;
  DELETE FROM public.kyc_documents WHERE user_id=p_user_id;
  DELETE FROM public.notifications WHERE user_id=p_user_id;
  DELETE FROM public.notification_preferences WHERE user_id=p_user_id;
  DELETE FROM public.push_subscriptions WHERE user_id=p_user_id;
  DELETE FROM public.user_announcement_dismissals WHERE user_id=p_user_id;
  DELETE FROM public.favorites WHERE user_id=p_user_id;
  DELETE FROM public.mission_claims WHERE user_id=p_user_id;
  DELETE FROM public.user_bonuses WHERE user_id=p_user_id;
  DELETE FROM public.loyalty_accounts WHERE user_id=p_user_id;
  DELETE FROM public.user_limits WHERE user_id=p_user_id;
  DELETE FROM public.responsible_gaming_limits WHERE user_id=p_user_id;
  DELETE FROM public.self_exclusions WHERE user_id=p_user_id;
  DELETE FROM public.risk_profiles WHERE user_id=p_user_id;
  DELETE FROM public.fraud_flags WHERE user_id=p_user_id;
  DELETE FROM public.idempotency_keys WHERE user_id=p_user_id;
  DELETE FROM public.customer_anonymizations WHERE user_id=p_user_id;
  DELETE FROM public.error_events WHERE user_id=p_user_id;

  DELETE FROM public.profiles WHERE id=p_user_id AND COALESCE(is_admin,FALSE)=FALSE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer profile could not be purged'; END IF;

  RETURN jsonb_build_object(
    'user_id',p_user_id,'deleted_bets',v_bets,'deleted_wallet_transactions',v_transactions,
    'financial_history_deleted',TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hard_purge_customer(UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hard_purge_customer(UUID,UUID,TEXT) TO service_role;
