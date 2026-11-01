import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const bodySchema = z.object({
  confirmation: z.string().trim().min(3).max(320),
  reason: z.string().trim().min(5).max(500),
});

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message || "Unknown error");
  return "Customer anonymization failed";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAdminApi(req, res);
  if (!auth) return;
  if (auth.adminRole !== "super_admin") {
    return res.status(403).json({ error: "Only a super admin can anonymize a customer" });
  }

  const id = z.string().uuid().safeParse(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id);
  const body = bodySchema.safeParse(req.body);
  if (!id.success || !body.success) {
    return res.status(400).json({ error: "Valid customer, exact email confirmation and audit reason are required" });
  }

  const admin = supabaseAdmin as any;
  try {
    const userId = id.data;
    const { data: target, error: targetError } = await admin.from("profiles")
      .select("id,email,is_admin,account_anonymized_at")
      .eq("id", userId).maybeSingle();
    if (targetError) throw targetError;
    if (!target || target.is_admin) return res.status(404).json({ error: "Customer account not found" });
    if (target.account_anonymized_at) return res.status(409).json({ error: "This customer is already anonymized" });
    if (body.data.confirmation.toLowerCase() !== String(target.email || "").toLowerCase()) {
      return res.status(400).json({ error: "Confirmation must exactly match the customer email" });
    }

    const [accountsResult, pendingBets, pendingWithdrawals, pendingDeposits] = await Promise.all([
      admin.from("ledger_accounts").select("id,balance").eq("user_id", userId),
      admin.from("bets").select("id", { count: "exact", head: true }).eq("user_id", userId).in("status", ["pending","placed"]),
      admin.from("manual_withdrawal_requests").select("id", { count: "exact", head: true }).eq("user_id", userId).in("status", ["pending","approved"]),
      admin.from("manual_deposit_requests").select("id", { count: "exact", head: true }).eq("user_id", userId).in("status", ["pending","approved"]),
    ]);
    if (accountsResult.error) throw accountsResult.error;
    if (pendingBets.error) throw pendingBets.error;
    if (pendingWithdrawals.error) throw pendingWithdrawals.error;
    if (pendingDeposits.error) throw pendingDeposits.error;

    const balance = (accountsResult.data || []).reduce((sum: number, row: { balance?: number }) => sum + Number(row.balance || 0), 0);
    const pendingCount = Number(pendingBets.count || 0) + Number(pendingWithdrawals.count || 0) + Number(pendingDeposits.count || 0);
    if (Math.abs(balance) > 0.000001 || pendingCount > 0) {
      return res.status(409).json({
        error: "Settle or refund the wallet balance and all pending bets/deposits/withdrawals before anonymizing this customer.",
        balance,
        pendingItems: pendingCount,
      });
    }

    const reference = randomUUID();
    const anonymousEmail = `deleted-${userId}@users.invalid`;
    const emailHash = createHash("sha256").update(String(target.email).trim().toLowerCase()).digest("hex");
    const now = new Date().toISOString();
    const warnings: string[] = [];

    const { data: documents, error: documentsError } = await admin.from("kyc_documents")
      .select("id,file_url").eq("user_id", userId);
    if (documentsError) warnings.push("KYC records could not be inspected");
    const storagePaths = (documents || [])
      .map((row: { file_url?: string }) => row.file_url)
      .filter((path: string | undefined): path is string => typeof path === "string" && path.length > 0);
    if (storagePaths.length) {
      const { error } = await supabaseAdmin.storage.from("kyc-documents").remove(storagePaths);
      if (error) warnings.push("One or more KYC files could not be removed from storage");
    }
    const { error: kycDeleteError } = await admin.from("kyc_documents").delete().eq("user_id", userId);
    if (kycDeleteError) warnings.push("KYC database records could not be removed");

    const { error: profileError } = await admin.from("profiles").update({
      email: anonymousEmail,
      full_name: "Deleted Customer",
      phone_number: null,
      date_of_birth: null,
      country: null,
      avatar_url: null,
      referral_code: null,
      referred_by: null,
      is_verified: false,
      kyc_status: "not_submitted",
      two_factor_enabled: false,
      account_status: "closed",
      is_suspended: true,
      wallet_frozen: true,
      betting_disabled: true,
      deposits_disabled: true,
      withdrawals_disabled: true,
      account_deleted_at: now,
      account_deleted_by: auth.userId,
      account_anonymized_at: now,
      account_anonymized_by: auth.userId,
      anonymization_reference: reference,
      suspension_reason: "Account anonymized and closed",
      control_reason: body.data.reason,
      control_updated_at: now,
      control_updated_by: auth.userId,
      updated_at: now,
    }).eq("id", userId).eq("is_admin", false);
    if (profileError) throw profileError;

    const cleanupOperations = [
      admin.from("notifications").delete().eq("user_id", userId),
      admin.from("notification_preferences").delete().eq("user_id", userId),
      admin.from("push_subscriptions").delete().eq("user_id", userId),
      admin.from("support_ticket_messages").update({ message: "[redacted after account anonymization]" }).eq("author_id", userId),
      admin.from("support_tickets").update({ subject: "[anonymized customer request]", message: "[redacted after account anonymization]" }).eq("user_id", userId),
      admin.from("casino_sessions").update({ status: "closed", updated_at: now }).eq("user_id", userId).in("status", ["creating","active"]),
      admin.from("ledger_accounts").update({ status: "frozen", updated_at: now }).eq("user_id", userId),
      admin.from("broker_players").update({ is_active: false }).eq("player_id", userId),
    ];
    const cleanupResults = await Promise.all(cleanupOperations);
    if (cleanupResults.some((result) => result.error)) warnings.push("Some optional communication/session records require manual review");

    const { error: recordError } = await admin.from("customer_anonymizations").insert({
      id: reference,
      user_id: userId,
      anonymized_by: auth.userId,
      original_email_hash: emailHash,
      reason: body.data.reason,
      retained_financial_history: true,
    });
    if (recordError) throw recordError;

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      email: anonymousEmail,
      password: randomBytes(32).toString("hex"),
      email_confirm: true,
      ban_duration: "876000h",
      user_metadata: { account_anonymized: true, anonymization_reference: reference },
    });
    if (authError) warnings.push("Supabase Auth could not be anonymized; the closed profile still blocks platform access");

    const forwardedFor = req.headers["x-forwarded-for"];
    const ipAddress = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(",")[0]?.trim() || req.socket.remoteAddress || null;
    const { error: auditError } = await admin.from("audit_logs").insert({
      admin_id: auth.userId,
      action: "user_anonymized_and_closed",
      entity_type: "profile",
      entity_id: userId,
      changes: {
        anonymization_reference: reference,
        original_email_hash: emailHash,
        reason: body.data.reason,
        retained_financial_history: true,
        removed_kyc_records: (documents || []).length,
        warnings,
      },
      ip_address: ipAddress,
      user_agent: req.headers["user-agent"] || null,
    });
    if (auditError) warnings.push("Audit log insertion requires manual review");

    return res.status(200).json({
      success: true,
      message: "Customer personal data was anonymized, access was closed, and financial/betting history was retained.",
      reference,
      warnings,
    });
  } catch (error) {
    console.error("Customer anonymization failed", error);
    return res.status(500).json({ error: message(error) });
  }
}
