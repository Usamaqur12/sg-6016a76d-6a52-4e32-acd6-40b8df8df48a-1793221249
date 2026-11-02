-- Privacy-safe customer deletion: anonymize personal data while retaining financial/audit history.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_anonymized_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_anonymized_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS anonymization_reference UUID;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_anonymization_reference_idx
  ON public.profiles(anonymization_reference)
  WHERE anonymization_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.customer_anonymizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  anonymized_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  original_email_hash TEXT NOT NULL CHECK (original_email_hash ~ '^[a-f0-9]{64}$'),
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 500),
  retained_financial_history BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE public.customer_anonymizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_anonymizations FROM PUBLIC,anon,authenticated;

CREATE INDEX IF NOT EXISTS customer_anonymizations_created_idx
  ON public.customer_anonymizations(created_at DESC);


-- Irreversible hard purge for explicitly confirmed customer deletion.
-- Restricted to service role + active super admin with explicit destructive confirmation.

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
  -- The destructive UI/API requires the exact customer email plus DELETE ALL HISTORY.
  -- After that confirmation, balances and pending rows are deliberately included in the purge.

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

  -- A journal can contain both a customer posting and its system-account counter-posting.
  -- Delete the complete journal so the deferred balanced-ledger constraint remains valid.
  CREATE TEMP TABLE purge_customer_journals ON COMMIT DROP AS
  SELECT DISTINCT p.journal_id
  FROM public.ledger_postings p
  JOIN public.ledger_accounts a ON a.id=p.account_id
  WHERE a.user_id=p_user_id
  UNION
  SELECT j.id
  FROM public.ledger_journals j
  WHERE j.source_transaction_id IN (
    SELECT id FROM public.wallet_transactions WHERE user_id=p_user_id
  );

  DELETE FROM public.ledger_postings
  WHERE journal_id IN (SELECT journal_id FROM purge_customer_journals);
  DELETE FROM public.ledger_journals
  WHERE id IN (SELECT journal_id FROM purge_customer_journals);
  DELETE FROM public.ledger_accounts WHERE user_id=p_user_id;
  DELETE FROM public.wallet_transactions WHERE user_id=p_user_id;
  DELETE FROM public.wallet_accounts WHERE user_id=p_user_id;

  -- Keep shared clearing/reserve account balances consistent with their remaining postings.
  UPDATE public.ledger_accounts a
  SET balance=COALESCE((
        SELECT SUM(p.amount) FROM public.ledger_postings p WHERE p.account_id=a.id
      ),0),
      updated_at=NOW()
  WHERE a.is_system=TRUE;

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
    'discarded_wallet_balance',v_balance,'deleted_pending_activity',v_pending,
    'financial_history_deleted',TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hard_purge_customer(UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hard_purge_customer(UUID,UUID,TEXT) TO service_role;
