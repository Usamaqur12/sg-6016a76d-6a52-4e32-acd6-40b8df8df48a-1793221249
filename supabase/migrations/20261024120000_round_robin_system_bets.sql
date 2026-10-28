-- Atomic round-robin system bets (for example 2-from-3 or 3-from-5).
-- Every line is stored separately so partial wins and void legs settle correctly.

CREATE TABLE IF NOT EXISTS public.system_bet_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id UUID NOT NULL REFERENCES public.bets(id) ON DELETE CASCADE,
  combination_size INTEGER NOT NULL CHECK (combination_size BETWEEN 2 AND 10),
  line_stake NUMERIC(15,2) NOT NULL CHECK (line_stake > 0),
  line_odds NUMERIC(15,4) NOT NULL CHECK (line_odds >= 1),
  potential_return NUMERIC(15,2) NOT NULL CHECK (potential_return >= 0),
  result TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('pending','won','lost','void')),
  payout NUMERIC(15,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.system_bet_line_selections (
  line_id UUID NOT NULL REFERENCES public.system_bet_lines(id) ON DELETE CASCADE,
  bet_selection_id UUID NOT NULL REFERENCES public.bet_selections(id) ON DELETE CASCADE,
  PRIMARY KEY(line_id, bet_selection_id)
);

CREATE INDEX IF NOT EXISTS system_bet_lines_bet_idx ON public.system_bet_lines(bet_id);
ALTER TABLE public.system_bet_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_bet_line_selections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_read_own_system_lines" ON public.system_bet_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bets b WHERE b.id=bet_id AND (b.user_id=auth.uid() OR public.is_admin())));
CREATE POLICY "users_read_own_system_line_selections" ON public.system_bet_line_selections FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.system_bet_lines l JOIN public.bets b ON b.id=l.bet_id WHERE l.id=line_id AND (b.user_id=auth.uid() OR public.is_admin())));
GRANT SELECT ON public.system_bet_lines, public.system_bet_line_selections TO authenticated;

CREATE OR REPLACE FUNCTION public.place_system_bet_atomic(
  p_stake NUMERIC,
  p_selections JSONB,
  p_combination_size INTEGER,
  p_idempotency_key TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_user UUID:=auth.uid(); v_balance NUMERIC; v_bet UUID; v_tx UUID;
  v_item JSONB; v_prices JSONB:='[]'::JSONB; v_current NUMERIC; v_name TEXT;
  v_count INTEGER; v_line_count INTEGER; v_line_stake NUMERIC; v_sum_odds NUMERIC;
  v_potential NUMERIC; v_average_odds NUMERIC; v_response JSONB; v_cached JSONB;
  v_combo RECORD; v_line UUID; v_selection_id UUID; v_line_index INTEGER:=0; v_this_line_stake NUMERIC;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key))<8 THEN RAISE EXCEPTION 'A valid idempotency key is required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::TEXT||':'||p_idempotency_key,0));
  SELECT response_data INTO v_cached FROM public.idempotency_keys WHERE user_id=v_user AND key=p_idempotency_key AND expires_at>NOW();
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;
  IF p_stake IS NULL OR p_stake<=0 OR p_stake>100000 THEN RAISE EXCEPTION 'Invalid stake'; END IF;
  IF jsonb_typeof(p_selections)<>'array' THEN RAISE EXCEPTION 'Selections must be an array'; END IF;
  v_count:=jsonb_array_length(p_selections);
  IF v_count<3 OR v_count>10 OR p_combination_size<2 OR p_combination_size>=v_count THEN
    RAISE EXCEPTION 'System bets require 3-10 selections and a valid combination size';
  END IF;
  IF (SELECT COUNT(DISTINCT value->>'event_id') FROM jsonb_array_elements(p_selections))<>v_count THEN
    RAISE EXCEPTION 'A system bet can contain only one selection per event';
  END IF;

  SELECT COALESCE(demo_balance,0) INTO v_balance FROM public.profiles
  WHERE id=v_user AND COALESCE(is_suspended,FALSE)=FALSE AND (self_exclusion_until IS NULL OR self_exclusion_until<=NOW()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account is unavailable or self-excluded'; END IF;
  IF v_balance<p_stake THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_selections) LOOP
    SELECT o.value,o.selection INTO v_current,v_name FROM public.odds o
    JOIN public.markets m ON m.id=o.market_id JOIN public.events e ON e.id=m.event_id
    WHERE o.id=(v_item->>'odds_id')::UUID AND m.id=(v_item->>'market_id')::UUID
      AND e.id=(v_item->>'event_id')::UUID AND o.is_active=TRUE AND COALESCE(o.is_locked,FALSE)=FALSE
      AND m.status='active' AND e.status IN ('upcoming','live') AND COALESCE(e.is_suspended,FALSE)=FALSE FOR SHARE OF o,m,e;
    IF NOT FOUND THEN RAISE EXCEPTION 'A selection is unavailable'; END IF;
    IF v_name IS DISTINCT FROM v_item->>'selection' THEN RAISE EXCEPTION 'Selection does not match current market data'; END IF;
    IF abs(v_current-(v_item->>'odds_value')::NUMERIC)>0.01 THEN RAISE EXCEPTION 'Odds changed. Current odds: %',v_current; END IF;
    v_prices:=v_prices||jsonb_build_array(v_item||jsonb_build_object('accepted_odds',v_current));
  END LOOP;

  WITH RECURSIVE items AS (
    SELECT row_number() OVER()::INTEGER rn,(value->>'accepted_odds')::NUMERIC odds FROM jsonb_array_elements(v_prices)
  ), combos(last_rn,depth,product) AS (
    SELECT rn,1,odds FROM items UNION ALL
    SELECT i.rn,c.depth+1,c.product*i.odds FROM combos c JOIN items i ON i.rn>c.last_rn WHERE c.depth<p_combination_size
  ) SELECT COUNT(*),COALESCE(SUM(product),0) INTO v_line_count,v_sum_odds FROM combos WHERE depth=p_combination_size;
  v_line_stake:=round(p_stake/v_line_count,2);
  IF v_line_stake<=0 THEN RAISE EXCEPTION 'Stake is too small for % system lines',v_line_count; END IF;
  v_potential:=round(v_line_stake*v_sum_odds,2); v_average_odds:=round(v_potential/p_stake,2);

  INSERT INTO public.bets(user_id,type,stake,total_odds,potential_return,status)
  VALUES(v_user,'system',p_stake,v_average_odds,v_potential,'pending') RETURNING id INTO v_bet;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_prices) LOOP
    INSERT INTO public.bet_selections(bet_id,event_id,market_id,odds_id,selection,odds_value,result)
    VALUES(v_bet,(v_item->>'event_id')::UUID,(v_item->>'market_id')::UUID,(v_item->>'odds_id')::UUID,v_item->>'selection',(v_item->>'accepted_odds')::NUMERIC,'pending');
  END LOOP;

  FOR v_combo IN
    WITH RECURSIVE items AS (
      SELECT row_number() OVER(ORDER BY created_at,id)::INTEGER rn,id,odds_value FROM public.bet_selections WHERE bet_id=v_bet
    ), combos(ids,last_rn,depth,product) AS (
      SELECT ARRAY[id],rn,1,odds_value FROM items UNION ALL
      SELECT c.ids||i.id,i.rn,c.depth+1,c.product*i.odds_value FROM combos c JOIN items i ON i.rn>c.last_rn WHERE c.depth<p_combination_size
    ) SELECT ids,product FROM combos WHERE depth=p_combination_size ORDER BY ids
  LOOP
    v_line_index:=v_line_index+1;
    v_this_line_stake:=CASE WHEN v_line_index=1 THEN p_stake-(v_line_stake*(v_line_count-1)) ELSE v_line_stake END;
    INSERT INTO public.system_bet_lines(bet_id,combination_size,line_stake,line_odds,potential_return)
    VALUES(v_bet,p_combination_size,v_this_line_stake,v_combo.product,round(v_this_line_stake*v_combo.product,2)) RETURNING id INTO v_line;
    FOREACH v_selection_id IN ARRAY v_combo.ids LOOP
      INSERT INTO public.system_bet_line_selections(line_id,bet_selection_id) VALUES(v_line,v_selection_id);
    END LOOP;
  END LOOP;

  SELECT COALESCE(SUM(potential_return),0) INTO v_potential FROM public.system_bet_lines WHERE bet_id=v_bet;
  v_average_odds:=round(v_potential/p_stake,2);
  UPDATE public.bets SET total_odds=v_average_odds,potential_return=v_potential WHERE id=v_bet;
  UPDATE public.bet_selections SET result=result WHERE bet_id=v_bet;

  UPDATE public.profiles SET demo_balance=v_balance-p_stake,updated_at=NOW() WHERE id=v_user;
  INSERT INTO public.wallet_transactions(user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata)
  VALUES(v_user,'bet_placed',-p_stake,v_balance,v_balance-p_stake,'System bet placed',v_bet,'completed',jsonb_build_object('combination_size',p_combination_size,'lines',v_line_count)) RETURNING id INTO v_tx;
  UPDATE public.bets SET wallet_transaction_id=v_tx WHERE id=v_bet;
  v_response:=jsonb_build_object('success',TRUE,'result','accepted','bet',jsonb_build_object('id',v_bet,'type','system','stake',p_stake,'totalOdds',v_average_odds,'potentialReturn',v_potential,'status','pending','lineCount',v_line_count,'combinationSize',p_combination_size));
  INSERT INTO public.idempotency_keys(user_id,key,request_data,response_data,expires_at)
  VALUES(v_user,p_idempotency_key,jsonb_build_object('betType','system','stake',p_stake,'selections',p_selections,'combinationSize',p_combination_size),v_response,NOW()+INTERVAL '24 hours');
  RETURN v_response;
END; $$;

CREATE OR REPLACE FUNCTION public.settle_ready_system_bet()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_bet public.bets%ROWTYPE; v_line RECORD; v_payout NUMERIC:=0; v_balance NUMERIC; v_tx UUID; v_won INTEGER:=0; v_void INTEGER:=0;
BEGIN
  SELECT b.* INTO v_bet FROM public.bets b WHERE b.id=NEW.bet_id AND b.type='system' FOR UPDATE;
  IF NOT FOUND OR v_bet.status<>'pending' OR EXISTS(SELECT 1 FROM public.bet_selections WHERE bet_id=v_bet.id AND result='pending') THEN RETURN NEW; END IF;
  FOR v_line IN
    SELECT l.id,l.line_stake,
      bool_or(bs.result='lost') lost,bool_and(bs.result='void') all_void,
      COALESCE(exp(sum(CASE WHEN bs.result='won' THEN ln(bs.odds_value) ELSE 0 END)),1) factor
    FROM public.system_bet_lines l JOIN public.system_bet_line_selections x ON x.line_id=l.id
    JOIN public.bet_selections bs ON bs.id=x.bet_selection_id WHERE l.bet_id=v_bet.id GROUP BY l.id,l.line_stake
  LOOP
    IF v_line.lost THEN UPDATE public.system_bet_lines SET result='lost',payout=0 WHERE id=v_line.id;
    ELSIF v_line.all_void THEN v_payout:=v_payout+v_line.line_stake; v_void:=v_void+1; UPDATE public.system_bet_lines SET result='void',payout=line_stake WHERE id=v_line.id;
    ELSE v_payout:=v_payout+round(v_line.line_stake*v_line.factor,2); v_won:=v_won+1; UPDATE public.system_bet_lines SET result='won',payout=round(line_stake*v_line.factor,2) WHERE id=v_line.id; END IF;
  END LOOP;
  SELECT COALESCE(demo_balance,0) INTO v_balance FROM public.profiles WHERE id=v_bet.user_id FOR UPDATE;
  UPDATE public.profiles SET demo_balance=v_balance+v_payout,updated_at=NOW() WHERE id=v_bet.user_id;
  INSERT INTO public.wallet_transactions(user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata)
  VALUES(v_bet.user_id,CASE WHEN v_won>0 THEN 'bet_won' WHEN v_void>0 THEN 'adjustment' ELSE 'bet_lost' END,v_payout,v_balance,v_balance+v_payout,'System bet settled',v_bet.id,'completed',jsonb_build_object('winning_lines',v_won,'void_lines',v_void)) RETURNING id INTO v_tx;
  UPDATE public.bets SET status=CASE WHEN v_won>0 THEN 'won' WHEN v_void>0 THEN 'void' ELSE 'lost' END,payout=v_payout,settled_at=NOW() WHERE id=v_bet.id;
  INSERT INTO public.settlements(bet_id,settlement_type,original_stake,settlement_amount,settlement_reason,is_manual,wallet_transaction_id)
  VALUES(v_bet.id,CASE WHEN v_won>0 THEN 'win' WHEN v_void>0 THEN 'void' ELSE 'loss' END,v_bet.stake,v_payout,'Automatic system-line settlement',FALSE,v_tx);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS settle_ready_system_bet_trigger ON public.bet_selections;
CREATE TRIGGER settle_ready_system_bet_trigger AFTER UPDATE OF result ON public.bet_selections
FOR EACH ROW WHEN (NEW.result IS DISTINCT FROM OLD.result) EXECUTE FUNCTION public.settle_ready_system_bet();

REVOKE ALL ON FUNCTION public.place_system_bet_atomic(NUMERIC,JSONB,INTEGER,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.place_system_bet_atomic(NUMERIC,JSONB,INTEGER,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.settle_ready_system_bet() FROM PUBLIC,anon,authenticated;
