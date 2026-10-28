-- Step 3: Create new admin policies using the SECURITY DEFINER function
-- These will NOT cause recursion because is_admin() bypasses RLS

CREATE POLICY "admins_select_all_profiles"
ON public.profiles
FOR SELECT
TO public
USING (public.is_admin());

CREATE POLICY "admins_update_all_profiles"
ON public.profiles
FOR UPDATE
TO public
USING (public.is_admin());

-- Verify all current policies on profiles
SELECT 
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'profiles'
ORDER BY cmd, policyname;