ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en','ur'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_currency TEXT NOT NULL DEFAULT 'USD' CHECK (display_currency IN ('USD','PKR'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Karachi';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS odds_format TEXT NOT NULL DEFAULT 'decimal' CHECK (odds_format IN ('decimal','fractional','american'));

CREATE OR REPLACE FUNCTION public.update_my_display_preferences(p_locale TEXT,p_currency TEXT,p_timezone TEXT,p_odds_format TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_locale NOT IN ('en','ur') OR p_currency NOT IN ('USD','PKR') OR p_odds_format NOT IN ('decimal','fractional','american') THEN RAISE EXCEPTION 'Invalid display preference'; END IF;
  IF length(trim(COALESCE(p_timezone,'')))<3 OR length(p_timezone)>80 THEN RAISE EXCEPTION 'Invalid timezone'; END IF;
  UPDATE public.profiles SET locale=p_locale,display_currency=p_currency,timezone=trim(p_timezone),odds_format=p_odds_format,updated_at=NOW() WHERE id=auth.uid();
END; $$;
REVOKE ALL ON FUNCTION public.update_my_display_preferences(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_my_display_preferences(TEXT,TEXT,TEXT,TEXT) TO authenticated;
