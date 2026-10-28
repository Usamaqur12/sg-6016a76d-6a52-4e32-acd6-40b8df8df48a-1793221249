-- Server-managed sports data providers. API credentials are encrypted by the
-- application before they reach this table and are never exposed by RLS.

CREATE TABLE IF NOT EXISTS public.sports_feed_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 100),
  provider_type TEXT NOT NULL CHECK (provider_type IN (
    'thesportsdb_demo',
    'thesportsdb_live',
    'sportmonks'
  )),
  encrypted_api_key TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::JSONB,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  priority INTEGER NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 1000),
  sync_interval_seconds INTEGER NOT NULL DEFAULT 10 CHECK (sync_interval_seconds BETWEEN 5 AND 3600),
  status TEXT NOT NULL DEFAULT 'not_tested' CHECK (status IN ('not_tested', 'healthy', 'degraded', 'error', 'disabled')),
  last_sync_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  last_event_count INTEGER NOT NULL DEFAULT 0 CHECK (last_event_count >= 0),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sports_feed_providers_enabled_priority
  ON public.sports_feed_providers (is_enabled, priority);

ALTER TABLE public.sports_feed_providers ENABLE ROW LEVEL SECURITY;

-- Provider configuration, especially encrypted credentials, is intentionally
-- service-role only. Admin access goes through authenticated API routes.
REVOKE ALL ON public.sports_feed_providers FROM anon, authenticated;

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
  'TheSportsDB Demo Schedule',
  'thesportsdb_demo',
  '{"leagueId":"4328","sport":"Soccer"}'::JSONB,
  TRUE,
  TRUE,
  100,
  300,
  'not_tested'
WHERE NOT EXISTS (
  SELECT 1 FROM public.sports_feed_providers
  WHERE provider_type = 'thesportsdb_demo' AND is_demo = TRUE
);

COMMENT ON TABLE public.sports_feed_providers IS
  'Server-only registry for live score/schedule providers. Secrets are AES-GCM ciphertext.';
COMMENT ON COLUMN public.sports_feed_providers.encrypted_api_key IS
  'AES-256-GCM ciphertext produced with SPORTS_PROVIDER_ENCRYPTION_KEY; never return to clients.';

