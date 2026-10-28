CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  author_role TEXT NOT NULL CHECK (author_role IN ('customer', 'staff')),
  message TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 5000),
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket_created
  ON public.support_ticket_messages(ticket_id, created_at);

ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_customers_read_messages ON public.support_ticket_messages;
CREATE POLICY support_customers_read_messages ON public.support_ticket_messages
  FOR SELECT TO authenticated
  USING (
    is_internal = FALSE
    AND EXISTS (
      SELECT 1 FROM public.support_tickets ticket
      WHERE ticket.id = ticket_id AND ticket.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS support_staff_read_messages ON public.support_ticket_messages;
CREATE POLICY support_staff_read_messages ON public.support_ticket_messages
  FOR SELECT TO authenticated
  USING (public.has_admin_role(ARRAY['support']));

DROP POLICY IF EXISTS support_customers_add_messages ON public.support_ticket_messages;
CREATE POLICY support_customers_add_messages ON public.support_ticket_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND author_role = 'customer'
    AND is_internal = FALSE
    AND EXISTS (
      SELECT 1 FROM public.support_tickets ticket
      WHERE ticket.id = ticket_id AND ticket.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT ON public.support_ticket_messages TO authenticated;

CREATE OR REPLACE FUNCTION public.create_support_ticket(
  p_subject TEXT,
  p_message TEXT,
  p_priority TEXT DEFAULT 'medium'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_ticket UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF char_length(btrim(COALESCE(p_subject, ''))) NOT BETWEEN 3 AND 160 THEN
    RAISE EXCEPTION 'Subject must be between 3 and 160 characters';
  END IF;
  IF char_length(btrim(COALESCE(p_message, ''))) NOT BETWEEN 10 AND 5000 THEN
    RAISE EXCEPTION 'Message must be between 10 and 5000 characters';
  END IF;
  IF p_priority NOT IN ('low', 'medium', 'high', 'urgent') THEN
    RAISE EXCEPTION 'Invalid ticket priority';
  END IF;

  INSERT INTO public.support_tickets (user_id, subject, message, priority)
  VALUES (v_user, btrim(p_subject), btrim(p_message), p_priority)
  RETURNING id INTO v_ticket;

  INSERT INTO public.support_ticket_messages (ticket_id, author_id, author_role, message)
  VALUES (v_ticket, v_user, 'customer', btrim(p_message));

  RETURN v_ticket;
END;
$$;

CREATE OR REPLACE FUNCTION public.reply_support_ticket(
  p_ticket_id UUID,
  p_message TEXT,
  p_internal BOOLEAN DEFAULT FALSE,
  p_status TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_ticket public.support_tickets%ROWTYPE;
  v_is_staff BOOLEAN;
  v_message UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF char_length(btrim(COALESCE(p_message, ''))) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'Reply must be between 1 and 5000 characters';
  END IF;

  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support ticket not found'; END IF;

  v_is_staff := public.has_admin_role(ARRAY['support']);
  IF NOT v_is_staff AND v_ticket.user_id <> v_user THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF NOT v_is_staff AND p_internal THEN RAISE EXCEPTION 'Internal notes are staff only'; END IF;
  IF p_status IS NOT NULL AND (NOT v_is_staff OR p_status NOT IN ('open', 'in_progress', 'resolved', 'closed')) THEN
    RAISE EXCEPTION 'Invalid status change';
  END IF;

  INSERT INTO public.support_ticket_messages (ticket_id, author_id, author_role, message, is_internal)
  VALUES (p_ticket_id, v_user, CASE WHEN v_is_staff THEN 'staff' ELSE 'customer' END, btrim(p_message), COALESCE(p_internal, FALSE))
  RETURNING id INTO v_message;

  UPDATE public.support_tickets
  SET status = CASE
        WHEN p_status IS NOT NULL THEN p_status
        WHEN v_is_staff THEN 'in_progress'
        WHEN status IN ('resolved', 'closed') THEN 'open'
        ELSE status
      END,
      assigned_to = CASE WHEN v_is_staff THEN COALESCE(assigned_to, v_user) ELSE assigned_to END,
      updated_at = NOW()
  WHERE id = p_ticket_id;

  IF v_is_staff AND NOT COALESCE(p_internal, FALSE) THEN
    INSERT INTO public.notifications (user_id, type, title, message, metadata)
    VALUES (v_ticket.user_id, 'support_reply', 'Support replied', left(btrim(p_message), 240), jsonb_build_object('ticket_id', p_ticket_id));
  END IF;

  IF v_is_staff THEN
    INSERT INTO public.audit_logs (admin_id, action, entity_type, entity_id, changes)
    VALUES (v_user, 'support_reply', 'support_ticket', p_ticket_id, jsonb_build_object('internal', COALESCE(p_internal, FALSE), 'status', p_status));
  END IF;

  RETURN v_message;
END;
$$;

REVOKE ALL ON FUNCTION public.create_support_ticket(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(TEXT, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.reply_support_ticket(UUID, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reply_support_ticket(UUID, TEXT, BOOLEAN, TEXT) TO authenticated;
