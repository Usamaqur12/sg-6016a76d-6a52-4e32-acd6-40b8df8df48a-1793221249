-- Add missing columns for sportsbook control system

-- 1. Add is_suspended to events table (for admin to suspend events)
ALTER TABLE events 
ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false;

-- 2. Add is_locked to odds table (for admin to lock individual odds)
ALTER TABLE odds
ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_events_is_suspended ON events(is_suspended);
CREATE INDEX IF NOT EXISTS idx_odds_is_locked ON odds(is_locked);

SELECT 'Added is_suspended to events and is_locked to odds' AS status;