import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { protectApi } from "@/lib/server/apiProtection";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(20).max(500), auth: z.string().min(8).max(500) }),
});
const unsubscribeSchema = z.object({ endpoint: z.string().url().max(2000) });

function bearerToken(value: string | undefined) {
  if (!value?.startsWith("Bearer ")) return null;
  return value.slice(7).trim() || null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!await protectApi(req, res, { scope: "push-subscribe", limit: 12, windowMs: 60_000, requireJson: true })) return;
  if (req.method !== "POST" && req.method !== "DELETE") { res.setHeader("Allow", "POST, DELETE"); return res.status(405).json({ error: "Method not allowed" }); }
  if (process.env.WEB_PUSH_ENABLED !== "true") return res.status(503).json({ error: "Push enrollment is not enabled" });
  const token = bearerToken(req.headers.authorization);
  if (!token) return res.status(401).json({ error: "Authentication required" });
  const parsed = (req.method === "POST" ? subscribeSchema : unsubscribeSchema).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid push subscription" });
  const admin = supabaseAdmin;
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return res.status(401).json({ error: "Invalid session" });
  const operation = req.method === "POST"
    ? (admin as any).from("push_subscriptions").upsert({ user_id: authData.user.id, endpoint: parsed.data.endpoint, p256dh: (parsed.data as z.infer<typeof subscribeSchema>).keys.p256dh, auth_secret: (parsed.data as z.infer<typeof subscribeSchema>).keys.auth, user_agent: req.headers["user-agent"] || null, is_active: true, failure_count: 0, updated_at: new Date().toISOString() }, { onConflict: "user_id,endpoint" }).select("id").single()
    : (admin as any).from("push_subscriptions").update({ is_active: false, updated_at: new Date().toISOString() }).eq("user_id", authData.user.id).eq("endpoint", parsed.data.endpoint).select("id").maybeSingle();
  const { data, error } = await operation;
  if (error) return res.status(400).json({ error: error.message });
  return res.status(200).json({ success: true, subscriptionId: data?.id || null });
}

