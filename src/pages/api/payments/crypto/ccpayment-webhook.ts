import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { ccPaymentRequest, getCCPaymentConfiguration } from "@/lib/server/ccpayment";
import { paymentPayloadHash } from "@/lib/server/cryptoPayments";
import { protectApi } from "@/lib/server/apiProtection";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const webhookSchema = z.object({
  type: z.literal("ApiDeposit"),
  msg: z.object({
    recordId: z.string().min(1).max(160),
    orderId: z.string().uuid(),
    coinId: z.union([z.string(), z.number()]).optional(),
    coinSymbol: z.string().optional(),
    status: z.enum(["Processing", "Success", "Failed"]),
    isFlaggedAsRisky: z.boolean().default(false),
  }).passthrough(),
}).passthrough();

type PaidRecord = {
  recordId?: string;
  status?: string;
  coinSymbol?: string;
  paidValue?: string | number;
  amount?: string | number;
  txId?: string;
  txid?: string;
  isFlaggedAsRisky?: boolean;
};

type OrderInfo = {
  orderId: string;
  price: string | number;
  priceSymbol: string;
  totalPaidValue: string | number;
  paidList?: PaidRecord[];
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!await protectApi(req, res, { scope: "ccpayment-webhook", limit: 240, windowMs: 60_000, requireJson: true, failClosed: false })) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!getCCPaymentConfiguration().configured) {
    return res.status(503).json({ error: "CCPayment is not configured" });
  }

  const parsed = webhookSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid CCPayment webhook payload" });

  const notification = parsed.data;
  try {
    // CCPayment documents webhook messages as notifications only. The signed
    // server-to-server order query is the authority for every wallet credit.
    const order = await ccPaymentRequest<OrderInfo>("getInvoiceOrderInfo", {
      orderId: notification.msg.orderId,
    });
    if (order.orderId !== notification.msg.orderId) {
      throw new Error("CCPayment order identity mismatch");
    }

    const paidList = Array.isArray(order.paidList) ? order.paidList : [];
    const matchingRecord =
      paidList.find((item) => item.recordId === notification.msg.recordId) ||
      paidList.find((item) => item.status === "Success") ||
      paidList[0];

    const risky = Boolean(
      notification.msg.isFlaggedAsRisky ||
      paidList.some((item) => item.isFlaggedAsRisky === true)
    );
    const totalPaid = Number(order.totalPaidValue || 0);
    const price = Number(order.price || 0);
    if (!Number.isFinite(totalPaid) || !Number.isFinite(price) || price <= 0) {
      throw new Error("CCPayment returned invalid order amounts");
    }

    const reconciledStatus = risky
      ? "Risky"
      : paidList.some((item) => item.status === "Success") && totalPaid + 0.00000001 >= price
        ? "Success"
        : notification.msg.status === "Failed" && !paidList.some((item) => item.status === "Processing")
          ? "Failed"
          : "Processing";

    const payload = { notification, order };
    const eventKey = [
      notification.msg.recordId,
      reconciledStatus,
      String(order.totalPaidValue),
    ].join(":");

    const { data, error } = await (supabaseAdmin as any).rpc(
      "apply_ccpayment_invoice_update",
      {
        p_event_key: eventKey,
        p_invoice_id: notification.msg.orderId,
        p_payment_status: reconciledStatus,
        p_price_value: price,
        p_price_symbol: order.priceSymbol,
        p_paid_value: totalPaid,
        p_pay_currency: matchingRecord?.coinSymbol || notification.msg.coinSymbol || "multi",
        p_tx_hash: matchingRecord?.txId || matchingRecord?.txid || "",
        p_risky: risky,
        p_payload_hash: paymentPayloadHash(payload),
        p_payload: payload,
      }
    );
    if (error) throw error;

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send("Success");
  } catch (error) {
    console.error("CCPayment webhook reconciliation failed", {
      orderId: notification.msg.orderId,
      recordId: notification.msg.recordId,
      error,
    });
    return res.status(500).json({ error: "CCPayment webhook could not be reconciled" });
  }
}
