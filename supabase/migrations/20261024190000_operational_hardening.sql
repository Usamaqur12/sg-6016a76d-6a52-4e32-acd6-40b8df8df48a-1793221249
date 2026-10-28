-- Operational hardening: observable errors and provider-neutral casino ledger.
-- Casino remains disabled until a licensed aggregator and compliance approvals exist.

CREATE TABLE IF NOT EXISTS public.error_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fingerprint TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('browser','api','worker','provider')),
  severity TEXT NOT NULL DEFAULT 'error' CHECK (severity IN ('warning','error','fatal')),
  message TEXT NOT NULL,
  route TEXT,
  stack TEXT,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  context JSONB NOT NULL DEFAULT '{}'::JSONB,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS error_events_created_idx ON public.error_events(created_at DESC);
CREATE INDEX IF NOT EXISTS error_events_fingerprint_idx ON public.error_events(fingerprint,created_at DESC);
ALTER TABLE public.error_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Monitoring admins read error events" ON public.error_events;
CREATE POLICY "Monitoring admins read error events" ON public.error_events FOR SELECT TO authenticated
USING (public.has_admin_role(ARRAY[]::TEXT[]));
REVOKE ALL ON public.error_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.error_events TO authenticated;

CREATE TABLE IF NOT EXISTS public.casino_providers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  is_demo BOOLEAN NOT NULL DEFAULT TRUE,
  settings JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'not_tested' CHECK (status IN ('not_tested','healthy','degraded','offline')),
  last_health_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.casino_games (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id UUID NOT NULL REFERENCES public.casino_providers(id) ON DELETE CASCADE,
  external_game_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('slots','live','table','jackpot','instant','other')),
  thumbnail_url TEXT,
  is_popular BOOLEAN NOT NULL DEFAULT FALSE,
  is_new BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider_id,external_game_id)
);

CREATE TABLE IF NOT EXISTS public.casino_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES public.casino_providers(id) ON DELETE RESTRICT,
  game_id UUID NOT NULL REFERENCES public.casino_games(id) ON DELETE RESTRICT,
  provider_session_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'creating' CHECK (status IN ('creating','active','closed','failed')),
  currency TEXT NOT NULL DEFAULT 'USD',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS casino_sessions_user_idx ON public.casino_sessions(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.casino_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
  UNIQUE(provider_id,provider_event_id)
);
CREATE INDEX IF NOT EXISTS casino_transactions_user_idx ON public.casino_transactions(user_id,created_at DESC);

ALTER TABLE public.casino_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casino_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casino_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casino_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public reads active casino games" ON public.casino_games;
CREATE POLICY "Public reads active casino games" ON public.casino_games FOR SELECT USING (is_active=TRUE);
DROP POLICY IF EXISTS "Public reads enabled casino providers" ON public.casino_providers;
CREATE POLICY "Public reads enabled casino providers" ON public.casino_providers FOR SELECT USING (is_enabled=TRUE);
DROP POLICY IF EXISTS "Admins manage casino providers" ON public.casino_providers;
CREATE POLICY "Admins manage casino providers" ON public.casino_providers FOR ALL TO authenticated USING (public.has_admin_role(NULL)) WITH CHECK (public.has_admin_role(NULL));
DROP POLICY IF EXISTS "Admins manage casino games" ON public.casino_games;
CREATE POLICY "Admins manage casino games" ON public.casino_games FOR ALL TO authenticated USING (public.has_admin_role(NULL)) WITH CHECK (public.has_admin_role(NULL));
DROP POLICY IF EXISTS "Users read own casino sessions" ON public.casino_sessions;
CREATE POLICY "Users read own casino sessions" ON public.casino_sessions FOR SELECT TO authenticated USING (user_id=auth.uid());
DROP POLICY IF EXISTS "Users read own casino transactions" ON public.casino_transactions;
CREATE POLICY "Users read own casino transactions" ON public.casino_transactions FOR SELECT TO authenticated USING (user_id=auth.uid());

ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_type_check CHECK (
  type IN ('deposit','withdrawal','bet_placed','bet_won','bet_lost','bonus_awarded','bonus_wagered','referral_bonus','adjustment','casino_bet','casino_win','casino_refund')
);

CREATE OR REPLACE FUNCTION public.apply_casino_transaction(
  p_provider_code TEXT,p_session_id UUID,p_provider_event_id TEXT,p_provider_round_id TEXT,
  p_transaction_type TEXT,p_amount NUMERIC,p_currency TEXT,p_payload_hash TEXT,p_metadata JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_provider UUID; v_user UUID; v_game UUID; v_balance NUMERIC; v_before NUMERIC;
  v_transaction UUID; v_wallet_type TEXT; v_signed_amount NUMERIC;
BEGIN
  IF p_transaction_type NOT IN ('bet','win','refund') OR p_amount<=0 OR UPPER(p_currency)<>'USD' THEN
    RAISE EXCEPTION 'Invalid casino transaction';
  END IF;
  SELECT id INTO v_provider FROM public.casino_providers WHERE code=p_provider_code AND is_enabled=TRUE FOR UPDATE;
  IF v_provider IS NULL THEN RAISE EXCEPTION 'Casino provider is unavailable'; END IF;
  SELECT user_id,game_id INTO v_user,v_game FROM public.casino_sessions
  WHERE id=p_session_id AND provider_id=v_provider AND status='active' FOR UPDATE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'Casino session is unavailable'; END IF;
  SELECT id,balance_after INTO v_transaction,v_balance FROM public.casino_transactions
  WHERE provider_id=v_provider AND provider_event_id=p_provider_event_id;
  IF v_transaction IS NOT NULL THEN RETURN jsonb_build_object('transaction_id',v_transaction,'balance',v_balance,'replayed',TRUE); END IF;

  SELECT demo_balance INTO v_before FROM public.profiles WHERE id=v_user FOR UPDATE;
  IF p_transaction_type='bet' AND v_before<p_amount THEN RAISE EXCEPTION 'Insufficient wallet balance'; END IF;
  v_signed_amount:=CASE WHEN p_transaction_type='bet' THEN -p_amount ELSE p_amount END;
  v_balance:=v_before+v_signed_amount;
  v_wallet_type:=CASE p_transaction_type WHEN 'bet' THEN 'casino_bet' WHEN 'win' THEN 'casino_win' ELSE 'casino_refund' END;

  INSERT INTO public.casino_transactions(provider_id,session_id,user_id,game_id,provider_event_id,provider_round_id,transaction_type,amount,currency,balance_after,payload_hash,metadata)
  VALUES(v_provider,p_session_id,v_user,v_game,p_provider_event_id,p_provider_round_id,p_transaction_type,p_amount,'USD',v_balance,p_payload_hash,COALESCE(p_metadata,'{}'::JSONB))
  RETURNING id INTO v_transaction;
  UPDATE public.profiles SET demo_balance=v_balance,updated_at=NOW() WHERE id=v_user;
  INSERT INTO public.wallet_transactions(user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata)
  VALUES(v_user,v_wallet_type,v_signed_amount,v_before,v_balance,'Casino '||p_transaction_type,v_transaction,'completed',jsonb_build_object('provider',p_provider_code,'round_id',p_provider_round_id));
  RETURN jsonb_build_object('transaction_id',v_transaction,'balance',v_balance,'replayed',FALSE);
END;
$$;

REVOKE ALL ON public.casino_providers,public.casino_games,public.casino_sessions,public.casino_transactions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.casino_providers,public.casino_games TO anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.casino_providers,public.casino_games TO authenticated;
GRANT SELECT ON public.casino_sessions,public.casino_transactions TO authenticated;
REVOKE ALL ON FUNCTION public.apply_casino_transaction(TEXT,UUID,TEXT,TEXT,TEXT,NUMERIC,TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated;

INSERT INTO public.casino_providers(code,name,is_enabled,is_demo,status)
VALUES('demo','PrimeBet Demo Casino',FALSE,TRUE,'not_tested') ON CONFLICT(code) DO NOTHING;
