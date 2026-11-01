import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const bodySchema = z.object({
  confirmation: z.string().trim().min(3).max(320),
  reason: z.string().trim().min(5).max(500),
});

function createAdminRequestClient(req: NextApiRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publicKey = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();
  const authorization = req.headers.authorization;

  if (!url || !publicKey || !authorization?.startsWith("Bearer ")) {
    throw new Error("Authenticated Supabase admin session is not configured");
  }

  return createClient(url, publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Permanent deletion failed";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "DELETE") {
    res.setHeader("Allow", "DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAdminApi(req, res);
  if (!auth) return;
  if (auth.adminRole !== "super_admin") {
    return res.status(403).json({ error: "Only a super admin can permanently delete a customer" });
  }

  const parsedId = z.string().uuid().safeParse(
    Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  );
  const parsedBody = bodySchema.safeParse(req.body);
  if (!parsedId.success || !parsedBody.success) {
    return res.status(400).json({
      error: "Valid customer, exact email confirmation, and an audit reason of at least 5 characters are required",
    });
  }

  try {
    const userId = parsedId.data;
    const { data: target, error: targetError } = await supabaseAdmin
      .from("profiles")
      .select("id,email,is_admin,account_status")
      .eq("id", userId)
      .maybeSingle();

    if (targetError) throw targetError;
    if (!target || target.is_admin) {
      return res.status(404).json({ error: "Customer account not found" });
    }
    if (parsedBody.data.confirmation.toLowerCase() !== String(target.email).toLowerCase()) {
      return res.status(400).json({ error: "Confirmation must exactly match the customer email" });
    }

    const [betsResult, transactionsResult, adjustmentsResult, walletResult] = await Promise.all([
      supabaseAdmin.from("bets").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabaseAdmin.from("wallet_transactions").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabaseAdmin.from("admin_balance_adjustments").select("id", { count: "exact", head: true }).eq("user_id", userId),
      (supabaseAdmin as any).rpc("get_user_wallet_balance", { p_user_id: userId }),
    ]);

    if (betsResult.error) throw betsResult.error;
    if (transactionsResult.error) throw transactionsResult.error;
    if (adjustmentsResult.error) throw adjustmentsResult.error;
    if (walletResult.error) throw walletResult.error;

    const wallet = walletResult.data as {
      cash_balance?: number;
      bonus_balance?: number;
      locked_balance?: number;
    } | null;
    const balance =
      Number(wallet?.cash_balance || 0) +
      Number(wallet?.bonus_balance || 0) +
      Number(wallet?.locked_balance || 0);
    const historyCount =
      Number(betsResult.count || 0) +
      Number(transactionsResult.count || 0) +
      Number(adjustmentsResult.count || 0);

    if (Math.abs(balance) > 0.000001 || historyCount > 0) {
      return res.status(409).json({
        error:
          "This customer has wallet or financial/betting history and cannot be permanently erased. Archive the account instead.",
      });
    }

    const adminClient = createAdminRequestClient(req);
    const now = new Date().toISOString();
    const { error: closeError } = await adminClient
      .from("profiles")
      .update({
        account_status: "closed",
        is_suspended: true,
        wallet_frozen: true,
        betting_disabled: true,
        deposits_disabled: true,
        withdrawals_disabled: true,
        account_deleted_at: now,
        account_deleted_by: auth.userId,
        control_reason: parsedBody.data.reason,
        control_updated_at: now,
        control_updated_by: auth.userId,
      })
      .eq("id", userId)
      .eq("is_admin", false);
    if (closeError) throw closeError;

    const forwardedFor = req.headers["x-forwarded-for"];
    const ipAddress = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor?.split(",")[0]?.trim() || req.socket.remoteAddress || null;
    const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
      admin_id: auth.userId,
      action: "user_permanently_deleted",
      entity_type: "profile",
      entity_id: userId,
      changes: {
        email: target.email,
        reason: parsedBody.data.reason,
        verified_zero_balance: true,
        verified_no_financial_history: true,
      },
      ip_address: ipAddress,
      user_agent: req.headers["user-agent"] || null,
    });
    if (auditError) throw auditError;

    const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userId, false);
    if (authDeleteError) throw authDeleteError;

    const { data: remainingProfile, error: remainingError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (remainingError) throw remainingError;

    if (remainingProfile) {
      const { error: profileDeleteError } = await supabaseAdmin
        .from("profiles")
        .delete()
        .eq("id", userId)
        .eq("is_admin", false);
      if (profileDeleteError) {
        return res.status(409).json({
          error:
            "Login was permanently deleted, but related database records require this profile to remain archived.",
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: "Customer login and empty profile were permanently deleted",
    });
  } catch (error) {
    console.error("Permanent customer deletion failed", error);
    return res.status(500).json({ error: getErrorMessage(error) });
  }
}
