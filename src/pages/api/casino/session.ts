import { randomUUID } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";
import { protectApi } from "@/lib/server/apiProtection";
import { createCasinoLaunch } from "@/lib/server/casinoProvider";

const schema = z.object({ gameId: z.string().uuid() });
function bearer(value: string | undefined) { return value?.startsWith("Bearer ") ? value.slice(7).trim() : null; }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!await protectApi(req, res, { scope: "casino-session", limit: 10, windowMs: 60_000, requireJson: true, failClosed: process.env.NODE_ENV === "production" })) return;
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
  if (process.env.CASINO_ENABLED !== "true") return res.status(503).json({ error: "Casino is not enabled" });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid game request" });
  const token = bearer(req.headers.authorization);
  if (!token) return res.status(401).json({ error: "Authentication required" });
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (!siteUrl || !process.env.CASINO_CALLBACK_SECRET) return res.status(503).json({ error: "Casino callbacks are not configured" });

  const admin = supabaseAdmin;
  const { data: auth } = await admin.auth.getUser(token);
  if (!auth.user) return res.status(401).json({ error: "Invalid session" });
  const [{ data: profile }, { data: game }] = await Promise.all([
    (admin as any).from("profiles").select("id,kyc_status,is_suspended,is_self_excluded,self_exclusion_until").eq("id", auth.user.id).single(),
    (admin as any).from("casino_games").select("id,external_game_id,provider_id,casino_providers!inner(is_enabled)").eq("id", parsed.data.gameId).eq("is_active", true).single(),
  ]);
  const excluded = profile?.is_self_excluded || (profile?.self_exclusion_until && new Date(profile.self_exclusion_until).getTime() > Date.now());
  if (!profile || profile.kyc_status !== "approved" || profile.is_suspended || excluded) return res.status(403).json({ error: "Approved KYC and an active, unrestricted account are required" });
  if (!game || !game.casino_providers?.is_enabled) return res.status(404).json({ error: "Game is unavailable" });

  const sessionId = randomUUID();
  const { error: insertError } = await (admin as any).from("casino_sessions").insert({ id: sessionId, user_id: auth.user.id, provider_id: game.provider_id, game_id: game.id, status: "creating" });
  if (insertError) return res.status(409).json({ error: "Game session could not be created" });
  try {
    const launch = await createCasinoLaunch({ sessionId, gameId: game.external_game_id, userId: auth.user.id, currency: "USD", callbackUrl: `${siteUrl}/api/casino/callback`, returnUrl: `${siteUrl}/casino` });
    await (admin as any).from("casino_sessions").update({ provider_session_id: launch.providerSessionId, status: "active", expires_at: new Date(Date.now() + 2 * 60 * 60_000).toISOString(), updated_at: new Date().toISOString() }).eq("id", sessionId);
    return res.status(201).json({ launchUrl: launch.launchUrl, sessionId });
  } catch (error) {
    console.error("Casino launch failed", error);
    await (admin as any).from("casino_sessions").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", sessionId);
    return res.status(502).json({ error: "Casino provider could not launch the game" });
  }
}
