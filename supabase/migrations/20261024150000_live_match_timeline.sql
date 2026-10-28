-- Customer-facing live incident timeline populated from idempotent feed updates.

CREATE TABLE IF NOT EXISTS public.event_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  feed_update_id UUID REFERENCES public.feed_updates(id) ON DELETE SET NULL,
  incident_type TEXT NOT NULL,
  match_minute INTEGER,
  team_side TEXT CHECK (team_side IN ('home','away','neutral')),
  score_home INTEGER,
  score_away INTEGER,
  description TEXT,
  provider_id TEXT,
  provider_incident_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider_id,provider_incident_id)
);
CREATE INDEX IF NOT EXISTS event_timeline_event_minute_idx ON public.event_timeline(event_id,match_minute DESC,created_at DESC);
ALTER TABLE public.event_timeline ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_event_timeline" ON public.event_timeline FOR SELECT TO anon,authenticated USING (TRUE);
GRANT SELECT ON public.event_timeline TO anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.event_timeline FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.capture_feed_incident_timeline()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_incident TEXT:=lower(trim(COALESCE(NEW.payload->>'incident',''))); v_incident_id TEXT;
BEGIN
  IF v_incident='' OR NEW.event_id IS NULL THEN RETURN NEW; END IF;
  v_incident_id:=COALESCE(NULLIF(trim(NEW.payload->>'incident_id'),''),NEW.update_id);
  INSERT INTO public.event_timeline(event_id,feed_update_id,incident_type,match_minute,team_side,score_home,score_away,description,provider_id,provider_incident_id)
  VALUES(NEW.event_id,NEW.id,v_incident,NULLIF(NEW.payload->>'live_minute','')::INTEGER,
    CASE WHEN lower(COALESCE(NEW.payload->>'team_side','neutral')) IN ('home','away') THEN lower(NEW.payload->>'team_side') ELSE 'neutral' END,
    NULLIF(NEW.payload->>'home_score','')::INTEGER,NULLIF(NEW.payload->>'away_score','')::INTEGER,
    NULLIF(trim(COALESCE(NEW.payload->>'incident_description',NEW.payload->>'description','')),''),NEW.provider_id,v_incident_id)
  ON CONFLICT(provider_id,provider_incident_id) DO NOTHING;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS capture_feed_incident_timeline_trigger ON public.feed_updates;
CREATE TRIGGER capture_feed_incident_timeline_trigger AFTER INSERT ON public.feed_updates FOR EACH ROW EXECUTE FUNCTION public.capture_feed_incident_timeline();
REVOKE ALL ON FUNCTION public.capture_feed_incident_timeline() FROM PUBLIC,anon,authenticated;

