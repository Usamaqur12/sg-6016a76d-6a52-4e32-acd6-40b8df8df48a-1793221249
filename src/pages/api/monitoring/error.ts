import { createHash } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { protectApi } from "@/lib/server/apiProtection";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const schema = z.object({
  message: z.string().trim().min(1).max(1_000), stack: z.string().max(12_000).optional().nullable(),
  route: z.string().max(500).optional().nullable(), context: z.record(z.string(), z.unknown()).optional().default({}),
});

function redact(value: string) {
  return value.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]").replace(/(?:api[_-]?key|token|secret)=([^&\s]+)/gi, "$1=[redacted]");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!await protectApi(req, res, { scope: "browser-error", limit: 12, windowMs: 60_000, requireJson: true })) return;
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid error report" });
  try {
    const admin = supabaseAdmin;
    const message = redact(parsed.data.message);
    const route = parsed.data.route ? redact(parsed.data.route) : null;
    const stack = parsed.data.stack ? redact(parsed.data.stack) : null;
    const fingerprint = createHash("sha256").update(`${message}:${route || ""}:${stack?.split("\n")[0] || ""}`).digest("hex");
    const event = { fingerprint, source: "browser", severity: "error", message, route, stack, context: parsed.data.context };
    const { error } = await (admin as any).from("error_events").insert(event);
    if (error) throw error;
    const webhook = process.env.ERROR_MONITORING_WEBHOOK_URL;
    if (webhook) void fetch(webhook, { method: "POST", headers: { "content-type": "application/json", ...(process.env.ERROR_MONITORING_WEBHOOK_TOKEN ? { authorization: `Bearer ${process.env.ERROR_MONITORING_WEBHOOK_TOKEN}` } : {}) }, body: JSON.stringify(event), signal: AbortSignal.timeout(2_500) }).catch(() => undefined);
    return res.status(202).json({ accepted: true });
  } catch (error) {
    console.error("Error report could not be stored", error);
    return res.status(503).json({ error: "Error reporting is unavailable" });
  }
}
