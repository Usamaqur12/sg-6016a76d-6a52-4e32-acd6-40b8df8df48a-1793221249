-- Responsible-play controls must be enforced by the database, not only by UI checks.

CREATE OR REPLACE FUNCTION public.set_my_responsible_limit(
  p_limit_type TEXT,
  p_limit_value NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_existing public.responsible_gaming_limits%ROWTYPE;
  v_id UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_limit_type NOT IN ('daily_stake', 'weekly_stake', 'monthly_stake') THEN
    RAISE EXCEPTION 'Unsupported limit type';
  END IF;
  IF p_limit_value IS NULL OR p_limit_value <= 0 OR p_limit_value > 1000000 THEN
    RAISE EXCEPTION 'Invalid limit value';
  END IF;

  v_start := CASE p_limit_type
    WHEN 'daily_stake' THEN date_trunc('day', NOW())
    WHEN 'weekly_stake' THEN date_trunc('week', NOW())
    ELSE date_trunc('month', NOW())
  END;
  v_end := CASE p_limit_type
    WHEN 'daily_stake' THEN v_start + INTERVAL '1 day'
    WHEN 'weekly_stake' THEN v_start + INTERVAL '1 week'
    ELSE v_start + INTERVAL '1 month'
  END;

  SELECT * INTO v_existing
  FROM public.responsible_gaming_limits
  WHERE user_id = v_user_id AND limit_type = p_limit_type AND is_active = TRUE
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND AND p_limit_value > v_existing.limit_value AND v_existing.period_end > NOW() THEN
    RAISE EXCEPTION 'An active limit can only be reduced until its period ends';
  END IF;

  UPDATE public.responsible_gaming_limits
  SET is_active = FALSE, updated_at = NOW()
  WHERE user_id = v_user_id AND limit_type = p_limit_type AND is_active = TRUE;

  INSERT INTO public.responsible_gaming_limits (
    user_id, limit_type, limit_value, period_start, period_end,
    current_usage, is_active
  ) VALUES (
    v_user_id, p_limit_type, p_limit_value, v_start, v_end,
    COALESCE(v_existing.current_usage, 0), TRUE
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_responsible_limit(TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_responsible_limit(TEXT, NUMERIC) TO authenticated;

CREATE OR REPLACE FUNCTION public.start_my_self_exclusion(
  p_exclusion_type TEXT,
  p_duration_days INTEGER DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_end TIMESTAMPTZ;
  v_id UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_exclusion_type NOT IN ('timeout', 'self_exclusion', 'permanent') THEN
    RAISE EXCEPTION 'Invalid exclusion type';
  END IF;
  IF p_exclusion_type = 'timeout' AND (p_duration_days IS NULL OR p_duration_days < 1 OR p_duration_days > 30) THEN
    RAISE EXCEPTION 'Timeout must be between 1 and 30 days';
  END IF;
  IF p_exclusion_type = 'self_exclusion' AND (p_duration_days IS NULL OR p_duration_days < 180) THEN
    RAISE EXCEPTION 'Self-exclusion must be at least 180 days';
  END IF;

  v_end := CASE
    WHEN p_exclusion_type = 'permanent' THEN NULL
    ELSE NOW() + make_interval(days => p_duration_days)
  END;

  INSERT INTO public.self_exclusions (
    user_id, exclusion_type, start_date, end_date, reason, is_active
  ) VALUES (
    v_user_id, p_exclusion_type, NOW(), v_end, NULLIF(trim(p_reason), ''), TRUE
  )
  ON CONFLICT (user_id) DO UPDATE SET
    exclusion_type = CASE
      WHEN self_exclusions.is_active AND self_exclusions.end_date IS NULL THEN self_exclusions.exclusion_type
      ELSE EXCLUDED.exclusion_type
    END,
    start_date = CASE
      WHEN self_exclusions.is_active AND self_exclusions.end_date IS NULL THEN self_exclusions.start_date
      ELSE NOW()
    END,
    end_date = CASE
      WHEN self_exclusions.is_active AND self_exclusions.end_date IS NULL THEN NULL
      WHEN EXCLUDED.end_date IS NULL THEN NULL
      ELSE GREATEST(COALESCE(self_exclusions.end_date, EXCLUDED.end_date), EXCLUDED.end_date)
    END,
    reason = COALESCE(EXCLUDED.reason, self_exclusions.reason),
    is_active = TRUE
  RETURNING id INTO v_id;

  UPDATE public.profiles
  SET self_exclusion_until = COALESCE(v_end, TIMESTAMPTZ '9999-12-31 23:59:59+00'),
      updated_at = NOW()
  WHERE id = v_user_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.start_my_self_exclusion(TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_my_self_exclusion(TEXT, INTEGER, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_responsible_gaming_before_bet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit public.responsible_gaming_limits%ROWTYPE;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.self_exclusions
    WHERE user_id = NEW.user_id AND is_active = TRUE
      AND (end_date IS NULL OR end_date > NOW())
  ) THEN
    RAISE EXCEPTION 'Account is self-excluded';
  END IF;

  FOR v_limit IN
    SELECT * FROM public.responsible_gaming_limits
    WHERE user_id = NEW.user_id
      AND limit_type IN ('daily_stake', 'weekly_stake', 'monthly_stake')
      AND is_active = TRUE
      AND period_start <= NOW() AND period_end > NOW()
    FOR UPDATE
  LOOP
    IF COALESCE(v_limit.current_usage, 0) + NEW.stake > v_limit.limit_value THEN
      RAISE EXCEPTION '% limit exceeded', replace(v_limit.limit_type, '_', ' ');
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_responsible_gaming_usage_after_bet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.responsible_gaming_limits
  SET current_usage = COALESCE(current_usage, 0) + NEW.stake,
      updated_at = NOW()
  WHERE user_id = NEW.user_id
    AND limit_type IN ('daily_stake', 'weekly_stake', 'monthly_stake')
    AND is_active = TRUE
    AND period_start <= NOW() AND period_end > NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_responsible_gaming_before_bet ON public.bets;
CREATE TRIGGER enforce_responsible_gaming_before_bet
BEFORE INSERT ON public.bets
FOR EACH ROW EXECUTE FUNCTION public.enforce_responsible_gaming_before_bet();

DROP TRIGGER IF EXISTS record_responsible_gaming_usage_after_bet ON public.bets;
CREATE TRIGGER record_responsible_gaming_usage_after_bet
AFTER INSERT ON public.bets
FOR EACH ROW EXECUTE FUNCTION public.record_responsible_gaming_usage_after_bet();

DROP POLICY IF EXISTS "Users manage own RG limits" ON public.responsible_gaming_limits;
CREATE POLICY "users_read_own_rg_limits" ON public.responsible_gaming_limits
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users see own exclusions" ON public.self_exclusions;
CREATE POLICY "users_read_own_exclusions" ON public.self_exclusions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

