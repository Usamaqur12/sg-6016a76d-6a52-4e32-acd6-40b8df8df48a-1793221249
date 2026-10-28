import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabasePublicKey = (
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)?.trim();

export async function requireAdminApi(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<{ userId: string; adminRole: string } | null> {
  if (!supabaseUrl || !supabasePublicKey) {
    res.status(503).json({ error: "Supabase authentication is not configured" });
    return null;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid authorization header" });
    return null;
  }

  const token = authHeader.substring(7);
  const supabase = createClient(supabaseUrl, supabasePublicKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return null;
  }

  // Check admin status (2FA requirement removed)
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_admin, admin_role, is_suspended")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile?.is_admin || profile.is_suspended) {
    res.status(403).json({ error: "Admin access denied" });
    return null;
  }

  return { userId: user.id, adminRole: profile.admin_role || "admin" };
}
