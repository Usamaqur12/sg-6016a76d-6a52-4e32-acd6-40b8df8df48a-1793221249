import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";
import { verifyBearerSecret } from "@/lib/server/verifyBearerSecret";
import { protectApi } from "@/lib/server/apiProtection";

const marketTypes = [
  "match_result", "over_under", "handicap", "both_teams_score",
  "correct_score", "double_chance", "draw_no_bet", "first_half", "total_goals",
] as const;

const feedSchema = z.object({
  updateId: z.string().trim().min(3).max(200),
  providerId: z.string().trim().min(2).max(100),
  providerEventId: z.string().trim().min(1).max(200),
  sport: z.object({ name: z.string().min(1).max(100), slug: z.string().regex(/^[a-z0-9-]+$/), icon: z.string().max(30).optional() }),
  league: z.object({ name: z.string().min(1).max(150), slug: z.string().regex(/^[a-z0-9-]+$/), country: z.string().max(100).optional() }),
  homeTeam: z.string().trim().min(1).max(150),
  awayTeam: z.string().trim().min(1).max(150),
  startTime: z.string().datetime({ offset: true }),
  status: z.enum(["upcoming", "live", "finished", "cancelled", "postponed"]),
  homeScore: z.number().int().min(0).nullable().optional(),
  awayScore: z.number().int().min(0).nullable().optional(),
  liveMinute: z.number().int().min(0).max(1000).nullable().optional(),
  incident: z.enum(["goal", "penalty", "red_card", "var", "wicket", "match_point"]).optional(),
  resumeMarkets: z.boolean().optional(),
  markets: z.array(z.object({
    name: z.string().min(1).max(150),
    type: z.enum(marketTypes),
    line: z.number().nullable().optional(),
    status: z.enum(["active", "suspended"]).optional(),
    outcomes: z.array(z.object({
      selection: z.string().trim().min(1).max(150),
      value: z.number().min(1.01).max(10000),
      active: z.boolean().optional(),
    })).max(100),
  })).max(100),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!await protectApi(req, res, { scope: "provider-feed", limit: 600, windowMs: 60_000, requireJson: true })) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!verifyBearerSecret(req.headers.authorization, process.env.SPORTS_FEED_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = feedSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid feed payload", details: parsed.error.flatten() });

  const value = parsed.data;
  const payload = {
    provider_id: value.providerId,
    provider_event_id: value.providerEventId,
    sport_name: value.sport.name,
    sport_slug: value.sport.slug,
    sport_icon: value.sport.icon || null,
    league_name: value.league.name,
    league_slug: value.league.slug,
    country: value.league.country || null,
    home_team: value.homeTeam,
    away_team: value.awayTeam,
    start_time: value.startTime,
    status: value.status,
    home_score: value.homeScore,
    away_score: value.awayScore,
    live_minute: value.liveMinute,
    incident: value.incident,
    resume_markets: value.resumeMarkets || false,
    markets: value.markets.map((market) => ({
      name: market.name, type: market.type, line: market.line ?? null, status: market.status || "active",
      outcomes: market.outcomes,
    })),
  };

  try {
    const admin = supabaseAdmin;
    const { data, error } = await admin.rpc("ingest_sports_feed_event", { p_update_id: value.updateId, p_payload: payload });
    if (error) throw error;
    return res.status(202).json({ accepted: true, result: data });
  } catch (error) {
    console.error("Sports feed ingestion failed", error);
    return res.status(500).json({ error: "Unable to ingest sports feed update" });
  }
}
