import { z } from "zod";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

export const FAUCETPAY_CHECKOUT_URL = "https://faucetpay.io/merchant/webscr";
const FAUCETPAY_VERIFY_BASE_URL = "https://faucetpay.io/merchant/get-payment";

const currencySchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,12}$/);
const priceCurrencySchema = z.enum(["USD", "USDT"]);
const decimalSchema = z.union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .pipe(z.string().regex(/^\d{1,18}(?:\.\d{1,18})?$/));
const identifierSchema = z.union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .pipe(z.string().min(1).max(180));
const optionalNameSchema = z.union([z.string(), z.null(), z.undefined()])
  .transform((value) => typeof value === "string" ? value.trim() : "")
  .pipe(z.string().max(180));

const verifiedPaymentSchema = z.object({
  valid: z.union([z.literal(true), z.literal(1), z.literal("1"), z.literal("true")]),
  transaction_id: identifierSchema,
  merchant_username: z.string().trim().min(1).max(180),
  payer_username: optionalNameSchema,
  amount1: decimalSchema,
  currency1: currencySchema,
  amount2: decimalSchema,
  currency2: currencySchema,
  custom: z.string().uuid(),
  exchange_rate: decimalSchema.optional(),
}).passthrough();

export type FaucetPayVerifiedPayment = {
  transactionId: string;
  merchantUsername: string;
  payerUsername: string;
  amount1: string;
  currency1: string;
  amount2: string;
  currency2: string;
  custom: string;
  exchangeRate?: string;
};

export type FaucetPayCheckoutFields = {
  merchant_username: string;
  item_description: string;
  amount1: string;
  currency1: string;
  currency2: string;
  custom: string;
  callback_url: string;
  success_url: string;
  cancel_url: string;
};

export type FaucetPayMerchantConfig = {
  enabled: boolean;
  configured: boolean;
  merchantUsername: string;
  priceCurrency: string;
  payCurrency: string;
  siteOrigin: string;
  source: "database" | "environment";
};

const storedConfigSchema = z.object({
  merchant_username: z.string().trim().max(180).default(""),
  price_currency: z.string().trim().default("USDT"),
  pay_currency: z.string().trim().default(""),
  site_url: z.string().trim().max(2048).default(""),
}).passthrough();

class FaucetPayConfigurationUnavailableError extends Error {
  constructor() {
    super("FaucetPay provider configuration is temporarily unavailable");
    this.name = "FaucetPayConfigurationUnavailableError";
  }
}

function normalizedSiteOrigin(rawSiteUrl: string) {
  if (!rawSiteUrl) return "";
  try {
    const siteUrl = new URL(rawSiteUrl);
    if (!["http:", "https:"].includes(siteUrl.protocol)) return "";
    if (siteUrl.protocol === "http:" && (
      process.env.NODE_ENV === "production"
      || !["localhost", "127.0.0.1"].includes(siteUrl.hostname)
    )) return "";
    return siteUrl.origin;
  } catch {
    return "";
  }
}

function environmentMerchantConfig(): FaucetPayMerchantConfig | null {
  const merchantUsername = process.env.FAUCETPAY_MERCHANT_USERNAME?.trim() || "";
  const priceCurrency = priceCurrencySchema.safeParse((process.env.FAUCETPAY_PRICE_CURRENCY || "USDT").trim().toUpperCase());
  const rawPayCurrency = process.env.FAUCETPAY_PAY_CURRENCY?.trim() || "";
  const payCurrency = rawPayCurrency ? currencySchema.safeParse(rawPayCurrency) : null;
  const siteOrigin = normalizedSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL?.trim() || "");

  if (!merchantUsername || !priceCurrency.success || (payCurrency && !payCurrency.success) || !siteOrigin) return null;

  return {
    enabled: process.env.FAUCETPAY_DEPOSITS_ENABLED === "true",
    configured: true,
    merchantUsername,
    priceCurrency: priceCurrency.data,
    payCurrency: payCurrency?.success ? payCurrency.data : "",
    siteOrigin,
    source: "environment",
  };
}

export async function faucetPayMerchantConfig(adminClient: typeof supabaseAdmin = supabaseAdmin): Promise<FaucetPayMerchantConfig | null> {
  try {
    const { data, error } = await (adminClient as any)
      .from("payment_provider_configs")
      .select("provider_code,is_enabled,public_config,updated_by")
      .eq("provider_code", "faucetpay")
      .maybeSingle();

    if (error) {
      const code = String((error as { code?: unknown })?.code || "");
      if (["42P01", "PGRST205"].includes(code)) return environmentMerchantConfig();
      console.error("FaucetPay configuration lookup failed", code || "unknown_error");
      throw new FaucetPayConfigurationUnavailableError();
    }

    if (!data) return environmentMerchantConfig();

    const parsed = storedConfigSchema.safeParse(data.public_config || {});
    const stored = parsed.success ? parsed.data : storedConfigSchema.parse({});
    const merchantUsername = stored.merchant_username;
    const priceCurrency = priceCurrencySchema.safeParse(stored.price_currency.toUpperCase());
    const payCurrency = stored.pay_currency ? currencySchema.safeParse(stored.pay_currency) : null;
    const siteOrigin = normalizedSiteOrigin(stored.site_url);
    const configured = Boolean(merchantUsername && priceCurrency.success && (!payCurrency || payCurrency.success) && siteOrigin);

    if (!data.updated_by && !configured) {
      const legacy = environmentMerchantConfig();
      if (legacy) return legacy;
    }

    return {
      enabled: Boolean(data.is_enabled),
      configured,
      merchantUsername,
      priceCurrency: priceCurrency.success ? priceCurrency.data : "USDT",
      payCurrency: payCurrency?.success ? payCurrency.data : "",
      siteOrigin,
      source: "database",
    };
  } catch (error) {
    if (error instanceof FaucetPayConfigurationUnavailableError) throw error;
    const code = String((error as { code?: unknown })?.code || "");
    if (["42P01", "PGRST205"].includes(code)) return environmentMerchantConfig();
    console.error("FaucetPay configuration lookup failed", code || "unknown_error");
    throw new FaucetPayConfigurationUnavailableError();
  }
}

export function buildFaucetPayCheckoutFields(input: {
  invoiceId: string;
  amount: number;
  merchantUsername: string;
  priceCurrency: string;
  payCurrency: string;
  siteOrigin: string;
}): FaucetPayCheckoutFields {
  const siteName = (process.env.NEXT_PUBLIC_SITE_NAME || "MindBet Pro").trim().slice(0, 80) || "MindBet Pro";
  return {
    merchant_username: input.merchantUsername,
    item_description: siteName + " wallet deposit",
    amount1: input.amount.toFixed(2),
    currency1: input.priceCurrency,
    currency2: input.payCurrency,
    custom: input.invoiceId,
    callback_url: input.siteOrigin + "/api/payments/faucetpay/callback",
    success_url: input.siteOrigin + "/account/wallet?faucetpay=success",
    cancel_url: input.siteOrigin + "/account/wallet?faucetpay=cancel",
  };
}

export function decimalAmountMatches(left: string | number, right: string | number, precision = 2) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
  const scale = 10 ** precision;
  return Math.round(leftNumber * scale) === Math.round(rightNumber * scale);
}

export async function verifyFaucetPayToken(token: string): Promise<FaucetPayVerifiedPayment> {
  if (!/^[A-Za-z0-9_-]{8,256}$/.test(token)) throw new Error("Invalid FaucetPay verification token");
  const response = await fetch(FAUCETPAY_VERIFY_BASE_URL + "/" + encodeURIComponent(token), {
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("FaucetPay verification returned " + response.status);

  const parsed = verifiedPaymentSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("FaucetPay returned an invalid verification record");
  const value = parsed.data;
  return {
    transactionId: value.transaction_id,
    merchantUsername: value.merchant_username,
    payerUsername: value.payer_username,
    amount1: value.amount1,
    currency1: value.currency1,
    amount2: value.amount2,
    currency2: value.currency2,
    custom: value.custom,
    exchangeRate: value.exchange_rate,
  };
}
