import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { ArrowLeft, Calendar, ShieldCheck, Wallet } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type UserDetails = {
  profile: {
    id: string;
    email: string;
    full_name: string | null;
    kyc_status: string | null;
    is_suspended: boolean;
    created_at: string;
    demo_balance: number;
  };
  transactions: Array<Record<string, any>>;
  bets: Array<Record<string, any>>;
  adjustments: Array<Record<string, any>>;
};

export default function AdminUserDetailsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [details, setDetails] = useState<UserDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<"add" | "subtract">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

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

  async function loadDetails() {
    if (typeof router.query.id !== "string") return;
    setLoading(true);
    try {
      setDetails(await adminFetch(`/api/admin/users/${encodeURIComponent(router.query.id)}`));
    } catch (error) {
      toast({ title: "Unable to load user", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
      setDetails(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (router.isReady) void loadDetails();
  }, [router.isReady, router.query.id]);

  async function adjustBalance() {
    if (!details) return;
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 0.01 || reason.trim().length < 5) {
      toast({ title: "Invalid adjustment", description: "Enter a valid amount and a reason of at least 5 characters.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await adminFetch("/api/admin/users/adjust-balance", {
        method: "POST",
        body: JSON.stringify({
          userId: details.profile.id,
          amount: numericAmount,
          operation,
          reason: reason.trim(),
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      toast({ title: operation === "add" ? "Balance added" : "Balance deducted" });
      setAmount("");
      setReason("");
      await loadDetails();
    } catch (error) {
      toast({ title: "Adjustment failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/users"><ArrowLeft className="mr-2 h-4 w-4" />Back to users</Link>
        </Button>

        {loading ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground">Loading user…</CardContent></Card>
        ) : !details ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground">User could not be loaded.</CardContent></Card>
        ) : (
          <>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="text-3xl font-bold">{details.profile.full_name || "Customer"}</h1>
                <p className="text-muted-foreground">{details.profile.email}</p>
              </div>
              <div className="flex gap-2">
                <Badge variant={details.profile.is_suspended ? "destructive" : "outline"}>
                  {details.profile.is_suspended ? "Suspended" : "Active"}
                </Badge>
                <Badge variant="secondary">{details.profile.kyc_status || "not_submitted"}</Badge>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Card><CardContent className="p-4"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Wallet className="h-4 w-4" />Current balance</div><div className="mt-2 text-2xl font-bold font-mono">${Number(details.profile.demo_balance || 0).toFixed(2)}</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Calendar className="h-4 w-4" />Joined</div><div className="mt-2 font-medium">{new Date(details.profile.created_at).toLocaleString()}</div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4" />KYC status</div><div className="mt-2 font-medium capitalize">{details.profile.kyc_status || "not submitted"}</div></CardContent></Card>
            </div>

            <Card>
              <CardHeader><CardTitle>Adjust balance</CardTitle></CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-[180px_180px_1fr_auto] md:items-end">
                <div className="space-y-2">
                  <Label>Operation</Label>
                  <Select value={operation} onValueChange={(value) => setOperation(value as "add" | "subtract")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="add">Add</SelectItem><SelectItem value="subtract">Deduct</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Amount (USD)</Label>
                  <Input type="number" min="0.01" max="100000" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Reason</Label>
                  <Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="Required audit reason" />
                </div>
                <Button onClick={() => void adjustBalance()} disabled={saving}>{saving ? "Saving…" : "Apply"}</Button>
              </CardContent>
            </Card>

            <div className="grid gap-6 xl:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Recent transactions</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {details.transactions.length === 0 ? <p className="text-sm text-muted-foreground">No transactions.</p> : details.transactions.map((item) => (
                    <div key={String(item.id)} className="flex items-center justify-between rounded border p-3 text-sm">
                      <div><div className="font-medium">{String(item.type || "transaction").replaceAll("_", " ")}</div><div className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</div></div>
                      <div className="font-mono font-bold">${Number(item.amount || 0).toFixed(2)}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Recent bets</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {details.bets.length === 0 ? <p className="text-sm text-muted-foreground">No bets.</p> : details.bets.map((item) => (
                    <div key={String(item.id)} className="flex items-center justify-between rounded border p-3 text-sm">
                      <div><div className="font-medium capitalize">{String(item.bet_type || "bet").replaceAll("_", " ")}</div><div className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</div></div>
                      <div className="text-right"><div className="font-mono">${Number(item.stake || 0).toFixed(2)}</div><Badge variant="outline">{String(item.status || "pending")}</Badge></div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
