-- Add policy to allow users to read their own profile if it doesn't exist
DO $$
BEGIN
  -- Drop existing select_own policy if it exists to recreate it properly
  DROP POLICY IF EXISTS "select_own" ON public.profiles;
  
  -- Create policy allowing users to read their own profile
  CREATE POLICY "select_own" ON public.profiles
    FOR SELECT
    USING (auth.uid() = id);
    
  RAISE NOTICE 'RLS policy created: users can read their own profile';
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'Policy already exists';
END $$;

-- Verify the policy was created
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'profiles' AND policyname = 'select_own';