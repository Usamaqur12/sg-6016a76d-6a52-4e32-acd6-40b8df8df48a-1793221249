-- Create market_correlation_rules table for bet builder
CREATE TABLE IF NOT EXISTS market_correlation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  market_id_1 UUID NOT NULL,
  market_id_2 UUID NOT NULL,
  correlation_type TEXT NOT NULL CHECK (correlation_type IN ('independent', 'dependent', 'mutually_exclusive')),
  is_allowed BOOLEAN NOT NULL DEFAULT true,
  adjustment_factor NUMERIC(5, 2) DEFAULT 1.00,
  rule_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_correlation_rules_event_id ON market_correlation_rules(event_id);
CREATE INDEX IF NOT EXISTS idx_market_correlation_rules_markets ON market_correlation_rules(market_id_1, market_id_2);

-- Enable RLS
ALTER TABLE market_correlation_rules ENABLE ROW LEVEL SECURITY;

-- Public read access for checking correlations
CREATE POLICY "Public can view correlation rules"
  ON market_correlation_rules FOR SELECT
  TO authenticated
  USING (true);

-- Admins can manage
CREATE POLICY "Admins can manage correlation rules"
  ON market_correlation_rules FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.admin_role IN ('super_admin', 'sports_trader')
    )
  );

SELECT 'Market correlation rules table created successfully' AS status;