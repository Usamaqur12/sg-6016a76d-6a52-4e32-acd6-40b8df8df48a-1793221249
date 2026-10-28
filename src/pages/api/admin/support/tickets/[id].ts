import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { hasAccess } from "@/lib/adminRoles";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });
  const auth = await requireAdminApi(req, res);
  if (!auth) return;
  if (!hasAccess(auth.adminRole, "support")) return res.status(403).json({ error: "Support authorization required" });

  const id = z.string().uuid().safeParse(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id);
  const body = z.object({ status: z.enum(["open", "in_progress", "resolved", "closed"]) }).safeParse(req.body);
  if (!id.success || !body.success) return res.status(400).json({ error: "Valid ticket and status are required" });

  try {
    const { data: ticket, error: ticketError } = await supabaseAdmin.from("support_tickets").select("id,status").eq("id", id.data).maybeSingle();
    if (ticketError) throw ticketError;
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    const { error } = await supabaseAdmin.from("support_tickets").update({ status: body.data.status, updated_at: new Date().toISOString() }).eq("id", id.data);
    if (error) throw error;
    const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
      admin_id: auth.userId, action: "support_ticket_status_updated", entity_type: "support_ticket", entity_id: id.data,
      changes: { from: ticket.status, to: body.data.status },
    });
    if (auditError) throw auditError;
    return res.status(200).json({ success: true, status: body.data.status });
  } catch (error) {
    console.error("Support ticket update failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Ticket update failed" });
  }
}
