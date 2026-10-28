-- Change default demo_balance from 10000 to 0 in profiles table
ALTER TABLE profiles
ALTER COLUMN demo_balance SET DEFAULT 0.00;
