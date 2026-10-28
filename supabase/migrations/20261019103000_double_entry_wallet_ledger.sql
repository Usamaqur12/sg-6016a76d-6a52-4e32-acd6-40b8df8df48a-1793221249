-- Double-entry play-money wallet ledger. Existing wallet_transactions remain
-- the compatibility event stream; this trigger mirrors every new event into a
-- balanced, immutable cash/bonus/locked ledger.

CREATE TABLE IF NOT EXISTS public.ledger_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL CHECK (account_code IN ('cash', 'bonus', 'locked', 'sportsbook_clearing', 'bonus_reserve')),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((is_system AND user_id IS NULL) OR (NOT is_system AND user_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_user_account_unique
  ON public.ledger_accounts (user_id, currency, account_code)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ledger_system_account_unique
  ON public.ledger_accounts (currency, account_code)
  WHERE user_id IS NULL;

CREATE TABLE IF NOT EXISTS public.ledger_journals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL,
  source_transaction_id UUID UNIQUE REFERENCES public.wallet_transactions(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ledger_postings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id UUID NOT NULL REFERENCES public.ledger_journals(id) ON DELETE RESTRICT,
  account_id UUID NOT NULL REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT,
  amount NUMERIC(18,2) NOT NULL CHECK (amount <> 0),
  balance_after NUMERIC(18,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ledger_postings_account_created_idx
  ON public.ledger_postings (account_id, created_at DESC);

REVOKE INSERT, UPDATE, DELETE ON public.ledger_accounts FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.ledger_journals FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.ledger_postings FROM PUBLIC, anon, authenticated;

ALTER TABLE public.ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_postings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own ledger accounts" ON public.ledger_accounts
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Finance staff can view all ledger accounts" ON public.ledger_accounts
  FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['finance']));
CREATE POLICY "Users can view own ledger postings" ON public.ledger_postings
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.ledger_accounts a WHERE a.id=account_id AND a.user_id=auth.uid())
  );
CREATE POLICY "Finance staff can view all ledger postings" ON public.ledger_postings
  FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['finance']));
CREATE POLICY "Users can view own ledger journals" ON public.ledger_journals
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.ledger_postings p JOIN public.ledger_accounts a ON a.id=p.account_id
      WHERE p.journal_id=ledger_journals.id AND a.user_id=auth.uid()
    )
  );
CREATE POLICY "Finance staff can view all ledger journals" ON public.ledger_journals
  FOR SELECT TO authenticated USING (public.has_admin_role(ARRAY['finance']));

CREATE OR REPLACE FUNCTION public.verify_ledger_journal_balanced()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_journal UUID := COALESCE(NEW.journal_id,OLD.journal_id); v_total NUMERIC;
BEGIN
  SELECT COALESCE(SUM(amount),0) INTO v_total FROM public.ledger_postings WHERE journal_id=v_journal;
  IF v_total <> 0 THEN RAISE EXCEPTION 'Ledger journal % is unbalanced by %',v_journal,v_total; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS verify_ledger_journal_balanced_trigger ON public.ledger_postings;
CREATE CONSTRAINT TRIGGER verify_ledger_journal_balanced_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.ledger_postings
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.verify_ledger_journal_balanced();

INSERT INTO public.ledger_accounts (user_id, account_code, currency, balance, is_system)
VALUES (NULL,'sportsbook_clearing','USD',0,TRUE),(NULL,'bonus_reserve','USD',0,TRUE)
ON CONFLICT (currency, account_code) WHERE user_id IS NULL DO NOTHING;

CREATE OR REPLACE FUNCTION public.ensure_user_ledger_accounts_from_id(p_user_id UUID,p_cash_balance NUMERIC DEFAULT 0)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_cash_account UUID;
  v_system_account UUID;
  v_journal UUID;
  v_system_balance NUMERIC;
BEGIN
  INSERT INTO public.ledger_accounts(user_id,account_code,currency,balance,is_system)
  SELECT p_user_id,code,'USD',0,FALSE
  FROM (VALUES('cash'),('bonus'),('locked')) v(code)
  ON CONFLICT (user_id,currency,account_code) WHERE user_id IS NOT NULL DO NOTHING;

  IF COALESCE(p_cash_balance,0) <> 0
    AND NOT EXISTS (
      SELECT 1 FROM public.ledger_journals
      WHERE idempotency_key='profile-opening:'||p_user_id
    ) THEN
    SELECT id INTO v_cash_account
    FROM public.ledger_accounts
    WHERE user_id=p_user_id AND currency='USD' AND account_code='cash'
    FOR UPDATE;
    SELECT id INTO v_system_account
    FROM public.ledger_accounts
    WHERE user_id IS NULL AND currency='USD' AND account_code='sportsbook_clearing'
    FOR UPDATE;

    INSERT INTO public.ledger_journals(source_type,idempotency_key,description,metadata)
    VALUES('opening_balance','profile-opening:'||p_user_id,'Opening play-money balance',jsonb_build_object('user_id',p_user_id))
    RETURNING id INTO v_journal;

    UPDATE public.ledger_accounts
    SET balance=balance+p_cash_balance,updated_at=NOW()
    WHERE id=v_cash_account;
    UPDATE public.ledger_accounts
    SET balance=balance-p_cash_balance,updated_at=NOW()
    WHERE id=v_system_account
    RETURNING balance INTO v_system_balance;

    INSERT INTO public.ledger_postings(journal_id,account_id,amount,balance_after)
    VALUES
      (v_journal,v_cash_account,p_cash_balance,p_cash_balance),
      (v_journal,v_system_account,-p_cash_balance,v_system_balance);
  END IF;
END;
$$;

SELECT public.ensure_user_ledger_accounts_from_id(id,COALESCE(demo_balance,0))
FROM public.profiles;

CREATE OR REPLACE FUNCTION public.ensure_user_ledger_accounts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.ensure_user_ledger_accounts_from_id(NEW.id,COALESCE(NEW.demo_balance,0));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_user_ledger_accounts_trigger ON public.profiles;
CREATE TRIGGER ensure_user_ledger_accounts_trigger
AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.ensure_user_ledger_accounts();

CREATE OR REPLACE FUNCTION public.mirror_wallet_transaction_to_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE
  v_journal UUID;
  v_user_cash UUID; v_user_bonus UUID; v_target UUID; v_system UUID;
  v_cash_balance NUMERIC; v_bonus_balance NUMERIC;
  v_cash_part NUMERIC; v_bonus_part NUMERIC; v_amount NUMERIC := ABS(NEW.amount);
  v_balance NUMERIC;
BEGIN
  IF EXISTS (SELECT 1 FROM public.ledger_journals WHERE source_transaction_id=NEW.id) THEN RETURN NEW; END IF;
  PERFORM public.ensure_user_ledger_accounts_from_id(
    NEW.user_id,
    COALESCE(NEW.balance_before,(SELECT demo_balance FROM public.profiles WHERE id=NEW.user_id),0)
  );

  INSERT INTO public.ledger_journals(source_type,source_transaction_id,idempotency_key,description,metadata)
  VALUES ('wallet_transaction',NEW.id,'wallet:'||NEW.id,NEW.description,COALESCE(NEW.metadata,'{}'::JSONB))
  RETURNING id INTO v_journal;

  SELECT id,balance INTO v_user_cash,v_cash_balance FROM public.ledger_accounts WHERE user_id=NEW.user_id AND currency='USD' AND account_code='cash' FOR UPDATE;
  SELECT id,balance INTO v_user_bonus,v_bonus_balance FROM public.ledger_accounts WHERE user_id=NEW.user_id AND currency='USD' AND account_code='bonus' FOR UPDATE;
  SELECT id INTO v_system FROM public.ledger_accounts WHERE user_id IS NULL AND currency='USD' AND account_code=CASE WHEN NEW.type='bonus_awarded' THEN 'bonus_reserve' ELSE 'sportsbook_clearing' END FOR UPDATE;

  IF NEW.amount < 0 THEN
    v_cash_part := LEAST(v_amount,GREATEST(v_cash_balance,0));
    v_bonus_part := v_amount-v_cash_part;
    IF v_bonus_part > GREATEST(v_bonus_balance,0) THEN RAISE EXCEPTION 'Ledger funds are insufficient'; END IF;
    IF v_cash_part > 0 THEN
      UPDATE public.ledger_accounts SET balance=balance-v_cash_part,updated_at=NOW() WHERE id=v_user_cash RETURNING balance INTO v_balance;
      INSERT INTO public.ledger_postings(journal_id,account_id,amount,balance_after) VALUES(v_journal,v_user_cash,-v_cash_part,v_balance);
    END IF;
    IF v_bonus_part > 0 THEN
      UPDATE public.ledger_accounts SET balance=balance-v_bonus_part,updated_at=NOW() WHERE id=v_user_bonus RETURNING balance INTO v_balance;
      INSERT INTO public.ledger_postings(journal_id,account_id,amount,balance_after) VALUES(v_journal,v_user_bonus,-v_bonus_part,v_balance);
    END IF;
    UPDATE public.ledger_accounts SET balance=balance+v_amount,updated_at=NOW() WHERE id=v_system RETURNING balance INTO v_balance;
    INSERT INTO public.ledger_postings(journal_id,account_id,amount,balance_after) VALUES(v_journal,v_system,v_amount,v_balance);
  ELSIF NEW.amount > 0 THEN
    UPDATE public.ledger_accounts SET balance=balance-v_amount,updated_at=NOW() WHERE id=v_system RETURNING balance INTO v_balance;
    INSERT INTO public.ledger_postings(journal_id,account_id,amount,balance_after) VALUES(v_journal,v_system,-v_amount,v_balance);

    IF NEW.type='adjustment' AND NEW.reference_id IS NOT NULL THEN
      SELECT
        LEAST(v_amount,COALESCE(SUM(-p.amount) FILTER(WHERE a.account_code='cash' AND p.amount<0),0)),
        LEAST(v_amount,COALESCE(SUM(-p.amount) FILTER(WHERE a.account_code='bonus' AND p.amount<0),0))
      INTO v_cash_part,v_bonus_part
      FROM public.wallet_transactions wt
      JOIN public.ledger_journals j ON j.source_transaction_id=wt.id
      JOIN public.ledger_postings p ON p.journal_id=j.id
      JOIN public.ledger_accounts a ON a.id=p.account_id
      WHERE wt.reference_id=NEW.reference_id AND wt.type='bet_placed' AND wt.user_id=NEW.user_id;
      v_cash_part := LEAST(v_amount,COALESCE(v_cash_part,0));
      v_bonus_part := LEAST(v_amount-v_cash_part,COALESCE(v_bonus_part,0));
      v_cash_part := v_cash_part+(v_amount-v_cash_part-v_bonus_part);
    ELSE
      v_cash_part := CASE WHEN NEW.type='bonus_awarded' THEN 0 ELSE v_amount END;
      v_bonus_part := CASE WHEN NEW.type='bonus_awarded' THEN v_amount ELSE 0 END;
    END IF;

    IF v_cash_part>0 THEN
      UPDATE public.ledger_accounts SET balance=balance+v_cash_part,updated_at=NOW() WHERE id=v_user_cash RETURNING balance INTO v_balance;
      INSERT INTO public.ledger_postings(journal_id,account_id,amount,balance_after) VALUES(v_journal,v_user_cash,v_cash_part,v_balance);
    END IF;
    IF v_bonus_part>0 THEN
      UPDATE public.ledger_accounts SET balance=balance+v_bonus_part,updated_at=NOW() WHERE id=v_user_bonus RETURNING balance INTO v_balance;
      INSERT INTO public.ledger_postings(journal_id,account_id,amount,balance_after) VALUES(v_journal,v_user_bonus,v_bonus_part,v_balance);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mirror_wallet_transaction_to_ledger_trigger ON public.wallet_transactions;
CREATE TRIGGER mirror_wallet_transaction_to_ledger_trigger
AFTER INSERT ON public.wallet_transactions FOR EACH ROW EXECUTE FUNCTION public.mirror_wallet_transaction_to_ledger();

CREATE OR REPLACE FUNCTION public.get_my_wallet_balances()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object(
    'currency','USD',
    'cash',COALESCE(MAX(balance) FILTER(WHERE account_code='cash'),0),
    'bonus',COALESCE(MAX(balance) FILTER(WHERE account_code='bonus'),0),
    'locked',COALESCE(MAX(balance) FILTER(WHERE account_code='locked'),0),
    'available',COALESCE(MAX(balance) FILTER(WHERE account_code='cash'),0)+COALESCE(MAX(balance) FILTER(WHERE account_code='bonus'),0)
  ) FROM public.ledger_accounts WHERE user_id=auth.uid() AND currency='USD';
$$;

CREATE OR REPLACE FUNCTION public.get_wallet_reconciliation_report()
RETURNS TABLE(user_id UUID,profile_balance NUMERIC,ledger_available NUMERIC,difference NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_admin_role(ARRAY['finance']) THEN RAISE EXCEPTION 'Finance authorization required'; END IF;
  RETURN QUERY
  SELECT p.id,COALESCE(p.demo_balance,0),
    COALESCE(SUM(a.balance) FILTER(WHERE a.account_code IN('cash','bonus')),0),
    COALESCE(p.demo_balance,0)-COALESCE(SUM(a.balance) FILTER(WHERE a.account_code IN('cash','bonus')),0)
  FROM public.profiles p LEFT JOIN public.ledger_accounts a ON a.user_id=p.id AND a.currency='USD'
  GROUP BY p.id,p.demo_balance
  HAVING COALESCE(p.demo_balance,0)<>COALESCE(SUM(a.balance) FILTER(WHERE a.account_code IN('cash','bonus')),0)
  ORDER BY ABS(COALESCE(p.demo_balance,0)-COALESCE(SUM(a.balance) FILTER(WHERE a.account_code IN('cash','bonus')),0)) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_user_ledger_accounts() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ensure_user_ledger_accounts_from_id(UUID,NUMERIC) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mirror_wallet_transaction_to_ledger() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.verify_ledger_journal_balanced() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_my_wallet_balances() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_wallet_balances() TO authenticated;
REVOKE ALL ON FUNCTION public.get_wallet_reconciliation_report() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_wallet_reconciliation_report() TO authenticated;