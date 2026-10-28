import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { hasAccess } from "@/lib/adminRoles";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";
import { syncSportsProvider, type ManagedSportsProvider } from "@/lib/server/syncSportsProvider";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const adminAuth = await requireAdminApi(req, res);
  if (!adminAuth) return;

  if (!hasAccess(adminAuth.adminRole, "sports_management")) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  const { id: providerId } = req.query;
  const { action } = req.body;

  if (!providerId || typeof providerId !== "string") {
    return res.status(400).json({ error: "Provider ID is required" });
  }

  if (!action || !["test", "sync"].includes(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }

  try {
    const { data: provider, error: fetchError } = await supabaseAdmin
      .from("sports_feed_providers")
      .select("*")
      .eq("id", providerId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!provider) return res.status(404).json({ error: "Provider not found" });
    if (action === "sync" && !provider.is_enabled) return res.status(400).json({ error: "Enable the provider before syncing" });
    return res.status(200).json(await syncSportsProvider(provider as ManagedSportsProvider, action));
  } catch (error: any) {
    console.error("Provider action error:", error);
    return res.status(500).json({
      error: "Failed to perform provider action",
      details: error.message,
    });
  }
}
