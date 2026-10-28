import type { NextApiRequest, NextApiResponse } from "next";
import { verifyBearerSecret } from "@/lib/server/verifyBearerSecret";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";
import { syncSportsProvider, type ManagedSportsProvider } from "@/lib/server/syncSportsProvider";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "POST"].includes(req.method || "")) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!verifyBearerSecret(req.headers.authorization, process.env.CRON_SECRET || "")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { data: providers, error } = await supabaseAdmin
      .from("sports_feed_providers")
      .select("*")
      .eq("is_enabled", true)
      .order("priority", { ascending: true })
      .limit(20);

    if (error) throw error;

    if (!providers || providers.length === 0) {
      return res.status(200).json({
        message: "No enabled providers to sync",
        synced: 0,
      });
    }

    const now = Date.now();
    const dueProviders = providers.filter((provider) => !provider.last_sync_at ||
      now - new Date(provider.last_sync_at).getTime() >= provider.sync_interval_seconds * 1000);
    const syncResults = await Promise.all(dueProviders.map(async (provider) => {
      try {
        return await syncSportsProvider(provider as ManagedSportsProvider, "sync");
      } catch (syncError) {
        return { ok: false, providerId: provider.id, error: syncError instanceof Error ? syncError.message : "Sync failed" };
      }
    }));

    return res.status(200).json({
      message: "Sports feed sync completed",
      due: dueProviders.length,
      synced: syncResults.filter((result) => result.ok).length,
      results: syncResults,
    });
  } catch (error: any) {
    console.error("Sports feed sync error:", error);
    return res.status(500).json({
      error: "Failed to sync sports feed",
      details: error.message,
    });
  }
}
