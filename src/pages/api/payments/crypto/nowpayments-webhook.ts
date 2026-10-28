import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";
import { paymentPayloadHash, verifyNowPaymentsSignature } from "@/lib/server/cryptoPayments";

const webhookSchema = z.object({
  payment_id: z.union([z.string(), z.number()]),
  payment_status: z.enum(["waiting", "confirming", "confirmed", "partially_paid", "finished", "expired", "failed", "refunded"]),
  pay_address: z.string().optional().nullable(),
  price_amount: z.number(),
  price_currency: z.string(),
  pay_amount: z.number(),
  actually_paid: z.number().default(0),
  pay_currency: z.string(),
  order_id: z.string().uuid(),
  updated_at: z.string().optional().nullable(),
  outcome_hash: z.string().optional().nullable(),
  purchase_id: z.union([z.string(), z.number()]).optional().nullable(),
}).passthrough();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const signature = Array.isArray(req.headers["x-nowpayments-sig"]) ? req.headers["x-nowpayments-sig"][0] : req.headers["x-nowpayments-sig"];
  if (!verifyNowPaymentsSignature(req.body, signature, process.env.NOWPAYMENTS_IPN_SECRET)) {
    return res.status(401).json({ error: "Invalid webhook signature" });
  }
  const parsed = webhookSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid webhook payload" });

  const value = parsed.data;
  const payloadHash = paymentPayloadHash(req.body);
  const eventKey = `${value.payment_id}:${value.payment_status}:${value.updated_at || payloadHash}`;
  try {
    const admin = supabaseAdmin;
    const { data, error } = await (admin as any).rpc("apply_crypto_deposit_update", {
      p_provider: "nowpayments", p_event_key: eventKey, p_provider_payment_id: String(value.payment_id),
      p_invoice_id: value.order_id, p_payment_status: value.payment_status, p_price_amount: value.price_amount,
      p_price_currency: value.price_currency, p_pay_currency: value.pay_currency, p_pay_amount: value.pay_amount,
      p_actually_paid: value.actually_paid, p_tx_hash: value.outcome_hash || "", p_payload_hash: payloadHash, p_payload: req.body,
    });
    if (error) throw error;
    return res.status(202).json({ accepted: true, result: data });
  } catch (error) {
    console.error("Crypto webhook processing failed", error);
    return res.status(500).json({ error: "Webhook could not be processed" });
  }
}

