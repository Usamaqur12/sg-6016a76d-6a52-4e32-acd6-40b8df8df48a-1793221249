BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.wallet_accounts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance NUMERIC(15,2) NOT NULL DEFAULT 10000.00,
  bonus_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'bet_placed', 'bet_won', 'bet_lost', 'bonus_awarded', 'bonus_wagered', 'referral_bonus', 'adjustment')),
  amount NUMERIC(15,2) NOT NULL,
  balance_before NUMERIC(15,2) NOT NULL DEFAULT 0,
  balance_after NUMERIC(15,2) NOT NULL DEFAULT 0,
  description TEXT,
  reference_id UUID,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id UUID NOT NULL REFERENCES public.sports(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  country TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sport_id, slug)
);

CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id UUID NOT NULL REFERENCES public.sports(id) ON DELETE CASCADE,
  league_id UUID REFERENCES public.leagues(id) ON DELETE SET NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'live', 'finished', 'cancelled', 'postponed')),
  live_score_home INTEGER,
  live_score_away INTEGER,
  live_minute INTEGER,
  venue TEXT,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
  provider_event_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('match_result', 'over_under', 'handicap', 'both_teams_score', 'correct_score', 'double_chance', 'draw_no_bet', 'first_half', 'total_goals')),
  line NUMERIC(10,2),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'settled')),
  result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.odds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  selection TEXT NOT NULL,
  value NUMERIC(10,2) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  last_provider_update TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('single', 'multiple', 'system')),
  stake NUMERIC(15,2) NOT NULL CHECK (stake > 0),
  total_odds NUMERIC(10,2) NOT NULL CHECK (total_odds >= 1),
  potential_return NUMERIC(15,2) NOT NULL CHECK (potential_return >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost', 'void', 'cashout', 'cancelled')),
  settled_at TIMESTAMPTZ,
  payout NUMERIC(15,2),
  wallet_transaction_id UUID REFERENCES public.wallet_transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bet_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id UUID NOT NULL REFERENCES public.bets(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id),
  market_id UUID NOT NULL REFERENCES public.markets(id),
  odds_id UUID NOT NULL REFERENCES public.odds(id),
  selection TEXT NOT NULL,
  odds_value NUMERIC(10,2) NOT NULL CHECK (odds_value >= 1),
  result TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('won', 'lost', 'void', 'pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('account', 'betting', 'payments', 'technical', 'other')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_response', 'resolved', 'closed')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assigned_to UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_role TEXT NOT NULL CHECK (author_role IN ('customer', 'staff')),
  message TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 5000),
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('info', 'warning', 'success', 'urgent')),
  priority INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_announcement_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, announcement_id)
);

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  bet_results BOOLEAN NOT NULL DEFAULT TRUE,
  promotions BOOLEAN NOT NULL DEFAULT TRUE,
  account_updates BOOLEAN NOT NULL DEFAULT TRUE,
  live_events BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_created ON public.wallet_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_status_start ON public.events(status, start_time);
CREATE INDEX IF NOT EXISTS idx_markets_event_id ON public.markets(event_id);
CREATE INDEX IF NOT EXISTS idx_odds_market_active ON public.odds(market_id, is_active);
CREATE INDEX IF NOT EXISTS idx_bets_user_created ON public.bets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bet_selections_bet_id ON public.bet_selections(bet_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_created ON public.support_tickets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_created ON public.support_ticket_messages(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_active ON public.announcements(is_active, starts_at DESC);

ALTER TABLE public.wallet_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.odds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bet_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_announcement_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_wallet_account" ON public.wallet_accounts;
CREATE POLICY "select_own_wallet_account" ON public.wallet_accounts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_wallet_account" ON public.wallet_accounts;
CREATE POLICY "update_own_wallet_account" ON public.wallet_accounts
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "select_own_wallet_transactions" ON public.wallet_transactions;
CREATE POLICY "select_own_wallet_transactions" ON public.wallet_transactions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "public_read_sports" ON public.sports;
CREATE POLICY "public_read_sports" ON public.sports
  FOR SELECT TO anon, authenticated
  USING (is_active = TRUE);

DROP POLICY IF EXISTS "public_read_leagues" ON public.leagues;
CREATE POLICY "public_read_leagues" ON public.leagues
  FOR SELECT TO anon, authenticated
  USING (is_active = TRUE);

DROP POLICY IF EXISTS "public_read_events" ON public.events;
CREATE POLICY "public_read_events" ON public.events
  FOR SELECT TO anon, authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "public_read_markets" ON public.markets;
CREATE POLICY "public_read_markets" ON public.markets
  FOR SELECT TO anon, authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "public_read_odds" ON public.odds;
CREATE POLICY "public_read_odds" ON public.odds
  FOR SELECT TO anon, authenticated
  USING (is_active = TRUE);

DROP POLICY IF EXISTS "select_own_bets" ON public.bets;
CREATE POLICY "select_own_bets" ON public.bets
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "select_own_bet_selections" ON public.bet_selections;
CREATE POLICY "select_own_bet_selections" ON public.bet_selections
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bets b
      WHERE b.id = bet_id AND b.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "select_own_support_tickets" ON public.support_tickets;
CREATE POLICY "select_own_support_tickets" ON public.support_tickets
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_support_tickets" ON public.support_tickets;
CREATE POLICY "insert_own_support_tickets" ON public.support_tickets
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_support_tickets" ON public.support_tickets;
CREATE POLICY "update_own_support_tickets" ON public.support_tickets
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "select_own_support_messages" ON public.support_ticket_messages;
CREATE POLICY "select_own_support_messages" ON public.support_ticket_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = ticket_id AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "insert_own_support_messages" ON public.support_ticket_messages;
CREATE POLICY "insert_own_support_messages" ON public.support_ticket_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND author_role = 'customer'
    AND is_internal = FALSE
    AND EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = ticket_id AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "public_read_announcements" ON public.announcements;
CREATE POLICY "public_read_announcements" ON public.announcements
  FOR SELECT TO anon, authenticated
  USING (
    is_active = TRUE
    AND starts_at <= NOW()
    AND (expires_at IS NULL OR expires_at > NOW())
  );

DROP POLICY IF EXISTS "manage_own_announcement_dismissals" ON public.user_announcement_dismissals;
CREATE POLICY "manage_own_announcement_dismissals" ON public.user_announcement_dismissals
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "manage_own_notification_preferences" ON public.notification_preferences;
CREATE POLICY "manage_own_notification_preferences" ON public.notification_preferences
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "select_own_notifications" ON public.notifications;
CREATE POLICY "select_own_notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_notifications" ON public.notifications;
CREATE POLICY "update_own_notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.create_support_ticket(
  p_subject TEXT,
  p_message TEXT,
  p_priority TEXT DEFAULT 'medium',
  p_category TEXT DEFAULT 'other'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_ticket_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO public.support_tickets (user_id, subject, category, priority, message)
  VALUES (v_user_id, btrim(p_subject), p_category, p_priority, btrim(p_message))
  RETURNING id INTO v_ticket_id;

  INSERT INTO public.support_ticket_messages (ticket_id, author_id, author_role, message)
  VALUES (v_ticket_id, v_user_id, 'customer', btrim(p_message));

  RETURN v_ticket_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_support_ticket(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.reply_support_ticket(
  p_ticket_id UUID,
  p_message TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_message_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.support_tickets
    WHERE id = p_ticket_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  INSERT INTO public.support_ticket_messages (ticket_id, author_id, author_role, message)
  VALUES (p_ticket_id, v_user_id, 'customer', btrim(p_message))
  RETURNING id INTO v_message_id;

  UPDATE public.support_tickets
  SET status = 'waiting_response',
      updated_at = NOW()
  WHERE id = p_ticket_id AND user_id = v_user_id;

  RETURN v_message_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reply_support_ticket(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reply_support_ticket(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_support_ticket(
  p_ticket_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.support_tickets
  SET status = 'closed',
      updated_at = NOW()
  WHERE id = p_ticket_id AND user_id = v_user_id;

  RETURN p_ticket_id;
END;
$$;

REVOKE ALL ON FUNCTION public.close_support_ticket(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_support_ticket(UUID) TO authenticated;

INSERT INTO public.wallet_accounts (user_id)
SELECT id
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.notification_preferences (user_id)
SELECT id
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.sports (name, slug, icon, display_order, is_active)
SELECT 'Football', 'football', 'Trophy', 1, TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.sports WHERE slug = 'football');

INSERT INTO public.sports (name, slug, icon, display_order, is_active)
SELECT 'Cricket', 'cricket', 'Activity', 2, TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.sports WHERE slug = 'cricket');

WITH football AS (
  SELECT id FROM public.sports WHERE slug = 'football' LIMIT 1
)
INSERT INTO public.leagues (sport_id, name, slug, country, display_order, is_active)
SELECT football.id, 'Premier League', 'premier-league', 'England', 1, TRUE
FROM football
WHERE NOT EXISTS (
  SELECT 1 FROM public.leagues WHERE slug = 'premier-league'
);

WITH football AS (
  SELECT id FROM public.sports WHERE slug = 'football' LIMIT 1
), league AS (
  SELECT id FROM public.leagues WHERE slug = 'premier-league' LIMIT 1
)
INSERT INTO public.events (sport_id, league_id, home_team, away_team, start_time, status, is_featured)
SELECT football.id, league.id, 'Manchester City', 'Liverpool', NOW() + INTERVAL '2 hours', 'upcoming', TRUE
FROM football, league
WHERE NOT EXISTS (
  SELECT 1 FROM public.events WHERE home_team = 'Manchester City' AND away_team = 'Liverpool'
);

WITH event_row AS (
  SELECT id FROM public.events WHERE home_team = 'Manchester City' AND away_team = 'Liverpool' LIMIT 1
)
INSERT INTO public.markets (event_id, name, type, status)
SELECT event_row.id, 'Match Result', 'match_result', 'active'
FROM event_row
WHERE NOT EXISTS (
  SELECT 1 FROM public.markets WHERE event_id = event_row.id AND name = 'Match Result'
);

WITH market_row AS (
  SELECT m.id
  FROM public.markets m
  JOIN public.events e ON e.id = m.event_id
  WHERE e.home_team = 'Manchester City' AND e.away_team = 'Liverpool' AND m.name = 'Match Result'
  LIMIT 1
)
INSERT INTO public.odds (market_id, selection, value, is_active, is_locked)
SELECT market_row.id, values_row.selection, values_row.value, TRUE, FALSE
FROM market_row,
LATERAL (
  VALUES
    ('Manchester City', 1.95::NUMERIC),
    ('Draw', 3.45::NUMERIC),
    ('Liverpool', 3.75::NUMERIC)
) AS values_row(selection, value)
WHERE NOT EXISTS (
  SELECT 1 FROM public.odds o WHERE o.market_id = market_row.id AND o.selection = values_row.selection
);

INSERT INTO public.announcements (title, message, type, priority, is_active)
SELECT 'Welcome to PrimeBet', 'Your Supabase data layer is now active for support, notifications, and live odds.', 'success', 10, TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.announcements WHERE title = 'Welcome to PrimeBet'
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.markets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.odds;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_ticket_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

COMMIT;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'wallet_accounts',
    'wallet_transactions',
    'sports',
    'leagues',
    'events',
    'markets',
    'odds',
    'bets',
    'bet_selections',
    'support_tickets',
    'support_ticket_messages',
    'announcements',
    'user_announcement_dismissals',
    'notification_preferences',
    'notifications'
  )
ORDER BY table_name;