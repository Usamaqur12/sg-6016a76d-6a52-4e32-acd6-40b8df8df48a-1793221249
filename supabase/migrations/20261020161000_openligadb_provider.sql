-- Add a no-key, community live-score provider for safe product previews.
-- OpenLigaDB must not be used as a certified betting settlement source.

ALTER TABLE public.sports_feed_providers
  DROP CONSTRAINT IF EXISTS sports_feed_providers_provider_type_check;

ALTER TABLE public.sports_feed_providers
  ADD CONSTRAINT sports_feed_providers_provider_type_check
  CHECK (provider_type IN (
    'openligadb',
    'thesportsdb_demo',
    'thesportsdb_live',
    'sportmonks'
  ));

INSERT INTO public.sports_feed_providers (
  name,
  provider_type,
  settings,
  is_enabled,
  is_demo,
  priority,
  sync_interval_seconds,
  status
)
SELECT
  'OpenLigaDB Bundesliga Live Scores',
  'openligadb',
  '{"leagueShortcut":"bl1","sport":"Soccer"}'::JSONB,
  TRUE,
  TRUE,
  50,
  60,
  'not_tested'
WHERE NOT EXISTS (
  SELECT 1 FROM public.sports_feed_providers
  WHERE provider_type = 'openligadb' AND settings->>'leagueShortcut' = 'bl1'
);

