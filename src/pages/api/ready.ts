import type { NextApiRequest, NextApiResponse } from "next";
import { getRuntimeReadiness } from "@/lib/server/runtimeReadiness";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const runtime = getRuntimeReadiness();
  let databaseReady = false;
  let databaseError: string | null = null;

  if (!runtime.failedCriticalChecks.includes("database-secrets")) {
    try {
      const { supabaseAdmin } = await import("@/lib/server/supabaseAdmin");
      const { error } = await supabaseAdmin.from("profiles").select("id", { count: "exact", head: true });
      databaseReady = !error;
      databaseError = error?.message || null;
    } catch (error) {
      databaseError = error instanceof Error ? error.message : "Database check failed";
    }
  }

  const ready = runtime.productionMode
    ? runtime.productionReady && databaseReady
    : databaseReady || runtime.failedCriticalChecks.includes("database-secrets");

  return res.status(ready ? 200 : 503).json({
    status: ready ? (runtime.productionMode ? "ready" : "development") : "not_ready",
    ready,
    database: { ready: databaseReady, error: databaseError },
    productionMode: runtime.productionMode,
    productionReady: runtime.productionReady && databaseReady,
    failedChecks: [...runtime.failedCriticalChecks, ...(!databaseReady ? ["database-connection"] : [])],
    timestamp: runtime.timestamp,
  });
}
