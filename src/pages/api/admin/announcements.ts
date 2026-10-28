import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { hasAccess } from "@/lib/adminRoles";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const valuesSchema = z.object({
  title: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(5000),
  type: z.enum(["info", "warning", "success", "urgent"]),
  priority: z.coerce.number().int().min(0).max(1000),
  is_active: z.boolean(),
  starts_at: z.string().min(1),
  expires_at: z.string().nullable(),
});

async function audit(adminId: string, action: string, entityId: string, changes: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from("audit_logs").insert({
    admin_id: adminId, action, entity_type: "announcement", entity_id: entityId, changes,
  });
  if (error) throw error;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAdminApi(req, res);
  if (!auth) return;
  if (!hasAccess(auth.adminRole, "announcements")) {
    return res.status(403).json({ error: "Announcement authorization required" });
  }

  try {
    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin.from("announcements").select("*").order("priority", { ascending: false }).order("created_at", { ascending: false });
      if (error) throw error;
      return res.status(200).json({ announcements: data || [] });
    }

    if (req.method === "POST") {
      const parsed = valuesSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Valid announcement fields are required" });
      const values = normalizeDates(parsed.data);
      if (!values) return res.status(400).json({ error: "Announcement dates are invalid" });
      const { data, error } = await supabaseAdmin.from("announcements").insert({ ...values, created_by: auth.userId }).select("id").single();
      if (error) throw error;
      await audit(auth.userId, "announcement_created", data.id, { title: values.title });
      return res.status(201).json({ success: true, id: data.id });
    }

    if (req.method === "PATCH") {
      const parsed = valuesSchema.extend({ id: z.string().uuid() }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Valid announcement fields are required" });
      const { id, ...rawValues } = parsed.data;
      const values = normalizeDates(rawValues);
      if (!values) return res.status(400).json({ error: "Announcement dates are invalid" });
      const { error } = await supabaseAdmin.from("announcements").update({ ...values, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
      await audit(auth.userId, "announcement_updated", id, { title: values.title, active: values.is_active });
      return res.status(200).json({ success: true });
    }

    if (req.method === "DELETE") {
      const id = z.string().uuid().safeParse(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id);
      if (!id.success) return res.status(400).json({ error: "Valid announcement ID is required" });
      const { error } = await supabaseAdmin.from("announcements").delete().eq("id", id.data);
      if (error) throw error;
      await audit(auth.userId, "announcement_deleted", id.data, {});
      return res.status(200).json({ success: true });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("Announcement operation failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Announcement operation failed" });
  }
}

function normalizeDates(values: z.infer<typeof valuesSchema>) {
  const startsAt = new Date(values.starts_at);
  const expiresAt = values.expires_at ? new Date(values.expires_at) : null;
  if (Number.isNaN(startsAt.getTime()) || (expiresAt && Number.isNaN(expiresAt.getTime()))) return null;
  if (expiresAt && expiresAt <= startsAt) return null;
  return { ...values, starts_at: startsAt.toISOString(), expires_at: expiresAt?.toISOString() || null };
}
