import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { hasAccess } from "@/lib/adminRoles";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const auth = await requireAdminApi(req, res);
  if (!auth) return;
  if (!hasAccess(auth.adminRole, "audit")) {
    return res.status(403).json({ error: "Audit log authorization required" });
  }

  const limitResult = z.coerce.number().int().min(1).max(500).safeParse(req.query.limit || 200);
  if (!limitResult.success) return res.status(400).json({ error: "Invalid result limit" });

  try {
    const { data: logs, error } = await supabaseAdmin
      .from("audit_logs")
      .select("id,admin_id,action,entity_type,entity_id,changes,ip_address,created_at")
      .order("created_at", { ascending: false })
      .limit(limitResult.data);
    if (error) throw error;

    const adminIds = [...new Set((logs || []).map((log) => log.admin_id))];
    const { data: profiles, error: profileError } = adminIds.length
      ? await supabaseAdmin.from("profiles").select("id,email,admin_role").in("id", adminIds)
      : { data: [], error: null };
    if (profileError) throw profileError;
    const admins = new Map((profiles || []).map((profile) => [profile.id, profile]));

    return res.status(200).json({
      logs: (logs || []).map((log) => {
        const admin = admins.get(log.admin_id);
        return {
          id: log.id,
          admin_email: admin?.email || "Unknown admin",
          admin_role: admin?.admin_role || "unknown",
          action: log.action,
          entity_type: log.entity_type,
          entity_id: log.entity_id,
          details: log.changes && Object.keys(log.changes).length > 0 ? JSON.stringify(log.changes) : "No additional details",
          ip_address: log.ip_address,
          timestamp: log.created_at,
        };
      }),
    });
  } catch (error) {
    console.error("Audit log fetch failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Audit logs could not be loaded" });
  }
}
