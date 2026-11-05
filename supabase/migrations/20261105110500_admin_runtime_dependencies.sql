-- Minimal, non-destructive runtime dependencies for admin casino/revenue pages.
-- This intentionally does not modify wallet constraints or insert demo providers.

BEGIN;

CREATE TABLE IF NOT EXISTS public.casino_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  settings JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'not_tested'
    CHECK (status IN ('not_tested','healthy','degraded','offline')),
  last_health_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.casino_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES public.casino_providers(id) ON DELETE CASCADE,
  external_game_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL
    CHECK (category IN ('slots','live','table','jackpot','instant','other')),
  thumbnail_url TEXT,
  is_popular BOOLEAN NOT NULL DEFAULT FALSE,
  is_new BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider_id, external_game_id)
);

CREATE TABLE IF NOT EXISTS public.casino_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES public.casino_providers(id) ON DELETE RESTRICT,
  game_id UUID NOT NULL REFERENCES public.casino_games(id) ON DELETE RESTRICT,
  provider_session_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating','active','closed','failed')),
  currency TEXT NOT NULL DEFAULT 'USD',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.casino_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES public.casino_providers(id) ON DELETE RESTRICT,
  session_id UUID NOT NULL REFERENCES public.casino_sessions(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  game_id UUID NOT NULL REFERENCES public.casino_games(id) ON DELETE RESTRICT,
  provider_event_id TEXT NOT NULL,
  provider_round_id TEXT,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('bet','win','refund')),
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  balance_after NUMERIC(15,2) NOT NULL,
  payload_hash TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider_id, provider_event_id)
);

CREATE INDEX IF NOT EXISTS casino_sessions_user_idx
  ON public.casino_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS casino_transactions_user_idx
  ON public.casino_transactions(user_id, created_at DESC);

ALTER TABLE public.casino_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casino_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casino_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casino_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public reads active casino games" ON public.casino_games;
CREATE POLICY "Public reads active casino games"
  ON public.casino_games FOR SELECT USING (is_active = TRUE);

DROP POLICY IF EXISTS "Public reads enabled casino providers" ON public.casino_providers;
CREATE POLICY "Public reads enabled casino providers"
  ON public.casino_providers FOR SELECT USING (is_enabled = TRUE);

DROP POLICY IF EXISTS "Admins manage casino providers" ON public.casino_providers;
CREATE POLICY "Admins manage casino providers"
  ON public.casino_providers FOR ALL TO authenticated
  USING (public.has_admin_role(NULL))
  WITH CHECK (public.has_admin_role(NULL));

DROP POLICY IF EXISTS "Admins manage casino games" ON public.casino_games;
CREATE POLICY "Admins manage casino games"
  ON public.casino_games FOR ALL TO authenticated
  USING (public.has_admin_role(NULL))
  WITH CHECK (public.has_admin_role(NULL));

DROP POLICY IF EXISTS "Users read own casino sessions" ON public.casino_sessions;
CREATE POLICY "Users read own casino sessions"
  ON public.casino_sessions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users read own casino transactions" ON public.casino_transactions;
CREATE POLICY "Users read own casino transactions"
  ON public.casino_transactions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.casino_providers, public.casino_games,
  public.casino_sessions, public.casino_transactions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.casino_providers, public.casino_games TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.casino_providers, public.casino_games TO authenticated;
GRANT SELECT ON public.casino_sessions, public.casino_transactions TO authenticated;

COMMIT;
