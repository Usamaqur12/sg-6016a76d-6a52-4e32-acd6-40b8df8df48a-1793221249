import { createClient } from "@supabase/supabase-js";
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

function publicSupabaseForToken(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();

  if (!url || !key) {
    throw new Error("Public Supabase configuration is missing");
  }

  return createClient(url, key, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
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

  const userClient = publicSupabaseForToken(token);
  const { data: authData, error: authError } =
    await userClient.auth.getUser(token);

  if (authError || !authData.user) {
    return res.status(401).json({ error: "Invalid session" });
  }

  const userId = authData.user.id;
  let { data: rows, error: accountError } = await userClient
    .from("ledger_accounts")
    .select("account_code,balance,currency")
    .eq("user_id", userId)
    .eq("currency", "USD");

  // A server read keeps this endpoint reliable if a customer's RLS policies
  // have not yet been refreshed in PostgREST.
  if (accountError || !rows || rows.length === 0) {
    const serverResult = await supabaseAdmin
      .from("ledger_accounts")
      .select("account_code,balance,currency")
      .eq("user_id", userId)
      .eq("currency", "USD");

    rows = serverResult.data;
    accountError = serverResult.error;
  }

  if (accountError) {
    console.error("Customer wallet ledger read failed", {
      userId,
      code: accountError.code,
      message: accountError.message,
    });
    return res.status(500).json({ error: "Wallet balance could not be loaded" });
  }

  const balanceFor = (code: string) =>
    safeBalance(rows?.find((row) => row.account_code === code)?.balance);

  let cash = balanceFor("cash");
  const bonus = balanceFor("bonus");
  const locked = balanceFor("locked");
  let source = "ledger";

  // Compatibility fallback for accounts created before the ledger rollout.
  // It is only used when every authoritative ledger bucket is zero.
  if (cash === 0 && bonus === 0 && locked === 0) {
    let { data: profile } = await userClient
      .from("profiles")
      .select("demo_balance")
      .eq("id", userId)
      .maybeSingle();

    if (!profile) {
      const serverProfile = await supabaseAdmin
        .from("profiles")
        .select("demo_balance")
        .eq("id", userId)
        .maybeSingle();
      profile = serverProfile.data;
    }

    const reconciled = safeBalance(profile?.demo_balance);
    if (reconciled > 0) {
      cash = reconciled;
      source = "profile_reconciliation";
    }
  }

  return res.status(200).json({
    balances: {
      currency: rows?.[0]?.currency || "USD",
      cash,
      bonus,
      locked,
      available: cash + bonus,
    },
    source,
    userId,
  });
}
