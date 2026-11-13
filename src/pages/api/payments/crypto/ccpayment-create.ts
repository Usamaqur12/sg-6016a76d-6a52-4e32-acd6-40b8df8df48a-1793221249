import { randomUUID } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { ccPaymentRequest, getCCPaymentConfiguration, resolveCCPaymentUsdFiatId } from "@/lib/server/ccpayment";
import { protectApi } from "@/lib/server/apiProtection";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const requestSchema = z.object({
  amount: z.number().finite().positive().max(100000),
  idempotencyKey: z.string().trim().min(8).max(120),
});

type InvoiceResponse = { invoiceUrl: string };

function bearerToken(value: string | undefined) {
  if (!value?.startsWith("Bearer ")) return null;
  return value.slice(7).trim() || null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!await protectApi(req, res, {
    scope: "ccpayment-create",
    limit: 10,
    windowMs: 60_000,
    requireJson: true,
    failClosed: process.env.NODE_ENV === "production",
  })) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (process.env.CRYPTO_DEPOSITS_ENABLED !== "true") {
    return res.status(503).json({ error: "Crypto deposits are not enabled" });
  }

  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid deposit request", details: parsed.error.flatten() });
  }
  const token = bearerToken(req.headers.authorization);
  if (!token) return res.status(401).json({ error: "Authentication required" });

  const config = getCCPaymentConfiguration();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!config.configured || !siteUrl) {
    return res.status(503).json({ error: "CCPayment is not fully configured" });
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(siteUrl);
  } catch {
    return res.status(503).json({ error: "NEXT_PUBLIC_SITE_URL is invalid" });
  }
  if (process.env.NODE_ENV === "production" && baseUrl.protocol !== "https:") {
    return res.status(503).json({ error: "CCPayment requires an HTTPS production site URL" });
  }

  const admin = supabaseAdmin;
  const { data: method, error: methodError } = await (admin as any)
    .from("payment_methods")
    .select("id,min_amount,max_amount")
    .eq("provider_code", "ccpayment")
    .eq("method_type", "provider")
    .eq("is_enabled", true)
    .is("archived_at", null)
    .maybeSingle();

  if (methodError || !method) {
    return res.status(503).json({ error: "CCPayment is disabled in Admin → Payment Methods" });
  }

  const amount = Math.round(parsed.data.amount * 100) / 100;
  if (amount < Number(method.min_amount) || amount > Number(method.max_amount)) {
    return res.status(400).json({
      error: `Deposit must be between $${Number(method.min_amount).toFixed(2)} and $${Number(method.max_amount).toFixed(2)}`,
    });
  }

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return res.status(401).json({ error: "Invalid session" });

  const userId = authData.user.id;
  const { data: profile, error: profileError } = await (admin as any)
    .from("profiles")
    .select("id,account_status,is_suspended,wallet_frozen,deposits_disabled,self_exclusion_until,deposit_limit")
    .eq("id", userId)
    .single();

  const activated = profile?.account_status !== "closed";
  if (profileError || !profile || !activated || profile.is_suspended || profile.wallet_frozen || profile.deposits_disabled) {
    return res.status(403).json({ error: "An active account with deposits enabled is required" });
  }
  if (profile.self_exclusion_until && new Date(profile.self_exclusion_until).getTime() > Date.now()) {
    return res.status(403).json({ error: "Deposits are unavailable during self-exclusion" });
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { data: monthlyDeposits } = await (admin as any)
    .from("crypto_deposit_invoices")
    .select("fiat_amount")
    .eq("user_id", userId)
    .eq("status", "completed")
    .gte("completed_at", monthStart.toISOString());
  const monthTotal = (monthlyDeposits || []).reduce(
    (sum: number, invoice: any) => sum + Number(invoice.fiat_amount || 0),
    0
  );
  if (profile.deposit_limit && monthTotal + amount > Number(profile.deposit_limit)) {
    return res.status(409).json({ error: "Monthly deposit limit would be exceeded" });
  }

  const { data: existing } = await (admin as any)
    .from("crypto_deposit_invoices")
    .select("id,provider,status,fiat_amount,fiat_currency,pay_currency,expires_at,provider_payload")
    .eq("user_id", userId)
    .eq("idempotency_key", parsed.data.idempotencyKey)
    .maybeSingle();

  if (existing) {
    if (existing.provider !== "ccpayment") {
      return res.status(409).json({ error: "Idempotency key is already used by another provider" });
    }
    return res.status(200).json({
      invoice: { ...existing, checkout_url: existing.provider_payload?.invoiceUrl || null },
      reused: true,
    });
  }

  const invoiceId = randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const { error: insertError } = await (admin as any).from("crypto_deposit_invoices").insert({
    id: invoiceId,
    user_id: userId,
    provider: "ccpayment",
    provider_payment_id: invoiceId,
    idempotency_key: parsed.data.idempotencyKey,
    fiat_amount: amount,
    fiat_currency: "USD",
    pay_currency: "multi",
    status: "creating",
    expires_at: expiresAt.toISOString(),
  });
  if (insertError) {
    return res.status(409).json({ error: "Deposit request could not be created" });
  }

  try {
    const fiatId = await resolveCCPaymentUsdFiatId();
    const root = baseUrl.toString().replace(/\/$/, "");
    const provider = await ccPaymentRequest<InvoiceResponse>("createInvoiceUrl", {
      orderId: invoiceId,
      product: "MindBet Pro wallet deposit",
      price: amount.toFixed(2),
      priceFiatId: fiatId,
      buyerEmail: authData.user.email || undefined,
      returnUrl: `${root}/account/wallet?payment=ccpayment`,
      closeUrl: `${root}/account/wallet`,
      notifyUrl: `${root}/api/payments/crypto/ccpayment-webhook`,
      expiredAt: Math.floor(expiresAt.getTime() / 1000),
    });

    const checkout = new URL(provider.invoiceUrl);
    if (checkout.protocol !== "https:") throw new Error("CCPayment returned an insecure checkout URL");

    const update = {
      status: "waiting",
      provider_payload: { invoiceUrl: checkout.toString(), createdAt: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    };
    const { error: updateError } = await (admin as any)
      .from("crypto_deposit_invoices")
      .update(update)
      .eq("id", invoiceId);
    if (updateError) throw updateError;

    return res.status(201).json({
      invoice: {
        id: invoiceId,
        provider: "ccpayment",
        fiat_amount: amount,
        fiat_currency: "USD",
        pay_currency: "multi",
        status: "waiting",
        expires_at: expiresAt.toISOString(),
        checkout_url: checkout.toString(),
      },
    });
  } catch (error) {
    console.error("CCPayment invoice creation failed", error);
    await (admin as any)
      .from("crypto_deposit_invoices")
      .update({
        status: "failed",
        provider_payload: { error: "provider_request_failed" },
        updated_at: new Date().toISOString(),
      })
      .eq("id", invoiceId);
    return res.status(502).json({
      error: error instanceof Error ? error.message : "CCPayment could not create the invoice",
    });
  }
}
