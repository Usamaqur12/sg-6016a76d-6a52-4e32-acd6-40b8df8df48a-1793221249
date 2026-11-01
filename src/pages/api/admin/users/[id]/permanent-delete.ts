import { createHash } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const bodySchema = z.object({
  confirmation: z.string().trim().min(3).max(320),
  purgePhrase: z.literal("DELETE ALL HISTORY"),
  reason: z.string().trim().min(5).max(500),
});

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === "string" && value.trim()) return value;
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
    return res.status(403).json({ error: "Only a super admin can permanently purge a customer" });
  }

  const id = z.string().uuid().safeParse(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id);
  const body = bodySchema.safeParse(req.body);
  if (!id.success || !body.success) {
    return res.status(400).json({ error: "Exact email, DELETE ALL HISTORY confirmation and audit reason are required" });
  }

  const admin = supabaseAdmin as any;
  try {
    const userId = id.data;
    const { data: target, error: targetError } = await admin.from("profiles")
      .select("id,email,is_admin").eq("id", userId).maybeSingle();
    if (targetError) throw targetError;
    if (!target || target.is_admin) return res.status(404).json({ error: "Customer account not found" });
    if (body.data.confirmation.toLowerCase() !== String(target.email || "").toLowerCase()) {
      return res.status(400).json({ error: "Confirmation must exactly match the customer email" });
    }

    const emailHash = createHash("sha256").update(String(target.email).trim().toLowerCase()).digest("hex");
    const { data: documents, error: documentsError } = await admin.from("kyc_documents")
      .select("file_url").eq("user_id", userId);
    if (documentsError) throw documentsError;
    const storagePaths = (documents || [])
      .map((row: { file_url?: string }) => row.file_url)
      .filter((path: string | undefined): path is string => typeof path === "string" && path.length > 0);

    const { data: purgeResult, error: purgeError } = await admin.rpc("hard_purge_customer", {
      p_user_id: userId,
      p_admin_id: auth.userId,
      p_reason: body.data.reason,
    });
    if (purgeError) {
      const status = /balance|pending activity/i.test(purgeError.message || "") ? 409 : 500;
      return res.status(status).json({ error: purgeError.message || "Customer history purge failed" });
    }

    const warnings: string[] = [];
    if (storagePaths.length) {
      const { error } = await supabaseAdmin.storage.from("kyc-documents").remove(storagePaths);
      if (error) warnings.push("Some KYC storage objects require manual removal");
    }

    const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userId, false);
    if (authDeleteError) warnings.push("The orphaned Supabase Auth identity requires manual removal");

    const forwardedFor = req.headers["x-forwarded-for"];
    const ipAddress = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(",")[0]?.trim() || req.socket.remoteAddress || null;
    const { error: auditError } = await admin.from("audit_logs").insert({
      admin_id: auth.userId,
      action: "customer_hard_purged",
      entity_type: "deleted_customer",
      entity_id: userId,
      changes: {
        original_email_hash: emailHash,
        reason: body.data.reason,
        financial_history_deleted: true,
        purge_result: purgeResult,
        warnings,
      },
      ip_address: ipAddress,
      user_agent: req.headers["user-agent"] || null,
    });
    if (auditError) warnings.push("Purge audit record requires manual review");

    return res.status(200).json({
      success: true,
      message: "Customer account, betting history, wallet history and related personal records were permanently deleted.",
      result: purgeResult,
      warnings,
    });
  } catch (error) {
    console.error("Permanent customer purge failed", error);
    return res.status(500).json({ error: getErrorMessage(error) });
  }
}
