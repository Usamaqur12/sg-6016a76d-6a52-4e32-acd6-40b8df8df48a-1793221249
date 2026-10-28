import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, FileText, User, DollarSign, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface AuditLog {
  id: string;
  admin_email: string;
  admin_role: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: string;
  timestamp: string;
}

export default function AdminAudit() {
  const { toast } = useToast();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");

  useEffect(() => {
    void loadAuditLogs();
  }, []);

  async function loadAuditLogs() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Admin session expired");
      const response = await fetch("/api/admin/audit?limit=300", {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Audit logs could not be loaded");
      setLogs(body.logs || []);
    } catch (error) {
      toast({
        title: "Error loading audit logs",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const getActionBadge = (action: string) => {
    const colors: Record<string, string> = {
      user_suspended: "bg-danger/10 text-danger border-danger/30",
      transaction_approved: "bg-success/10 text-success border-success/30",
      transaction_rejected: "bg-danger/10 text-danger border-danger/30",
      admin_created: "bg-primary/10 text-primary border-primary/30",
      kyc_approved: "bg-success/10 text-success border-success/30",
      kyc_rejected: "bg-danger/10 text-danger border-danger/30",
    };

    return (
      <Badge className={colors[action] || "bg-muted"}>
        {action.replace("_", " ").toUpperCase()}
      </Badge>
    );
  };

  const getEntityIcon = (type: string) => {
    switch (type) {
      case "user":
        return <User className="h-4 w-4" />;
      case "transaction":
        return <DollarSign className="h-4 w-4" />;
      case "admin":
        return <Shield className="h-4 w-4" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  const filtered = logs.filter(log => {
    if (actionFilter !== "all" && log.action !== actionFilter) return false;
    
    const needle = search.toLowerCase();
    return !needle || 
      log.admin_email.toLowerCase().includes(needle) ||
      log.action.toLowerCase().includes(needle) ||
      log.details.toLowerCase().includes(needle);
  });

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Admin Activity Log</h1>
          <p className="text-sm text-muted-foreground">Track all administrative actions and changes</p>
        </div>

        {/* Filters */}
        <Card className="surface">
          <CardContent className="p-4">
            <div className="grid gap-4 md:grid-cols-[1fr_250px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by admin, action, or details..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Action Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="user_suspended">User Suspended</SelectItem>
                  <SelectItem value="transaction_approved">Transaction Approved</SelectItem>
                  <SelectItem value="transaction_rejected">Transaction Rejected</SelectItem>
                  <SelectItem value="admin_created">Admin Created</SelectItem>
                  <SelectItem value="kyc_approved">KYC Approved</SelectItem>
                  <SelectItem value="kyc_rejected">KYC Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="surface">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Total Actions</div>
              <div className="text-2xl font-bold">{logs.length}</div>
            </CardContent>
          </Card>
          <Card className="surface">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Today</div>
              <div className="text-2xl font-bold">
                {logs.filter(l => new Date(l.timestamp).toDateString() === new Date().toDateString()).length}
              </div>
            </CardContent>
          </Card>
          <Card className="surface">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">This Week</div>
              <div className="text-2xl font-bold">
                {logs.filter(l => {
                  const logDate = new Date(l.timestamp);
                  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                  return logDate > weekAgo;
                }).length}
              </div>
            </CardContent>
          </Card>
          <Card className="surface">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Active Admins</div>
              <div className="text-2xl font-bold">
                {new Set(logs.map(l => l.admin_email)).size}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Audit Logs */}
        <Card className="surface">
          <CardHeader>
            <CardTitle>Activity Log ({filtered.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">No audit logs found</p>
            ) : (
              <div className="space-y-3">
                {filtered.map((log) => (
                  <div
                    key={log.id}
                    className="flex flex-col md:flex-row md:items-center justify-between p-4 rounded-lg border border-border gap-4"
                  >
                    <div className="flex items-start gap-4 flex-1">
                      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                        {getEntityIcon(log.entity_type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {getActionBadge(log.action)}
                          <Badge variant="outline" className="capitalize">
                            {log.entity_type.replace("_", " ")}
                          </Badge>
                          <Badge variant="secondary">{log.admin_role}</Badge>
                        </div>
                        <div className="text-sm mb-1">{log.details}</div>
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          <div>Admin: {log.admin_email}</div>
                          <div>Time: {new Date(log.timestamp).toLocaleString()}</div>
                          {log.entity_id && <div>Entity ID: {log.entity_id}</div>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
