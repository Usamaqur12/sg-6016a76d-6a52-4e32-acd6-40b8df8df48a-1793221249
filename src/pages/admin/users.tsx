import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Search, UserCheck, UserPlus, Ban, Mail, Phone, Calendar, Wallet, AlertTriangle } from "lucide-react";
import Link from "next/link";

interface User {
  id: string;
  email: string;
  full_name: string | null;
  kyc_status: string;
  is_suspended: boolean;
  account_status: "pending_kyc" | "active" | "closed";
  created_at: string;
  wallet_balance: number;
  total_bets: number;
  total_deposits: number;
}

type ProfileRow = Pick<
  User,
  "id" | "email" | "full_name" | "kyc_status" | "is_suspended" | "account_status" | "created_at"
>;

export default function AdminUsers() {
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [kycFilter, setKycFilter] = useState("all");
  const [currentAdminRole, setCurrentAdminRole] = useState("");
  const [balanceUser, setBalanceUser] = useState<User | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [creditKey, setCreditKey] = useState("");
  const [crediting, setCrediting] = useState(false);
  const [balanceOperation, setBalanceOperation] = useState<"add" | "subtract">("add");
  const [showAddUserDialog, setShowAddUserDialog] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [creatingUser, setCreatingUser] = useState(false);

  useEffect(() => {
    void loadUsers();
    void loadCurrentAdminRole();
  }, []);

  async function loadCurrentAdminRole() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from("profiles").select("admin_role").eq("id", user.id).maybeSingle();
    setCurrentAdminRole(data?.admin_role || "");
  }

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

  async function createUser() {
    const email = newUserEmail.trim().toLowerCase();
    const fullName = newUserName.trim();

    if (!email || newUserPassword.length < 12) {
      toast({
        title: "Validation error",
        description: "Enter a valid email and a temporary password of at least 12 characters.",
        variant: "destructive",
      });
      return;
    }

    setCreatingUser(true);
    try {
      const body = await adminFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email,
          password: newUserPassword,
          fullName: fullName || undefined,
        }),
      });

      toast({
        title: "User created",
        description: body.message || `${email} can now sign in with the temporary password.`,
      });
      setShowAddUserDialog(false);
      setNewUserEmail("");
      setNewUserName("");
      setNewUserPassword("");
      await loadUsers();
    } catch (error) {
      toast({
        title: "User creation failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCreatingUser(false);
    }
  }

  function openBalanceCredit(user: User) {
    setBalanceUser(user);
    setCreditAmount("");
    setCreditReason("");
    setCreditKey(crypto.randomUUID());
    setBalanceOperation("add");
  }

  async function creditUserBalance() {
    if (!balanceUser) return;
    const amount = Number(creditAmount);
    if (!Number.isFinite(amount) || amount < 0.01 || amount > 100000) {
      toast({ title: "Invalid amount", description: "Enter an amount from 0.01 to 100000.00.", variant: "destructive" });
      return;
    }
    if (creditReason.trim().length < 5) {
      toast({ title: "Reason is too short", description: "Enter at least 5 characters, for example: Cash deposit received.", variant: "destructive" });
      return;
    }
    setCrediting(true);
    try {
      const body = await adminFetch("/api/admin/users/adjust-balance", {
        method: "POST",
        body: JSON.stringify({
          userId: balanceUser.id,
          amount,
          operation: balanceOperation,
          reason: creditReason.trim(),
          idempotencyKey: creditKey,
        }),
      });
      toast({
        title: balanceOperation === "add" ? "Balance added" : "Balance deducted",
        description: `New balance: ${Number(body.result?.balance || 0).toFixed(2)}`,
      });
      setBalanceUser(null);
      await loadUsers();
    } catch (error) {
      toast({ title: "Balance credit failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    } finally {
      setCrediting(false);
    }
  }

  async function loadUsers() {
    setLoading(true);
    try {
      const body = await adminFetch("/api/admin/users", {
        method: "GET",
      });
      setUsers(Array.isArray(body.users) ? body.users : []);
    } catch (error) {
      toast({
        title: "Error loading users",
        description: error instanceof Error ? error.message : "Unable to load users",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function toggleSuspension(userId: string, currentStatus: boolean) {
    const action = currentStatus ? "unsuspend" : "suspend";
    if (!window.confirm(`Are you sure you want to ${action} this user?`)) return;

    try {
      await adminFetch(`/api/admin/users/${userId}/suspension`, {
        method: "PATCH",
        body: JSON.stringify({ suspended: !currentStatus }),
      });
      toast({
        title: "User updated",
        description: `User has been ${currentStatus ? "unsuspended" : "suspended"}`,
      });
      await loadUsers();
    } catch (error) {
      toast({
        title: "Action failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  const filtered = users.filter(user => {
    if (statusFilter === "open" && user.account_status === "closed") return false;
    if (statusFilter === "active" && (user.account_status !== "active" || user.is_suspended)) return false;
    if (statusFilter === "suspended" && (user.account_status === "closed" || !user.is_suspended)) return false;
    if (statusFilter === "archived" && user.account_status !== "closed") return false;
    if (kycFilter !== "all" && user.kyc_status !== kycFilter) return false;
    
    const needle = search.toLowerCase();
    return !needle || 
      user.email.toLowerCase().includes(needle) ||
      (user.full_name && user.full_name.toLowerCase().includes(needle));
  });

  const getKycBadge = (status: string) => {
    switch (status) {
      case "approved":
        return <Badge className="bg-success/10 text-success border-success/30">Verified</Badge>;
      case "pending":
        return <Badge variant="outline" className="border-warning text-warning">Pending</Badge>;
      case "rejected":
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="outline">Not Submitted</Badge>;
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">User Management</h1>
            <p className="text-sm text-muted-foreground">Search, create, view, and manage user accounts</p>
          </div>
          {["super_admin", "admin"].includes(currentAdminRole) && (
            <Button onClick={() => setShowAddUserDialog(true)}>
              <UserPlus className="mr-2 h-4 w-4" />
              Add User
            </Button>
          )}
        </div>

        {/* Filters */}
        <Card className="surface">
          <CardContent className="p-4">
            <div className="grid gap-4 md:grid-cols-[1fr_200px_200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by email or name..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open accounts</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                  <SelectItem value="all">All including archived</SelectItem>
                </SelectContent>
              </Select>
              <Select value={kycFilter} onValueChange={setKycFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="KYC" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All KYC</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="not_submitted">Not Submitted</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="surface">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Open Users</div>
              <div className="text-2xl font-bold">{users.filter(u => u.account_status !== "closed").length}</div>
            </CardContent>
          </Card>
          <Card className="surface">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Active</div>
              <div className="text-2xl font-bold text-success">
                {users.filter(u => u.account_status === "active" && !u.is_suspended).length}
              </div>
            </CardContent>
          </Card>
          <Card className="surface">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Suspended</div>
              <div className="text-2xl font-bold text-warning">
                {users.filter(u => u.account_status !== "closed" && u.is_suspended).length}
              </div>
            </CardContent>
          </Card>
          <Card className="surface">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Archived</div>
              <div className="text-2xl font-bold text-danger">
                {users.filter(u => u.account_status === "closed").length}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Users List */}
        <Card className="surface">
          <CardHeader>
            <CardTitle>Users ({filtered.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">No users found</p>
            ) : (
              <div className="space-y-3">
                {filtered.map((user) => (
                  <div
                    key={user.id}
                    className="flex flex-col md:flex-row md:items-center justify-between p-4 rounded-lg border border-border gap-4"
                  >
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-3">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="font-medium">{user.email}</div>
                          {user.full_name && (
                            <div className="text-sm text-muted-foreground">{user.full_name}</div>
                          )}
                        </div>
                        {user.account_status === "closed" ? (
                          <Badge variant="secondary" className="ml-2">Archived</Badge>
                        ) : user.is_suspended ? (
                          <Badge variant="destructive" className="ml-2">
                            <Ban className="h-3 w-3 mr-1" />
                            Suspended
                          </Badge>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Joined {new Date(user.created_at).toLocaleDateString()}
                        </div>
                        <div className="flex items-center gap-1">
                          <Wallet className="h-3 w-3" />
                          ${user.wallet_balance.toFixed(2)}
                        </div>
                        <div>{user.total_bets} bets</div>
                        <div>${user.total_deposits.toFixed(2)} deposited</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {getKycBadge(user.kyc_status)}
                      {["super_admin", "admin", "finance"].includes(currentAdminRole) && (
                        <Button size="sm" variant="default" onClick={() => openBalanceCredit(user)}>
                          <Wallet className="mr-1 h-4 w-4" /> Adjust Balance
                        </Button>
                      )}
                      {user.account_status !== "closed" && (
                        <Button
                          size="sm"
                          variant={user.is_suspended ? "outline" : "destructive"}
                          onClick={() => toggleSuspension(user.id, user.is_suspended)}
                        >
                          {user.is_suspended ? "Unsuspend" : "Suspend"}
                        </Button>
                      )}
                      <Link href={`/admin/users/${user.id}`}>
                        <Button size="sm" variant="outline">View Details</Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={showAddUserDialog}
        onOpenChange={(open) => {
          if (!creatingUser) setShowAddUserDialog(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add new user</DialogTitle>
            <DialogDescription>
              Create a customer login directly. New users start with a real balance of $0.00.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="new-user-name">Full name</Label>
              <Input
                id="new-user-name"
                value={newUserName}
                onChange={(event) => setNewUserName(event.target.value)}
                maxLength={120}
                placeholder="Customer name (optional)"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-user-email">Email</Label>
              <Input
                id="new-user-email"
                type="email"
                value={newUserEmail}
                onChange={(event) => setNewUserEmail(event.target.value)}
                maxLength={320}
                autoComplete="off"
                placeholder="customer@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-user-password">Temporary password</Label>
              <Input
                id="new-user-password"
                type="password"
                value={newUserPassword}
                onChange={(event) => setNewUserPassword(event.target.value)}
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                placeholder="At least 12 characters"
              />
              <p className="text-xs text-muted-foreground">
                Share this password securely. The account is created with confirmed email and zero balance.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddUserDialog(false)} disabled={creatingUser}>
              Cancel
            </Button>
            <Button onClick={() => void createUser()} disabled={creatingUser}>
              {creatingUser ? "Creating…" : "Create user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(balanceUser)} onOpenChange={(open) => !open && !crediting && setBalanceUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust user balance</DialogTitle>
            <DialogDescription>
              Add or deduct cash for {balanceUser?.email}. Every adjustment creates a wallet transaction, ledger journal and audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border p-3 text-sm">
              Current balance: <span className="font-mono font-bold">${balanceUser?.wallet_balance.toFixed(2)}</span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="balance-operation">Operation</Label>
              <Select value={balanceOperation} onValueChange={(value) => setBalanceOperation(value as "add" | "subtract")}>
                <SelectTrigger id="balance-operation"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="add">Add balance</SelectItem>
                  <SelectItem value="subtract">Deduct balance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="credit-amount">Amount (USD)</Label>
              <Input id="credit-amount" type="number" min="0.01" max="100000" step="0.01" value={creditAmount} onChange={(event) => setCreditAmount(event.target.value)} placeholder="100.00" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="credit-reason">Reason (minimum 5 characters)</Label>
                <span className={`text-xs ${creditReason.trim().length > 0 && creditReason.trim().length < 5 ? "text-destructive" : "text-muted-foreground"}`}>
                  {creditReason.trim().length}/5 minimum
                </span>
              </div>
              <Input
                id="credit-reason"
                value={creditReason}
                onChange={(event) => setCreditReason(event.target.value)}
                minLength={5}
                maxLength={500}
                aria-invalid={creditReason.trim().length > 0 && creditReason.trim().length < 5}
                placeholder="Example: Cash deposit received"
              />
              {creditReason.trim().length > 0 && creditReason.trim().length < 5 ? (
                <p className="text-xs text-destructive">Please enter at least 5 characters before confirming.</p>
              ) : (
                <p className="text-xs text-muted-foreground">The reason is permanently recorded in the transaction and audit log.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBalanceUser(null)} disabled={crediting}>Cancel</Button>
            <Button
              onClick={() => void creditUserBalance()}
              disabled={
                crediting ||
                !Number.isFinite(Number(creditAmount)) ||
                Number(creditAmount) < 0.01 ||
                Number(creditAmount) > 100000 ||
                creditReason.trim().length < 5
              }
            >
              {crediting ? "Saving…" : balanceOperation === "add" ? "Confirm addition" : "Confirm deduction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
