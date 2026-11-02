-- Allow the production odds provider used by the admin sports-feed configuration.
-- The API key is encrypted by the application and is never stored in this migration.

ALTER TABLE public.sports_feed_providers
  DROP CONSTRAINT IF EXISTS sports_feed_providers_provider_type_check;

ALTER TABLE public.sports_feed_providers
  ADD CONSTRAINT sports_feed_providers_provider_type_check
  CHECK (
    provider_type IN (
      'openligadb',
      'the_odds_api',
      'thesportsdb_demo',
      'thesportsdb_live',
      'sportmonks'
    )
  );

COMMENT ON COLUMN public.sports_feed_providers.provider_type IS
  'Supported feed adapter identifier. Secrets are stored separately in sports_provider_secrets.';
