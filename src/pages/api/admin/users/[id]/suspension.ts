import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const requestSchema = z.object({ suspended: z.boolean() });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });

  const auth = await requireAdminApi(req, res);
  if (!auth) return;
  if (!["super_admin", "admin", "support"].includes(auth.adminRole)) {
    return res.status(403).json({ error: "User management authorization required" });
  }

  const id = z.string().uuid().safeParse(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id);
  const body = requestSchema.safeParse(req.body);
  if (!id.success || !body.success) {
    return res.status(400).json({ error: "Valid user ID and suspension state are required" });
  }

  try {
    const { data: target, error: targetError } = await supabaseAdmin
      .from("profiles")
      .select("id,email,is_admin,is_suspended")
      .eq("id", id.data)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target || target.is_admin) return res.status(404).json({ error: "Customer account not found" });
    if (target.is_suspended === body.data.suspended) {
      return res.status(200).json({ success: true, unchanged: true });
    }

    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ is_suspended: body.data.suspended })
      .eq("id", id.data)
      .eq("is_admin", false);
    if (updateError) throw updateError;

    const forwardedFor = req.headers["x-forwarded-for"];
    const ipAddress = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor?.split(",")[0]?.trim() || req.socket.remoteAddress || null;
    const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
      admin_id: auth.userId,
      action: body.data.suspended ? "user_suspended" : "user_unsuspended",
      entity_type: "user",
      entity_id: id.data,
      changes: { email: target.email, suspended: body.data.suspended },
      ip_address: ipAddress,
      user_agent: req.headers["user-agent"] || null,
    });
    if (auditError) throw auditError;

    return res.status(200).json({ success: true, suspended: body.data.suspended });
  } catch (error) {
    console.error("User suspension update failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "User update failed" });
  }
}
