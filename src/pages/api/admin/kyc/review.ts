import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const reviewSchema = z.object({
  documentId: z.string().uuid(),
  action: z.enum(["approve", "reject", "request_documents", "hold"]),
  note: z.string().trim().max(1000).nullable().optional(),
  riskLevel: z.enum(["low", "medium", "high"]).default("low"),
  sourceOfFundsStatus: z
    .enum(["not_required", "requested", "submitted", "approved", "rejected"])
    .default("not_required"),
}).superRefine((value, context) => {
  if (value.action !== "approve" && (!value.note || value.note.trim().length < 3)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["note"],
      message: "A review note of at least 3 characters is required",
    });
  }
});

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "KYC review failed";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAdminApi(req, res);
  if (!auth) return;

  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || "Invalid KYC review request",
    });
  }

  try {
    const { documentId, action, note, riskLevel, sourceOfFundsStatus } = parsed.data;
    const { data: document, error: documentError } = await (supabaseAdmin as any)
      .from("kyc_documents")
      .select("id,user_id,document_type,status")
      .eq("id", documentId)
      .maybeSingle();

    if (documentError) throw documentError;
    if (!document) return res.status(404).json({ error: "KYC document not found" });

    const documentStatus =
      action === "approve" ? "approved" : action === "reject" ? "rejected" : "pending";
    const reviewedAt = new Date().toISOString();

    const { error: updateError } = await (supabaseAdmin as any)
      .from("kyc_documents")
      .update({
        status: documentStatus,
        rejection_reason:
          action === "reject" || action === "request_documents" ? note?.trim() || null : null,
        admin_note: note?.trim() || null,
        risk_level: riskLevel,
        source_of_funds_status: sourceOfFundsStatus,
        reviewed_by: auth.userId,
        reviewed_at: reviewedAt,
      })
      .eq("id", documentId);

    if (updateError) throw updateError;

    const { data: documents, error: documentsError } = await (supabaseAdmin as any)
      .from("kyc_documents")
      .select("document_type,status")
      .eq("user_id", document.user_id);

    if (documentsError) throw documentsError;

    const reviewedDocuments = (documents || []) as Array<{
      document_type: string;
      status: string;
    }>;
    const identityApproved = reviewedDocuments.some(
      (item) =>
        ["national_id", "passport", "drivers_license"].includes(item.document_type) &&
        item.status === "approved"
    );
    const addressApproved = reviewedDocuments.some(
      (item) => item.document_type === "proof_of_address" && item.status === "approved"
    );
    const anyRejected = reviewedDocuments.some((item) => item.status === "rejected");
    const kycStatus = identityApproved && addressApproved
      ? "approved"
      : anyRejected
        ? "rejected"
        : "pending";

    const { error: profileError } = await (supabaseAdmin as any)
      .from("profiles")
      .update({ kyc_status: kycStatus, updated_at: reviewedAt })
      .eq("id", document.user_id);

    if (profileError) throw profileError;

    const notificationMessage =
      kycStatus === "approved"
        ? "Your withdrawal verification is approved. You can now request payouts."
        : action === "reject"
          ? "A verification document was rejected. Review the note and submit a replacement."
          : action === "request_documents"
            ? "Additional verification documents are required before withdrawals can be enabled."
            : action === "hold"
              ? "Your withdrawal verification is under additional review."
              : "A verification document was approved. Complete all required documents to enable withdrawals.";

    await Promise.all([
      (supabaseAdmin as any).from("notifications").insert({
        user_id: document.user_id,
        type: "kyc_" + action,
        title: "Withdrawal verification update",
        message: notificationMessage,
        metadata: {
          document_id: documentId,
          action,
          kyc_status: kycStatus,
          note: note?.trim() || null,
          risk_level: riskLevel,
        },
      }),
      (supabaseAdmin as any).from("audit_logs").insert({
        admin_id: auth.userId,
        action: "kyc_" + action,
        entity_type: "kyc_document",
        entity_id: documentId,
        changes: {
          previous_status: document.status,
          document_status: documentStatus,
          profile_kyc_status: kycStatus,
          note: note?.trim() || null,
          risk_level: riskLevel,
          source_of_funds_status: sourceOfFundsStatus,
        },
        ip_address: String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || ""),
        user_agent: req.headers["user-agent"] || null,
      }),
    ]);

    return res.status(200).json({
      success: true,
      documentStatus,
      kycStatus,
      required: {
        identityApproved,
        addressApproved,
      },
    });
  } catch (error) {
    console.error("KYC review failed", error);
    return res.status(500).json({ error: errorMessage(error) });
  }
}
