import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { casinoPayloadHash, verifyCasinoSignature } from "@/lib/server/casinoProvider";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";
import { protectApi } from "@/lib/server/apiProtection";

const schema = z.object({
  providerCode: z.string().trim().min(2).max(50), sessionId: z.string().uuid(), eventId: z.string().trim().min(3).max(200),
  roundId: z.string().trim().max(200).optional().default(""), type: z.enum(["bet","win","refund"]),
  amount: z.number().positive().max(1_000_000), currency: z.literal("USD"),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!await protectApi(req, res, { scope: "casino-callback", limit: 1200, windowMs: 60_000, requireJson: true, failClosed: true })) return;
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
  const signature = Array.isArray(req.headers["x-casino-signature"]) ? req.headers["x-casino-signature"][0] : req.headers["x-casino-signature"];
  if (!verifyCasinoSignature(req.body, signature, process.env.CASINO_CALLBACK_SECRET)) return res.status(401).json({ error: "Invalid callback signature" });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid callback payload" });
  try {
    const admin = supabaseAdmin;
    const value = parsed.data;
    const { data, error } = await (admin as any).rpc("apply_casino_transaction", {
      p_provider_code: value.providerCode, p_session_id: value.sessionId, p_provider_event_id: value.eventId,
      p_provider_round_id: value.roundId, p_transaction_type: value.type, p_amount: value.amount,
      p_currency: value.currency, p_payload_hash: casinoPayloadHash(req.body), p_metadata: {},
    });
    if (error) throw error;
    return res.status(200).json({ accepted: true, result: data });
  } catch (error) {
    console.error("Casino callback failed", error);
    return res.status(409).json({ error: "Casino transaction was rejected" });
  }
}
