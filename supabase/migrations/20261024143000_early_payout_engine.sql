-- Configurable early-payout engine. Rules are deliberately disabled until a
-- trusted live-score feed is connected and a trader enables them.

CREATE TABLE IF NOT EXISTS public.early_payout_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sport_slug TEXT NOT NULL,
  market_type TEXT NOT NULL DEFAULT 'match_result',
  minimum_lead INTEGER NOT NULL CHECK (minimum_lead BETWEEN 1 AND 20),
  minimum_minute INTEGER NOT NULL CHECK (minimum_minute BETWEEN 1 AND 200),
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS early_payout_rule_unique
  ON public.early_payout_rules(sport_slug,market_type,minimum_lead,minimum_minute);

CREATE TABLE IF NOT EXISTS public.early_payout_awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES public.early_payout_rules(id) ON DELETE RESTRICT,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  bet_selection_id UUID NOT NULL REFERENCES public.bet_selections(id) ON DELETE RESTRICT,
  score TEXT NOT NULL,
  match_minute INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(bet_selection_id)
);

ALTER TABLE public.early_payout_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.early_payout_awards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read_early_payout_rules" ON public.early_payout_rules FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "traders_read_early_payout_awards" ON public.early_payout_awards FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['sports_trader','risk_manager']));
GRANT SELECT ON public.early_payout_rules TO authenticated;
GRANT SELECT ON public.early_payout_awards TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.early_payout_rules FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.early_payout_awards FROM PUBLIC,anon,authenticated;

INSERT INTO public.early_payout_rules(name,sport_slug,market_type,minimum_lead,minimum_minute,is_enabled)
VALUES('Football two-goal lead after 75 minutes','football','match_result',2,75,FALSE)
ON CONFLICT(sport_slug,market_type,minimum_lead,minimum_minute) DO NOTHING;

CREATE OR REPLACE FUNCTION public.save_early_payout_rule(
  p_id UUID,p_name TEXT,p_sport_slug TEXT,p_market_type TEXT,p_minimum_lead INTEGER,p_minimum_minute INTEGER,p_is_enabled BOOLEAN
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.has_admin_role(ARRAY['sports_trader','risk_manager']) OR COALESCE(auth.jwt()->>'aal','aal1')<>'aal2' THEN RAISE EXCEPTION 'Trader AAL2 authorization required'; END IF;
  IF length(trim(COALESCE(p_name,'')))<3 OR length(trim(COALESCE(p_sport_slug,'')))<2 OR p_market_type<>'match_result' OR p_minimum_lead NOT BETWEEN 1 AND 20 OR p_minimum_minute NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid early-payout rule'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.early_payout_rules(name,sport_slug,market_type,minimum_lead,minimum_minute,is_enabled,created_by)
    VALUES(trim(p_name),lower(trim(p_sport_slug)),p_market_type,p_minimum_lead,p_minimum_minute,p_is_enabled,auth.uid()) RETURNING id INTO v_id;
  ELSE
    UPDATE public.early_payout_rules SET name=trim(p_name),sport_slug=lower(trim(p_sport_slug)),market_type=p_market_type,minimum_lead=p_minimum_lead,minimum_minute=p_minimum_minute,is_enabled=p_is_enabled,updated_at=NOW() WHERE id=p_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Early-payout rule not found'; END IF;
  END IF;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes) VALUES(auth.uid(),'early_payout_rule_saved','early_payout_rule',v_id,jsonb_build_object('enabled',p_is_enabled,'minimum_lead',p_minimum_lead,'minimum_minute',p_minimum_minute));
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.delete_early_payout_rule(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_admin_role(ARRAY['sports_trader','risk_manager']) OR COALESCE(auth.jwt()->>'aal','aal1')<>'aal2' THEN RAISE EXCEPTION 'Trader AAL2 authorization required'; END IF;
  IF EXISTS(SELECT 1 FROM public.early_payout_awards WHERE rule_id=p_id) THEN
    UPDATE public.early_payout_rules SET is_enabled=FALSE,updated_at=NOW() WHERE id=p_id;
  ELSE DELETE FROM public.early_payout_rules WHERE id=p_id; END IF;
  INSERT INTO public.audit_logs(admin_id,action,entity_type,entity_id,changes) VALUES(auth.uid(),'early_payout_rule_removed','early_payout_rule',p_id,'{}'::jsonb);
END; $$;

CREATE OR REPLACE FUNCTION public.process_early_payout_for_event(p_event_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_event RECORD; v_rule public.early_payout_rules%ROWTYPE; v_leader TEXT; v_awarded INTEGER:=0;
  v_bet RECORD; v_selection RECORD; v_factor NUMERIC; v_payout NUMERIC; v_balance NUMERIC; v_tx UUID;
BEGIN
  SELECT e.*,s.slug AS sport_slug INTO v_event FROM public.events e JOIN public.sports s ON s.id=e.sport_id WHERE e.id=p_event_id FOR SHARE OF e;
  IF NOT FOUND OR v_event.status<>'live' OR v_event.live_score_home IS NULL OR v_event.live_score_away IS NULL OR v_event.live_minute IS NULL THEN RETURN 0; END IF;

  FOR v_rule IN SELECT * FROM public.early_payout_rules WHERE is_enabled=TRUE AND sport_slug=v_event.sport_slug AND market_type='match_result' AND minimum_minute<=v_event.live_minute ORDER BY minimum_lead DESC
  LOOP
    IF v_event.live_score_home-v_event.live_score_away>=v_rule.minimum_lead THEN v_leader:='home';
    ELSIF v_event.live_score_away-v_event.live_score_home>=v_rule.minimum_lead THEN v_leader:='away';
    ELSE CONTINUE; END IF;

    WITH awarded AS (
      INSERT INTO public.early_payout_awards(rule_id,event_id,bet_selection_id,score,match_minute)
      SELECT v_rule.id,p_event_id,bs.id,v_event.live_score_home||'-'||v_event.live_score_away,v_event.live_minute
      FROM public.bet_selections bs
      JOIN public.bets b ON b.id=bs.bet_id AND b.status='pending'
      JOIN public.markets m ON m.id=bs.market_id AND m.event_id=p_event_id AND m.type='match_result'
      WHERE bs.event_id=p_event_id AND COALESCE(bs.result,'pending')='pending'
        AND ((v_leader='home' AND lower(trim(bs.selection)) IN ('home',lower(trim(v_event.home_team))))
          OR (v_leader='away' AND lower(trim(bs.selection)) IN ('away',lower(trim(v_event.away_team)))))
      ON CONFLICT(bet_selection_id) DO NOTHING RETURNING bet_selection_id
    )
    UPDATE public.bet_selections bs SET result='won' FROM awarded a WHERE bs.id=a.bet_selection_id;
    GET DIAGNOSTICS v_awarded = ROW_COUNT;
    EXIT WHEN v_awarded>0;
  END LOOP;

  IF v_awarded=0 THEN RETURN 0; END IF;

  FOR v_bet IN
    SELECT b.id,b.user_id,b.stake FROM public.bets b
    WHERE b.status='pending' AND b.type<>'system'
      AND EXISTS(SELECT 1 FROM public.bet_selections bs WHERE bs.bet_id=b.id AND bs.event_id=p_event_id)
    FOR UPDATE OF b
  LOOP
    IF EXISTS(SELECT 1 FROM public.bet_selections WHERE bet_id=v_bet.id AND result='lost') OR EXISTS(SELECT 1 FROM public.bet_selections WHERE bet_id=v_bet.id AND COALESCE(result,'pending')='pending') THEN CONTINUE; END IF;
    v_factor:=1;
    FOR v_selection IN SELECT result,odds_value FROM public.bet_selections WHERE bet_id=v_bet.id LOOP
      IF v_selection.result='won' THEN v_factor:=v_factor*v_selection.odds_value; END IF;
    END LOOP;
    v_payout:=ROUND(v_bet.stake*v_factor,2);
    SELECT demo_balance INTO v_balance FROM public.profiles WHERE id=v_bet.user_id FOR UPDATE;
    UPDATE public.profiles SET demo_balance=v_balance+v_payout,updated_at=NOW() WHERE id=v_bet.user_id;
    INSERT INTO public.wallet_transactions(user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata)
    VALUES(v_bet.user_id,'bet_won',v_payout,v_balance,v_balance+v_payout,'Early payout settlement',v_bet.id,'completed',jsonb_build_object('event_id',p_event_id)) RETURNING id INTO v_tx;
    UPDATE public.bets SET status='won',payout=v_payout,settled_at=NOW() WHERE id=v_bet.id;
    INSERT INTO public.settlements(bet_id,settlement_type,original_stake,settlement_amount,settlement_reason,is_manual,wallet_transaction_id)
    VALUES(v_bet.id,'win',v_bet.stake,v_payout,'Configured early-payout rule',FALSE,v_tx);
    INSERT INTO public.notifications(user_id,type,title,message,metadata) VALUES(v_bet.user_id,'early_payout','Early payout awarded','Your qualifying bet was settled early as a winner.',jsonb_build_object('bet_id',v_bet.id,'event_id',p_event_id,'payout',v_payout));
  END LOOP;
  RETURN v_awarded;
END; $$;

CREATE OR REPLACE FUNCTION public.trigger_early_payout_on_live_score()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status='live' AND (NEW.live_score_home IS DISTINCT FROM OLD.live_score_home OR NEW.live_score_away IS DISTINCT FROM OLD.live_score_away OR NEW.live_minute IS DISTINCT FROM OLD.live_minute) THEN
    PERFORM public.process_early_payout_for_event(NEW.id);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS process_early_payout_live_score_trigger ON public.events;
CREATE TRIGGER process_early_payout_live_score_trigger AFTER UPDATE OF live_score_home,live_score_away,live_minute,status ON public.events FOR EACH ROW EXECUTE FUNCTION public.trigger_early_payout_on_live_score();

REVOKE ALL ON FUNCTION public.save_early_payout_rule(UUID,TEXT,TEXT,TEXT,INTEGER,INTEGER,BOOLEAN) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_early_payout_rule(UUID,TEXT,TEXT,TEXT,INTEGER,INTEGER,BOOLEAN) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_early_payout_rule(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_early_payout_rule(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.process_early_payout_for_event(UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.trigger_early_payout_on_live_score() FROM PUBLIC,anon,authenticated;

