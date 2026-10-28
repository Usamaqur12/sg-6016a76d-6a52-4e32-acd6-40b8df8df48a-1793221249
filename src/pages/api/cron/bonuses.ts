import type { NextApiRequest, NextApiResponse } from "next";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";
import { verifyBearerSecret } from "@/lib/server/verifyBearerSecret";

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
    const { data, error } = await admin.rpc("expire_user_bonuses", { p_batch_size: 500 });
    if (error) throw error;
    return res.status(200).json({ ok: true, result: data });
  } catch (error) {
    console.error("Bonus expiry worker failed", error);
    return res.status(500).json({ error: "Bonus expiry worker failed" });
  }
}
