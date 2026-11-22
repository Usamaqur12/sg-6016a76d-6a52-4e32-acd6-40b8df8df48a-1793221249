import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { protectApi } from "@/lib/server/apiProtection";
import { paymentPayloadHash } from "@/lib/server/cryptoPayments";
import {
  decimalAmountMatches,
  faucetPayMerchantConfig,
  verifyFaucetPayToken,
} from "@/lib/server/faucetpay";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const callbackSchema = z.object({
  token: z.string().trim().regex(/^[A-Za-z0-9_-]{8,256}$/),
  transaction_id: z.union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .optional(),
}).passthrough();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!await protectApi(req, res, {
    scope: "faucetpay-callback",
    limit: 240,
    windowMs: 60_000,
    failClosed: false,
  })) return;

  res.setHeader("Cache-Control", "no-store");
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    return res.status(415).json({ error: "Form-encoded callback required" });
  }

  const parsed = callbackSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid FaucetPay callback" });

  const callbackTransactionId = parsed.data.transaction_id;
  if (callbackTransactionId) {
    const { data: duplicateEvent } = await (supabaseAdmin as any)
      .from("crypto_webhook_events")
      .select("id")
      .eq("provider", "faucetpay")
      .eq("event_key", callbackTransactionId)
      .maybeSingle();
    if (duplicateEvent) return res.status(200).json({ accepted: true, duplicate: true });
  }

  try {
    const verified = await verifyFaucetPayToken(parsed.data.token);
    if (callbackTransactionId && callbackTransactionId !== verified.transactionId) {
      return res.status(409).json({ error: "FaucetPay transaction identity mismatch" });
    }

    const { data: invoice, error: invoiceError } = await (supabaseAdmin as any)
      .from("crypto_deposit_invoices")
      .select("id,provider,provider_payment_id,fiat_amount,fiat_currency,pay_currency,provider_payload")
      .eq("id", verified.custom)
      .eq("provider", "faucetpay")
      .maybeSingle();
    if (invoiceError || !invoice) {
      return res.status(404).json({ error: "FaucetPay deposit invoice not found" });
    }

    const invoicePayload = invoice.provider_payload && typeof invoice.provider_payload === "object"
      ? invoice.provider_payload as Record<string, unknown>
      : null;
    const snapshottedMerchant = typeof invoicePayload?.merchant_username === "string"
      ? invoicePayload.merchant_username.trim()
      : "";

    let expectedMerchant = snapshottedMerchant;
    if (!expectedMerchant) {
      const currentMerchant = await faucetPayMerchantConfig(supabaseAdmin);
      expectedMerchant = currentMerchant?.merchantUsername || "";
    }
    if (!expectedMerchant || verified.merchantUsername.toLowerCase() !== expectedMerchant.toLowerCase()) {
      return res.status(401).json({ error: "Merchant identity mismatch" });
    }
    if (invoice.provider_payment_id && String(invoice.provider_payment_id) !== verified.transactionId) {
      return res.status(409).json({ error: "Provider transaction does not match the invoice" });
    }
    if (
      !decimalAmountMatches(verified.amount1, invoice.fiat_amount, 2)
      || verified.currency1 !== String(invoice.fiat_currency).toUpperCase()
    ) {
      return res.status(409).json({ error: "Verified payment amount or currency does not match the invoice" });
    }

    const expectedPayCurrency = String(invoice.pay_currency || "multi").toUpperCase();
    if (expectedPayCurrency !== "MULTI" && expectedPayCurrency !== verified.currency2) {
      return res.status(409).json({ error: "Verified payment asset does not match the invoice" });
    }

    const authoritativePayload = {
      transaction_id: verified.transactionId,
      merchant_username: verified.merchantUsername,
      payer_username: verified.payerUsername,
      amount1: verified.amount1,
      currency1: verified.currency1,
      amount2: verified.amount2,
      currency2: verified.currency2,
      custom: verified.custom,
      ...(verified.exchangeRate ? { exchange_rate: verified.exchangeRate } : {}),
    };

    const { data, error } = await (supabaseAdmin as any).rpc("apply_faucetpay_deposit_update", {
      p_event_key: verified.transactionId,
      p_provider_payment_id: verified.transactionId,
      p_invoice_id: verified.custom,
      p_amount1: verified.amount1,
      p_currency1: verified.currency1,
      p_amount2: verified.amount2,
      p_currency2: verified.currency2,
      p_payer_username: verified.payerUsername || null,
      p_payload_hash: paymentPayloadHash(authoritativePayload),
      p_payload: authoritativePayload,
    });
    if (error) throw error;

    return res.status(200).json({ accepted: true, result: data });
  } catch (error) {
    console.error(
      "FaucetPay callback verification or processing failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    return res.status(502).json({ error: "FaucetPay payment could not be verified" });
  }
}
