-- Product experience upgrades: feature flags, maintenance control, withdrawal
-- address cooling, provider match statistics, missions and public leaderboard.

CREATE TABLE IF NOT EXISTS public.feature_flags (
  key TEXT PRIMARY KEY CHECK (key ~ '^[a-z0-9_]+$'),
  name TEXT NOT NULL,
  description TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_by UUID REFERENCES public.profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_feature_flags" ON public.feature_flags FOR SELECT TO anon,authenticated USING (TRUE);
GRANT SELECT ON public.feature_flags TO anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.feature_flags FROM PUBLIC,anon,authenticated;
INSERT INTO public.feature_flags(key,name,description,is_enabled,config) VALUES
  ('maintenance_mode','Maintenance mode','Show a controlled maintenance screen to customers',FALSE,'{"message":"PrimeBet is receiving an upgrade. Please check back shortly."}'),
  ('missions','Missions','Enable customer missions and loyalty rewards',TRUE,'{}'),
  ('leaderboards','Leaderboards','Enable the anonymized weekly leaderboard',TRUE,'{}'),
  ('match_statistics','Match statistics','Display provider-supplied match statistics and lineups',TRUE,'{}'),
  ('withdrawal_address_whitelist','Withdrawal address whitelist','Require a cooled-down saved payout destination',TRUE,'{"cooldown_hours":24}'),
  ('web_push','Browser push','Allow browser push enrollment after a provider is configured',FALSE,'{}'),
  ('telegram_notifications','Telegram notifications','Allow Telegram delivery after bot credentials are configured',FALSE,'{}')
ON CONFLICT(key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.save_feature_flag(p_key TEXT,p_enabled BOOLEAN,p_config JSONB DEFAULT '{}'::JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_admin() OR COALESCE(auth.jwt()->>'aal','aal1')<>'aal2' THEN RAISE EXCEPTION 'Admin AAL2 authorization required'; END IF;
  UPDATE public.feature_flags SET is_enabled=p_enabled,config=COALESCE(p_config,'{}'::JSONB),updated_by=auth.uid(),updated_at=NOW() WHERE key=p_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'Feature flag not found'; END IF;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes) VALUES(auth.uid(),'feature_flag_updated','feature_flag',NULL,jsonb_build_object('key',p_key,'enabled',p_enabled,'config',p_config));
END; $$;

CREATE TABLE IF NOT EXISTS public.withdrawal_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  payment_method_id UUID NOT NULL REFERENCES public.payment_methods(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  destination_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','blocked')),
  activates_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id,payment_method_id,destination_reference)
);
ALTER TABLE public.withdrawal_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_read_own_withdrawal_addresses" ON public.withdrawal_addresses FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY "finance_read_withdrawal_addresses" ON public.withdrawal_addresses FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['finance']));
GRANT SELECT ON public.withdrawal_addresses TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.withdrawal_addresses FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.add_my_withdrawal_address(p_payment_method_id UUID,p_label TEXT,p_destination TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID; v_hours INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF length(trim(COALESCE(p_label,'')))<2 OR length(trim(COALESCE(p_destination,'')))<6 THEN RAISE EXCEPTION 'A label and valid destination are required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.payment_methods WHERE id=p_payment_method_id AND is_enabled=TRUE AND archived_at IS NULL AND method_type<>'provider') THEN RAISE EXCEPTION 'Payment method is unavailable'; END IF;
  SELECT COALESCE((config->>'cooldown_hours')::INTEGER,24) INTO v_hours FROM public.feature_flags WHERE key='withdrawal_address_whitelist';
  INSERT INTO public.withdrawal_addresses(user_id,payment_method_id,label,destination_reference,activates_at)
  VALUES(auth.uid(),p_payment_method_id,trim(p_label),trim(p_destination),NOW()+make_interval(hours=>GREATEST(COALESCE(v_hours,24),0)))
  ON CONFLICT(user_id,payment_method_id,destination_reference) DO UPDATE SET label=EXCLUDED.label,status='pending',activates_at=EXCLUDED.activates_at,updated_at=NOW()
  RETURNING id INTO v_id;
  INSERT INTO public.notifications(user_id,type,title,message,metadata) VALUES(auth.uid(),'withdrawal_address_added','New payout destination','A new payout destination was added and is in its security cooling period.',jsonb_build_object('address_id',v_id,'activates_at',NOW()+make_interval(hours=>GREATEST(COALESCE(v_hours,24),0))));
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.remove_my_withdrawal_address(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  DELETE FROM public.withdrawal_addresses WHERE id=p_id AND user_id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Payout destination not found'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.validate_manual_withdrawal_destination()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_enabled BOOLEAN;
BEGIN
  SELECT is_enabled INTO v_enabled FROM public.feature_flags WHERE key='withdrawal_address_whitelist';
  IF COALESCE(v_enabled,FALSE) AND NOT EXISTS(
    SELECT 1 FROM public.withdrawal_addresses a WHERE a.user_id=NEW.user_id AND a.payment_method_id=NEW.payment_method_id
      AND a.destination_reference=NEW.destination_reference AND a.status<>'blocked' AND a.activates_at<=NOW()
  ) THEN RAISE EXCEPTION 'Use an active saved payout destination. New destinations have a security cooling period'; END IF;
  UPDATE public.withdrawal_addresses SET status='active',last_used_at=NOW(),updated_at=NOW()
  WHERE user_id=NEW.user_id AND payment_method_id=NEW.payment_method_id AND destination_reference=NEW.destination_reference AND activates_at<=NOW() AND status<>'blocked';
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_manual_withdrawal_destination_trigger ON public.manual_withdrawal_requests;
CREATE TRIGGER validate_manual_withdrawal_destination_trigger BEFORE INSERT ON public.manual_withdrawal_requests FOR EACH ROW EXECUTE FUNCTION public.validate_manual_withdrawal_destination();

CREATE TABLE IF NOT EXISTS public.event_statistics (
  event_id UUID PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  possession_home NUMERIC(5,2), possession_away NUMERIC(5,2),
  shots_home INTEGER, shots_away INTEGER, shots_on_target_home INTEGER, shots_on_target_away INTEGER,
  corners_home INTEGER, corners_away INTEGER, fouls_home INTEGER, fouls_away INTEGER,
  yellow_cards_home INTEGER, yellow_cards_away INTEGER, red_cards_home INTEGER, red_cards_away INTEGER,
  provider_id TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.event_lineups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  team_side TEXT NOT NULL CHECK(team_side IN ('home','away')), formation TEXT, coach TEXT, players JSONB NOT NULL DEFAULT '[]'::JSONB,
  provider_id TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(event_id,team_side)
);
ALTER TABLE public.event_statistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_lineups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_event_statistics" ON public.event_statistics FOR SELECT TO anon,authenticated USING(TRUE);
CREATE POLICY "public_read_event_lineups" ON public.event_lineups FOR SELECT TO anon,authenticated USING(TRUE);
GRANT SELECT ON public.event_statistics,public.event_lineups TO anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.event_statistics,public.event_lineups FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.capture_feed_match_details()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_stats JSONB:=NEW.payload->'statistics'; v_lineups JSONB:=NEW.payload->'lineups';
BEGIN
  IF NEW.event_id IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(v_stats)='object' THEN
    INSERT INTO public.event_statistics(event_id,possession_home,possession_away,shots_home,shots_away,shots_on_target_home,shots_on_target_away,corners_home,corners_away,fouls_home,fouls_away,yellow_cards_home,yellow_cards_away,red_cards_home,red_cards_away,provider_id)
    VALUES(NEW.event_id,NULLIF(v_stats->>'possession_home','')::NUMERIC,NULLIF(v_stats->>'possession_away','')::NUMERIC,NULLIF(v_stats->>'shots_home','')::INTEGER,NULLIF(v_stats->>'shots_away','')::INTEGER,NULLIF(v_stats->>'shots_on_target_home','')::INTEGER,NULLIF(v_stats->>'shots_on_target_away','')::INTEGER,NULLIF(v_stats->>'corners_home','')::INTEGER,NULLIF(v_stats->>'corners_away','')::INTEGER,NULLIF(v_stats->>'fouls_home','')::INTEGER,NULLIF(v_stats->>'fouls_away','')::INTEGER,NULLIF(v_stats->>'yellow_cards_home','')::INTEGER,NULLIF(v_stats->>'yellow_cards_away','')::INTEGER,NULLIF(v_stats->>'red_cards_home','')::INTEGER,NULLIF(v_stats->>'red_cards_away','')::INTEGER,NEW.provider_id)
    ON CONFLICT(event_id) DO UPDATE SET possession_home=EXCLUDED.possession_home,possession_away=EXCLUDED.possession_away,shots_home=EXCLUDED.shots_home,shots_away=EXCLUDED.shots_away,shots_on_target_home=EXCLUDED.shots_on_target_home,shots_on_target_away=EXCLUDED.shots_on_target_away,corners_home=EXCLUDED.corners_home,corners_away=EXCLUDED.corners_away,fouls_home=EXCLUDED.fouls_home,fouls_away=EXCLUDED.fouls_away,yellow_cards_home=EXCLUDED.yellow_cards_home,yellow_cards_away=EXCLUDED.yellow_cards_away,red_cards_home=EXCLUDED.red_cards_home,red_cards_away=EXCLUDED.red_cards_away,provider_id=EXCLUDED.provider_id,updated_at=NOW();
  END IF;
  IF jsonb_typeof(v_lineups)='object' THEN
    INSERT INTO public.event_lineups(event_id,team_side,formation,coach,players,provider_id) VALUES
      (NEW.event_id,'home',v_lineups->'home'->>'formation',v_lineups->'home'->>'coach',COALESCE(v_lineups->'home'->'players','[]'::JSONB),NEW.provider_id),
      (NEW.event_id,'away',v_lineups->'away'->>'formation',v_lineups->'away'->>'coach',COALESCE(v_lineups->'away'->'players','[]'::JSONB),NEW.provider_id)
    ON CONFLICT(event_id,team_side) DO UPDATE SET formation=EXCLUDED.formation,coach=EXCLUDED.coach,players=EXCLUDED.players,provider_id=EXCLUDED.provider_id,updated_at=NOW();
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS capture_feed_match_details_trigger ON public.feed_updates;
CREATE TRIGGER capture_feed_match_details_trigger AFTER INSERT ON public.feed_updates FOR EACH ROW EXECUTE FUNCTION public.capture_feed_match_details();

CREATE TABLE IF NOT EXISTS public.missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), title TEXT NOT NULL, description TEXT NOT NULL,
  metric TEXT NOT NULL CHECK(metric IN ('bets_placed','settled_wins','total_stake')), target_value NUMERIC NOT NULL CHECK(target_value>0),
  reward_points INTEGER NOT NULL CHECK(reward_points>0), starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CHECK(ends_at>starts_at)
);
CREATE TABLE IF NOT EXISTS public.mission_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), mission_id UUID NOT NULL REFERENCES public.missions(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, progress_at_claim NUMERIC NOT NULL,
  reward_points INTEGER NOT NULL, claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(mission_id,user_id)
);
ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.mission_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_active_missions" ON public.missions FOR SELECT TO anon,authenticated USING(is_enabled=TRUE);
CREATE POLICY "users_read_own_mission_claims" ON public.mission_claims FOR SELECT TO authenticated USING(user_id=auth.uid());
GRANT SELECT ON public.missions TO anon,authenticated; GRANT SELECT ON public.mission_claims TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.missions,public.mission_claims FROM PUBLIC,anon,authenticated;
INSERT INTO public.missions(title,description,metric,target_value,reward_points,starts_at,ends_at) VALUES
  ('First Steps','Place 3 sportsbook bets','bets_placed',3,100,date_trunc('week',NOW()),date_trunc('week',NOW())+INTERVAL '7 days'),
  ('Winning Form','Settle 2 winning bets','settled_wins',2,250,date_trunc('week',NOW()),date_trunc('week',NOW())+INTERVAL '7 days'),
  ('Weekend Action','Place 250 demo credits in total stake','total_stake',250,400,date_trunc('week',NOW()),date_trunc('week',NOW())+INTERVAL '7 days')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.mission_progress(p_mission public.missions,p_user UUID)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_progress NUMERIC;
BEGIN
  IF p_mission.metric='bets_placed' THEN SELECT COUNT(*) INTO v_progress FROM public.bets WHERE user_id=p_user AND created_at BETWEEN p_mission.starts_at AND p_mission.ends_at;
  ELSIF p_mission.metric='settled_wins' THEN SELECT COUNT(*) INTO v_progress FROM public.bets WHERE user_id=p_user AND status='won' AND settled_at BETWEEN p_mission.starts_at AND p_mission.ends_at;
  ELSE SELECT COALESCE(SUM(stake),0) INTO v_progress FROM public.bets WHERE user_id=p_user AND created_at BETWEEN p_mission.starts_at AND p_mission.ends_at; END IF;
  RETURN COALESCE(v_progress,0);
END; $$;

CREATE OR REPLACE FUNCTION public.get_my_missions()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',m.id,'name',m.title,'description',m.description,'metric',m.metric,'target_value',m.target_value,'progress',LEAST(public.mission_progress(m,auth.uid()),m.target_value),'reward_points',m.reward_points,'ends_at',m.ends_at,'completed',public.mission_progress(m,auth.uid())>=m.target_value,'claimed',c.id IS NOT NULL) ORDER BY m.ends_at,m.reward_points),'[]'::JSONB)
  FROM public.missions m LEFT JOIN public.mission_claims c ON c.mission_id=m.id AND c.user_id=auth.uid()
  WHERE m.is_enabled=TRUE AND NOW() BETWEEN m.starts_at AND m.ends_at;
$$;

CREATE OR REPLACE FUNCTION public.claim_mission_reward(p_mission_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_mission public.missions%ROWTYPE; v_progress NUMERIC; v_points BIGINT; v_tier TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_mission FROM public.missions WHERE id=p_mission_id AND is_enabled=TRUE AND NOW() BETWEEN starts_at AND ends_at FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mission is unavailable'; END IF;
  v_progress:=public.mission_progress(v_mission,auth.uid()); IF v_progress<v_mission.target_value THEN RAISE EXCEPTION 'Mission is not complete'; END IF;
  INSERT INTO public.mission_claims(mission_id,user_id,progress_at_claim,reward_points) VALUES(p_mission_id,auth.uid(),v_progress,v_mission.reward_points);
  INSERT INTO public.loyalty_accounts(user_id,points,lifetime_points) VALUES(auth.uid(),v_mission.reward_points,v_mission.reward_points)
  ON CONFLICT(user_id) DO UPDATE SET points=public.loyalty_accounts.points+EXCLUDED.points,lifetime_points=public.loyalty_accounts.lifetime_points+EXCLUDED.lifetime_points,updated_at=NOW();
  SELECT points,tier INTO v_points,v_tier FROM public.loyalty_accounts WHERE user_id=auth.uid();
  INSERT INTO public.notifications(user_id,type,title,message,metadata) VALUES(auth.uid(),'mission_reward','Mission reward claimed','Loyalty points were added to your account.',jsonb_build_object('mission_id',p_mission_id,'points',v_mission.reward_points));
  RETURN jsonb_build_object('success',TRUE,'points_awarded',v_mission.reward_points,'total_points',v_points,'tier',v_tier);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Mission reward was already claimed';
END; $$;

CREATE OR REPLACE FUNCTION public.get_public_leaderboard(p_limit INTEGER DEFAULT 20)
RETURNS TABLE(rank BIGINT,display_name TEXT,points BIGINT,tier TEXT,is_current BOOLEAN) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH ranked AS (
    SELECT l.user_id,l.points,l.tier,left(COALESCE(NULLIF(p.username,''),NULLIF(p.full_name,''),split_part(p.email,'@',1)),2)||'***' display_name
    FROM public.loyalty_accounts l JOIN public.profiles p ON p.id=l.user_id WHERE COALESCE(p.is_admin,FALSE)=FALSE
  ) SELECT row_number() OVER(ORDER BY points DESC,user_id),display_name,points,tier,user_id=auth.uid()
  FROM ranked ORDER BY points DESC,user_id LIMIT LEAST(GREATEST(p_limit,1),100);
$$;

REVOKE ALL ON FUNCTION public.save_feature_flag(TEXT,BOOLEAN,JSONB) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.save_feature_flag(TEXT,BOOLEAN,JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.add_my_withdrawal_address(UUID,TEXT,TEXT) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.add_my_withdrawal_address(UUID,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.remove_my_withdrawal_address(UUID) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.remove_my_withdrawal_address(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_missions() FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.get_my_missions() TO authenticated;
REVOKE ALL ON FUNCTION public.claim_mission_reward(UUID) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.claim_mission_reward(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.get_public_leaderboard(INTEGER) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.get_public_leaderboard(INTEGER) TO anon,authenticated;
REVOKE ALL ON FUNCTION public.validate_manual_withdrawal_destination() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.capture_feed_match_details() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mission_progress(public.missions,UUID) FROM PUBLIC,anon,authenticated;

