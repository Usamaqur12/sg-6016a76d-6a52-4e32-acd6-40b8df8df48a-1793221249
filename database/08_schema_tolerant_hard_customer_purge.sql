-- Schema-tolerant full customer purge.
-- Optional product modules (casino, Aviator, broker, bonus, support, etc.) are skipped when not installed.
-- The RPC remains callable only by service_role and still verifies an active super admin.

CREATE OR REPLACE FUNCTION public.hard_purge_delete_user_rows(
  p_table_name TEXT,
  p_user_column TEXT,
  p_user_id UUID
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $helper$
DECLARE
  v_table REGCLASS;
  v_count INTEGER:=0;
BEGIN
  v_table:=to_regclass(format('public.%I',p_table_name));
  IF v_table IS NULL THEN RETURN 0; END IF;
  EXECUTE format('DELETE FROM %s WHERE %I=$1',v_table,p_user_column) USING p_user_id;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
EXCEPTION
  WHEN undefined_column OR undefined_table THEN RETURN 0;
END;
$helper$;

REVOKE ALL ON FUNCTION public.hard_purge_delete_user_rows(TEXT,TEXT,UUID) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.hard_purge_customer(
  p_user_id UUID,
  p_admin_id UUID,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $purge$
DECLARE
  v_balance NUMERIC:=0;
  v_pending INTEGER:=0;
  v_bets INTEGER:=0;
  v_transactions INTEGER:=0;
  v_table_name TEXT;
  v_user_column TEXT;
  v_table REGCLASS;
BEGIN
  IF char_length(btrim(COALESCE(p_reason,'')))<5 THEN
    RAISE EXCEPTION 'A deletion reason is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id=p_admin_id
      AND is_admin=TRUE
      AND admin_role='super_admin'
      AND COALESCE(is_suspended,FALSE)=FALSE
  ) THEN
    RAISE EXCEPTION 'Super admin authorization required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id=p_user_id AND COALESCE(is_admin,FALSE)=FALSE
  ) THEN
    RAISE EXCEPTION 'Customer account not found';
  END IF;

  IF to_regclass('public.ledger_accounts') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT COALESCE(SUM(balance),0) FROM public.ledger_accounts WHERE user_id=$1'
        INTO v_balance USING p_user_id;
    EXCEPTION WHEN undefined_column THEN v_balance:=0; END;
  END IF;
  IF to_regclass('public.bets') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT COUNT(*) FROM public.bets WHERE user_id=$1' INTO v_bets USING p_user_id;
      EXECUTE 'SELECT COUNT(*) FROM public.bets WHERE user_id=$1 AND status IN (''pending'',''placed'')'
        INTO v_pending USING p_user_id;
    EXCEPTION WHEN undefined_column THEN v_bets:=0; END;
  END IF;
  IF to_regclass('public.wallet_transactions') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT COUNT(*) FROM public.wallet_transactions WHERE user_id=$1'
        INTO v_transactions USING p_user_id;
    EXCEPTION WHEN undefined_column THEN v_transactions:=0; END;
  END IF;

  -- Capture all related entity IDs before deleting module records.
  CREATE TEMP TABLE purge_customer_entity_ids(
    id UUID PRIMARY KEY
  ) ON COMMIT DROP;
  INSERT INTO purge_customer_entity_ids(id) VALUES(p_user_id) ON CONFLICT DO NOTHING;

  FOR v_table_name,v_user_column IN
    SELECT * FROM (VALUES
      ('bets','user_id'),
      ('wallet_transactions','user_id'),
      ('kyc_documents','user_id'),
      ('manual_deposit_requests','user_id'),
      ('manual_withdrawal_requests','user_id'),
      ('casino_transactions','user_id'),
      ('casino_sessions','user_id'),
      ('aviator_bets','user_id'),
      ('support_tickets','user_id')
    ) AS entity_tables(table_name,user_column)
  LOOP
    v_table:=to_regclass(format('public.%I',v_table_name));
    IF v_table IS NOT NULL THEN
      BEGIN
        EXECUTE format(
          'INSERT INTO purge_customer_entity_ids(id) SELECT id FROM %s WHERE %I=$1 ON CONFLICT DO NOTHING',
          v_table,v_user_column
        ) USING p_user_id;
      EXCEPTION WHEN undefined_column THEN NULL; END;
    END IF;
  END LOOP;

  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    BEGIN
      EXECUTE 'DELETE FROM public.audit_logs WHERE entity_id IN (SELECT id FROM purge_customer_entity_ids)';
    EXCEPTION WHEN undefined_column THEN NULL; END;
  END IF;

  -- Broker and partner dependencies.
  PERFORM public.hard_purge_delete_user_rows('partner_vertical_commissions','player_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('broker_commissions','player_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('broker_players','player_id',p_user_id);
  IF to_regclass('public.brokers') IS NOT NULL THEN
    IF to_regclass('public.partner_vertical_commissions') IS NOT NULL THEN
      BEGIN EXECUTE 'DELETE FROM public.partner_vertical_commissions WHERE broker_id IN (SELECT id FROM public.brokers WHERE user_id=$1)' USING p_user_id;
      EXCEPTION WHEN undefined_column THEN NULL; END;
    END IF;
    IF to_regclass('public.broker_commissions') IS NOT NULL THEN
      BEGIN EXECUTE 'DELETE FROM public.broker_commissions WHERE broker_id IN (SELECT id FROM public.brokers WHERE user_id=$1)' USING p_user_id;
      EXCEPTION WHEN undefined_column THEN NULL; END;
    END IF;
    IF to_regclass('public.broker_payout_requests') IS NOT NULL THEN
      BEGIN EXECUTE 'DELETE FROM public.broker_payout_requests WHERE broker_id IN (SELECT id FROM public.brokers WHERE user_id=$1)' USING p_user_id;
      EXCEPTION WHEN undefined_column THEN NULL; END;
    END IF;
    IF to_regclass('public.broker_players') IS NOT NULL THEN
      BEGIN EXECUTE 'DELETE FROM public.broker_players WHERE broker_id IN (SELECT id FROM public.brokers WHERE user_id=$1)' USING p_user_id;
      EXCEPTION WHEN undefined_column THEN NULL; END;
    END IF;
    PERFORM public.hard_purge_delete_user_rows('brokers','user_id',p_user_id);
  END IF;

  -- Sportsbook dependencies.
  IF to_regclass('public.bets') IS NOT NULL THEN
    IF to_regclass('public.early_payout_awards') IS NOT NULL
       AND to_regclass('public.bet_selections') IS NOT NULL THEN
      BEGIN
        EXECUTE 'DELETE FROM public.early_payout_awards WHERE bet_selection_id IN (
          SELECT bs.id FROM public.bet_selections bs JOIN public.bets b ON b.id=bs.bet_id WHERE b.user_id=$1
        )' USING p_user_id;
      EXCEPTION WHEN undefined_column THEN NULL; END;
    END IF;
    IF to_regclass('public.settlements') IS NOT NULL THEN
      BEGIN EXECUTE 'DELETE FROM public.settlements WHERE bet_id IN (SELECT id FROM public.bets WHERE user_id=$1)' USING p_user_id;
      EXCEPTION WHEN undefined_column THEN NULL; END;
    END IF;
    PERFORM public.hard_purge_delete_user_rows('cashout_offers','user_id',p_user_id);
    PERFORM public.hard_purge_delete_user_rows('bet_validations','user_id',p_user_id);
    IF to_regclass('public.bet_selections') IS NOT NULL THEN
      BEGIN EXECUTE 'DELETE FROM public.bet_selections WHERE bet_id IN (SELECT id FROM public.bets WHERE user_id=$1)' USING p_user_id;
      EXCEPTION WHEN undefined_column THEN NULL; END;
    END IF;
    PERFORM public.hard_purge_delete_user_rows('bets','user_id',p_user_id);
  END IF;

  -- Casino, Aviator and payment modules.
  PERFORM public.hard_purge_delete_user_rows('casino_transactions','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('casino_sessions','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('aviator_bets','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('crypto_deposit_invoices','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('manual_deposit_requests','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('manual_withdrawal_requests','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('withdrawal_addresses','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('admin_balance_adjustments','user_id',p_user_id);

  -- Remove complete double-entry journals, including system counter-postings.
  IF to_regclass('public.ledger_accounts') IS NOT NULL
     AND to_regclass('public.ledger_postings') IS NOT NULL
     AND to_regclass('public.ledger_journals') IS NOT NULL THEN
    CREATE TEMP TABLE purge_customer_journals(
      journal_id UUID PRIMARY KEY
    ) ON COMMIT DROP;
    BEGIN
      EXECUTE 'INSERT INTO purge_customer_journals(journal_id)
        SELECT DISTINCT p.journal_id
        FROM public.ledger_postings p
        JOIN public.ledger_accounts a ON a.id=p.account_id
        WHERE a.user_id=$1
        ON CONFLICT DO NOTHING' USING p_user_id;
      IF to_regclass('public.wallet_transactions') IS NOT NULL THEN
        EXECUTE 'INSERT INTO purge_customer_journals(journal_id)
          SELECT j.id FROM public.ledger_journals j
          WHERE j.source_transaction_id IN (
            SELECT id FROM public.wallet_transactions WHERE user_id=$1
          ) ON CONFLICT DO NOTHING' USING p_user_id;
      END IF;
      EXECUTE 'DELETE FROM public.ledger_postings WHERE journal_id IN (SELECT journal_id FROM purge_customer_journals)';
      EXECUTE 'DELETE FROM public.ledger_journals WHERE id IN (SELECT journal_id FROM purge_customer_journals)';
    EXCEPTION WHEN undefined_column THEN NULL; END;
  END IF;

  PERFORM public.hard_purge_delete_user_rows('ledger_accounts','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('wallet_transactions','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('wallet_accounts','user_id',p_user_id);

  IF to_regclass('public.ledger_accounts') IS NOT NULL
     AND to_regclass('public.ledger_postings') IS NOT NULL THEN
    BEGIN
      EXECUTE 'UPDATE public.ledger_accounts a
        SET balance=COALESCE((SELECT SUM(p.amount) FROM public.ledger_postings p WHERE p.account_id=a.id),0),
            updated_at=NOW()
        WHERE a.is_system=TRUE';
    EXCEPTION WHEN undefined_column THEN NULL; END;
  END IF;

  -- Support history.
  IF to_regclass('public.support_tickets') IS NOT NULL
     AND to_regclass('public.support_ticket_messages') IS NOT NULL THEN
    BEGIN
      EXECUTE 'DELETE FROM public.support_ticket_messages
        WHERE ticket_id IN (SELECT id FROM public.support_tickets WHERE user_id=$1)
           OR author_id=$1' USING p_user_id;
    EXCEPTION WHEN undefined_column THEN NULL; END;
  END IF;
  PERFORM public.hard_purge_delete_user_rows('support_ticket_messages','author_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('support_tickets','user_id',p_user_id);

  -- Customer-owned settings, verification, rewards and risk records.
  PERFORM public.hard_purge_delete_user_rows('kyc_documents','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('notifications','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('notification_preferences','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('push_subscriptions','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('user_announcement_dismissals','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('favorites','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('mission_claims','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('user_bonuses','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('loyalty_accounts','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('user_limits','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('responsible_gaming_limits','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('self_exclusions','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('risk_profiles','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('fraud_flags','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('idempotency_keys','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('customer_anonymizations','user_id',p_user_id);
  PERFORM public.hard_purge_delete_user_rows('error_events','user_id',p_user_id);

  DELETE FROM public.profiles
  WHERE id=p_user_id AND COALESCE(is_admin,FALSE)=FALSE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer profile could not be purged'; END IF;

  RETURN jsonb_build_object(
    'user_id',p_user_id,
    'deleted_bets',v_bets,
    'deleted_wallet_transactions',v_transactions,
    'discarded_wallet_balance',v_balance,
    'deleted_pending_activity',v_pending,
    'financial_history_deleted',TRUE,
    'schema_tolerant',TRUE
  );
END;
$purge$;

REVOKE ALL ON FUNCTION public.hard_purge_customer(UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hard_purge_customer(UUID,UUID,TEXT) TO service_role;
