import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { protectApi } from "@/lib/server/apiProtection";
import { faucetPayMerchantConfig, type FaucetPayMerchantConfig } from "@/lib/server/faucetpay";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const currencySchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,12}$/);
const priceCurrencySchema = z.enum(["USD", "USDT"]);
const patchSchema = z.object({
  enabled: z.boolean(),
  merchantUsername: z.string().trim().min(1).max(180).regex(/^[^\u0000-\u001f\u007f]+$/),
  priceCurrency: priceCurrencySchema,
  payCurrency: z.union([z.literal(""), currencySchema]).default(""),
  siteUrl: z.string().trim().min(1).max(2048),
}).strict();

function publicConfig(config: FaucetPayMerchantConfig | null) {
  const siteUrl = config?.siteOrigin || "";
  return {
    providerCode: "faucetpay" as const,
    enabled: Boolean(config?.enabled),
    merchantUsername: config?.merchantUsername || "",
    priceCurrency: config?.priceCurrency || "USDT",
    payCurrency: config?.payCurrency || "",
    siteUrl,
    configured: Boolean(config?.configured),
    source: config?.source || "none",
    callbackUrl: siteUrl ? siteUrl + "/api/payments/faucetpay/callback" : "",
  };
}

function normalizedSiteOrigin(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.protocol === "http:" && (
      process.env.NODE_ENV === "production"
      || !["localhost", "127.0.0.1"].includes(url.hostname)
    )) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!await protectApi(req, res, {
    scope: "admin-faucetpay-provider",
    limit: 60,
    windowMs: 60_000,
    requireJson: req.method === "PATCH",
    failClosed: process.env.NODE_ENV === "production",
  })) return;

  res.setHeader("Cache-Control", "no-store");

  try {
    const authorization = await requireAdminApi(req, res);
    if (!authorization) return;
    if (authorization.adminRole !== "super_admin") {
      return res.status(403).json({ error: "Super admin permission required" });
    }

    if (req.method === "GET") {
      return res.status(200).json(publicConfig(await faucetPayMerchantConfig(supabaseAdmin)));
    }

    if (req.method === "PATCH") {
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid FaucetPay merchant configuration",
          details: parsed.error.flatten(),
        });
      }

      const siteOrigin = normalizedSiteOrigin(parsed.data.siteUrl);
      if (!siteOrigin) {
        return res.status(400).json({
          error: "A valid HTTPS site URL is required (HTTP is allowed only for local development)",
        });
      }

      const { error } = await (supabaseAdmin as any).rpc("save_faucetpay_provider_config", {
        p_actor: authorization.userId,
        p_enabled: parsed.data.enabled,
        p_merchant_username: parsed.data.merchantUsername,
        p_price_currency: parsed.data.priceCurrency,
        p_pay_currency: parsed.data.payCurrency,
        p_site_url: siteOrigin,
      });
      if (error) throw error;

      return res.status(200).json(publicConfig(await faucetPayMerchantConfig(supabaseAdmin)));
    }

    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("FaucetPay provider admin operation failed", error);
    return res.status(500).json({ error: "FaucetPay provider operation failed" });
  }
}
