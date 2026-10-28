import { supabase } from "@/integrations/supabase/client";

export async function uploadKYCDocument(
  userId: string,
  documentType: string,
  file: File
) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== userId) throw new Error("Authentication required");
    const allowedTypes = ["passport", "national_id", "drivers_license", "proof_of_address", "selfie"];
    if (!allowedTypes.includes(documentType)) throw new Error("Unsupported document type");
    const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowedMimeTypes.includes(file.type)) throw new Error("Only JPG, PNG, WebP or PDF files are accepted");
    if (file.size > 5 * 1024 * 1024) throw new Error("File must be 5 MB or smaller");
    // Upload file to Supabase Storage
    const fileExt = file.name.split(".").pop();
    const fileName = `${userId}/${documentType}_${Date.now()}.${fileExt}`;
    
    const { error: uploadError } = await supabase.storage
      .from("kyc-documents")
      .upload(fileName, file);

    if (uploadError) throw uploadError;

    // Create KYC document record
    const { data, error } = await supabase
      .from("kyc_documents")
      .insert({
        user_id: userId,
        document_type: documentType,
        file_url: fileName,
        status: "pending",
      })
      .select()
      .single();

    if (error) throw error;

    // Update profile KYC status to pending if not already
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ kyc_status: "pending" })
      .eq("id", userId)
      .eq("kyc_status", "not_submitted");

    if (profileError) console.error("Update KYC status error:", profileError);

    return { success: true, document: data };
  } catch (error: any) {
    console.error("Upload KYC document error:", error);
    return { success: false, error: error.message };
  }
}

export async function getUserKYCDocuments(userId: string) {
  try {
    const { data, error } = await supabase
      .from("kyc_documents")
      .select("*")
      .eq("user_id", userId)
      .order("uploaded_at", { ascending: false });

    if (error) throw error;

    return { success: true, documents: data };
  } catch (error: any) {
    console.error("Get KYC documents error:", error);
    return { success: false, error: error.message };
  }
}

export async function reviewKYCDocument(
  documentId: string,
  status: "approved" | "rejected",
  reviewerId: string,
  rejectionReason?: string
) {
  try {
    // Update document
    const { data: document, error: docError } = await supabase
      .from("kyc_documents")
      .update({
        status,
        rejection_reason: rejectionReason,
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", documentId)
      .select("user_id")
      .single();

    if (docError) throw docError;

    // Check if all user documents are approved
    const { data: userDocs, error: userDocsError } = await supabase
      .from("kyc_documents")
      .select("status")
      .eq("user_id", document.user_id);

    if (userDocsError) throw userDocsError;

    const allApproved = userDocs.every((doc) => doc.status === "approved");
    const anyRejected = userDocs.some((doc) => doc.status === "rejected");

    let kycStatus = "pending";
    if (allApproved && userDocs.length >= 2) {
      kycStatus = "approved";
    } else if (anyRejected) {
      kycStatus = "rejected";
    }

    // Update profile KYC status
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ kyc_status: kycStatus })
      .eq("id", document.user_id);

    if (profileError) throw profileError;

    // Create audit log
    await supabase.from("audit_logs").insert({
      admin_id: reviewerId,
      action: "review_kyc",
      entity_type: "kyc_document",
      entity_id: documentId,
      changes: { status, rejection_reason: rejectionReason },
    });

    return { success: true };
  } catch (error: any) {
    console.error("Review KYC document error:", error);
    return { success: false, error: error.message };
  }
}

export async function getPendingKYCDocuments() {
  try {
    const { data, error } = await supabase
      .from("kyc_documents")
      .select(
        `
        *,
        profiles!kyc_documents_user_id_fkey (email, full_name, country)
      `
      )
      .eq("status", "pending")
      .order("uploaded_at", { ascending: true });

    if (error) throw error;

    return { success: true, documents: data };
  } catch (error: any) {
    console.error("Get pending KYC documents error:", error);
    return { success: false, error: error.message };
  }
}
