import type { NextApiRequest, NextApiResponse } from "next";
import { getReadinessStatus } from "@/lib/server/runtimeReadiness";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

type SchemaHealth = {
  ready?: boolean;
  schemaVersion?: string;
  missingTables?: string[];
  missingFunctions?: string[];
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const adminAuth = await requireAdminApi(req, res);
  if (!adminAuth) return;

  try {
    const status = getReadinessStatus();
    const { data, error } = await supabaseAdmin.rpc("admin_platform_health_check");
    const health = (data || {}) as SchemaHealth;
    const missing = [
      ...(health.missingTables || []).map((name) => `table: ${name}`),
      ...(health.missingFunctions || []).map((name) => `function: ${name}`),
    ];

    const databaseItem = {
      id: "database-schema",
      label: "Admin database compatibility",
      ready: !error && health.ready === true,
      detail: error
        ? "Latest database diagnostics migration is not active. Run supabase/migrations/20261105110000_admin_platform_health_check.sql after all earlier migrations."
        : health.ready
          ? `Required admin tables and functions are available (schema ${health.schemaVersion || "current"}).`
          : `Missing database objects: ${missing.join(", ") || "unknown"}. Apply pending Supabase migrations in order.`,
      owner: "development" as const,
      critical: true,
    };

    const items = [...status.items, databaseItem];
    const ready = items.filter((item) => item.ready).length;

    return res.status(200).json({
      ...status,
      score: Math.round((ready / items.length) * 100),
      ready,
      total: items.length,
      productionReady: status.productionReady && databaseItem.ready,
      failedCriticalChecks: databaseItem.ready
        ? status.failedCriticalChecks
        : [...status.failedCriticalChecks, "database-schema"],
      items,
    });
  } catch (error: any) {
    return res.status(500).json({
      error: "Failed to get readiness status",
      details: error.message,
    });
  }
}
