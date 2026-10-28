import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const assignableRoles = ["admin", "finance", "kyc", "support", "risk_manager", "sports_trader"] as const;

async function writeAudit(adminId: string, action: string, entityId: string, changes: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from("audit_logs").insert({
    admin_id: adminId,
    action,
    entity_type: "admin_profile",
    entity_id: entityId,
    changes,
  });
  if (error) throw error;
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
        email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
        password: z.string().min(12).max(128),
        role: z.enum(assignableRoles),
      }).safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "A valid email, temporary password of at least 12 characters, and assignable role are required",
        });
      }

      const { data: existingProfile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("id,email,is_admin,admin_role")
        .eq("email", parsed.data.email)
        .maybeSingle();
      if (profileError) throw profileError;
      if (existingProfile?.is_admin) {
        return res.status(409).json({ error: "This user is already an admin" });
      }

      let profileId = existingProfile?.id;
      let createdAuthUser = false;

      if (!profileId) {
        const { data: createdUser, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
          email: parsed.data.email,
          password: parsed.data.password,
          email_confirm: true,
          user_metadata: {
            force_password_change: true,
            created_by_super_admin: auth.userId,
          },
        });

        if (createUserError || !createdUser.user) {
          throw createUserError || new Error("Unable to create the admin login");
        }

        profileId = createdUser.user.id;
        createdAuthUser = true;
      }

      const { error: upsertError } = await supabaseAdmin.from("profiles").upsert({
        id: profileId,
        email: parsed.data.email,
        is_admin: true,
        admin_role: parsed.data.role,
        is_suspended: false,
      }, { onConflict: "id" });

      if (upsertError) {
        if (createdAuthUser) {
          await supabaseAdmin.auth.admin.deleteUser(profileId);
        }
        throw upsertError;
      }

      await writeAudit(auth.userId, "admin_created", profileId, {
        email: parsed.data.email,
        role: parsed.data.role,
        created_login: createdAuthUser,
      });

      return res.status(201).json({
        success: true,
        createdUser: createdAuthUser,
        message: createdAuthUser
          ? "Admin login and permissions created"
          : "Existing user promoted to admin",
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

      const { error } = await supabaseAdmin.from("profiles").update({ is_suspended: parsed.data.suspended }).eq("id", parsed.data.id);
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

      const { error } = await supabaseAdmin.from("profiles").update({ is_admin: false, admin_role: null }).eq("id", id.data);
      if (error) throw error;
      await writeAudit(auth.userId, "admin_removed", id.data, { email: target.email, previous_role: target.admin_role });
      return res.status(200).json({ success: true });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("Admin user management failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Admin operation failed" });
  }
}
