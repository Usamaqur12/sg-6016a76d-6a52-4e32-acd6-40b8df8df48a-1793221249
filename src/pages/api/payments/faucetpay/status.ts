import type { NextApiRequest, NextApiResponse } from "next";
import { protectApi } from "@/lib/server/apiProtection";
import { faucetPayMerchantConfig } from "@/lib/server/faucetpay";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!await protectApi(req, res, {
    scope: "faucetpay-status",
    limit: 120,
    windowMs: 60_000,
    failClosed: process.env.NODE_ENV === "production",
  })) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const [merchant, methodResult] = await Promise.all([
      faucetPayMerchantConfig(supabaseAdmin),
      (supabaseAdmin as any)
        .from("payment_methods")
        .select("currency,min_amount,max_amount")
        .eq("provider_code", "faucetpay")
        .eq("method_type", "provider")
        .eq("is_enabled", true)
        .is("archived_at", null)
        .order("display_order", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    if (methodResult.error) {
      return res.status(503).json({ error: "FaucetPay availability is temporarily unavailable" });
    }

    const method = methodResult.data;
    return res.status(200).json({
      available: Boolean(merchant?.configured && merchant.enabled && method),
      currency: method?.currency || merchant?.priceCurrency || "USDT",
      minAmount: method ? Number(method.min_amount) : null,
      maxAmount: method ? Number(method.max_amount) : null,
    });
  } catch {
    return res.status(503).json({ error: "FaucetPay availability is temporarily unavailable" });
  }
}
