import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import { canAccessAdminArea, type AdminArea } from "@/lib/adminRoles";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabasePublicKey = (
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)?.trim();

type ApiRequirement = AdminArea | "super_admin";

const ADMIN_API_ACCESS: Array<{ prefix: string; requirement: ApiRequirement }> = [
  { prefix: "/api/admin/admin-users", requirement: "super_admin" },
  { prefix: "/api/admin/readiness", requirement: "super_admin" },
  { prefix: "/api/admin/dashboard", requirement: "dashboard" },
  { prefix: "/api/admin/users", requirement: "users" },
  { prefix: "/api/admin/announcements", requirement: "announcements" },
  { prefix: "/api/admin/promotions", requirement: "promotions" },
  { prefix: "/api/admin/support", requirement: "support" },
  { prefix: "/api/admin/casino-catalogue", requirement: "casino" },
  { prefix: "/api/admin/generate-markets", requirement: "sports_management" },
  { prefix: "/api/admin/sports-catalogue", requirement: "sports_management" },
  { prefix: "/api/admin/sports-providers", requirement: "sports_management" },
];

function getApiRequirement(url: string | undefined): ApiRequirement | null {
  const pathname = new URL(url || "/", "http://localhost").pathname;
  return ADMIN_API_ACCESS.find(({ prefix }) => pathname.startsWith(prefix))?.requirement ?? null;
}

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

  const adminRole = profile.admin_role || "admin";
  const requirement = getApiRequirement(req.url);
  const pathname = new URL(req.url || "/", "http://localhost").pathname;

  const denied =
    requirement === "super_admin"
      ? adminRole !== "super_admin"
      : requirement
        ? !canAccessAdminArea(adminRole, requirement)
        : pathname.startsWith("/api/admin/") && adminRole !== "super_admin";

  if (denied) {
    res.status(403).json({ error: "Your admin role does not allow this operation" });
    return null;
  }

  return { userId: user.id, adminRole };
}
