import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { hasAccess } from "@/lib/adminRoles";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const periodSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
}).refine((value) => value.to > value.from, { message: "The report end must be after its start" });

const settingsSchema = z.object({
  paymentFeeBps: z.number().int().min(0).max(5000),
  gamingTaxBps: z.number().int().min(0).max(10000),
  defaultCasinoShareBps: z.number().int().min(0).max(10000),
});

const settlementStatusSchema = z.object({
  resource: z.literal("settlement_status"),
  id: z.string().uuid(),
  status: z.enum(["approved","paid","disputed"]),
  paymentReference: z.string().trim().max(240).optional().nullable(),
});

const adjustmentSchema = z.object({
  resource: z.literal("adjustment"),
  type: z.enum(["payment_fee","provider_fee","gaming_tax","chargeback","refund","bonus_cost","affiliate_commission","other_cost","other_income"]),
  amount: z.number().positive().max(100_000_000),
  reference: z.string().trim().max(240).optional().nullable(),
  notes: z.string().trim().min(3).max(1000),
  occurredAt: z.string().datetime().optional(),
});

const settlementSchema = z.object({
  resource: z.literal("casino_settlements"),
  from: z.string().datetime(),
  to: z.string().datetime(),
});

function canManageFinance(role: string) {
  return role === "super_admin" || role === "finance";
}

function getOperationError(error: unknown) {
  const details =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message || "")
        : String(error || "");

  const schemaNotReady = /get_finance_summary|finance_settings|finance_adjustments|casino_provider_settlements|schema cache|does not exist/i.test(details);
  return {
    status: schemaNotReady ? 503 : 500,
    code: schemaNotReady ? "REVENUE_SCHEMA_NOT_READY" : "REVENUE_OPERATION_FAILED",
    message: schemaNotReady
      ? `Revenue database objects are not active. Run supabase/migrations/20261102120000_revenue_accounting.sql in Supabase SQL Editor. Database detail: ${details}`
      : details || "Revenue operation failed",
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAdminApi(req, res);
  if (!auth) return;
  if (!hasAccess(auth.adminRole, "reports")) return res.status(403).json({ error: "Reports authorization required" });

  const admin = supabaseAdmin as any;

  try {
    if (req.method === "GET") {
      const parsed = periodSchema.safeParse({
        from: Array.isArray(req.query.from) ? req.query.from[0] : req.query.from,
        to: Array.isArray(req.query.to) ? req.query.to[0] : req.query.to,
      });
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Valid reporting dates are required" });

      const periodFrom = parsed.data.from.toISOString();
      const periodTo = parsed.data.to.toISOString();
      const [summaryResult, settingsResult, adjustmentsResult, settlementsResult] = await Promise.all([
        admin.rpc("get_finance_summary", { p_period_from: periodFrom, p_period_to: periodTo }),
        admin.from("finance_settings").select("*").eq("id", true).single(),
        admin.from("finance_adjustments").select("*").gte("occurred_at", periodFrom).lt("occurred_at", periodTo).order("occurred_at", { ascending: false }).limit(250),
        admin.from("casino_provider_settlements").select("*,casino_providers(name,code)").order("period_from", { ascending: false }).limit(100),
      ]);
      if (summaryResult.error) throw summaryResult.error;
      if (settingsResult.error) throw settingsResult.error;
      if (adjustmentsResult.error) throw adjustmentsResult.error;
      if (settlementsResult.error) throw settlementsResult.error;
      return res.status(200).json({
        summary: summaryResult.data,
        settings: settingsResult.data,
        adjustments: adjustmentsResult.data || [],
        settlements: settlementsResult.data || [],
        canManage: canManageFinance(auth.adminRole),
      });
    }

    if (req.method === "PATCH") {
      if (!canManageFinance(auth.adminRole)) return res.status(403).json({ error: "Finance role required" });

      const settlementStatus = settlementStatusSchema.safeParse(req.body);
      if (settlementStatus.success) {
        if (settlementStatus.data.status === "paid" && !settlementStatus.data.paymentReference) {
          return res.status(400).json({ error: "Payment reference is required when marking a settlement paid" });
        }
        const now = new Date().toISOString();
        const changes: Record<string, unknown> = {
          status: settlementStatus.data.status,
          payment_reference: settlementStatus.data.paymentReference || null,
        };
        if (settlementStatus.data.status === "approved") changes.approved_at = now;
        if (settlementStatus.data.status === "paid") { changes.approved_at = now; changes.paid_at = now; }
        const { error } = await admin.from("casino_provider_settlements").update(changes).eq("id", settlementStatus.data.id);
        if (error) throw error;
        await admin.from("audit_logs").insert({
          admin_id: auth.userId,
          action: "casino_settlement_status_updated",
          entity_type: "casino_provider_settlement",
          entity_id: settlementStatus.data.id,
          changes,
        });
        return res.status(200).json({ success: true });
      }

      const parsed = settingsSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Valid finance settings are required" });
      const { error } = await admin.from("finance_settings").update({
        payment_fee_bps: parsed.data.paymentFeeBps,
        gaming_tax_bps: parsed.data.gamingTaxBps,
        default_casino_share_bps: parsed.data.defaultCasinoShareBps,
        updated_by: auth.userId,
        updated_at: new Date().toISOString(),
      }).eq("id", true);
      if (error) throw error;
      await admin.from("audit_logs").insert({
        admin_id: auth.userId,
        action: "finance_settings_updated",
        entity_type: "finance_settings",
        changes: parsed.data,
      });
      return res.status(200).json({ success: true });
    }

    if (req.method === "POST") {
      if (!canManageFinance(auth.adminRole)) return res.status(403).json({ error: "Finance role required" });

      const adjustment = adjustmentSchema.safeParse(req.body);
      if (adjustment.success) {
        const { data, error } = await admin.from("finance_adjustments").insert({
          adjustment_type: adjustment.data.type,
          amount: adjustment.data.amount,
          currency: "USD",
          reference: adjustment.data.reference || null,
          notes: adjustment.data.notes,
          occurred_at: adjustment.data.occurredAt || new Date().toISOString(),
          created_by: auth.userId,
        }).select("id").single();
        if (error) throw error;
        await admin.from("audit_logs").insert({
          admin_id: auth.userId,
          action: "finance_adjustment_created",
          entity_type: "finance_adjustment",
          entity_id: data.id,
          changes: { type: adjustment.data.type, amount: adjustment.data.amount, reference: adjustment.data.reference || null },
        });
        return res.status(201).json({ success: true, id: data.id });
      }

      const settlement = settlementSchema.safeParse(req.body);
      if (!settlement.success) return res.status(400).json({ error: "Valid adjustment or settlement request is required" });
      const { data, error } = await admin.rpc("create_casino_provider_settlements", {
        p_period_from: settlement.data.from,
        p_period_to: settlement.data.to,
        p_admin_id: auth.userId,
      });
      if (error) throw error;
      return res.status(201).json({ success: true, providers: data });
    }

    res.setHeader("Allow", "GET, PATCH, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("Revenue operation failed", error);
    const operationError = getOperationError(error);
    return res.status(operationError.status).json({
      error: operationError.message,
      code: operationError.code,
    });
  }
}
