import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { 
  FileCheck, Upload, CheckCircle, XCircle, Clock, 
  IdCard, FileText, Camera, AlertTriangle 
} from "lucide-react";

interface KYCDocument {
  id: string;
  document_type: string;
  file_url: string;
  status: string;
  rejection_reason: string | null;
  uploaded_at: string;
}

export default function KYCPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<KYCDocument[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [kycStatus, setKycStatus] = useState<string>("not_submitted");

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      router.push("/auth/login");
      return;
    }

    setUser(user);

    // Load profile for balance display
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profile) {
      setProfile(profile);
    }

    await loadKYCDocuments(user.id);
  }

  async function loadKYCDocuments(userId: string) {
    setLoading(true);

    // Get user KYC status
    const { data: profile } = await supabase
      .from("profiles")
      .select("kyc_status")
      .eq("id", userId)
      .single();

    if (profile) {
      setKycStatus(profile.kyc_status);
    }

    // Get uploaded documents
    const { data, error } = await supabase
      .from("kyc_documents")
      .select("*")
      .eq("user_id", userId)
      .order("uploaded_at", { ascending: false });

    if (error) {
      console.error("Error loading KYC documents:", error);
      toast({
        title: "Error",
        description: "Failed to load KYC documents",
        variant: "destructive",
      });
    } else {
      setDocuments(data || []);
    }

    setLoading(false);
  }

  async function handleFileUpload(documentType: string, event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File Too Large",
        description: "Please upload a file smaller than 5MB",
        variant: "destructive",
      });
      return;
    }

    // Validate file type
    const validTypes = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
    if (!validTypes.includes(file.type)) {
      toast({
        title: "Invalid File Type",
        description: "Please upload a JPG, PNG, or PDF file",
        variant: "destructive",
      });
      return;
    }

    setUploading(documentType);

    try {
      // Upload to Supabase Storage
      const fileName = `${user.id}/${documentType}_${Date.now()}.${file.name.split(".").pop()}`;
      const { error: uploadError, data } = await supabase.storage
        .from("kyc-documents")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from("kyc-documents")
        .getPublicUrl(fileName);

      // Save document record
      const { error: insertError } = await supabase
        .from("kyc_documents")
        .insert({
          user_id: user.id,
          document_type: documentType,
          file_url: publicUrl,
          status: "pending",
        });

      if (insertError) throw insertError;

      // Update profile KYC status to pending if not already
      if (kycStatus === "not_submitted") {
        await supabase
          .from("profiles")
          .update({ kyc_status: "pending" })
          .eq("id", user.id);
        setKycStatus("pending");
      }

      toast({
        title: "Document Uploaded",
        description: "Your document has been submitted for review",
      });

      // Reload documents
      await loadKYCDocuments(user.id);
    } catch (error) {
      console.error("Error uploading document:", error);
      toast({
        title: "Upload Failed",
        description: "Failed to upload document. Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploading(null);
      event.target.value = "";
    }
  }

  function getDocumentStatus(type: string) {
    const doc = documents.find(d => d.document_type === type);
    return doc;
  }

  function getDocumentIcon(type: string) {
    switch (type) {
      case "national_id":
      case "passport":
      case "drivers_license":
        return <IdCard className="h-5 w-5" />;
      case "proof_of_address":
        return <FileText className="h-5 w-5" />;
      case "selfie":
        return <Camera className="h-5 w-5" />;
      default:
        return <FileCheck className="h-5 w-5" />;
    }
  }

  function getDocumentLabel(type: string) {
    const labels: Record<string, string> = {
      national_id: "National ID",
      passport: "Passport",
      drivers_license: "Driver's License",
      proof_of_address: "Proof of Address",
      selfie: "Selfie Verification",
    };
    return labels[type] || type;
  }

  const documentTypes = [
    { type: "national_id", description: "Clear photo of your national ID card (front and back)" },
    { type: "passport", description: "Clear photo of your passport photo page" },
    { type: "drivers_license", description: "Clear photo of your driver's license (front and back)" },
    { type: "proof_of_address", description: "Utility bill or bank statement (less than 3 months old)" },
    { type: "selfie", description: "Selfie holding your ID document next to your face" },
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
        return (
          <Badge className="bg-success text-success-foreground">
            <CheckCircle className="h-3 w-3 mr-1" />
            Approved
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Rejected
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="secondary">
            <Clock className="h-3 w-3 mr-1" />
            Under Review
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header
        user={
          profile
            ? {
                email: user?.email || "",
                balance: profile.demo_balance || 0,
              }
            : null
        }
        onAuthClick={() => router.push("/auth/login")}
      />
      
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-3xl font-bold mb-2">KYC Verification</h1>
            <p className="text-muted-foreground">
              Complete your identity verification to unlock full account features
            </p>
          </div>

          {/* Overall Status */}
          <Card className="surface border-primary/20">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                    <FileCheck className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <CardTitle>Verification Status</CardTitle>
                    <CardDescription>Current KYC verification level</CardDescription>
                  </div>
                </div>
                {getStatusBadge(kycStatus)}
              </div>
            </CardHeader>
            {kycStatus === "rejected" && (
              <CardContent>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-danger/10 border border-danger/20">
                  <AlertTriangle className="h-5 w-5 text-danger flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-danger">Verification Rejected</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Please review the rejection reasons below and resubmit the required documents.
                    </p>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Document Upload */}
          <Card className="surface">
            <CardHeader>
              <CardTitle>Upload Documents</CardTitle>
              <CardDescription>
                Upload at least one form of ID and proof of address. All documents must be clear and valid.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-24 rounded-lg animate-pulse bg-background" />
                  ))}
                </div>
              ) : (
                documentTypes.map(({ type, description }) => {
                  const existingDoc = getDocumentStatus(type);
                  const isUploading = uploading === type;

                  return (
                    <div
                      key={type}
                      className="p-4 rounded-lg border border-border bg-background hover:border-primary/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 flex-1">
                          <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                            {getDocumentIcon(type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-semibold text-sm">{getDocumentLabel(type)}</h3>
                              {existingDoc && getStatusBadge(existingDoc.status)}
                            </div>
                            <p className="text-xs text-muted-foreground mb-2">{description}</p>
                            {existingDoc?.status === "rejected" && existingDoc.rejection_reason && (
                              <div className="flex items-start gap-2 p-2 rounded bg-danger/5 border border-danger/20">
                                <AlertTriangle className="h-3 w-3 text-danger flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-danger">{existingDoc.rejection_reason}</p>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex-shrink-0">
                          {existingDoc?.status === "approved" ? (
                            <Button size="sm" variant="outline" disabled>
                              <CheckCircle className="h-4 w-4 mr-2 text-success" />
                              Verified
                            </Button>
                          ) : (
                            <div>
                              <Input
                                type="file"
                                id={`upload-${type}`}
                                accept="image/*,.pdf"
                                onChange={(e) => handleFileUpload(type, e)}
                                className="hidden"
                                disabled={isUploading}
                              />
                              <Label htmlFor={`upload-${type}`}>
                                <Button
                                  size="sm"
                                  variant={existingDoc ? "outline" : "default"}
                                  disabled={isUploading}
                                  asChild
                                >
                                  <span>
                                    <Upload className="h-4 w-4 mr-2" />
                                    {isUploading ? "Uploading..." : existingDoc ? "Reupload" : "Upload"}
                                  </span>
                                </Button>
                              </Label>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* Requirements */}
          <Card className="surface">
            <CardHeader>
              <CardTitle>Document Requirements</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                  <span>Documents must be clear, legible, and in color</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                  <span>All four corners of the document must be visible</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                  <span>Documents must be valid and not expired</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                  <span>Proof of address must be dated within the last 3 months</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                  <span>Selfie must clearly show your face and ID document</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                  <span>Maximum file size: 5MB per document</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                  <span>Accepted formats: JPG, PNG, PDF</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </main>

      <Footer />
    </div>
  );
}