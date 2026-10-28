CREATE TABLE IF NOT EXISTS public.provider_event_map (
  provider_id text NOT NULL,
  provider_event_id text NOT NULL,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, provider_event_id)
);

CREATE TABLE IF NOT EXISTS public.feed_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id text NOT NULL,
  update_id text NOT NULL,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, update_id)
);

ALTER TABLE public.provider_event_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_updates ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.ingest_sports_feed_event(
  p_update_id text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_provider text := trim(COALESCE(p_payload->>'provider_id', ''));
  v_provider_event text := trim(COALESCE(p_payload->>'provider_event_id', ''));
  v_provider_name text;
  v_provider_type text;
  v_provider_health_id uuid;
  v_sport_id uuid;
  v_league_id uuid;
  v_event_id uuid;
  v_existing_event_id uuid;
  v_market_id uuid;
  v_odds_id uuid;
  v_market jsonb;
  v_outcome jsonb;
  v_previous_odds numeric(10,2);
  v_should_suspend boolean := COALESCE(p_payload->>'status', '') IN ('postponed', 'cancelled', 'finished');
  v_market_count integer := 0;
  v_odds_count integer := 0;
BEGIN
  IF p_update_id IS NULL OR length(trim(p_update_id)) < 3 OR v_provider = '' OR v_provider_event = '' THEN
    RAISE EXCEPTION 'Provider and update identifiers are required';
  END IF;

  IF COALESCE(p_payload->>'sport_slug', '') = ''
    OR COALESCE(p_payload->>'league_slug', '') = ''
    OR COALESCE(p_payload->>'home_team', '') = ''
    OR COALESCE(p_payload->>'away_team', '') = ''
    OR COALESCE(p_payload->>'start_time', '') = '' THEN
    RAISE EXCEPTION 'Sport, league, team, and kickoff values are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_provider || ':' || p_update_id));

  SELECT event_id
  INTO v_existing_event_id
  FROM public.feed_updates
  WHERE provider_id = v_provider
    AND update_id = p_update_id
  LIMIT 1;

  IF v_existing_event_id IS NOT NULL THEN
    RETURN jsonb_build_object('duplicate', TRUE, 'event_id', v_existing_event_id);
  END IF;

  SELECT name, provider_type
  INTO v_provider_name, v_provider_type
  FROM public.sports_feed_providers
  WHERE id::text = v_provider
  ORDER BY created_at ASC
  LIMIT 1;

  v_provider_name := COALESCE(v_provider_name, NULLIF(trim(p_payload->>'provider_name'), ''), v_provider);
  v_provider_type := COALESCE(v_provider_type, NULLIF(trim(p_payload->>'provider_type'), ''), 'odds');

  INSERT INTO public.sports (name, slug, icon, is_active)
  VALUES (
    p_payload->>'sport_name',
    p_payload->>'sport_slug',
    NULLIF(p_payload->>'sport_icon', ''),
    TRUE
  )
  ON CONFLICT (slug) DO UPDATE
    SET name = EXCLUDED.name,
        icon = COALESCE(EXCLUDED.icon, public.sports.icon),
        is_active = TRUE
  RETURNING id INTO v_sport_id;

  INSERT INTO public.leagues (sport_id, name, slug, country, is_active)
  VALUES (
    v_sport_id,
    p_payload->>'league_name',
    p_payload->>'league_slug',
    NULLIF(p_payload->>'country', ''),
    TRUE
  )
  ON CONFLICT (sport_id, slug) DO UPDATE
    SET name = EXCLUDED.name,
        country = EXCLUDED.country,
        is_active = TRUE
  RETURNING id INTO v_league_id;

  SELECT event_id
  INTO v_event_id
  FROM public.provider_event_map
  WHERE provider_id = v_provider
    AND provider_event_id = v_provider_event
  LIMIT 1;

  IF v_event_id IS NULL THEN
    SELECT id
    INTO v_event_id
    FROM public.events
    WHERE provider_event_id = v_provider_event
      AND COALESCE(metadata->>'providerId', '') = v_provider
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_event_id IS NULL THEN
    SELECT id
    INTO v_event_id
    FROM public.events
    WHERE sport_id = v_sport_id
      AND lower(trim(home_team)) = lower(trim(p_payload->>'home_team'))
      AND lower(trim(away_team)) = lower(trim(p_payload->>'away_team'))
      AND abs(extract(epoch FROM (start_time - (p_payload->>'start_time')::timestamptz))) <= 900
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_event_id IS NULL THEN
    INSERT INTO public.events (
      sport_id,
      league_id,
      home_team,
      away_team,
      start_time,
      status,
      live_score_home,
      live_score_away,
      live_minute,
      provider_event_id,
      is_suspended,
      metadata
    )
    VALUES (
      v_sport_id,
      v_league_id,
      p_payload->>'home_team',
      p_payload->>'away_team',
      (p_payload->>'start_time')::timestamptz,
      COALESCE(p_payload->>'status', 'upcoming'),
      CASE WHEN p_payload ? 'home_score' THEN (p_payload->>'home_score')::integer ELSE NULL END,
      CASE WHEN p_payload ? 'away_score' THEN (p_payload->>'away_score')::integer ELSE NULL END,
      CASE WHEN p_payload ? 'live_minute' THEN (p_payload->>'live_minute')::integer ELSE NULL END,
      v_provider_event,
      v_should_suspend,
      jsonb_build_object(
        'providerId', v_provider,
        'providerEventId', v_provider_event,
        'providerType', v_provider_type,
        'providerName', v_provider_name,
        'source', 'score-feed'
      )
    )
    RETURNING id INTO v_event_id;
  ELSE
    UPDATE public.events
    SET sport_id = v_sport_id,
        league_id = v_league_id,
        home_team = p_payload->>'home_team',
        away_team = p_payload->>'away_team',
        start_time = (p_payload->>'start_time')::timestamptz,
        status = COALESCE(p_payload->>'status', status),
        live_score_home = CASE WHEN p_payload ? 'home_score' THEN (p_payload->>'home_score')::integer ELSE live_score_home END,
        live_score_away = CASE WHEN p_payload ? 'away_score' THEN (p_payload->>'away_score')::integer ELSE live_score_away END,
        live_minute = CASE WHEN p_payload ? 'live_minute' THEN (p_payload->>'live_minute')::integer ELSE live_minute END,
        provider_event_id = COALESCE(public.events.provider_event_id, v_provider_event),
        is_suspended = CASE
          WHEN v_should_suspend THEN TRUE
          WHEN COALESCE((p_payload->>'resume_markets')::boolean, FALSE) THEN FALSE
          ELSE is_suspended
        END,
        metadata = COALESCE(public.events.metadata, '{}'::jsonb) || jsonb_build_object(
          'providerId', v_provider,
          'providerEventId', v_provider_event,
          'providerType', v_provider_type,
          'providerName', v_provider_name,
          'source', 'score-feed'
        ),
        updated_at = now()
    WHERE id = v_event_id;
  END IF;

  INSERT INTO public.provider_event_map (provider_id, provider_event_id, event_id)
  VALUES (v_provider, v_provider_event, v_event_id)
  ON CONFLICT (provider_id, provider_event_id) DO UPDATE
    SET event_id = EXCLUDED.event_id,
        updated_at = now();

  IF v_should_suspend THEN
    UPDATE public.markets
    SET status = 'suspended'
    WHERE event_id = v_event_id
      AND status = 'active';
  END IF;

  FOR v_market IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_payload->'markets', '[]'::jsonb))
  LOOP
    SELECT id
    INTO v_market_id
    FROM public.markets
    WHERE event_id = v_event_id
      AND type = v_market->>'type'
      AND line IS NOT DISTINCT FROM NULLIF(v_market->>'line', '')::numeric
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_market_id IS NULL THEN
      INSERT INTO public.markets (event_id, name, type, line, status)
      VALUES (
        v_event_id,
        v_market->>'name',
        v_market->>'type',
        NULLIF(v_market->>'line', '')::numeric,
        CASE WHEN v_should_suspend THEN 'suspended' ELSE COALESCE(v_market->>'status', 'active') END
      )
      RETURNING id INTO v_market_id;
    ELSE
      UPDATE public.markets
      SET name = v_market->>'name',
          status = CASE WHEN v_should_suspend THEN 'suspended' ELSE COALESCE(v_market->>'status', status) END
      WHERE id = v_market_id;
    END IF;

    v_market_count := v_market_count + 1;

    FOR v_outcome IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(v_market->'outcomes', '[]'::jsonb))
    LOOP
      SELECT id, value
      INTO v_odds_id, v_previous_odds
      FROM public.odds
      WHERE market_id = v_market_id
        AND lower(trim(selection)) = lower(trim(v_outcome->>'selection'))
      ORDER BY created_at ASC
      LIMIT 1;

      IF v_odds_id IS NULL THEN
        INSERT INTO public.odds (
          market_id,
          selection,
          value,
          is_active,
          is_locked,
          last_provider_update
        )
        VALUES (
          v_market_id,
          v_outcome->>'selection',
          (v_outcome->>'value')::numeric,
          COALESCE((v_outcome->>'active')::boolean, TRUE),
          v_should_suspend,
          now()
        )
        RETURNING id INTO v_odds_id;
      ELSE
        IF v_previous_odds IS DISTINCT FROM (v_outcome->>'value')::numeric THEN
          INSERT INTO public.odds_history (
            odds_id,
            market_id,
            selection,
            previous_value,
            new_value,
            provider_odds,
            change_type
          )
          VALUES (
            v_odds_id,
            v_market_id,
            v_outcome->>'selection',
            v_previous_odds,
            (v_outcome->>'value')::numeric,
            (v_outcome->>'value')::numeric,
            'provider_update'
          );
        END IF;

        UPDATE public.odds
        SET value = (v_outcome->>'value')::numeric,
            is_active = COALESCE((v_outcome->>'active')::boolean, TRUE),
            is_locked = v_should_suspend,
            last_provider_update = now(),
            updated_at = now()
        WHERE id = v_odds_id;
      END IF;

      v_odds_count := v_odds_count + 1;
    END LOOP;
  END LOOP;

  IF COALESCE((p_payload->>'resume_markets')::boolean, FALSE) AND NOT v_should_suspend THEN
    UPDATE public.markets
    SET status = 'active'
    WHERE event_id = v_event_id
      AND status = 'suspended';

    UPDATE public.odds
    SET is_locked = FALSE,
        updated_at = now()
    WHERE market_id IN (
      SELECT id
      FROM public.markets
      WHERE event_id = v_event_id
    );
  END IF;

  INSERT INTO public.feed_updates (provider_id, update_id, event_id, payload)
  VALUES (v_provider, p_update_id, v_event_id, p_payload);

  SELECT id
  INTO v_provider_health_id
  FROM public.provider_health
  WHERE provider_name = v_provider_name
    AND provider_type = v_provider_type
  ORDER BY updated_at ASC
  LIMIT 1;

  IF v_provider_health_id IS NULL THEN
    INSERT INTO public.provider_health (
      provider_name,
      provider_type,
      status,
      last_successful_fetch,
      total_requests,
      failed_requests,
      consecutive_failures,
      error_message,
      updated_at
    )
    VALUES (
      v_provider_name,
      v_provider_type,
      'active',
      now(),
      1,
      0,
      0,
      NULL,
      now()
    );
  ELSE
    UPDATE public.provider_health
    SET status = 'active',
        last_successful_fetch = now(),
        total_requests = COALESCE(total_requests, 0) + 1,
        consecutive_failures = 0,
        error_message = NULL,
        updated_at = now()
    WHERE id = v_provider_health_id;
  END IF;

  RETURN jsonb_build_object(
    'duplicate', FALSE,
    'event_id', v_event_id,
    'markets', v_market_count,
    'odds', v_odds_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ingest_sports_feed_event(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_sports_feed_event(text, jsonb) TO service_role;