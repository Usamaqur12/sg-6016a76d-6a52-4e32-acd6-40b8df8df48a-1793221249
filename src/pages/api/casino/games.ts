import type { NextApiRequest, NextApiResponse } from "next";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";
import { protectApi } from "@/lib/server/apiProtection";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!await protectApi(req, res, { scope: "casino-games", limit: 120, windowMs: 60_000 })) return;
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }
  if (process.env.CASINO_ENABLED !== "true") return res.status(200).json({ enabled: false, games: [] });
  try {
    const admin = supabaseAdmin;
    const { data, error } = await (admin as any).from("casino_games")
      .select("id,external_game_id,name,category,thumbnail_url,is_popular,is_new,metadata,casino_providers!inner(code,name,is_enabled)")
      .eq("is_active", true).eq("casino_providers.is_enabled", true).order("is_popular", { ascending: false }).order("name");
    if (error) throw error;
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
    return res.status(200).json({ enabled: true, games: data || [] });
  } catch (error) {
    console.error("Casino catalogue failed", error);
    return res.status(503).json({ error: "Casino catalogue is temporarily unavailable" });
  }
}
