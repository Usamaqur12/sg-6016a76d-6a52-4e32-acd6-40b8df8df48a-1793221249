-- Create idempotency_keys table for duplicate bet prevention
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key TEXT NOT NULL UNIQUE,
  request_data JSONB NOT NULL,
  response_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Add index for fast key lookups
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_key ON idempotency_keys(key);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_user_id ON idempotency_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at ON idempotency_keys(expires_at);

-- Enable RLS
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only see their own idempotency keys
CREATE POLICY "users_select_own_idempotency_keys" ON idempotency_keys
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "users_insert_own_idempotency_keys" ON idempotency_keys
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_delete_own_idempotency_keys" ON idempotency_keys
  FOR DELETE USING (auth.uid() = user_id);

-- Admin full access
CREATE POLICY "admins_all_idempotency_keys" ON idempotency_keys
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND admin_role IN ('super_admin', 'support')
    )
  );

SELECT 'Idempotency keys table created successfully' AS status;