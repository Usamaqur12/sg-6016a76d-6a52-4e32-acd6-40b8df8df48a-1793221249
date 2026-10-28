import type { NextApiRequest, NextApiResponse } from "next";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";
import { verifyBearerSecret } from "@/lib/server/verifyBearerSecret";

const MAX_JOBS_PER_RUN = 25;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!verifyBearerSecret(req.headers.authorization, process.env.CRON_SECRET)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const admin = supabaseAdmin;
    const results = [];

    for (let index = 0; index < MAX_JOBS_PER_RUN; index += 1) {
      const { data, error } = await admin.rpc("process_next_settlement_job");
      if (error) throw error;
      results.push(data);

      if (!data || typeof data !== "object" || !("processed" in data) || !data.processed) {
        break;
      }
    }

    return res.status(200).json({ ok: true, jobs: results });
  } catch (error) {
    console.error("Settlement worker failed", error);
    return res.status(500).json({ error: "Settlement worker failed" });
  }
}
