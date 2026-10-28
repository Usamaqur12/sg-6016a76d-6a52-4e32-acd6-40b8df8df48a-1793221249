import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { hasAccess } from "@/lib/adminRoles";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const promotionSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).nullable(),
  type: z.enum(["welcome_bonus", "deposit_bonus", "free_bet", "cashback", "referral"]),
  bonus_amount: z.coerce.number().positive().max(1_000_000),
  wagering_requirement: z.coerce.number().min(0).max(1000),
  promo_code: z.string().trim().max(80).nullable(),
  min_odds: z.coerce.number().min(1).max(1000),
  expires_after_days: z.coerce.number().int().min(1).max(365),
  is_active: z.boolean(),
});

async function audit(adminId: string, action: string, entityId: string, changes: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from("audit_logs").insert({ admin_id: adminId, action, entity_type: "promotion", entity_id: entityId, changes });
  if (error) throw error;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAdminApi(req, res);
  if (!auth) return;
  if (!hasAccess(auth.adminRole, "promotions")) return res.status(403).json({ error: "Promotion authorization required" });

  try {
    if (req.method === "POST") {
      const parsed = promotionSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Promotion fields are invalid" });
      const now = new Date();
      const values = { ...parsed.data, max_bonus: parsed.data.bonus_amount, promo_code: parsed.data.promo_code || null, valid_from: now.toISOString(), valid_until: new Date(now.getTime() + 90 * 86400000).toISOString() };
      const { data, error } = await supabaseAdmin.from("promotions").insert(values).select("id").single();
      if (error) throw error;
      await audit(auth.userId, "promotion_created", data.id, { title: values.title, active: values.is_active });
      return res.status(201).json({ success: true, id: data.id });
    }

    if (req.method === "PATCH") {
      const parsed = promotionSchema.partial().extend({ id: z.string().uuid() }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Promotion update is invalid" });
      const { id, ...changes } = parsed.data;
      if (Object.keys(changes).length === 0) return res.status(400).json({ error: "No promotion changes supplied" });
      const updates: Record<string, unknown> = { ...changes, updated_at: new Date().toISOString() };
      if (changes.bonus_amount !== undefined) updates.max_bonus = changes.bonus_amount;
      if (changes.promo_code !== undefined) updates.promo_code = changes.promo_code || null;
      const { error } = await supabaseAdmin.from("promotions").update(updates).eq("id", id);
      if (error) throw error;
      await audit(auth.userId, "promotion_updated", id, changes);
      return res.status(200).json({ success: true });
    }

    res.setHeader("Allow", "POST, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("Promotion operation failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Promotion operation failed" });
  }
}
