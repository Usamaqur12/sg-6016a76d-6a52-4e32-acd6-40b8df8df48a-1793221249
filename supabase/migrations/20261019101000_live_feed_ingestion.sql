-- Transactional provider feed ingestion with canonical event mapping,
-- idempotent updates, odds history and incident-based suspension.

CREATE TABLE IF NOT EXISTS public.provider_event_map (
  provider_id TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider_id, provider_event_id)
);

CREATE TABLE IF NOT EXISTS public.feed_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id TEXT NOT NULL,
  update_id TEXT NOT NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, update_id)
);

ALTER TABLE public.provider_event_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view provider event mappings"
  ON public.provider_event_map FOR SELECT TO authenticated
  USING (public.has_admin_role(ARRAY['sports_trader']));
CREATE POLICY "Admins can view feed updates"
  ON public.feed_updates FOR SELECT TO authenticated
  USING (public.has_admin_role(ARRAY['sports_trader']));

CREATE OR REPLACE FUNCTION public.ingest_sports_feed_event(
  p_update_id TEXT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider TEXT := trim(p_payload->>'provider_id');
  v_provider_event TEXT := trim(p_payload->>'provider_event_id');
  v_sport_id UUID;
  v_league_id UUID;
  v_event_id UUID;
  v_market_id UUID;
  v_odds_id UUID;
  v_market JSONB;
  v_outcome JSONB;
  v_previous_odds NUMERIC;
  v_incident TEXT := lower(COALESCE(p_payload->>'incident', ''));
  v_critical_incident BOOLEAN;
  v_should_suspend BOOLEAN;
  v_duplicate UUID;
  v_market_count INTEGER := 0;
  v_odds_count INTEGER := 0;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Feed ingestion authorization required';
  END IF;
  IF p_update_id IS NULL OR length(trim(p_update_id)) < 3
    OR v_provider = '' OR v_provider_event = '' THEN
    RAISE EXCEPTION 'Provider and update identifiers are required';
  END IF;
  IF COALESCE(p_payload->>'sport_slug', '') = ''
    OR COALESCE(p_payload->>'league_slug', '') = ''
    OR COALESCE(p_payload->>'home_team', '') = ''
    OR COALESCE(p_payload->>'away_team', '') = '' THEN
    RAISE EXCEPTION 'Sport, league and team identifiers are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_provider || ':' || p_update_id));
  SELECT id INTO v_duplicate FROM public.feed_updates
  WHERE provider_id = v_provider AND update_id = p_update_id;
  IF v_duplicate IS NOT NULL THEN
    SELECT event_id INTO v_event_id FROM public.feed_updates WHERE id = v_duplicate;
    RETURN jsonb_build_object('duplicate', TRUE, 'event_id', v_event_id);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_provider || ':' || v_provider_event));

  INSERT INTO public.sports (name, slug, icon, is_active)
  VALUES (p_payload->>'sport_name', p_payload->>'sport_slug', p_payload->>'sport_icon', TRUE)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, is_active = TRUE
  RETURNING id INTO v_sport_id;

  INSERT INTO public.leagues (sport_id, name, slug, country, is_active)
  VALUES (v_sport_id, p_payload->>'league_name', p_payload->>'league_slug', p_payload->>'country', TRUE)
  ON CONFLICT (sport_id, slug) DO UPDATE SET name = EXCLUDED.name, country = EXCLUDED.country, is_active = TRUE
  RETURNING id INTO v_league_id;

  SELECT event_id INTO v_event_id FROM public.provider_event_map
  WHERE provider_id = v_provider AND provider_event_id = v_provider_event;

  IF v_event_id IS NULL THEN
    SELECT id INTO v_event_id FROM public.events
    WHERE provider_id = v_provider AND provider_event_id = v_provider_event
    ORDER BY created_at ASC LIMIT 1;
  END IF;

  -- Cross-provider reconciliation: use the same canonical event when normalized
  -- teams and kickoff are effectively identical. Multiple providers may map to
  -- one event, enabling failover without duplicating the public fixture.
  IF v_event_id IS NULL THEN
    SELECT id INTO v_event_id FROM public.events
    WHERE sport_id = v_sport_id
      AND lower(trim(home_team)) = lower(trim(p_payload->>'home_team'))
      AND lower(trim(away_team)) = lower(trim(p_payload->>'away_team'))
      AND abs(extract(epoch FROM (start_time - (p_payload->>'start_time')::TIMESTAMPTZ))) <= 900
    ORDER BY created_at ASC LIMIT 1;
  END IF;

  IF v_event_id IS NULL THEN
    INSERT INTO public.events (
      sport_id, league_id, home_team, away_team, start_time, status,
      provider_id, provider_event_id, is_suspended
    ) VALUES (
      v_sport_id, v_league_id, p_payload->>'home_team', p_payload->>'away_team',
      (p_payload->>'start_time')::TIMESTAMPTZ, COALESCE(p_payload->>'status', 'upcoming'),
      v_provider, v_provider_event, FALSE
    ) RETURNING id INTO v_event_id;
  END IF;

  INSERT INTO public.provider_event_map (provider_id, provider_event_id, event_id)
  VALUES (v_provider, v_provider_event, v_event_id)
  ON CONFLICT (provider_id, provider_event_id) DO UPDATE
    SET updated_at = NOW();

  v_critical_incident := v_incident = ANY(ARRAY['goal', 'penalty', 'red_card', 'var', 'wicket', 'match_point']);
  v_should_suspend := v_critical_incident OR COALESCE(p_payload->>'status', '') IN ('postponed', 'cancelled', 'finished');

  UPDATE public.events SET
    sport_id = v_sport_id,
    league_id = v_league_id,
    home_team = p_payload->>'home_team',
    away_team = p_payload->>'away_team',
    start_time = (p_payload->>'start_time')::TIMESTAMPTZ,
    status = COALESCE(p_payload->>'status', status),
    live_score_home = CASE WHEN p_payload ? 'home_score' THEN (p_payload->>'home_score')::INTEGER ELSE live_score_home END,
    live_score_away = CASE WHEN p_payload ? 'away_score' THEN (p_payload->>'away_score')::INTEGER ELSE live_score_away END,
    live_minute = CASE WHEN p_payload ? 'live_minute' THEN (p_payload->>'live_minute')::INTEGER ELSE live_minute END,
    is_suspended = CASE WHEN v_should_suspend THEN TRUE WHEN COALESCE((p_payload->>'resume_markets')::BOOLEAN, FALSE) THEN FALSE ELSE is_suspended END,
    updated_at = NOW()
  WHERE id = v_event_id;

  IF v_should_suspend THEN
    UPDATE public.markets SET status = 'suspended'
    WHERE event_id = v_event_id AND status = 'active';
  END IF;

  FOR v_market IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'markets', '[]'::JSONB))
  LOOP
    SELECT id INTO v_market_id FROM public.markets
    WHERE event_id = v_event_id
      AND type = v_market->>'type'
      AND line IS NOT DISTINCT FROM NULLIF(v_market->>'line', '')::NUMERIC
    ORDER BY created_at ASC LIMIT 1;

    IF v_market_id IS NULL THEN
      INSERT INTO public.markets (event_id, name, type, line, status)
      VALUES (
        v_event_id, v_market->>'name', v_market->>'type', NULLIF(v_market->>'line', '')::NUMERIC,
        CASE WHEN v_should_suspend THEN 'suspended' ELSE COALESCE(v_market->>'status', 'active') END
      ) RETURNING id INTO v_market_id;
    ELSE
      UPDATE public.markets SET
        name = v_market->>'name',
        status = CASE WHEN v_should_suspend THEN 'suspended' ELSE COALESCE(v_market->>'status', status) END
      WHERE id = v_market_id;
    END IF;
    v_market_count := v_market_count + 1;

    FOR v_outcome IN SELECT value FROM jsonb_array_elements(COALESCE(v_market->'outcomes', '[]'::JSONB))
    LOOP
      SELECT id, value INTO v_odds_id, v_previous_odds FROM public.odds
      WHERE market_id = v_market_id AND lower(trim(selection)) = lower(trim(v_outcome->>'selection'))
      ORDER BY created_at ASC LIMIT 1;

      IF v_odds_id IS NULL THEN
        INSERT INTO public.odds (market_id, selection, value, is_active, is_locked, provider_id, provider_odds, last_provider_update)
        VALUES (v_market_id, v_outcome->>'selection', (v_outcome->>'value')::NUMERIC, TRUE, v_should_suspend, v_provider, (v_outcome->>'value')::NUMERIC, NOW())
        RETURNING id INTO v_odds_id;
      ELSE
        IF v_previous_odds IS DISTINCT FROM (v_outcome->>'value')::NUMERIC THEN
          INSERT INTO public.odds_history (odds_id, market_id, selection, previous_value, new_value, provider_odds, change_type)
          VALUES (v_odds_id, v_market_id, v_outcome->>'selection', v_previous_odds, (v_outcome->>'value')::NUMERIC, (v_outcome->>'value')::NUMERIC, 'provider_update');
        END IF;
        UPDATE public.odds SET
          value = (v_outcome->>'value')::NUMERIC,
          provider_odds = (v_outcome->>'value')::NUMERIC,
          provider_id = v_provider,
          is_active = COALESCE((v_outcome->>'active')::BOOLEAN, TRUE),
          is_locked = v_should_suspend,
          last_provider_update = NOW(), updated_at = NOW()
        WHERE id = v_odds_id;
      END IF;
      v_odds_count := v_odds_count + 1;
    END LOOP;
  END LOOP;

  IF COALESCE((p_payload->>'resume_markets')::BOOLEAN, FALSE) AND NOT v_should_suspend THEN
    UPDATE public.markets SET status = 'active' WHERE event_id = v_event_id AND status = 'suspended';
    UPDATE public.odds SET is_locked = FALSE WHERE market_id IN (SELECT id FROM public.markets WHERE event_id = v_event_id);
  END IF;

  INSERT INTO public.feed_updates (provider_id, update_id, event_id, payload)
  VALUES (v_provider, p_update_id, v_event_id, p_payload);

  RETURN jsonb_build_object('duplicate', FALSE, 'event_id', v_event_id, 'markets', v_market_count, 'odds', v_odds_count, 'suspended', v_should_suspend);
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_sports_feed_event(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_sports_feed_event(TEXT, JSONB) TO service_role;
