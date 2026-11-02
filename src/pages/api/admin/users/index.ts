import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const createUserSchema = z.object({
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
  fullName: z.string().trim().min(2).max(120).optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAdminApi(req, res);
  if (!auth) return;
  if (!["super_admin", "admin"].includes(auth.adminRole)) {
    return res.status(403).json({ error: "User management authorization required" });
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
      account_status: "pending_kyc",
      kyc_activation_override: false,
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
