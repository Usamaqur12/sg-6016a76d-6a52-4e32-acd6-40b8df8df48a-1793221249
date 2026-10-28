-- Add missing columns to wallet_transactions table
ALTER TABLE wallet_transactions
ADD COLUMN IF NOT EXISTS balance_before NUMERIC(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS balance_after NUMERIC(12,2) DEFAULT 0;

SELECT 'Added balance_before and balance_after columns to wallet_transactions' AS status;