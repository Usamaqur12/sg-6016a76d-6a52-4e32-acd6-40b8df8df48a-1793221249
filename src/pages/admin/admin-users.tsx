import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Shield, UserPlus, Trash2 } from "lucide-react";
import { useRouter } from "next/router";

interface AdminUser {
  id: string;
  email: string;
  admin_role: string;
  is_suspended: boolean;
  created_at: string;
}

export default function AdminUsersPage() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminRole, setNewAdminRole] = useState<string>("admin");
  const [processing, setProcessing] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState<string>("admin");
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    void loadAdmins();
  }, []);

  async function adminFetch(url: string, init?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Admin session expired");
    const response = await fetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.access_token}`,
        ...(init?.headers || {}),
      },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Admin request failed");
    return body;
  }

  async function loadAdmins() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return void router.replace("/admin/login");
      const { data: profile } = await supabase
        .from("profiles")
        .select("admin_role")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.admin_role !== "super_admin") {
        toast({ title: "Access denied", description: "Super admin access required", variant: "destructive" });
        return void router.replace("/admin");
      }
      setCurrentUserRole("super_admin");
      const body = await adminFetch("/api/admin/admin-users");
      setAdmins(body.admins || []);
    } catch (error: any) {
      toast({
        title: "Error loading admins",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleAddAdmin() {
    if (!newAdminEmail || !newAdminRole) {
      toast({
        title: "Validation error",
        description: "Email and role are required",
        variant: "destructive",
      });
      return;
    }

    try {
      setProcessing(true);
      await adminFetch("/api/admin/admin-users", {
        method: "POST",
        body: JSON.stringify({ email: newAdminEmail, role: newAdminRole }),
      });

      toast({
        title: "Admin added",
        description: `${newAdminEmail} is now an admin with role: ${newAdminRole}`,
      });

      setShowAddDialog(false);
      setNewAdminEmail("");
      setNewAdminRole("admin");
      await loadAdmins();
    } catch (error: any) {
      toast({
        title: "Error adding admin",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
    }
  }

  async function handleRemoveAdmin(adminId: string, email: string) {
    if (!confirm(`Remove admin access for ${email}?`)) return;

    try {
      await adminFetch(`/api/admin/admin-users?id=${encodeURIComponent(adminId)}`, { method: "DELETE" });

      toast({
        title: "Admin removed",
        description: `${email} no longer has admin access`,
      });

      await loadAdmins();
    } catch (error: any) {
      toast({
        title: "Error removing admin",
        description: error.message,
        variant: "destructive",
      });
    }
  }

  async function handleToggleSuspend(adminId: string, currentStatus: boolean) {
    try {
      await adminFetch("/api/admin/admin-users", {
        method: "PATCH",
        body: JSON.stringify({ id: adminId, suspended: !currentStatus }),
      });

      toast({
        title: currentStatus ? "Admin unsuspended" : "Admin suspended",
      });

      await loadAdmins();
    } catch (error: any) {
      toast({
        title: "Error updating admin",
        description: error.message,
        variant: "destructive",
      });
    }
  }

  const isSuperAdmin = currentUserRole === "super_admin";

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Shield className="h-8 w-8 text-primary" />
              Admin Users
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage admin users and their roles
            </p>
          </div>
          {isSuperAdmin && (
            <Button onClick={() => setShowAddDialog(true)}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add Admin
            </Button>
          )}
        </div>

        {!isSuperAdmin && (
          <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <p className="text-sm text-amber-900 dark:text-amber-100">
              Only Super Admins can add or remove admin users.
            </p>
          </div>
        )}

        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Added</TableHead>
                {isSuperAdmin && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : admins.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No admin users found
                  </TableCell>
                </TableRow>
              ) : (
                admins.map((admin) => (
                  <TableRow key={admin.id}>
                    <TableCell className="font-medium">{admin.email}</TableCell>
                    <TableCell>
                      <Badge 
                        variant={
                          admin.admin_role === "super_admin" 
                            ? "default"
                            : admin.admin_role === "admin"
                            ? "secondary"
                            : "outline"
                        }
                        className={
                          admin.admin_role === "super_admin"
                            ? "bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold"
                            : ""
                        }
                      >
                        {/* Only show super_admin role to super admins */}
                        {admin.admin_role === "super_admin" && currentUserRole === "super_admin" && "👑 "}
                        {admin.admin_role === "super_admin" && currentUserRole !== "super_admin" 
                          ? "ADMIN" 
                          : (admin.admin_role?.replace("_", " ").toUpperCase() || "ADMIN")
                        }
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {admin.is_suspended ? (
                        <Badge variant="destructive">Suspended</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                          Active
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(admin.created_at).toLocaleDateString()}
                    </TableCell>
                    {isSuperAdmin && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleToggleSuspend(admin.id, admin.is_suspended)}
                          >
                            {admin.is_suspended ? "Unsuspend" : "Suspend"}
                          </Button>
                          {admin.admin_role !== "super_admin" && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleRemoveAdmin(admin.id, admin.email)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Add Admin Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Admin</DialogTitle>
            <DialogDescription>
              Promote an existing user to admin. User must be registered first.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email">User Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="user@example.com"
                value={newAdminEmail}
                onChange={(e) => setNewAdminEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Admin Role</Label>
              <Select value={newAdminRole} onValueChange={(value: any) => setNewAdminRole(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin (Full Access)</SelectItem>
                  <SelectItem value="finance">Finance</SelectItem>
                  <SelectItem value="kyc">KYC</SelectItem>
                  <SelectItem value="support">Support</SelectItem>
                  <SelectItem value="risk_manager">Risk Manager</SelectItem>
                  <SelectItem value="sports_trader">Sports Trader</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                <strong>super_admin:</strong> Full access<br/>
                <strong>admin:</strong> Full access<br/>
                <strong>finance:</strong> Payments, transactions, crypto<br/>
                <strong>kyc:</strong> KYC verification<br/>
                <strong>support:</strong> User support, announcements<br/>
                <strong>risk_manager:</strong> Risk, bets monitoring<br/>
                <strong>sports_trader:</strong> Sports, trading, bets
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddAdmin} disabled={processing}>
              {processing ? "Adding…" : "Add Admin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
