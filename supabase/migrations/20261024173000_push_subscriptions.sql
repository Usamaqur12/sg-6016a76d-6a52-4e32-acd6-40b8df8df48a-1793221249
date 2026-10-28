-- Browser push enrollment. Message delivery stays disabled until VAPID keys and
-- a trusted push sender are configured on the production server.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth_secret TEXT NOT NULL,
  user_agent TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK(failure_count>=0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id,endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_read_own_push_subscriptions" ON public.push_subscriptions FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY "monitoring_read_push_subscriptions" ON public.push_subscriptions FOR SELECT TO authenticated USING(public.has_admin_role(ARRAY['monitoring']));
GRANT SELECT ON public.push_subscriptions TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.push_subscriptions FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.save_my_push_subscription(p_endpoint TEXT,p_p256dh TEXT,p_auth_secret TEXT,p_user_agent TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF length(trim(COALESCE(p_endpoint,'')))<20 OR length(trim(COALESCE(p_p256dh,'')))<20 OR length(trim(COALESCE(p_auth_secret,'')))<8 THEN RAISE EXCEPTION 'Invalid push subscription'; END IF;
  INSERT INTO public.push_subscriptions(user_id,endpoint,p256dh,auth_secret,user_agent)
  VALUES(auth.uid(),trim(p_endpoint),trim(p_p256dh),trim(p_auth_secret),left(p_user_agent,500))
  ON CONFLICT(user_id,endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh,auth_secret=EXCLUDED.auth_secret,user_agent=EXCLUDED.user_agent,is_active=TRUE,failure_count=0,updated_at=NOW()
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.remove_my_push_subscription(p_endpoint TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.push_subscriptions SET is_active=FALSE,updated_at=NOW() WHERE user_id=auth.uid() AND endpoint=p_endpoint;
END; $$;

REVOKE ALL ON FUNCTION public.save_my_push_subscription(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.save_my_push_subscription(TEXT,TEXT,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.remove_my_push_subscription(TEXT) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.remove_my_push_subscription(TEXT) TO authenticated;

