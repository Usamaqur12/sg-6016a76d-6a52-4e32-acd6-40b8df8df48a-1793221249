import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const createUserSchema = z.object({
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
  fullName: z.string().trim().min(2).max(120).optional(),
});

function money(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

async function listUsers(res: NextApiResponse) {
  const [profilesResult, ledgerResult, betsResult, depositsResult] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("id,email,full_name,kyc_status,is_suspended,account_status,created_at,demo_balance")
      .eq("is_admin", false)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("ledger_accounts")
      .select("user_id,account_code,balance,currency")
      .not("user_id", "is", null)
      .eq("currency", "USD"),
    supabaseAdmin.from("bets").select("user_id"),
    supabaseAdmin
      .from("wallet_transactions")
      .select("user_id,amount")
      .eq("type", "deposit")
      .eq("status", "completed"),
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (ledgerResult.error) throw ledgerResult.error;
  if (betsResult.error) throw betsResult.error;
  if (depositsResult.error) throw depositsResult.error;

  const walletMap = new Map<string, { cash: number; bonus: number; locked: number }>();
  for (const row of ledgerResult.data || []) {
    if (!row.user_id) continue;
    const balance = walletMap.get(row.user_id) || { cash: 0, bonus: 0, locked: 0 };
    if (row.account_code === "cash") balance.cash = money(row.balance);
    if (row.account_code === "bonus") balance.bonus = money(row.balance);
    if (row.account_code === "locked") balance.locked = money(row.balance);
    walletMap.set(row.user_id, balance);
  }

  const betCountMap = new Map<string, number>();
  for (const bet of betsResult.data || []) {
    betCountMap.set(bet.user_id, (betCountMap.get(bet.user_id) || 0) + 1);
  }

  const depositMap = new Map<string, number>();
  for (const deposit of depositsResult.data || []) {
    depositMap.set(
      deposit.user_id,
      (depositMap.get(deposit.user_id) || 0) + money(deposit.amount)
    );
  }

  const users = (profilesResult.data || []).map((profile) => {
    const ledger = walletMap.get(profile.id) || { cash: 0, bonus: 0, locked: 0 };
    const ledgerAvailable = ledger.cash + ledger.bonus;
    const walletBalance =
      ledgerAvailable !== 0 ? ledgerAvailable : Math.max(0, money(profile.demo_balance));

    return {
      id: profile.id,
      email: profile.email,
      full_name: profile.full_name,
      kyc_status: profile.kyc_status || "not_submitted",
      is_suspended: Boolean(profile.is_suspended),
      account_status: profile.account_status === "closed" ? "closed" : "active",
      created_at: profile.created_at,
      wallet_balance: walletBalance,
      wallet: {
        currency: "USD",
        cash: ledgerAvailable !== 0 ? ledger.cash : walletBalance,
        bonus: ledger.bonus,
        locked: ledger.locked,
        available: walletBalance,
      },
      total_bets: betCountMap.get(profile.id) || 0,
      total_deposits: depositMap.get(profile.id) || 0,
    };
  });

  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  return res.status(200).json({ users });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!["GET", "POST"].includes(req.method || "")) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAdminApi(req, res);
  if (!auth) return;
  if (!["super_admin", "admin"].includes(auth.adminRole)) {
    return res.status(403).json({ error: "User management authorization required" });
  }

  if (req.method === "GET") {
    try {
      return await listUsers(res);
    } catch (error) {
      console.error("User list failed", error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Unable to load users",
      });
    }
  }

  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "A valid email and temporary password of at least 12 characters are required",
    });
  }

  const { email, password, fullName } = parsed.data;

  try {
    const { data: existingProfile, error: lookupError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (lookupError) throw lookupError;
    if (existingProfile) {
      return res.status(409).json({ error: "A user with this email already exists" });
    }

    const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName || null,
        force_password_change: true,
        created_by_admin: auth.userId,
      },
    });

    if (createError || !createdUser.user) {
      if (createError?.message?.toLowerCase().includes("already")) {
        return res.status(409).json({ error: "A user with this email already exists" });
      }
      throw createError || new Error("Unable to create user login");
    }

    const userId = createdUser.user.id;
    const { error: profileError } = await (supabaseAdmin as any).from("profiles").upsert({
      id: userId,
      email,
      full_name: fullName || null,
      is_admin: false,
      admin_role: null,
      is_suspended: false,
      demo_balance: 0,
      account_status: "active",
      kyc_activation_override: true,
    }, { onConflict: "id" });

    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw profileError;
    }

    const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
      admin_id: auth.userId,
      action: "user_created",
      entity_type: "profile",
      entity_id: userId,
      changes: {
        email,
        full_name: fullName || null,
        starting_balance: 0,
      },
    });

    if (auditError) {
      console.error("User creation audit log failed", auditError);
    }

    return res.status(201).json({
      success: true,
      user: { id: userId, email, fullName: fullName || null },
      message: "Customer login created with $0.00 balance. KYC approval or an admin activation override is required.",
    });
  } catch (error) {
    console.error("User creation failed", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "User creation failed",
    });
  }
}
