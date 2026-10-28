import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { CircleDollarSign, Copy, Handshake, Link2, ShieldCheck, Users } from "lucide-react";

interface BrokerDashboard {
  id: string;
  companyName: string;
  brokerCode: string;
  status: string;
  commissionBps: number;
  players: number;
  grossRevenue: number;
  commissionAvailable: number;
  commissionReserved?: number;
  commissionPaid: number;
}

export default function BrokerPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [dashboard, setDashboard] = useState<BrokerDashboard | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [brokerCode, setBrokerCode] = useState("");
  const [payoutAmount, setPayoutAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { void load(); }, []);

  async function load() {
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    setUser(currentUser);
    if (!currentUser) return;
    const [{ data: currentProfile }, { data: brokerData }] = await Promise.all([
      supabase.from("profiles").select("email,demo_balance,kyc_status").eq("id", currentUser.id).single(),
      (supabase as any).rpc("get_my_broker_dashboard"),
    ]);
    setProfile(currentProfile);
    setDashboard((brokerData as BrokerDashboard | null) || null);
  }

  async function apply() {
    if (!companyName.trim()) return;
    setSaving(true);
    const { error } = await (supabase as any).rpc("apply_for_broker", { p_company_name: companyName.trim() });
    setSaving(false);
    if (error) return toast({ title: "Application could not be submitted", description: error.message, variant: "destructive" });
    toast({ title: "Broker application submitted", description: "Finance review is required before the broker code becomes active." });
    await load();
  }

  async function linkBroker() {
    setSaving(true);
    const { data, error } = await (supabase as any).rpc("link_my_broker", { p_broker_code: brokerCode.trim().toUpperCase() });
    setSaving(false);
    if (error) return toast({ title: "Broker could not be linked", description: error.message, variant: "destructive" });
    toast({ title: "Broker linked", description: data?.broker ? `Your account is attributed to ${data.broker}.` : "Broker attribution saved." });
    setBrokerCode("");
  }

  async function requestPayout() {
    const amount = Number(payoutAmount);
    if (!Number.isFinite(amount) || amount < 100) return toast({ title: "Minimum payout is $100", variant: "destructive" });
    if (destination.trim().length < 3) return toast({ title: "Approved payout destination is required", variant: "destructive" });
    setSaving(true);
    const { error } = await (supabase as any).rpc("request_broker_payout", { p_amount: amount, p_destination_reference: destination.trim() || null });
    setSaving(false);
    if (error) return toast({ title: "Payout request failed", description: error.message, variant: "destructive" });
    toast({ title: "Payout request recorded", description: "Finance approval and provider settlement are required." });
    setPayoutAmount(""); setDestination(""); await load();
  }

  return <div className="min-h-screen flex flex-col bg-background pb-14 lg:pb-0">
    <Header user={profile ? { email: profile.email || user?.email || "", balance: profile.demo_balance || 0 } : null} onAuthClick={() => router.push("/auth/login")} />
    <main className="container flex-1 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div><div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-primary"><Handshake className="h-4 w-4" />PrimeBet Broker Network</div><h1 className="text-3xl font-black">Broker & Agent Portal</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Refer verified players, track attributed activity and receive an approved revenue-share commission. Broker access is reviewed before activation.</p></div>
        <Card className="border-warning/30 bg-warning/5"><CardContent className="flex gap-3 py-4 text-sm"><ShieldCheck className="h-5 w-5 shrink-0 text-warning" /><p>Commission payouts remain subject to licensing, KYC/AML, market rules and finance approval. Brokers cannot change player balances or settle bets.</p></CardContent></Card>

        {!user ? <Card><CardContent className="py-10 text-center"><Handshake className="mx-auto mb-3 h-10 w-10 text-primary" /><h2 className="text-xl font-bold">Sign in to continue</h2><p className="mb-4 mt-2 text-sm text-muted-foreground">A verified account is required to apply or link a broker.</p><Button onClick={() => router.push("/auth/login")}>Sign in</Button></CardContent></Card> : dashboard ? <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Stat icon={Users} label="Linked players" value={String(dashboard.players || 0)} /><Stat icon={CircleDollarSign} label="Gross revenue" value={`$${Number(dashboard.grossRevenue || 0).toFixed(2)}`} /><Stat icon={CircleDollarSign} label="Available commission" value={`$${Number(dashboard.commissionAvailable || 0).toFixed(2)}`} /><Stat icon={CircleDollarSign} label="Reserved payout" value={`$${Number(dashboard.commissionReserved || 0).toFixed(2)}`} /><Stat icon={CircleDollarSign} label="Paid commission" value={`$${Number(dashboard.commissionPaid || 0).toFixed(2)}`} /></div>
          <div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle className="flex items-center justify-between">Broker account <Badge variant={dashboard.status === "active" ? "outline" : "secondary"}>{dashboard.status}</Badge></CardTitle><CardDescription>{dashboard.companyName} · {(dashboard.commissionBps / 100).toFixed(2)}% revenue share</CardDescription></CardHeader><CardContent><Label>Referral code</Label><div className="mt-2 flex gap-2"><Input readOnly value={dashboard.brokerCode} className="font-mono text-lg font-bold" /><Button variant="outline" size="icon" onClick={() => void navigator.clipboard.writeText(dashboard.brokerCode)}><Copy className="h-4 w-4" /></Button></div></CardContent></Card>
          <Card><CardHeader><CardTitle>Request commission payout</CardTitle><CardDescription>Minimum $100. Requests enter the finance review queue.</CardDescription></CardHeader><CardContent className="grid gap-3"><Input type="number" min="100" step="0.01" placeholder="Amount" value={payoutAmount} onChange={(event) => setPayoutAmount(event.target.value)} /><Input placeholder="Approved payout destination/reference" value={destination} onChange={(event) => setDestination(event.target.value)} /><Button disabled={saving || dashboard.status !== "active"} onClick={() => void requestPayout()}>Request payout</Button></CardContent></Card></div>
        </> : <div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle>Apply as a broker</CardTitle><CardDescription>Approved KYC is required. Applications are manually reviewed.</CardDescription></CardHeader><CardContent className="grid gap-3"><Label htmlFor="company-name">Company or broker name</Label><Input id="company-name" value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Prime Sports Agency" /><Button disabled={saving || profile?.kyc_status !== "approved"} onClick={() => void apply()}><Handshake className="mr-2 h-4 w-4" />Submit application</Button>{profile?.kyc_status !== "approved" && <p className="text-xs text-warning">Complete KYC verification before applying.</p>}</CardContent></Card>
          <Card><CardHeader><CardTitle>Have a broker code?</CardTitle><CardDescription>Linking is one-time and only available before your first bet.</CardDescription></CardHeader><CardContent className="grid gap-3"><Label htmlFor="broker-code">Broker code</Label><Input id="broker-code" className="font-mono uppercase" value={brokerCode} onChange={(event) => setBrokerCode(event.target.value)} placeholder="AB12CD34" /><Button variant="outline" disabled={saving || brokerCode.trim().length < 6} onClick={() => void linkBroker()}><Link2 className="mr-2 h-4 w-4" />Link broker</Button></CardContent></Card></div>}
      </div>
    </main><Footer /><MobileBottomNav />
  </div>;
}

function Stat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return <Card><CardContent className="p-4"><Icon className="mb-3 h-5 w-5 text-primary" /><div className="text-2xl font-bold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></CardContent></Card>;
}

