import type { NextApiRequest, NextApiResponse } from "next";
import { protectApi } from "@/lib/server/apiProtection";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

function bearer(value: string | undefined) {
  return value?.startsWith("Bearer ") ? value.slice(7).trim() : null;
}

function safeBalance(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");

  if (
    !(await protectApi(req, res, {
      scope: "customer-wallet-balance",
      limit: 120,
      windowMs: 60_000,
      failClosed: false,
    }))
  ) {
    return;
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = bearer(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const { data: authData, error: authError } =
    await supabaseAdmin.auth.getUser(token);

  if (authError || !authData.user) {
    return res.status(401).json({ error: "Invalid session" });
  }

  const { data: rows, error: accountError } = await supabaseAdmin
    .from("ledger_accounts")
    .select("account_code,balance,currency")
    .eq("user_id", authData.user.id)
    .eq("currency", "USD");

  if (accountError) {
    console.error("Customer wallet ledger read failed", {
      userId: authData.user.id,
      code: accountError.code,
      message: accountError.message,
    });
    return res.status(500).json({ error: "Wallet balance could not be loaded" });
  }

  const balanceFor = (code: string) =>
    safeBalance(rows?.find((row) => row.account_code === code)?.balance);

  const cash = balanceFor("cash");
  const bonus = balanceFor("bonus");
  const locked = balanceFor("locked");

  return res.status(200).json({
    balances: {
      currency: rows?.[0]?.currency || "USD",
      cash,
      bonus,
      locked,
      available: cash + bonus,
    },
  });
}
