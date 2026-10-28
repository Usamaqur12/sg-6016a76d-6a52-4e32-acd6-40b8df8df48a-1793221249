import type { NextApiRequest, NextApiResponse } from "next";
import { getReadinessStatus } from "@/lib/server/runtimeReadiness";
import { requireAdminApi } from "@/lib/server/requireAdminApi";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const adminAuth = await requireAdminApi(req, res);
  if (!adminAuth) return;

  try {
    const status = await getReadinessStatus();
    return res.status(200).json(status);
  } catch (error: any) {
    return res.status(500).json({
      error: "Failed to get readiness status",
      details: error.message,
    });
  }
}

