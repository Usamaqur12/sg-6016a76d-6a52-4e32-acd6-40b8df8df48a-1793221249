import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

function money(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const auth = await requireAdminApi(req, res);
  if (!auth) return;
  const parsedId = z.string().uuid().safeParse(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id);
  if (!parsedId.success) return res.status(400).json({ error: "Valid user ID is required" });

  try {
    const userId = parsedId.data;
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id,email,full_name,kyc_status,kyc_activation_override,is_suspended,created_at,is_admin,account_status,wallet_frozen,betting_disabled,deposits_disabled,withdrawals_disabled,account_deleted_at,control_reason,account_anonymized_at,anonymization_reference,demo_balance")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile || profile.is_admin) return res.status(404).json({ error: "Customer not found" });

    const [transactionsResult, betsResult, adjustmentsResult, ledgerResult] = await Promise.all([
      supabaseAdmin.from("wallet_transactions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(25),
      supabaseAdmin.from("bets").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(25),
      supabaseAdmin.from("admin_balance_adjustments").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(25),
      supabaseAdmin
        .from("ledger_accounts")
        .select("account_code,balance,currency")
        .eq("user_id", userId)
        .eq("currency", "USD"),
    ]);

    if (transactionsResult.error) throw transactionsResult.error;
    if (betsResult.error) throw betsResult.error;
    if (ledgerResult.error) throw ledgerResult.error;

    const balanceFor = (code: string) =>
      money(ledgerResult.data?.find((row) => row.account_code === code)?.balance);

    let cash = balanceFor("cash");
    const bonus = balanceFor("bonus");
    const locked = balanceFor("locked");

    if (cash === 0 && bonus === 0 && locked === 0) {
      cash = Math.max(0, money(profile.demo_balance));
    }

    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    return res.status(200).json({
      requesterRole: auth.adminRole,
      profile,
      wallet: {
        currency: ledgerResult.data?.[0]?.currency || "USD",
        cash,
        bonus,
        locked,
        available: cash + bonus,
      },
      transactions: transactionsResult.data || [],
      bets: betsResult.data || [],
      adjustments: adjustmentsResult.error ? [] : adjustmentsResult.data || [],
    });
  } catch (error) {
    console.error("User details failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load user details" });
  }
}
