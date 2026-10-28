import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";
import { verifyBearerSecret } from "@/lib/server/verifyBearerSecret";
import { protectApi } from "@/lib/server/apiProtection";

const resultSchema = z.object({
  eventId: z.string().uuid(),
  providerReference: z.string().trim().min(3).max(200),
  status: z.enum(["finished", "cancelled"]),
  homeScore: z.number().int().min(0).nullable(),
  awayScore: z.number().int().min(0).nullable(),
  markets: z.array(z.object({
    marketId: z.string().uuid(),
    winningSelection: z.string().trim().min(1).max(200),
  })).max(100),
}).superRefine((value, context) => {
  if (value.status === "finished" && value.markets.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["markets"],
      message: "Finished events require at least one market result",
    });
  }
  if (value.status === "finished" && (value.homeScore === null || value.awayScore === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["homeScore"],
      message: "Finished events require final scores",
    });
  }
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!await protectApi(req, res, { scope: "provider-results", limit: 240, windowMs: 60_000, requireJson: true })) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!verifyBearerSecret(req.headers.authorization, process.env.SPORTS_FEED_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = resultSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid result payload",
      details: parsed.error.flatten(),
    });
  }

  try {
    const admin = supabaseAdmin;
    const { data, error } = await admin.rpc("record_event_result_and_queue", {
      p_event_id: parsed.data.eventId,
      p_status: parsed.data.status,
      p_home_score: parsed.data.homeScore,
      p_away_score: parsed.data.awayScore,
      p_market_results: parsed.data.markets.map((market) => ({
        market_id: market.marketId,
        winning_selection: market.winningSelection,
      })),
      p_provider_reference: parsed.data.providerReference,
    });

    if (error) throw error;
    return res.status(202).json({ accepted: true, jobId: data });
  } catch (error) {
    console.error("Result ingestion failed", error);
    return res.status(500).json({ error: "Unable to queue event result" });
  }
}
