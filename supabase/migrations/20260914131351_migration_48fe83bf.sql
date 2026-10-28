-- Add missing columns to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS demo_balance DECIMAL(15,2) DEFAULT 10000.00;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS admin_role TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kyc_status TEXT DEFAULT 'not_submitted';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referred_by TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS suspension_reason TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS self_exclusion_until TIMESTAMP WITH TIME ZONE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deposit_limit DECIMAL(15,2);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS loss_limit DECIMAL(15,2);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE;

-- Add check constraint for admin_role
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_admin_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_admin_role_check 
  CHECK (admin_role IN ('super_admin', 'finance', 'kyc', 'support', 'risk_manager', 'sports_trader') OR admin_role IS NULL);

-- Add check constraint for kyc_status
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_kyc_status_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_kyc_status_check 
  CHECK (kyc_status IN ('not_submitted', 'pending', 'approved', 'rejected'));

-- Create index on referral_code
CREATE INDEX IF NOT EXISTS idx_profiles_referral_code ON profiles(referral_code);