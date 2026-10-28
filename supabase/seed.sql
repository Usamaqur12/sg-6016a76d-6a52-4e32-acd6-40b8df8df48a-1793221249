-- Approved play-money fixtures for local/staging demo environments only.
-- This file is intentionally separate from migrations and must not be loaded
-- into a real-money production project.

INSERT INTO public.sports (id, name, slug, icon, display_order, is_active)
VALUES
  ('10000000-0000-0000-0000-000000000001', 'Football', 'football', 'football', 1, TRUE),
  ('10000000-0000-0000-0000-000000000002', 'Cricket', 'cricket', 'cricket', 2, TRUE),
  ('10000000-0000-0000-0000-000000000003', 'Esports', 'esports', 'gamepad', 3, TRUE)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  is_active = TRUE;

INSERT INTO public.leagues (id, sport_id, name, slug, country, display_order, is_active)
VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Demo Premier League', 'demo-premier-league', 'International', 1, TRUE),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Demo T20 Series', 'demo-t20-series', 'International', 1, TRUE),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'Demo Championship', 'demo-championship', 'International', 1, TRUE)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  is_active = TRUE;

INSERT INTO public.events (
  id, sport_id, league_id, home_team, away_team, start_time, status,
  live_score_home, live_score_away, live_minute, is_featured,
  is_suspended, provider_id, provider_event_id
)
VALUES
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'North City', 'River United', NOW() + INTERVAL '2 hours', 'upcoming', NULL, NULL, NULL, TRUE, FALSE, 'demo', 'demo-football-1'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Capital FC', 'Coastal Athletic', NOW() + INTERVAL '5 hours', 'upcoming', NULL, NULL, NULL, TRUE, FALSE, 'demo', 'demo-football-2'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Falcons XI', 'Titans XI', NOW() + INTERVAL '1 day', 'upcoming', NULL, NULL, NULL, TRUE, FALSE, 'demo', 'demo-cricket-1'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'Nova', 'Vertex', NOW() + INTERVAL '8 hours', 'upcoming', NULL, NULL, NULL, TRUE, FALSE, 'demo', 'demo-esports-1')
ON CONFLICT (id) DO UPDATE SET
  start_time = EXCLUDED.start_time,
  status = EXCLUDED.status,
  live_score_home = EXCLUDED.live_score_home,
  live_score_away = EXCLUDED.live_score_away,
  live_minute = EXCLUDED.live_minute,
  is_suspended = FALSE,
  updated_at = NOW();

INSERT INTO public.markets (id, event_id, name, type, status)
VALUES
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Match Result', 'match_result', 'active'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'Match Result', 'match_result', 'active'),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 'Match Winner', 'match_result', 'active'),
  ('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000004', 'Match Winner', 'match_result', 'active')
ON CONFLICT (id) DO UPDATE SET status = 'active', settled_at = NULL, result = NULL;

INSERT INTO public.odds (id, market_id, selection, value, is_active, is_locked, provider_id, provider_odds, last_provider_update)
VALUES
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Home', 2.10, TRUE, FALSE, 'demo', 2.10, NOW()),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 'Draw', 3.40, TRUE, FALSE, 'demo', 3.40, NOW()),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', 'Away', 3.25, TRUE, FALSE, 'demo', 3.25, NOW()),
  ('50000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000002', 'Home', 1.82, TRUE, FALSE, 'demo', 1.82, NOW()),
  ('50000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000002', 'Draw', 3.65, TRUE, FALSE, 'demo', 3.65, NOW()),
  ('50000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000002', 'Away', 4.10, TRUE, FALSE, 'demo', 4.10, NOW()),
  ('50000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000003', 'Home', 1.72, TRUE, FALSE, 'demo', 1.72, NOW()),
  ('50000000-0000-0000-0000-000000000008', '40000000-0000-0000-0000-000000000003', 'Away', 2.18, TRUE, FALSE, 'demo', 2.18, NOW()),
  ('50000000-0000-0000-0000-000000000009', '40000000-0000-0000-0000-000000000004', 'Home', 1.90, TRUE, FALSE, 'demo', 1.90, NOW()),
  ('50000000-0000-0000-0000-000000000010', '40000000-0000-0000-0000-000000000004', 'Away', 2.00, TRUE, FALSE, 'demo', 2.00, NOW())
ON CONFLICT (id) DO UPDATE SET
  value = EXCLUDED.value,
  is_active = TRUE,
  is_locked = FALSE,
  provider_odds = EXCLUDED.provider_odds,
  last_provider_update = NOW(),
  updated_at = NOW();

INSERT INTO public.promotions (
  id,title,description,type,bonus_amount,wagering_requirement,max_bonus,
  valid_from,valid_until,terms_and_conditions,is_active,promo_code,
  per_user_claim_limit,total_claim_limit,expires_after_days,min_odds,min_legs,
  loyalty_points_reward,requires_qualifying_deposit
)
VALUES (
  '60000000-0000-0000-0000-000000000001','Prime Demo Welcome',
  'Claim $100 in play-money bonus credits and complete the wagering target.',
  'welcome_bonus',100,5,100,NOW()-INTERVAL '1 day',NOW()+INTERVAL '90 days',
  'Demo credits only. One claim per account. Minimum qualifying odds 1.50.',
  TRUE,'PRIME100',1,10000,30,1.50,1,100,FALSE
)
ON CONFLICT (id) DO UPDATE SET
  title=EXCLUDED.title,description=EXCLUDED.description,bonus_amount=EXCLUDED.bonus_amount,
  wagering_requirement=EXCLUDED.wagering_requirement,valid_from=EXCLUDED.valid_from,
  valid_until=EXCLUDED.valid_until,is_active=TRUE,promo_code=EXCLUDED.promo_code,
  min_odds=EXCLUDED.min_odds,expires_after_days=EXCLUDED.expires_after_days,
  updated_at=NOW();

-- Demo wallet seed - starting with $0 balance
INSERT INTO wallet_accounts (user_id, balance, currency) 
VALUES ('00000000-0000-0000-0000-000000000001', 0.00, 'USD')
ON CONFLICT (user_id) DO NOTHING;
