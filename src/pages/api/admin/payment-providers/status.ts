import type { NextApiRequest, NextApiResponse } from "next";
import { getCCPaymentConfiguration } from "@/lib/server/ccpayment";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const admin = await requireAdminApi(req, res);
  if (!admin) return;

  const configuration = getCCPaymentConfiguration();
  const { data: method } = await (supabaseAdmin as any)
    .from("payment_methods")
    .select("id,is_enabled,archived_at")
    .eq("provider_code", "ccpayment")
    .eq("method_type", "provider")
    .is("archived_at", null)
    .maybeSingle();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || null;
  return res.status(200).json({
    configured: configuration.configured,
    appIdConfigured: Boolean(configuration.appId),
    appSecretConfigured: Boolean(configuration.appSecret),
    fiatIdConfigured: Boolean(configuration.fiatId),
    cryptoDepositsEnabled: process.env.CRYPTO_DEPOSITS_ENABLED === "true",
    customerCryptoEnabled: process.env.NEXT_PUBLIC_CRYPTO_DEPOSITS_ENABLED === "true",
    methodExists: Boolean(method),
    methodEnabled: Boolean(method?.is_enabled),
    webhookUrl: siteUrl ? `${siteUrl}/api/payments/crypto/ccpayment-webhook` : null,
  });
}
