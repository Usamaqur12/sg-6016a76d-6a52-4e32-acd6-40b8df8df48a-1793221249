-- Server-controlled, idempotent event settlement queue.
-- Provider callbacks enqueue a result once; a service-role worker processes it
-- with wallet credits and bet state changes in the same database transaction.

ALTER TABLE public.background_jobs
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS background_jobs_dedupe_key_unique
  ON public.background_jobs (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS background_jobs_claimable_idx
  ON public.background_jobs (priority, scheduled_at, created_at)
  WHERE status IN ('pending', 'retry');

ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view background jobs" ON public.background_jobs;
CREATE POLICY "Admins can view background jobs"
  ON public.background_jobs FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.record_event_result_and_queue(
  p_event_id UUID,
  p_status TEXT,
  p_home_score INTEGER,
  p_away_score INTEGER,
  p_market_results JSONB,
  p_provider_reference TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id UUID;
  v_result JSONB;
  v_market_id UUID;
  v_winning_selection TEXT;
BEGIN
  IF NOT public.is_service_role()
    AND NOT public.has_admin_role(ARRAY['sports_trader']) THEN
    RAISE EXCEPTION 'Settlement ingestion authorization required';
  END IF;
  IF p_status NOT IN ('finished', 'cancelled') THEN
    RAISE EXCEPTION 'Only finished or cancelled events can be settled';
  END IF;
  IF p_status = 'finished' AND (p_home_score IS NULL OR p_away_score IS NULL) THEN
    RAISE EXCEPTION 'Finished events require final scores';
  END IF;
  IF p_provider_reference IS NULL OR length(trim(p_provider_reference)) < 3 THEN
    RAISE EXCEPTION 'Provider reference is required';
  END IF;
  IF jsonb_typeof(COALESCE(p_market_results, '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'Market results must be a JSON array';
  END IF;

  -- Serialize duplicate callbacks before checking the idempotency key.
  PERFORM pg_advisory_xact_lock(hashtext('settlement:' || p_provider_reference));

  -- A repeated provider callback must be a no-op, including after the job has
  -- completed. This prevents a changed duplicate payload from mutating scores.
  SELECT id INTO v_job_id
  FROM public.background_jobs
  WHERE dedupe_key = 'settlement:' || p_provider_reference;
  IF v_job_id IS NOT NULL THEN
    RETURN v_job_id;
  END IF;

  PERFORM 1 FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF p_status = 'finished' AND jsonb_array_length(p_market_results) = 0 THEN
    RAISE EXCEPTION 'A finished event requires at least one market result';
  END IF;

  FOR v_result IN SELECT value FROM jsonb_array_elements(p_market_results)
  LOOP
    v_market_id := NULLIF(v_result->>'market_id', '')::UUID;
    v_winning_selection := NULLIF(trim(v_result->>'winning_selection'), '');

    IF v_market_id IS NULL OR v_winning_selection IS NULL THEN
      RAISE EXCEPTION 'Each market result requires market_id and winning_selection';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.markets
      WHERE id = v_market_id AND event_id = p_event_id
    ) THEN
      RAISE EXCEPTION 'Market % does not belong to event', v_market_id;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.odds
      WHERE market_id = v_market_id
        AND lower(trim(selection)) = lower(v_winning_selection)
    ) THEN
      RAISE EXCEPTION 'Winning selection % is not valid for market %', v_winning_selection, v_market_id;
    END IF;
  END LOOP;

  UPDATE public.events
  SET status = p_status,
      live_score_home = p_home_score,
      live_score_away = p_away_score,
      is_suspended = TRUE,
      updated_at = NOW()
  WHERE id = p_event_id;

  INSERT INTO public.background_jobs (
    job_type, status, priority, payload, dedupe_key, scheduled_at
  ) VALUES (
    'settlement',
    'pending',
    1,
    jsonb_build_object(
      'event_id', p_event_id,
      'event_status', p_status,
      'home_score', p_home_score,
      'away_score', p_away_score,
      'market_results', COALESCE(p_market_results, '[]'::JSONB),
      'provider_reference', p_provider_reference
    ),
    'settlement:' || p_provider_reference,
    NOW()
  )
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_job_id;

  IF v_job_id IS NULL THEN
    SELECT id INTO v_job_id
    FROM public.background_jobs
    WHERE dedupe_key = 'settlement:' || p_provider_reference;
  END IF;

  RETURN v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_event_result_and_queue(UUID, TEXT, INTEGER, INTEGER, JSONB, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_event_result_and_queue(UUID, TEXT, INTEGER, INTEGER, JSONB, TEXT)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.process_next_settlement_job()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.background_jobs%ROWTYPE;
  v_event_id UUID;
  v_event_status TEXT;
  v_result JSONB;
  v_market_id UUID;
  v_winning_selection TEXT;
  v_bet RECORD;
  v_selection RECORD;
  v_bet_status TEXT;
  v_settlement_type TEXT;
  v_payout_factor NUMERIC;
  v_payout NUMERIC;
  v_balance NUMERIC;
  v_transaction_id UUID;
  v_settled_count INTEGER := 0;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Settlement worker authorization required';
  END IF;

  SELECT * INTO v_job
  FROM public.background_jobs
  WHERE job_type = 'settlement'
    AND status IN ('pending', 'retry')
    AND scheduled_at <= NOW()
    AND retry_count < COALESCE(max_retries, 3)
  ORDER BY priority ASC, scheduled_at ASC, created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('processed', FALSE);
  END IF;

  UPDATE public.background_jobs
  SET status = 'processing', started_at = NOW(), error_message = NULL
  WHERE id = v_job.id;

  BEGIN
    v_event_id := (v_job.payload->>'event_id')::UUID;
    v_event_status := v_job.payload->>'event_status';

    IF v_event_status = 'cancelled' THEN
      UPDATE public.markets
      SET status = 'settled', result = 'void', settled_at = NOW()
      WHERE event_id = v_event_id AND status <> 'settled';

      UPDATE public.bet_selections
      SET result = 'void'
      WHERE event_id = v_event_id AND result = 'pending';
    ELSE
      FOR v_result IN
        SELECT value FROM jsonb_array_elements(v_job.payload->'market_results')
      LOOP
        v_market_id := (v_result->>'market_id')::UUID;
        v_winning_selection := trim(v_result->>'winning_selection');

        UPDATE public.markets
        SET status = 'settled', result = v_winning_selection, settled_at = NOW()
        WHERE id = v_market_id AND event_id = v_event_id;

        UPDATE public.bet_selections
        SET result = CASE
          WHEN lower(trim(selection)) = lower(v_winning_selection) THEN 'won'
          ELSE 'lost'
        END
        WHERE market_id = v_market_id AND event_id = v_event_id AND result = 'pending';
      END LOOP;
    END IF;

    FOR v_bet IN
      SELECT b.id, b.user_id, b.stake
      FROM public.bets b
      WHERE b.status = 'pending'
        AND EXISTS (
          SELECT 1 FROM public.bet_selections bs
          WHERE bs.bet_id = b.id AND bs.event_id = v_event_id
        )
      FOR UPDATE OF b
    LOOP
      IF EXISTS (
        SELECT 1 FROM public.bet_selections
        WHERE bet_id = v_bet.id AND result = 'lost'
      ) THEN
        v_bet_status := 'lost';
        v_settlement_type := 'loss';
        v_payout := 0;
      ELSIF EXISTS (
        SELECT 1 FROM public.bet_selections
        WHERE bet_id = v_bet.id AND result = 'pending'
      ) THEN
        CONTINUE;
      ELSE
        v_payout_factor := 1;
        FOR v_selection IN
          SELECT result, odds_value
          FROM public.bet_selections
          WHERE bet_id = v_bet.id
        LOOP
          IF v_selection.result = 'won' THEN
            v_payout_factor := v_payout_factor * v_selection.odds_value;
          END IF;
        END LOOP;

        IF NOT EXISTS (
          SELECT 1 FROM public.bet_selections
          WHERE bet_id = v_bet.id AND result = 'won'
        ) THEN
          v_bet_status := 'void';
          v_settlement_type := 'void';
          v_payout := v_bet.stake;
        ELSE
          v_bet_status := 'won';
          v_settlement_type := 'win';
          v_payout := ROUND(v_bet.stake * v_payout_factor, 2);
        END IF;
      END IF;

      SELECT COALESCE(demo_balance, 0) INTO v_balance
      FROM public.profiles WHERE id = v_bet.user_id FOR UPDATE;

      IF v_payout > 0 THEN
        UPDATE public.profiles
        SET demo_balance = v_balance + v_payout, updated_at = NOW()
        WHERE id = v_bet.user_id;
      END IF;

      INSERT INTO public.wallet_transactions (
        user_id, type, amount, balance_before, balance_after,
        description, reference_id, status
      ) VALUES (
        v_bet.user_id,
        CASE
          WHEN v_bet_status = 'won' THEN 'bet_won'
          WHEN v_bet_status = 'void' THEN 'adjustment'
          ELSE 'bet_lost'
        END,
        v_payout,
        v_balance,
        v_balance + v_payout,
        'Automatic event settlement - ' || v_bet_status,
        v_bet.id,
        'completed'
      ) RETURNING id INTO v_transaction_id;

      UPDATE public.bets
      SET status = v_bet_status,
          payout = v_payout,
          settled_at = NOW()
      WHERE id = v_bet.id;

      INSERT INTO public.settlements (
        bet_id, settlement_type, original_stake, settlement_amount,
        settlement_reason, is_manual, wallet_transaction_id
      ) VALUES (
        v_bet.id, v_settlement_type, v_bet.stake, v_payout,
        'Provider result: ' || COALESCE(v_job.payload->>'provider_reference', 'unknown'),
        FALSE, v_transaction_id
      );

      v_settled_count := v_settled_count + 1;
    END LOOP;

    UPDATE public.background_jobs
    SET status = 'completed',
        completed_at = NOW(),
        result = jsonb_build_object(
          'event_id', v_event_id,
          'settled_bets', v_settled_count
        )
    WHERE id = v_job.id;

    RETURN jsonb_build_object(
      'processed', TRUE,
      'job_id', v_job.id,
      'event_id', v_event_id,
      'settled_bets', v_settled_count
    );
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.background_jobs
    SET status = CASE
          WHEN COALESCE(retry_count, 0) + 1 >= COALESCE(max_retries, 3) THEN 'failed'
          ELSE 'retry'
        END,
        retry_count = COALESCE(retry_count, 0) + 1,
        scheduled_at = NOW() + make_interval(mins => LEAST(30, power(2, LEAST(COALESCE(retry_count, 0) + 1, 4)))),
        error_message = SQLERRM,
        completed_at = CASE
          WHEN COALESCE(retry_count, 0) + 1 >= COALESCE(max_retries, 3) THEN NOW()
          ELSE NULL
        END
    WHERE id = v_job.id;

    RETURN jsonb_build_object(
      'processed', TRUE,
      'job_id', v_job.id,
      'failed', TRUE,
      'error', SQLERRM
    );
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.process_next_settlement_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_next_settlement_job() TO service_role;
