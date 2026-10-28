import { randomUUID } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";
import { protectApi } from "@/lib/server/apiProtection";

const requestSchema = z.object({
  amount: z.number().min(10).max(100000),
  payCurrency: z.enum(["btc", "eth", "usdttrc20", "usdtbsc", "ltc"]),
  idempotencyKey: z.string().trim().min(8).max(120),
});

const providerResponseSchema = z.object({
  payment_id: z.union([z.string(), z.number()]),
  payment_status: z.string(),
  pay_address: z.string().min(4),
  price_amount: z.number(),
  price_currency: z.string(),
  pay_amount: z.number().positive(),
  pay_currency: z.string(),
  expiration_estimate_date: z.string().optional().nullable(),
}).passthrough();

function bearerToken(value: string | undefined) {
  if (!value?.startsWith("Bearer ")) return null;
  return value.slice(7).trim() || null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!await protectApi(req, res, { scope: "crypto-create", limit: 10, windowMs: 60_000, requireJson: true, failClosed: process.env.NODE_ENV === "production" })) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (process.env.CRYPTO_DEPOSITS_ENABLED !== "true") {
    return res.status(503).json({ error: "Crypto deposits are not enabled" });
  }

  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid deposit request", details: parsed.error.flatten() });
  const token = bearerToken(req.headers.authorization);
  if (!token) return res.status(401).json({ error: "Authentication required" });

  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!apiKey || !siteUrl || !process.env.NOWPAYMENTS_IPN_SECRET) {
    return res.status(503).json({ error: "Crypto payment provider is not configured" });
  }

  const admin = supabaseAdmin;
  const { data: configuredMethod, error: methodError } = await (admin as any)
    .from("payment_methods")
    .select("id")
    .eq("provider_code", "nowpayments")
    .eq("method_type", "provider")
    .eq("is_enabled", true)
    .is("archived_at", null)
    .maybeSingle();
  if (methodError || !configuredMethod) {
    return res.status(503).json({ error: "NOWPayments is disabled in the admin payment settings" });
  }
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return res.status(401).json({ error: "Invalid session" });

  const { amount, payCurrency, idempotencyKey } = parsed.data;
  const userId = authData.user.id;
  const { data: profile, error: profileError } = await (admin as any).from("profiles")
    .select("id,kyc_status,is_suspended,self_exclusion_until,deposit_limit")
    .eq("id", userId).single();
  if (profileError || !profile || profile.kyc_status !== "approved" || profile.is_suspended) {
    return res.status(403).json({ error: "Approved KYC and an active account are required" });
  }
  if (profile.self_exclusion_until && new Date(profile.self_exclusion_until).getTime() > Date.now()) {
    return res.status(403).json({ error: "Deposits are unavailable during self-exclusion" });
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const { data: monthlyDeposits } = await (admin as any).from("crypto_deposit_invoices")
    .select("fiat_amount").eq("user_id", userId).eq("status", "completed").gte("completed_at", monthStart.toISOString());
  const monthTotal = (monthlyDeposits || []).reduce((sum: number, invoice: any) => sum + Number(invoice.fiat_amount || 0), 0);
  if (profile.deposit_limit && monthTotal + amount > Number(profile.deposit_limit)) {
    return res.status(409).json({ error: "Monthly deposit limit would be exceeded" });
  }

  const { data: existing } = await (admin as any).from("crypto_deposit_invoices")
    .select("id,status,fiat_amount,pay_currency,pay_amount,pay_address,expires_at")
    .eq("user_id", userId).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing) return res.status(200).json({ invoice: existing, reused: true });

  const invoiceId = randomUUID();
  const { error: insertError } = await (admin as any).from("crypto_deposit_invoices").insert({
    id: invoiceId, user_id: userId, provider: "nowpayments", idempotency_key: idempotencyKey,
    fiat_amount: amount, fiat_currency: "USD", pay_currency: payCurrency, status: "creating",
  });
  if (insertError) return res.status(409).json({ error: "Deposit request could not be created" });

  try {
    const providerResponse = await fetch("https://api.nowpayments.io/v1/payment", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        price_amount: amount,
        price_currency: "usd",
        pay_currency: payCurrency,
        ipn_callback_url: `${siteUrl.replace(/\/$/, "")}/api/payments/crypto/nowpayments-webhook`,
        order_id: invoiceId,
        order_description: "PrimeBet wallet deposit",
        is_fixed_rate: true,
        is_fee_paid_by_user: true,
      }),
    });
    const body = await providerResponse.json();
    if (!providerResponse.ok) throw new Error("Provider rejected the payment request");
    const provider = providerResponseSchema.parse(body);
    if (provider.price_currency.toLowerCase() !== "usd" || provider.pay_currency.toLowerCase() !== payCurrency) {
      throw new Error("Provider returned a mismatched currency");
    }

    const invoice = {
      provider_payment_id: String(provider.payment_id), status: "waiting", pay_amount: provider.pay_amount,
      pay_address: provider.pay_address, expires_at: provider.expiration_estimate_date || null, provider_payload: body,
    };
    const { error: updateError } = await (admin as any).from("crypto_deposit_invoices").update(invoice).eq("id", invoiceId);
    if (updateError) throw updateError;
    return res.status(201).json({ invoice: { id: invoiceId, fiat_amount: amount, fiat_currency: "USD", pay_currency: payCurrency, ...invoice } });
  } catch (error) {
    console.error("Crypto invoice creation failed", error);
    await (admin as any).from("crypto_deposit_invoices").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", invoiceId);
    return res.status(502).json({ error: "Crypto payment provider could not create the invoice" });
  }
}

