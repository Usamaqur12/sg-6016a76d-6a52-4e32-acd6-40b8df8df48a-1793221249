DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'support_tickets'
      AND policyname = 'admins_read_support_tickets'
  ) THEN
    CREATE POLICY "admins_read_support_tickets"
    ON public.support_tickets
    FOR SELECT
    TO authenticated
    USING (has_admin_role(ARRAY['support'::text, 'admin'::text, 'super_admin'::text]));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'support_tickets'
      AND policyname = 'admins_update_support_tickets'
  ) THEN
    CREATE POLICY "admins_update_support_tickets"
    ON public.support_tickets
    FOR UPDATE
    TO authenticated
    USING (has_admin_role(ARRAY['support'::text, 'admin'::text, 'super_admin'::text]))
    WITH CHECK (has_admin_role(ARRAY['support'::text, 'admin'::text, 'super_admin'::text]));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'support_ticket_messages'
      AND policyname = 'admins_read_support_messages'
  ) THEN
    CREATE POLICY "admins_read_support_messages"
    ON public.support_ticket_messages
    FOR SELECT
    TO authenticated
    USING (has_admin_role(ARRAY['support'::text, 'admin'::text, 'super_admin'::text]));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'support_ticket_messages'
      AND policyname = 'admins_insert_support_messages'
  ) THEN
    CREATE POLICY "admins_insert_support_messages"
    ON public.support_ticket_messages
    FOR INSERT
    TO authenticated
    WITH CHECK (
      has_admin_role(ARRAY['support'::text, 'admin'::text, 'super_admin'::text])
      AND author_role = 'staff'::text
    );
  END IF;
END $$;

SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('support_tickets', 'support_ticket_messages')
ORDER BY tablename, policyname;