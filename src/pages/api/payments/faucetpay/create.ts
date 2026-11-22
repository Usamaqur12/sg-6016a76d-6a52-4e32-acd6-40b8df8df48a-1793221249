import { randomUUID } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { protectApi } from "@/lib/server/apiProtection";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";
import {
  FAUCETPAY_CHECKOUT_URL,
  buildFaucetPayCheckoutFields,
  decimalAmountMatches,
  faucetPayMerchantConfig,
} from "@/lib/server/faucetpay";

const requestSchema = z.object({
  amount: z.number().finite().positive().max(100000),
  idempotencyKey: z.string().uuid(),
}).strict();

function bearerToken(value: string | undefined) {
  if (!value?.startsWith("Bearer ")) return null;
  return value.slice(7).trim() || null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!await protectApi(req, res, {
    scope: "faucetpay-create",
    limit: 10,
    windowMs: 60_000,
    requireJson: true,
    failClosed: process.env.NODE_ENV === "production",
  })) return;

  res.setHeader("Cache-Control", "no-store");

  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid deposit request", details: parsed.error.flatten() });
  }

  const token = bearerToken(req.headers.authorization);
  if (!token) return res.status(401).json({ error: "Authentication required" });

  let merchant;
  try {
    merchant = await faucetPayMerchantConfig(supabaseAdmin);
  } catch {
    return res.status(503).json({ error: "FaucetPay merchant configuration is temporarily unavailable" });
  }
  if (!merchant?.configured) return res.status(503).json({ error: "FaucetPay merchant checkout is not configured" });
  if (!merchant.enabled) return res.status(503).json({ error: "FaucetPay deposits are not enabled" });

  const { data: configuredMethod, error: methodError } = await (supabaseAdmin as any)
    .from("payment_methods")
    .select("id,currency,min_amount,max_amount")
    .eq("provider_code", "faucetpay")
    .eq("method_type", "provider")
    .eq("is_enabled", true)
    .is("archived_at", null)
    .order("display_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (methodError || !configuredMethod) {
    return res.status(503).json({ error: "FaucetPay is disabled in the admin payment settings" });
  }
  if (String(configuredMethod.currency).toUpperCase() !== merchant.priceCurrency) {
    return res.status(503).json({ error: "FaucetPay currency configuration is inconsistent" });
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData.user) return res.status(401).json({ error: "Invalid session" });

  const userId = authData.user.id;
  const { amount, idempotencyKey } = parsed.data;
  if (amount < Number(configuredMethod.min_amount) || amount > Number(configuredMethod.max_amount)) {
    return res.status(400).json({ error: "Amount is outside the administrator-configured FaucetPay limits" });
  }

  const { data: profile, error: profileError } = await (supabaseAdmin as any)
    .from("profiles")
    .select("id,account_status,is_admin,is_suspended,wallet_frozen,deposits_disabled,self_exclusion_until,deposit_limit")
    .eq("id", userId)
    .single();

  const accountEligible = profile
    && profile.account_status !== "closed"
    && !profile.is_admin
    && !profile.is_suspended
    && !profile.wallet_frozen
    && !profile.deposits_disabled;
  if (profileError || !accountEligible) {
    return res.status(403).json({ error: "An active customer account with deposits enabled is required" });
  }
  if (profile.self_exclusion_until && new Date(profile.self_exclusion_until).getTime() > Date.now()) {
    return res.status(403).json({ error: "Deposits are unavailable during self-exclusion" });
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [cryptoDeposits, manualDeposits] = await Promise.all([
    (supabaseAdmin as any)
      .from("crypto_deposit_invoices")
      .select("fiat_amount")
      .eq("user_id", userId)
      .eq("status", "completed")
      .gte("completed_at", monthStart.toISOString()),
    (supabaseAdmin as any)
      .from("manual_deposit_requests")
      .select("amount")
      .eq("user_id", userId)
      .eq("status", "approved")
      .gte("reviewed_at", monthStart.toISOString()),
  ]);
  if (cryptoDeposits.error || manualDeposits.error) {
    return res.status(503).json({ error: "Deposit-limit checks are temporarily unavailable" });
  }
  const monthTotal = (cryptoDeposits.data || []).reduce(
    (sum: number, invoice: { fiat_amount?: number | string }) => sum + Number(invoice.fiat_amount || 0),
    0,
  ) + (manualDeposits.data || []).reduce(
    (sum: number, deposit: { amount?: number | string }) => sum + Number(deposit.amount || 0),
    0,
  );
  if (profile.deposit_limit != null && monthTotal + amount > Number(profile.deposit_limit)) {
    return res.status(409).json({ error: "Monthly deposit limit would be exceeded" });
  }

  const { data: existing, error: existingError } = await (supabaseAdmin as any)
    .from("crypto_deposit_invoices")
    .select("id,provider,status,fiat_amount,fiat_currency,pay_currency,provider_payload")
    .eq("user_id", userId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingError) return res.status(503).json({ error: "Deposit request could not be checked" });
  if (existing && existing.provider !== "faucetpay") {
    return res.status(409).json({ error: "Idempotency key already belongs to another payment provider" });
  }
  if (existing && !["creating", "waiting", "confirming"].includes(String(existing.status))) {
    return res.status(409).json({ error: "This FaucetPay checkout can no longer be reused; start a new deposit" });
  }
  if (existing && !decimalAmountMatches(existing.fiat_amount, amount, 2)) {
    return res.status(409).json({ error: "Idempotency key already belongs to a different deposit amount" });
  }

  const existingPayload = existing?.provider_payload && typeof existing.provider_payload === "object"
    ? existing.provider_payload as Record<string, unknown>
    : null;
  const existingMerchant = typeof existingPayload?.merchant_username === "string"
    ? existingPayload.merchant_username.trim()
    : "";
  if (existing && !existingMerchant) {
    return res.status(409).json({ error: "This older checkout cannot be safely reused; start a new FaucetPay deposit" });
  }
  if (existingMerchant && existingMerchant.toLowerCase() !== merchant.merchantUsername.toLowerCase()) {
    return res.status(409).json({ error: "Existing checkout belongs to a different FaucetPay merchant configuration" });
  }

  const invoiceId = existing?.id || randomUUID();
  const checkoutFields = buildFaucetPayCheckoutFields({
    invoiceId,
    amount: Number(existing?.fiat_amount ?? amount),
    merchantUsername: existingMerchant || merchant.merchantUsername,
    priceCurrency: merchant.priceCurrency,
    payCurrency: merchant.payCurrency,
    siteOrigin: merchant.siteOrigin,
  });

  if (existing) {
    if (
      String(existing.fiat_currency).toUpperCase() !== merchant.priceCurrency
      || String(existing.pay_currency).toLowerCase() !== (merchant.payCurrency || "multi").toLowerCase()
    ) {
      return res.status(409).json({ error: "Existing checkout no longer matches the configured FaucetPay currencies" });
    }
    return res.status(200).json({
      reused: true,
      invoice: {
        id: existing.id,
        status: existing.status,
        amount: Number(existing.fiat_amount),
        currency: existing.fiat_currency,
      },
      checkout: { url: FAUCETPAY_CHECKOUT_URL, fields: checkoutFields },
    });
  }

  const { error: insertError } = await (supabaseAdmin as any)
    .from("crypto_deposit_invoices")
    .insert({
      id: invoiceId,
      user_id: userId,
      provider: "faucetpay",
      idempotency_key: idempotencyKey,
      fiat_amount: amount,
      fiat_currency: merchant.priceCurrency,
      pay_currency: (merchant.payCurrency || "multi").toLowerCase(),
      status: "waiting",
      provider_payload: {
        checkout: "hosted",
        payment_method_id: configuredMethod.id,
        merchant_username: merchant.merchantUsername,
        price_currency: merchant.priceCurrency,
        pay_currency: merchant.payCurrency || "",
      },
    });
  if (insertError) return res.status(409).json({ error: "FaucetPay checkout could not be created" });

  return res.status(201).json({
    reused: false,
    invoice: { id: invoiceId, status: "waiting", amount, currency: merchant.priceCurrency },
    checkout: { url: FAUCETPAY_CHECKOUT_URL, fields: checkoutFields },
  });
}
