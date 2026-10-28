import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const requestSchema = z.object({
  userId: z.string().uuid(),
  amount: z.coerce.number().finite().min(0.01).max(100000),
  reason: z.string().trim().min(5).max(500),
  idempotencyKey: z.string().uuid(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const auth = await requireAdminApi(req, res);
  if (!auth) return;
  if (!["super_admin", "admin", "finance"].includes(auth.adminRole)) {
    return res.status(403).json({ error: "Finance authorization required" });
  }

  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Amount must be 0.01–100000.00 and include a meaningful reason" });
  }

  try {
    const { data, error } = await supabaseAdmin.rpc("admin_credit_user_balance", {
      p_user_id: parsed.data.userId,
      p_amount: Math.round(parsed.data.amount * 100) / 100,
      p_reason: parsed.data.reason,
      p_admin_id: auth.userId,
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    if (error) throw error;
    return res.status(200).json({ success: true, result: data });
  } catch (error) {
    console.error("Balance credit failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Balance credit failed" });
  }
}
