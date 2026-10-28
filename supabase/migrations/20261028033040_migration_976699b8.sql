-- Change default balance from 10000 to 0 in wallet_accounts table
ALTER TABLE wallet_accounts
ALTER COLUMN balance SET DEFAULT 0.00;
