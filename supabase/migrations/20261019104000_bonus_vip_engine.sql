-- Play-money promotion, wagering and loyalty engine. Real-money deposit and
-- cashback offers remain unavailable until a licensed payment provider is live.

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS promo_code TEXT,
  ADD COLUMN IF NOT EXISTS per_user_claim_limit INTEGER NOT NULL DEFAULT 1 CHECK (per_user_claim_limit > 0),
  ADD COLUMN IF NOT EXISTS total_claim_limit INTEGER CHECK (total_claim_limit IS NULL OR total_claim_limit > 0),
  ADD COLUMN IF NOT EXISTS expires_after_days INTEGER NOT NULL DEFAULT 30 CHECK (expires_after_days BETWEEN 1 AND 365),
  ADD COLUMN IF NOT EXISTS min_odds NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (min_odds >= 1),
  ADD COLUMN IF NOT EXISTS min_legs INTEGER NOT NULL DEFAULT 1 CHECK (min_legs BETWEEN 1 AND 25),
  ADD COLUMN IF NOT EXISTS loyalty_points_reward INTEGER NOT NULL DEFAULT 0 CHECK (loyalty_points_reward >= 0),
  ADD COLUMN IF NOT EXISTS requires_qualifying_deposit BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS promotions_promo_code_unique
  ON public.promotions (LOWER(promo_code)) WHERE promo_code IS NOT NULL;

ALTER TABLE public.user_bonuses
  ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS claim_source TEXT NOT NULL DEFAULT 'admin'
    CHECK (claim_source IN ('admin','promo_code','automatic','deposit','cashback')),
  ADD COLUMN IF NOT EXISTS forfeited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_wagered_at TIMESTAMPTZ;

UPDATE public.user_bonuses
SET remaining_amount=amount
WHERE remaining_amount IS NULL;

ALTER TABLE public.user_bonuses
  ALTER COLUMN remaining_amount SET DEFAULT 0,
  ALTER COLUMN remaining_amount SET NOT NULL;

ALTER TABLE public.user_bonuses DROP CONSTRAINT IF EXISTS user_bonuses_remaining_amount_nonnegative;
ALTER TABLE public.user_bonuses
  ADD CONSTRAINT user_bonuses_remaining_amount_nonnegative CHECK (remaining_amount >= 0);

CREATE INDEX IF NOT EXISTS user_bonuses_active_expiry_idx
  ON public.user_bonuses (expires_at, user_id) WHERE status='active';

CREATE TABLE IF NOT EXISTS public.loyalty_accounts (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  points BIGINT NOT NULL DEFAULT 0 CHECK (points >= 0),
  lifetime_points BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_points >= 0),
  tier TEXT NOT NULL DEFAULT 'bronze' CHECK (tier IN ('bronze','silver','gold','platinum')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.loyalty_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_read_own_loyalty" ON public.loyalty_accounts
  FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY "finance_read_loyalty" ON public.loyalty_accounts
  FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['finance']));
REVOKE INSERT,UPDATE,DELETE ON public.loyalty_accounts FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.set_loyalty_tier()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  NEW.tier := CASE
    WHEN NEW.lifetime_points >= 20000 THEN 'platinum'
    WHEN NEW.lifetime_points >= 5000 THEN 'gold'
    WHEN NEW.lifetime_points >= 1000 THEN 'silver'
    ELSE 'bronze'
  END;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_loyalty_tier_trigger ON public.loyalty_accounts;
CREATE TRIGGER set_loyalty_tier_trigger
BEFORE INSERT OR UPDATE OF lifetime_points ON public.loyalty_accounts
FOR EACH ROW EXECUTE FUNCTION public.set_loyalty_tier();

INSERT INTO public.loyalty_accounts(user_id)
SELECT id FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ensure_loyalty_account()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.loyalty_accounts(user_id) VALUES(NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_loyalty_account_trigger ON public.profiles;
CREATE TRIGGER ensure_loyalty_account_trigger
AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.ensure_loyalty_account();

CREATE OR REPLACE FUNCTION public.transfer_user_bonus_funds(
  p_user_id UUID,
  p_bonus_id UUID,
  p_requested_amount NUMERIC,
  p_destination TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_bonus_account UUID;
  v_destination_account UUID;
  v_journal UUID;
  v_bonus_balance NUMERIC;
  v_destination_balance NUMERIC;
  v_profile_balance NUMERIC;
  v_amount NUMERIC;
  v_key TEXT := 'bonus-'||p_destination||':'||p_bonus_id;
BEGIN
  IF p_destination NOT IN ('cash','reserve') THEN RAISE EXCEPTION 'Invalid bonus destination'; END IF;
  IF COALESCE(p_requested_amount,0) <= 0 THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.ledger_journals WHERE idempotency_key=v_key) THEN RETURN 0; END IF;

  SELECT id,balance INTO v_bonus_account,v_bonus_balance
  FROM public.ledger_accounts
  WHERE user_id=p_user_id AND currency='USD' AND account_code='bonus'
  FOR UPDATE;

  SELECT demo_balance INTO v_profile_balance FROM public.profiles WHERE id=p_user_id FOR UPDATE;

  IF p_destination='cash' THEN
    SELECT id,balance INTO v_destination_account,v_destination_balance
    FROM public.ledger_accounts
    WHERE user_id=p_user_id AND currency='USD' AND account_code='cash'
    FOR UPDATE;
    v_amount := LEAST(p_requested_amount,GREATEST(COALESCE(v_bonus_balance,0),0));
  ELSE
    SELECT id,balance INTO v_destination_account,v_destination_balance
    FROM public.ledger_accounts
    WHERE user_id IS NULL AND currency='USD' AND account_code='bonus_reserve'
    FOR UPDATE;
    v_amount := LEAST(p_requested_amount,GREATEST(COALESCE(v_bonus_balance,0),0),GREATEST(COALESCE(v_profile_balance,0),0));
  END IF;

  IF COALESCE(v_amount,0) <= 0 THEN RETURN 0; END IF;

  INSERT INTO public.ledger_journals(source_type,idempotency_key,description,metadata)
  VALUES(
    CASE WHEN p_destination='cash' THEN 'bonus_conversion' ELSE 'bonus_forfeiture' END,
    v_key,
    CASE WHEN p_destination='cash' THEN 'Bonus wagering completed' ELSE 'Expired bonus forfeited' END,
    jsonb_build_object('user_id',p_user_id,'bonus_id',p_bonus_id,'amount',v_amount)
  ) RETURNING id INTO v_journal;

  UPDATE public.ledger_accounts SET balance=balance-v_amount,updated_at=NOW()
  WHERE id=v_bonus_account RETURNING balance INTO v_bonus_balance;
  UPDATE public.ledger_accounts SET balance=balance+v_amount,updated_at=NOW()
  WHERE id=v_destination_account RETURNING balance INTO v_destination_balance;

  INSERT INTO public.ledger_postings(journal_id,account_id,amount,balance_after)
  VALUES
    (v_journal,v_bonus_account,-v_amount,v_bonus_balance),
    (v_journal,v_destination_account,v_amount,v_destination_balance);

  IF p_destination='reserve' THEN
    UPDATE public.profiles SET demo_balance=demo_balance-v_amount,updated_at=NOW() WHERE id=p_user_id;
  END IF;
  RETURN v_amount;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_promotion(p_promotion_id UUID,p_promo_code TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_promo public.promotions%ROWTYPE;
  v_balance NUMERIC;
  v_amount NUMERIC;
  v_wager_target NUMERIC;
  v_bonus_id UUID;
  v_claims INTEGER;
  v_total_claims INTEGER;
  v_recent_claims INTEGER;
  v_transferred NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::TEXT||':'||p_promotion_id::TEXT,0));

  SELECT * INTO v_promo FROM public.promotions WHERE id=p_promotion_id FOR UPDATE;
  IF NOT FOUND OR NOT COALESCE(v_promo.is_active,FALSE)
     OR NOW()<v_promo.valid_from OR NOW()>v_promo.valid_until THEN
    RAISE EXCEPTION 'Promotion is unavailable';
  END IF;
  IF v_promo.promo_code IS NOT NULL
     AND LOWER(TRIM(COALESCE(p_promo_code,'')))<>LOWER(v_promo.promo_code) THEN
    RAISE EXCEPTION 'A valid promo code is required';
  END IF;
  IF v_promo.requires_qualifying_deposit OR v_promo.type IN ('deposit_bonus','cashback') THEN
    RAISE EXCEPTION 'This offer requires a verified qualifying payment';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.fraud_flags
    WHERE user_id=v_user_id AND flag_type='bonus_abuse' AND severity IN ('high','critical') AND NOT COALESCE(is_reviewed,FALSE)
  ) THEN RAISE EXCEPTION 'Promotion claim requires review'; END IF;

  SELECT COUNT(*) INTO v_claims FROM public.user_bonuses
  WHERE user_id=v_user_id AND promotion_id=p_promotion_id;
  IF v_claims>=v_promo.per_user_claim_limit THEN RAISE EXCEPTION 'Promotion claim limit reached'; END IF;
  SELECT COUNT(*) INTO v_total_claims FROM public.user_bonuses WHERE promotion_id=p_promotion_id;
  IF v_promo.total_claim_limit IS NOT NULL AND v_total_claims>=v_promo.total_claim_limit THEN
    RAISE EXCEPTION 'Promotion is fully claimed';
  END IF;

  SELECT COALESCE(demo_balance,0) INTO v_balance
  FROM public.profiles
  WHERE id=v_user_id AND COALESCE(is_suspended,FALSE)=FALSE
    AND (self_exclusion_until IS NULL OR self_exclusion_until<=NOW())
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account is unavailable'; END IF;

  v_amount := LEAST(COALESCE(v_promo.bonus_amount,0),COALESCE(v_promo.max_bonus,v_promo.bonus_amount,0));
  IF v_amount<=0 THEN RAISE EXCEPTION 'Promotion has no claimable fixed bonus'; END IF;
  v_wager_target := ROUND(v_amount*GREATEST(COALESCE(v_promo.wagering_requirement,0),0),2);

  INSERT INTO public.user_bonuses(
    user_id,promotion_id,amount,remaining_amount,wagering_requirement,
    wagering_completed,status,expires_at,claim_source
  ) VALUES(
    v_user_id,p_promotion_id,v_amount,v_amount,v_wager_target,
    0,'active',NOW()+make_interval(days=>v_promo.expires_after_days),
    CASE WHEN v_promo.promo_code IS NULL THEN 'automatic' ELSE 'promo_code' END
  ) RETURNING id INTO v_bonus_id;

  UPDATE public.profiles SET demo_balance=v_balance+v_amount,updated_at=NOW() WHERE id=v_user_id;
  INSERT INTO public.wallet_transactions(
    user_id,type,amount,balance_before,balance_after,description,reference_id,status,metadata
  ) VALUES(
    v_user_id,'bonus_awarded',v_amount,v_balance,v_balance+v_amount,
    'Promotion claimed: '||v_promo.title,v_bonus_id,'completed',jsonb_build_object('promotion_id',p_promotion_id)
  );

  INSERT INTO public.loyalty_accounts(user_id,points,lifetime_points)
  VALUES(v_user_id,v_promo.loyalty_points_reward,v_promo.loyalty_points_reward)
  ON CONFLICT(user_id) DO UPDATE SET
    points=public.loyalty_accounts.points+EXCLUDED.points,
    lifetime_points=public.loyalty_accounts.lifetime_points+EXCLUDED.lifetime_points;

  SELECT COUNT(*) INTO v_recent_claims FROM public.user_bonuses
  WHERE user_id=v_user_id AND awarded_at>=NOW()-INTERVAL '24 hours';
  IF v_recent_claims>=3 AND NOT EXISTS(
    SELECT 1 FROM public.fraud_flags
    WHERE user_id=v_user_id AND flag_type='bonus_abuse' AND created_at>=NOW()-INTERVAL '24 hours'
  ) THEN
    INSERT INTO public.fraud_flags(user_id,flag_type,severity,description,metadata)
    VALUES(v_user_id,'bonus_abuse','medium','Multiple promotion claims within 24 hours',jsonb_build_object('claims',v_recent_claims));
  END IF;

  IF COALESCE((SELECT promotions FROM public.notification_preferences WHERE user_id=v_user_id),TRUE) THEN
    INSERT INTO public.notifications(user_id,type,title,message,metadata)
    VALUES(v_user_id,'promotion_claimed','Bonus claimed',v_promo.title||' was added to your demo bonus balance.',jsonb_build_object('bonus_id',v_bonus_id,'amount',v_amount));
  END IF;

  IF v_wager_target=0 THEN
    v_transferred := public.transfer_user_bonus_funds(v_user_id,v_bonus_id,v_amount,'cash');
    UPDATE public.user_bonuses SET status='completed',remaining_amount=GREATEST(remaining_amount-v_transferred,0),completed_at=NOW()
    WHERE id=v_bonus_id;
  END IF;

  RETURN jsonb_build_object('success',TRUE,'bonus_id',v_bonus_id,'amount',v_amount,'wagering_required',v_wager_target);
END;
$$;

CREATE OR REPLACE FUNCTION public.track_bonus_fund_consumption()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_bonus_spent NUMERIC := 0;
  v_spend_remaining NUMERIC;
  v_spend_apply NUMERIC;
  v_new_remaining NUMERIC;
  v_bonus RECORD;
BEGIN
  IF NEW.type<>'bet_placed' OR NEW.reference_id IS NULL OR NEW.amount>=0 THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(-p.amount),0) INTO v_bonus_spent
  FROM public.ledger_journals j
  JOIN public.ledger_postings p ON p.journal_id=j.id
  JOIN public.ledger_accounts a ON a.id=p.account_id
  WHERE j.source_transaction_id=NEW.id AND a.user_id=NEW.user_id
    AND a.account_code='bonus' AND p.amount<0;
  v_spend_remaining := v_bonus_spent;

  FOR v_bonus IN
    SELECT * FROM public.user_bonuses
    WHERE user_id=NEW.user_id AND status='active' AND remaining_amount>0
    ORDER BY expires_at NULLS LAST,awarded_at,id FOR UPDATE
  LOOP
    v_new_remaining := v_bonus.remaining_amount;
    IF v_spend_remaining>0 AND v_new_remaining>0 THEN
      v_spend_apply := LEAST(v_spend_remaining,v_new_remaining);
      v_new_remaining := v_new_remaining-v_spend_apply;
      v_spend_remaining := v_spend_remaining-v_spend_apply;
    END IF;
    UPDATE public.user_bonuses SET remaining_amount=v_new_remaining WHERE id=v_bonus.id;
    EXIT WHEN v_spend_remaining<=0;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_track_bonus_fund_consumption_trigger ON public.wallet_transactions;
CREATE TRIGGER zz_track_bonus_fund_consumption_trigger
AFTER INSERT ON public.wallet_transactions
FOR EACH ROW EXECUTE FUNCTION public.track_bonus_fund_consumption();

CREATE OR REPLACE FUNCTION public.settle_bonus_wagering()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_wager_remaining NUMERIC := NEW.stake;
  v_legs INTEGER;
  v_apply NUMERIC;
  v_new_progress NUMERIC;
  v_transferred NUMERIC;
  v_points BIGINT := FLOOR(NEW.stake);
  v_bonus RECORD;
BEGIN
  IF OLD.status<>'pending' OR NEW.status NOT IN ('won','lost') THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO v_legs FROM public.bet_selections WHERE bet_id=NEW.id;

  FOR v_bonus IN
    SELECT ub.*,COALESCE(pr.min_odds,1) AS required_odds,COALESCE(pr.min_legs,1) AS required_legs
    FROM public.user_bonuses ub
    LEFT JOIN public.promotions pr ON pr.id=ub.promotion_id
    WHERE ub.user_id=NEW.user_id AND ub.status='active'
      AND (ub.expires_at IS NULL OR ub.expires_at>NOW())
    ORDER BY ub.expires_at NULLS LAST,ub.awarded_at,ub.id
    FOR UPDATE OF ub
  LOOP
    v_new_progress := COALESCE(v_bonus.wagering_completed,0);
    IF v_wager_remaining>0 AND NEW.total_odds>=v_bonus.required_odds AND v_legs>=v_bonus.required_legs THEN
      v_apply := LEAST(v_wager_remaining,GREATEST(v_bonus.wagering_requirement-v_new_progress,0));
      v_new_progress := v_new_progress+v_apply;
      v_wager_remaining := v_wager_remaining-v_apply;
      UPDATE public.user_bonuses SET wagering_completed=v_new_progress,last_wagered_at=NOW() WHERE id=v_bonus.id;
    END IF;
    IF v_new_progress>=v_bonus.wagering_requirement THEN
      v_transferred := public.transfer_user_bonus_funds(NEW.user_id,v_bonus.id,v_bonus.remaining_amount,'cash');
      UPDATE public.user_bonuses SET status='completed',completed_at=NOW(),remaining_amount=GREATEST(remaining_amount-v_transferred,0) WHERE id=v_bonus.id;
      INSERT INTO public.notifications(user_id,type,title,message,metadata)
      VALUES(NEW.user_id,'bonus_completed','Bonus unlocked','Your wagering requirement is complete.',jsonb_build_object('bonus_id',v_bonus.id));
    END IF;
  END LOOP;

  IF v_points>0 THEN
    INSERT INTO public.loyalty_accounts(user_id,points,lifetime_points)
    VALUES(NEW.user_id,v_points,v_points)
    ON CONFLICT(user_id) DO UPDATE SET
      points=public.loyalty_accounts.points+EXCLUDED.points,
      lifetime_points=public.loyalty_accounts.lifetime_points+EXCLUDED.lifetime_points;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS settle_bonus_wagering_trigger ON public.bets;
CREATE TRIGGER settle_bonus_wagering_trigger
AFTER UPDATE OF status ON public.bets
FOR EACH ROW EXECUTE FUNCTION public.settle_bonus_wagering();

CREATE OR REPLACE FUNCTION public.expire_user_bonuses(p_batch_size INTEGER DEFAULT 250)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_bonus RECORD;
  v_forfeited NUMERIC;
  v_count INTEGER := 0;
  v_total NUMERIC := 0;
BEGIN
  IF NOT public.is_service_role() AND NOT public.has_admin_role(ARRAY['finance']) THEN
    RAISE EXCEPTION 'Finance authorization required';
  END IF;
  FOR v_bonus IN
    SELECT * FROM public.user_bonuses
    WHERE status='active' AND expires_at<=NOW()
    ORDER BY expires_at,id LIMIT LEAST(GREATEST(p_batch_size,1),1000)
    FOR UPDATE SKIP LOCKED
  LOOP
    v_forfeited := public.transfer_user_bonus_funds(v_bonus.user_id,v_bonus.id,v_bonus.remaining_amount,'reserve');
    UPDATE public.user_bonuses SET status='expired',remaining_amount=GREATEST(remaining_amount-v_forfeited,0),forfeited_at=NOW()
    WHERE id=v_bonus.id;
    INSERT INTO public.notifications(user_id,type,title,message,metadata)
    VALUES(v_bonus.user_id,'bonus_expired','Bonus expired','An unused demo bonus expired.',jsonb_build_object('bonus_id',v_bonus.id,'forfeited',v_forfeited));
    v_count := v_count+1;
    v_total := v_total+v_forfeited;
  END LOOP;
  RETURN jsonb_build_object('processed',v_count,'forfeited',v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.set_loyalty_tier() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ensure_loyalty_account() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.transfer_user_bonus_funds(UUID,UUID,NUMERIC,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.track_bonus_fund_consumption() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.settle_bonus_wagering() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_promotion(UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.claim_promotion(UUID,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.expire_user_bonuses(INTEGER) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.expire_user_bonuses(INTEGER) TO authenticated,service_role;
