BEGIN;

CREATE TABLE IF NOT EXISTS public.sports_feed_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  provider_type text NOT NULL CHECK (provider_type IN ('openligadb', 'thesportsdb_demo', 'thesportsdb_live', 'sportmonks')),
  encrypted_api_key text NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_enabled boolean NOT NULL DEFAULT false,
  is_demo boolean NOT NULL DEFAULT false,
  priority integer NOT NULL DEFAULT 100 CHECK (priority >= 1 AND priority <= 1000),
  sync_interval_seconds integer NOT NULL DEFAULT 10 CHECK (sync_interval_seconds >= 5 AND sync_interval_seconds <= 3600),
  status text NOT NULL DEFAULT 'not_tested' CHECK (status IN ('not_tested', 'healthy', 'error', 'disabled')),
  last_sync_at timestamp with time zone NULL,
  last_success_at timestamp with time zone NULL,
  last_error text NULL,
  last_event_count integer NOT NULL DEFAULT 0,
  created_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sports_feed_providers_priority
  ON public.sports_feed_providers (is_enabled DESC, priority ASC);

CREATE INDEX IF NOT EXISTS idx_sports_feed_providers_status
  ON public.sports_feed_providers (status);

ALTER TABLE public.sports_feed_providers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sports_feed_providers'
      AND policyname = 'admins_read_sports_feed_providers'
  ) THEN
    CREATE POLICY "admins_read_sports_feed_providers"
      ON public.sports_feed_providers
      FOR SELECT
      TO authenticated
      USING (has_admin_role(ARRAY['sports_trader'::text, 'admin'::text, 'super_admin'::text]));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sports_feed_providers'
      AND policyname = 'admins_insert_sports_feed_providers'
  ) THEN
    CREATE POLICY "admins_insert_sports_feed_providers"
      ON public.sports_feed_providers
      FOR INSERT
      TO authenticated
      WITH CHECK (has_admin_role(ARRAY['sports_trader'::text, 'admin'::text, 'super_admin'::text]));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sports_feed_providers'
      AND policyname = 'admins_update_sports_feed_providers'
  ) THEN
    CREATE POLICY "admins_update_sports_feed_providers"
      ON public.sports_feed_providers
      FOR UPDATE
      TO authenticated
      USING (has_admin_role(ARRAY['sports_trader'::text, 'admin'::text, 'super_admin'::text]))
      WITH CHECK (has_admin_role(ARRAY['sports_trader'::text, 'admin'::text, 'super_admin'::text]));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sports_feed_providers'
      AND policyname = 'admins_delete_sports_feed_providers'
  ) THEN
    CREATE POLICY "admins_delete_sports_feed_providers"
      ON public.sports_feed_providers
      FOR DELETE
      TO authenticated
      USING (has_admin_role(ARRAY['sports_trader'::text, 'admin'::text, 'super_admin'::text]));
  END IF;
END
$$;

COMMIT;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'sports_feed_providers';

SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'sports_feed_providers'
ORDER BY policyname;

SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'ingest_sports_feed_event';