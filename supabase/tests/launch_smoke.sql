-- Run after migrations on staging. Any missing launch-critical object aborts.
DO $$
BEGIN
  IF to_regprocedure('public.place_bet_atomic(text,numeric,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'place_bet_atomic is missing';
  END IF;
  IF to_regprocedure('public.accept_cashout(uuid,text,numeric)') IS NULL THEN
    RAISE EXCEPTION 'accept_cashout is missing';
  END IF;
  IF to_regprocedure('public.apply_crypto_deposit_update(text,text,text,uuid,text,numeric,text,text,numeric,numeric,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'crypto deposit settlement RPC is missing';
  END IF;
  IF to_regprocedure('public.get_my_broker_dashboard()') IS NULL THEN
    RAISE EXCEPTION 'broker dashboard RPC is missing';
  END IF;
  IF to_regprocedure('public.review_broker_payout(uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'broker payout review RPC is missing';
  END IF;
  IF to_regclass('public.crypto_deposit_invoices') IS NULL OR to_regclass('public.brokers') IS NULL THEN
    RAISE EXCEPTION 'crypto deposit or broker tables are missing';
  END IF;
  IF to_regprocedure('public.is_aal2()') IS NULL THEN
    RAISE EXCEPTION 'admin MFA assurance helper is missing';
  END IF;
  IF to_regprocedure('public.set_my_responsible_limit(text,numeric)') IS NULL THEN
    RAISE EXCEPTION 'responsible limit RPC is missing';
  END IF;
  IF to_regprocedure('public.start_my_self_exclusion(text,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'self-exclusion RPC is missing';
  END IF;
  IF to_regprocedure('public.record_event_result_and_queue(uuid,text,integer,integer,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'result ingestion RPC is missing';
  END IF;
  IF to_regprocedure('public.process_next_settlement_job()') IS NULL THEN
    RAISE EXCEPTION 'settlement worker RPC is missing';
  END IF;
  IF to_regprocedure('public.ingest_sports_feed_event(text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'sports feed ingestion RPC is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'enforce_and_refresh_bet_risk_trigger' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'risk and exposure trigger is missing';
  END IF;
  IF to_regprocedure('public.get_my_wallet_balances()') IS NULL THEN
    RAISE EXCEPTION 'wallet balance RPC is missing';
  END IF;
  IF to_regprocedure('public.ensure_user_ledger_accounts_from_id(uuid,numeric)') IS NULL THEN
    RAISE EXCEPTION 'wallet opening ledger helper is missing';
  END IF;
  IF to_regprocedure('public.get_wallet_reconciliation_report()') IS NULL THEN
    RAISE EXCEPTION 'wallet reconciliation RPC is missing';
  END IF;
  IF to_regprocedure('public.claim_promotion(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'promotion claim RPC is missing';
  END IF;
  IF to_regprocedure('public.expire_user_bonuses(integer)') IS NULL THEN
    RAISE EXCEPTION 'bonus expiry worker RPC is missing';
  END IF;
  IF to_regclass('public.loyalty_accounts') IS NULL THEN
    RAISE EXCEPTION 'loyalty accounts table is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'settle_bonus_wagering_trigger' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'bonus wagering trigger is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'verify_ledger_journal_balanced_trigger' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'ledger balance constraint trigger is missing';
  END IF;
  IF to_regclass('public.notifications') IS NULL THEN
    RAISE EXCEPTION 'notifications table is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'enforce_responsible_gaming_before_bet' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'responsible gaming bet trigger is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'kyc-documents' AND public = FALSE
  ) THEN
    RAISE EXCEPTION 'KYC bucket must be private';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'background_jobs'
      AND indexname = 'background_jobs_dedupe_key_unique'
  ) THEN
    RAISE EXCEPTION 'settlement job dedupe index is missing';
  END IF;
END;
$$;

SELECT 'launch smoke checks passed' AS result;

