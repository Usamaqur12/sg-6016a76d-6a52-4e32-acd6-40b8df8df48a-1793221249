import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { 
  CheckCircle, XCircle, FileText, User, Mail, Calendar, Eye
} from "lucide-react";

interface KYCDocument {
  id: string;
  user_id: string;
  document_type: string;
  file_url: string;
  status: string;
  rejection_reason: string | null;
  uploaded_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  admin_note?: string | null;
  risk_level?: "low" | "medium" | "high";
  source_of_funds_status?: "not_required" | "requested" | "submitted" | "approved" | "rejected";
  profiles: {
    id: string;
    full_name: string;
    email: string;
  };
}

export default function AdminKYC() {
  const { toast } = useToast();
  const [documents, setDocuments] = useState<KYCDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [selectedDoc, setSelectedDoc] = useState<KYCDocument | null>(null);
  const [reviewAction, setReviewAction] = useState<"approve" | "reject" | "request_documents" | "hold" | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [riskLevel, setRiskLevel] = useState<"low" | "medium" | "high">("low");
  const [sourceOfFunds, setSourceOfFunds] = useState<"not_required" | "requested" | "submitted" | "approved" | "rejected">("not_required");
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    loadDocuments();
  }, []);

  async function loadDocuments() {
    setLoading(true);

    const { data, error } = await supabase
      .from("kyc_documents")
      .select(`
        *,
        profiles!kyc_documents_user_id_fkey(id, full_name, email)
      `)
      .order("uploaded_at", { ascending: false });

    if (error) {
      console.error("Error loading KYC documents:", error);
      toast({
        title: "Error",
        description: "Failed to load KYC documents",
        variant: "destructive",
      });
    } else if (data) {
      setDocuments(data as any);
    }

    setLoading(false);
  }

  async function handleReview() {
    if (!selectedDoc || !reviewAction) return;

    setProcessing(true);

    try {
      const { error: updateError } = await (supabase as any).rpc("review_kyc_document_manual", {
        p_document_id: selectedDoc.id,
        p_action: reviewAction,
        p_note: rejectionReason || null,
        p_risk_level: riskLevel,
        p_source_of_funds_status: sourceOfFunds,
      });
      if (updateError) throw updateError;

      toast({
        title: "Document Reviewed",
        description: `Manual review action “${reviewAction.replaceAll("_", " ")}” was recorded.`,
      });

      setSelectedDoc(null);
      setReviewAction(null);
      setRejectionReason("");
      await loadDocuments();
    } catch (error) {
      console.error("Error reviewing document:", error);
      toast({
        title: "Error",
        description: "Failed to review document",
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
    }
  }

  async function viewDocument(path: string) {
    if (/^https?:\/\//i.test(path)) {
      toast({ title: "Legacy public KYC URL blocked", description: "Re-upload this document into the private KYC bucket.", variant: "destructive" });
      return;
    }
    const { data, error } = await supabase.storage.from("kyc-documents").createSignedUrl(path, 300);
    if (error || !data?.signedUrl) {
      toast({ title: "Document unavailable", description: error?.message || "Could not create secure link", variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  const filteredDocuments = documents.filter((doc) => {
    if (filter === "all") return true;
    return doc.status === filter;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary"><XCircle className="h-3 w-3 mr-1" />Pending</Badge>;
      case "approved":
        return <Badge className="bg-success text-success-foreground"><CheckCircle className="h-3 w-3 mr-1" />Approved</Badge>;
      case "rejected":
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getDocumentTypeLabel = (type: string) => {
    const typeMap: Record<string, string> = {
      passport: "Passport",
      national_id: "National ID",
      drivers_license: "Driver's License",
      proof_of_address: "Proof of Address",
      selfie: "Selfie Verification",
    };
    return typeMap[type] || type;
  };

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">KYC Document Review</h1>
          <p className="text-muted-foreground">
            Review and approve customer verification documents
          </p>
        </div>

        <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="pending">
              Pending
              {documents.filter(d => d.status === "pending").length > 0 && (
                <Badge className="ml-2 h-5 px-1.5 bg-warning text-warning-foreground">
                  {documents.filter(d => d.status === "pending").length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
          </TabsList>

          <TabsContent value={filter} className="mt-4">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-32 rounded-lg animate-pulse bg-surface" />
                ))}
              </div>
            ) : filteredDocuments.length === 0 ? (
              <Card className="surface">
                <CardContent className="p-12 text-center">
                  <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">
                    No {filter !== "all" && filter} documents found
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {filteredDocuments.map((doc) => (
                  <Card key={doc.id} className="surface">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                              <User className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <div className="font-semibold">{doc.profiles.full_name}</div>
                              <div className="text-xs text-muted-foreground flex items-center gap-1">
                                <Mail className="h-3 w-3" />
                                {doc.profiles.email}
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Document Type</div>
                              <Badge variant="outline" className="text-xs">
                                {getDocumentTypeLabel(doc.document_type)}
                              </Badge>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Status</div>
                              {getStatusBadge(doc.status)}
                              <div className="mt-1 text-[10px] uppercase text-muted-foreground">Risk: {doc.risk_level || "low"}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Submitted</div>
                              <div className="text-xs font-mono flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {new Date(doc.uploaded_at).toLocaleDateString()}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Document</div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => void viewDocument(doc.file_url)}
                              >
                                <Eye className="h-3 w-3 mr-1" />
                                View
                              </Button>
                            </div>
                          </div>

                          {doc.rejection_reason && (
                            <div className="p-2 rounded bg-danger/5 border border-danger/20">
                              <div className="text-xs text-muted-foreground mb-1">Rejection Reason:</div>
                              <div className="text-xs text-danger">{doc.rejection_reason}</div>
                            </div>
                          )}
                        </div>

                        {doc.status === "pending" && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 border-success/30 text-success hover:bg-success/10"
                              onClick={() => {
                                setSelectedDoc(doc);
                                setReviewAction("approve");
                              }}
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 border-danger/30 text-danger hover:bg-danger/10"
                              onClick={() => {
                                setSelectedDoc(doc);
                                setReviewAction("reject");
                              }}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              Reject
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { setSelectedDoc(doc); setReviewAction("request_documents"); setSourceOfFunds("requested"); }}>
                              Request docs
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { setSelectedDoc(doc); setReviewAction("hold"); }}>
                              Hold
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Review Dialog */}
      <Dialog open={!!selectedDoc && !!reviewAction} onOpenChange={() => {
        setSelectedDoc(null);
        setReviewAction(null);
        setRejectionReason("");
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewAction === "approve" ? "Approve" : reviewAction === "reject" ? "Reject" : reviewAction === "request_documents" ? "Request More Documents" : "Place on Hold"} Document
            </DialogTitle>
            <DialogDescription>
              Record the manual review decision, risk level and source-of-funds status. The customer receives an in-app notification.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-2"><Label>Risk level</Label><select className="h-10 w-full rounded border border-input bg-background px-3 text-sm" value={riskLevel} onChange={(event) => setRiskLevel(event.target.value as typeof riskLevel)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
            <label className="space-y-2"><Label>Source of funds</Label><select className="h-10 w-full rounded border border-input bg-background px-3 text-sm" value={sourceOfFunds} onChange={(event) => setSourceOfFunds(event.target.value as typeof sourceOfFunds)}><option value="not_required">Not required</option><option value="requested">Requested</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label>
          </div>

          {reviewAction !== "approve" && (
            <div className="space-y-2">
              <Label htmlFor="rejection-reason">Review note *</Label>
              <Textarea
                id="rejection-reason"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Reason, required document or investigation note"
                rows={4}
              />
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedDoc(null);
                setReviewAction(null);
                setRejectionReason("");
              }}
              disabled={processing}
            >
              Cancel
            </Button>
            <Button
              onClick={handleReview}
              disabled={processing || (reviewAction !== "approve" && !rejectionReason.trim())}
              className={reviewAction === "approve" ? "bg-success hover:bg-success/90" : ""}
              variant={reviewAction === "reject" ? "destructive" : "default"}
            >
              {processing ? "Processing..." : "Record review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
