import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

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
  return "Account control update failed";
}

const controlsSchema = z.object({
  reason: z.string().trim().min(5).max(500),
  action: z.enum(["archive", "restore"]).optional(),
  controls: z.object({
    is_suspended: z.boolean().optional(),
    wallet_frozen: z.boolean().optional(),
    betting_disabled: z.boolean().optional(),
    deposits_disabled: z.boolean().optional(),
    withdrawals_disabled: z.boolean().optional(),
  }).partial().optional(),
}).refine((value) => value.action || (value.controls && Object.keys(value.controls).length > 0), {
  message: "Choose at least one account control",
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PATCH") {
    res.setHeader("Allow", "PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAdminApi(req, res);
  if (!auth) return;
  if (!["super_admin", "admin"].includes(auth.adminRole)) {
    return res.status(403).json({ error: "Account-control authorization required" });
  }

  const parsedId = z.string().uuid().safeParse(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id);
  const parsedBody = controlsSchema.safeParse(req.body);
  if (!parsedId.success || !parsedBody.success) {
    return res.status(400).json({ error: "Valid user, controls and a reason of at least 5 characters are required" });
  }
  try {
    const userId = parsedId.data;
    const { data: target, error: targetError } = await (supabaseAdmin as any)
      .from("profiles")
      .select("id,email,is_admin,account_status,is_suspended,wallet_frozen,betting_disabled,deposits_disabled,withdrawals_disabled")
      .eq("id", userId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target || target.is_admin) return res.status(404).json({ error: "Customer account not found" });

    const updates: Record<string, unknown> = {
      ...(parsedBody.data.controls || {}),
      control_reason: parsedBody.data.reason,
      control_updated_by: auth.userId,
      control_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (parsedBody.data.action === "archive") {
      Object.assign(updates, {
        account_status: "closed",
        is_suspended: true,
        wallet_frozen: true,
        betting_disabled: true,
        deposits_disabled: true,
        withdrawals_disabled: true,
        account_deleted_at: new Date().toISOString(),
        account_deleted_by: auth.userId,
      });
    } else if (parsedBody.data.action === "restore") {
      Object.assign(updates, {
        account_status: "active",
        is_suspended: false,
        wallet_frozen: false,
        betting_disabled: false,
        deposits_disabled: false,
        withdrawals_disabled: false,
        account_deleted_at: null,
        account_deleted_by: null,
      });
    }

    // Run protected profile changes as the authenticated admin. This keeps
    // database role/trigger checks effective with opaque Supabase secret keys.
    const adminClient = createAdminRequestClient(req);
    const { data: updated, error: updateError } = await (adminClient as any)
      .from("profiles")
      .update(updates)
      .eq("id", userId)
      .eq("is_admin", false)
      .select("id,email,is_suspended,account_status,wallet_frozen,betting_disabled,deposits_disabled,withdrawals_disabled,account_deleted_at,control_reason")
      .single();
    if (updateError) throw updateError;

    if (parsedBody.data.action) {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
      const metadata = authUser.user?.user_metadata || {};
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        ban_duration: parsedBody.data.action === "archive" ? "876000h" : "none",
        user_metadata: {
          ...metadata,
          account_archived: parsedBody.data.action === "archive",
          account_control_reason: parsedBody.data.reason,
        },
      });
      if (authError) {
        console.error("Auth archive state sync failed", authError);
        if (parsedBody.data.action === "restore") {
          throw new Error("Profile restored, but authentication could not be re-enabled. Retry Restore User.");
        }
      }
    }

    const forwardedFor = req.headers["x-forwarded-for"];
    const ipAddress = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor?.split(",")[0]?.trim() || req.socket.remoteAddress || null;
    await supabaseAdmin.from("audit_logs").insert({
      admin_id: auth.userId,
      action: parsedBody.data.action ? "user_" + parsedBody.data.action + "d" : "user_controls_updated",
      entity_type: "profile",
      entity_id: userId,
      changes: { before: target, after: updated, reason: parsedBody.data.reason },
      ip_address: ipAddress,
      user_agent: req.headers["user-agent"] || null,
    });

    return res.status(200).json({ success: true, profile: updated });
  } catch (error) {
    console.error("Account control update failed", error);
    return res.status(500).json({ error: getErrorMessage(error) });
  }
}
