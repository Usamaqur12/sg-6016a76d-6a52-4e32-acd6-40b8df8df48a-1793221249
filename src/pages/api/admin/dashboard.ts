import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

type CountFilter = { column: string; value?: string | boolean; values?: string[] };

async function countRows(table: string, filters: CountFilter[] = []) {
  let query: any = supabaseAdmin.from(table).select("*", { count: "exact", head: true });
  for (const filter of filters) {
    query = filter.values ? query.in(filter.column, filter.values) : query.eq(filter.column, filter.value);
  }
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function safeCount(table: string, filters: CountFilter[] = []) {
  try {
    return await countRows(table, filters);
  } catch (error) {
    console.warn(`Dashboard count unavailable for ${table}`, error);
    return 0;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const adminAuth = await requireAdminApi(req, res);
  if (!adminAuth) return;

  const [
    pendingDeposits,
    pendingWithdrawals,
    pendingApprovals,
    openSupportTickets,
    pendingKyc,
    unreviewedRiskFlags,
    pendingJobs,
    failedJobs,
    liveEvents,
    upcomingEvents,
    enabledProviders,
    unhealthyProviders,
  ] = await Promise.all([
    safeCount("manual_deposit_requests", [{ column: "status", values: ["pending", "on_hold", "awaiting_approval"] }]),
    safeCount("manual_withdrawal_requests", [{ column: "status", values: ["pending", "on_hold", "awaiting_approval"] }]),
    safeCount("admin_approval_requests", [{ column: "status", value: "pending" }]),
    safeCount("support_tickets", [{ column: "status", values: ["open", "in_progress", "waiting_response"] }]),
    safeCount("kyc_documents", [{ column: "status", value: "pending" }]),
    safeCount("fraud_flags", [{ column: "is_reviewed", value: false }]),
    safeCount("background_jobs", [{ column: "status", value: "pending" }]),
    safeCount("background_jobs", [{ column: "status", value: "failed" }]),
    safeCount("events", [{ column: "status", value: "live" }]),
    safeCount("events", [{ column: "status", value: "upcoming" }]),
    safeCount("sports_feed_providers", [{ column: "is_enabled", value: true }]),
    safeCount("sports_feed_providers", [{ column: "is_enabled", value: true }, { column: "status", values: ["error", "degraded"] }]),
  ]);

  return res.status(200).json({
    generatedAt: new Date().toISOString(),
    queues: { pendingDeposits, pendingWithdrawals, pendingApprovals, openSupportTickets, pendingKyc, unreviewedRiskFlags },
    system: { pendingJobs, failedJobs, liveEvents, upcomingEvents, enabledProviders, unhealthyProviders },
  });
}
