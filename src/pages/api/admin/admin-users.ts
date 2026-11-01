import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const assignableRoles = ["admin", "finance", "kyc", "support", "risk_manager", "sports_trader"] as const;
const USERNAME_LOGIN_DOMAIN = "users.primebet.test";

function resolveAdminIdentifier(value: string): {
  email: string;
  identifier: string;
  kind: "email" | "username";
} {
  const identifier = value.trim().toLowerCase();

  if (identifier.includes("@")) {
    const email = z.string().email().max(320).safeParse(identifier);
    if (!email.success) throw new Error("Enter a valid email address or username");
    return { email: email.data, identifier: email.data, kind: "email" };
  }

  const validUsername =
    /^[a-z0-9][a-z0-9._-]{2,31}$/.test(identifier) &&
    !identifier.endsWith(".") &&
    !identifier.includes("..");

  if (!validUsername) {
    throw new Error("Username must be 3–32 characters using letters, numbers, dot, underscore, or hyphen");
  }

  return {
    email: `${identifier}@${USERNAME_LOGIN_DOMAIN}`,
    identifier,
    kind: "username",
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Admin operation failed";
}

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

async function writeAudit(adminId: string, action: string, entityId: string, changes: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from("audit_logs").insert({
    admin_id: adminId,
    action,
    entity_type: "admin_profile",
    entity_id: entityId,
    changes,
  });
  if (error) console.error("Admin audit log failed", error);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAdminApi(req, res);
  if (!auth) return;
  if (auth.adminRole !== "super_admin") {
    return res.status(403).json({ error: "Super admin access required" });
  }

  try {
    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("id,email,admin_role,is_suspended,created_at")
        .eq("is_admin", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return res.status(200).json({ admins: data || [] });
    }

    if (req.method === "POST") {
      const parsed = z.object({
        identifier: z.string().trim().min(3).max(320),
        password: z.string().min(12).max(128),
        role: z.enum(assignableRoles),
      }).safeParse({
        ...(req.body || {}),
        identifier: req.body?.identifier ?? req.body?.email,
      });
      if (!parsed.success) {
        return res.status(400).json({
          error: "Email or username, a temporary password of at least 12 characters, and an assignable role are required",
        });
      }

      let login: ReturnType<typeof resolveAdminIdentifier>;
      try {
        login = resolveAdminIdentifier(parsed.data.identifier);
      } catch (error) {
        return res.status(400).json({ error: getErrorMessage(error) });
      }

      const { data: existingProfile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("id,email,is_admin,admin_role")
        .eq("email", login.email)
        .maybeSingle();
      if (profileError) throw profileError;
      if (existingProfile?.is_admin) {
        return res.status(409).json({ error: "This user is already an admin" });
      }

      let profileId = existingProfile?.id;
      let createdAuthUser = false;

      if (!profileId) {
        const { data: createdUser, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
          email: login.email,
          password: parsed.data.password,
          email_confirm: true,
          user_metadata: {
            force_password_change: true,
            created_by_super_admin: auth.userId,
            login_identifier: login.identifier,
            login_kind: login.kind,
          },
        });

        if (createUserError || !createdUser.user) {
          throw createUserError || new Error("Unable to create the admin login");
        }

        profileId = createdUser.user.id;
        createdAuthUser = true;
      }

      const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("id", profileId)
        .maybeSingle();
      if (targetProfileError) throw targetProfileError;

      if (!targetProfile) {
        const { error: profileInsertError } = await supabaseAdmin.from("profiles").insert({
          id: profileId,
          email: login.email,
          is_admin: false,
          admin_role: null,
          is_suspended: false,
        });
        if (profileInsertError) {
          if (createdAuthUser) await supabaseAdmin.auth.admin.deleteUser(profileId);
          throw profileInsertError;
        }
      }

      // The database protects admin authority with the authenticated
      // super-admin identity. New Supabase secret keys are opaque rather than
      // JWTs, so this mutation intentionally uses the caller's verified token.
      const adminClient = createAdminRequestClient(req);
      const { data: updatedProfile, error: upsertError } = await adminClient
        .from("profiles")
        .update({
          email: login.email,
          is_admin: true,
          admin_role: parsed.data.role,
          is_suspended: false,
        })
        .eq("id", profileId)
        .select("id")
        .maybeSingle();

      if (upsertError || !updatedProfile) {
        if (createdAuthUser) {
          await supabaseAdmin.auth.admin.deleteUser(profileId);
        }
        throw upsertError || new Error("Admin profile could not be updated");
      }

      await writeAudit(auth.userId, "admin_created", profileId, {
        email: login.email,
        login_identifier: login.identifier,
        login_kind: login.kind,
        role: parsed.data.role,
        created_login: createdAuthUser,
      });

      return res.status(201).json({
        success: true,
        createdUser: createdAuthUser,
        identifier: login.identifier,
        loginKind: login.kind,
        message: createdAuthUser
          ? `Admin login created for ${login.identifier}; verification is not required`
          : `Existing account ${login.identifier} promoted to admin`,
      });
    }

    if (req.method === "PATCH") {
      const parsed = z.object({ id: z.string().uuid(), suspended: z.boolean() }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Valid admin and suspension state are required" });
      if (parsed.data.id === auth.userId) return res.status(400).json({ error: "You cannot suspend your own account" });

      const { data: target, error: targetError } = await supabaseAdmin
        .from("profiles")
        .select("id,admin_role,is_admin")
        .eq("id", parsed.data.id)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target?.is_admin) return res.status(404).json({ error: "Admin not found" });
      if (target.admin_role === "super_admin") return res.status(403).json({ error: "Another super admin cannot be suspended here" });

      const adminClient = createAdminRequestClient(req);
      const { error } = await adminClient.from("profiles").update({ is_suspended: parsed.data.suspended }).eq("id", parsed.data.id);
      if (error) throw error;
      await writeAudit(auth.userId, parsed.data.suspended ? "admin_suspended" : "admin_unsuspended", parsed.data.id, {});
      return res.status(200).json({ success: true });
    }

    if (req.method === "DELETE") {
      const id = z.string().uuid().safeParse(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id);
      if (!id.success) return res.status(400).json({ error: "Valid admin ID is required" });
      if (id.data === auth.userId) return res.status(400).json({ error: "You cannot remove your own admin access" });

      const { data: target, error: targetError } = await supabaseAdmin
        .from("profiles")
        .select("id,email,admin_role,is_admin")
        .eq("id", id.data)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target?.is_admin) return res.status(404).json({ error: "Admin not found" });
      if (target.admin_role === "super_admin") return res.status(403).json({ error: "Another super admin cannot be removed here" });

      const adminClient = createAdminRequestClient(req);
      const { error } = await adminClient.from("profiles").update({ is_admin: false, admin_role: null }).eq("id", id.data);
      if (error) throw error;
      await writeAudit(auth.userId, "admin_removed", id.data, { email: target.email, previous_role: target.admin_role });
      return res.status(200).json({ success: true });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("Admin user management failed", error);
    return res.status(500).json({ error: getErrorMessage(error) });
  }
}
