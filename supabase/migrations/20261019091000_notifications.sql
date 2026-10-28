CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  bet_results BOOLEAN NOT NULL DEFAULT TRUE,
  promotions BOOLEAN NOT NULL DEFAULT TRUE,
  account_updates BOOLEAN NOT NULL DEFAULT TRUE,
  live_events BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, is_read) WHERE is_read = FALSE;

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_notification_preferences"
  ON public.notification_preferences FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_read_own_notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "users_mark_own_notifications_read"
  ON public.notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.notify_bet_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('won', 'lost', 'void', 'cancelled')
     AND COALESCE((SELECT bet_results FROM public.notification_preferences WHERE user_id = NEW.user_id), TRUE)
  THEN
    INSERT INTO public.notifications (user_id, type, title, message, metadata)
    VALUES (
      NEW.user_id,
      'bet_' || NEW.status,
      CASE NEW.status WHEN 'won' THEN 'Bet won' WHEN 'lost' THEN 'Bet settled' WHEN 'void' THEN 'Bet voided' ELSE 'Bet cancelled' END,
      CASE NEW.status
        WHEN 'won' THEN 'Your bet was settled as won. Payout: ' || COALESCE(NEW.payout, 0)::TEXT
        WHEN 'lost' THEN 'Your bet was settled as lost.'
        WHEN 'void' THEN 'Your bet was voided and handled according to the settlement rules.'
        ELSE 'Your pending bet was cancelled.'
      END,
      jsonb_build_object('bet_id', NEW.id, 'status', NEW.status, 'payout', NEW.payout)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_bet_status_change ON public.bets;
CREATE TRIGGER notify_bet_status_change
AFTER UPDATE OF status ON public.bets
FOR EACH ROW EXECUTE FUNCTION public.notify_bet_status_change();

CREATE OR REPLACE FUNCTION public.notify_kyc_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('approved', 'rejected')
     AND COALESCE((SELECT account_updates FROM public.notification_preferences WHERE user_id = NEW.user_id), TRUE)
  THEN
    INSERT INTO public.notifications (user_id, type, title, message, metadata)
    VALUES (
      NEW.user_id,
      'kyc_' || NEW.status,
      CASE NEW.status WHEN 'approved' THEN 'Verification approved' ELSE 'Verification needs attention' END,
      CASE NEW.status WHEN 'approved' THEN 'Your identity document was approved.' ELSE 'A verification document was rejected. Review your account verification page.' END,
      jsonb_build_object('document_id', NEW.id, 'status', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_kyc_status_change ON public.kyc_documents;
CREATE TRIGGER notify_kyc_status_change
AFTER UPDATE OF status ON public.kyc_documents
FOR EACH ROW EXECUTE FUNCTION public.notify_kyc_status_change();

