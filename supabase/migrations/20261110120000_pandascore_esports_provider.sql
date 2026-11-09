-- Add the PandaScore esports fixtures adapter to the encrypted provider registry.
-- The API token is entered in Admin -> Providers and is never stored in SQL.

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
      'sportmonks',
      'pandascore'
    )
  );

COMMENT ON COLUMN public.sports_feed_providers.provider_type IS
  'Supported feed adapter identifier, including PandaScore fixtures. Provider secrets are encrypted by the application.';
