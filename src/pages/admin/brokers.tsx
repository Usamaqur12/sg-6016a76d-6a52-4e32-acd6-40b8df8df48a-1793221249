import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { canAccessAdminArea } from "@/lib/adminRoles";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, DollarSign, Handshake, RefreshCw, ShieldX, TrendingUp, Users } from "lucide-react";

interface BrokerRow { id: string; user_id: string; company_name: string; broker_code: string; status: string; commission_bps: number; created_at: string; email?: string; }
interface PayoutRow { id: string; broker_id: string; amount: number; status: string; destination_reference: string | null; payment_reference?: string | null; requested_at: string; }

export default function AdminBrokersPage() {
  const router = useRouter(); const { toast } = useToast();
  const [brokers, setBrokers] = useState<BrokerRow[]>([]); const [profiles, setProfiles] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [commissions, setCommissions] = useState<any[]>([]); const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true); const [rates, setRates] = useState<Record<string, string>>({});
  const emails = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile.email])), [profiles]);

  useEffect(() => { void initialize(); }, []);
  async function initialize() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return void router.push("/admin/login");
    const { data: profile } = await supabase.from("profiles").select("admin_role").eq("id", user.id).single();
    if (!profile || !canAccessAdminArea(profile.admin_role, "brokers")) return void router.push("/");
    await load();
  }
  async function load() {
    setLoading(true);
    const [brokerResult, profileResult, payoutResult, commissionResult, playerResult] = await Promise.all([
      (supabase as any).from("brokers").select("id,user_id,company_name,broker_code,status,commission_bps,created_at").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id,email"),
      (supabase as any).from("broker_payout_requests").select("id,broker_id,amount,status,destination_reference,payment_reference,requested_at").order("requested_at", { ascending: false }).limit(100),
      (supabase as any).from("broker_commissions").select("broker_id,gross_revenue,commission_amount,status,created_at").order("created_at", { ascending: false }).limit(1000),
      (supabase as any).from("broker_players").select("broker_id,player_id,is_active,attributed_at").limit(1000),
    ]);
    if (brokerResult.error) toast({ title: "Broker data could not be loaded", description: brokerResult.error.message, variant: "destructive" });
    setBrokers(brokerResult.data || []); setProfiles(profileResult.data || []);
    setPayouts(payoutResult.data || []); setCommissions(commissionResult.data || []); setPlayers(playerResult.data || []);
    setRates(Object.fromEntries((brokerResult.data || []).map((row: BrokerRow) => [row.id, String(row.commission_bps / 100)])));
    setLoading(false);
  }
  async function review(row: BrokerRow, status: "active" | "rejected" | "suspended") {
    const percentage = Number(rates[row.id] ?? row.commission_bps / 100);
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 50) return toast({ title: "Commission must be between 0% and 50%", variant: "destructive" });
    const { error } = await (supabase as any).rpc("review_broker_application", { p_broker_id: row.id, p_status: status, p_commission_bps: Math.round(percentage * 100), p_notes: null });
    if (error) return toast({ title: "Broker review failed", description: error.message, variant: "destructive" });
    toast({ title: `Broker ${status}` }); await load();
  }
  async function reviewPayout(payout: PayoutRow, status: "approved" | "paid" | "rejected") {
    const paymentReference = status === "paid" ? window.prompt("Enter the provider, bank or blockchain payment reference")?.trim() : null;
    if (status === "paid" && !paymentReference) return;
    const { error } = await (supabase as any).rpc("review_broker_payout", { p_request_id: payout.id, p_status: status, p_payment_reference: paymentReference, p_notes: null });
    if (error) return toast({ title: "Payout review failed", description: error.message, variant: "destructive" });
    toast({ title: status === "paid" ? "Payout marked paid" : `Payout ${status}` }); await load();
  }
  const grossRevenue = commissions.reduce((sum, row) => sum + Number(row.gross_revenue || 0), 0);
  const commissionEarned = commissions.reduce((sum, row) => sum + Number(row.commission_amount || 0), 0);
  return <AdminLayout><div className="space-y-6 p-4 md:p-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="flex items-center gap-2 text-2xl font-bold"><Handshake className="h-6 w-6 text-primary" />Brokers & Agents</h1><p className="text-sm text-muted-foreground">Review applications, attribution, commission performance and payout requests</p></div><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Card><CardContent className="p-4"><Handshake className="mb-2 h-5 w-5 text-primary" /><div className="text-2xl font-bold">{brokers.filter((item) => item.status === "active").length}</div><div className="text-xs text-muted-foreground">Active brokers</div></CardContent></Card><Card><CardContent className="p-4"><Users className="mb-2 h-5 w-5 text-cyan-400" /><div className="text-2xl font-bold">{players.filter((item) => item.is_active).length}</div><div className="text-xs text-muted-foreground">Linked players</div></CardContent></Card><Card><CardContent className="p-4"><TrendingUp className="mb-2 h-5 w-5 text-warning" /><div className="text-2xl font-bold">${grossRevenue.toFixed(2)}</div><div className="text-xs text-muted-foreground">Attributed gross revenue</div></CardContent></Card><Card><CardContent className="p-4"><DollarSign className="mb-2 h-5 w-5 text-success" /><div className="text-2xl font-bold">${commissionEarned.toFixed(2)}</div><div className="text-xs text-muted-foreground">Commission earned</div></CardContent></Card></div>
    <Card><CardHeader><CardTitle>Broker applications</CardTitle></CardHeader><CardContent className="space-y-3">{brokers.length === 0 ? <div className="py-12 text-center text-sm text-muted-foreground">{loading ? "Loading brokers…" : "No broker applications yet."}</div> : brokers.map((row) => <div key={row.id} className="grid gap-3 rounded-lg border border-border p-4 lg:grid-cols-[1fr_150px_auto] lg:items-center"><div><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{row.company_name}</span><Badge variant={row.status === "active" ? "outline" : "secondary"}>{row.status}</Badge><code className="rounded bg-muted px-2 py-0.5 text-xs">{row.broker_code}</code></div><div className="mt-1 text-xs text-muted-foreground">{emails.get(row.user_id) || row.user_id} · Applied {new Date(row.created_at).toLocaleString()}</div></div><div><label className="mb-1 block text-xs text-muted-foreground">Commission %</label><Input type="number" min="0" max="50" step="0.25" value={rates[row.id] ?? ""} onChange={(event) => setRates((current) => ({ ...current, [row.id]: event.target.value }))} /></div><div className="flex gap-2"><Button size="sm" onClick={() => void review(row, "active")}><CheckCircle className="mr-2 h-4 w-4" />Approve</Button><Button size="sm" variant="outline" className="text-destructive" onClick={() => void review(row, row.status === "pending" ? "rejected" : "suspended")}><ShieldX className="mr-2 h-4 w-4" />{row.status === "pending" ? "Reject" : "Suspend"}</Button></div></div>)}</CardContent></Card>
    <Card><CardHeader><CardTitle>Commission payout queue</CardTitle></CardHeader><CardContent className="space-y-2">{payouts.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">No broker payout requests.</div> : payouts.map((payout) => { const broker = brokers.find((item) => item.id === payout.broker_id); return <div key={payout.id} className="flex flex-col gap-3 rounded-lg border border-border p-3 lg:flex-row lg:items-center lg:justify-between"><div><div className="font-medium">{broker?.company_name || payout.broker_id}</div><div className="break-all text-xs text-muted-foreground">{payout.destination_reference || "Destination review required"} · {new Date(payout.requested_at).toLocaleString()}</div>{payout.payment_reference && <div className="mt-1 break-all text-xs text-success">Payment reference: {payout.payment_reference}</div>}</div><div className="flex flex-wrap items-center gap-2"><span className="mr-2 font-mono font-bold">${Number(payout.amount).toFixed(2)}</span><Badge variant="secondary">{payout.status}</Badge>{payout.status === "pending" && <><Button size="sm" onClick={() => void reviewPayout(payout, "approved")}>Approve</Button><Button size="sm" variant="outline" className="text-destructive" onClick={() => void reviewPayout(payout, "rejected")}>Reject</Button></>}{payout.status === "approved" && <Button size="sm" onClick={() => void reviewPayout(payout, "paid")}>Mark paid</Button>}</div></div>; })}</CardContent></Card>
  </div></AdminLayout>;
}

