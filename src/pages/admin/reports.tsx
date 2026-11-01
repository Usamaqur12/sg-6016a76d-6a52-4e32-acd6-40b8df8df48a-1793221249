import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { canAccessAdminArea } from "@/lib/adminRoles";
import { supabase } from "@/integrations/supabase/client";
import { BarChart3, Calculator, Download, RefreshCw, Save, WalletCards } from "lucide-react";

type RevenueGroup = { stakes: number; payouts: number; ggr: number; refunds?: number; providerShare?: number };
type Deductions = {
  bonusCost: number; partnerCommission: number; paymentFees: number; providerFees: number;
  chargebacks: number; refunds: number; gamingTax: number; otherCost: number; otherIncome: number;
};
type Summary = {
  periodFrom: string; periodTo: string; sportsbook: RevenueGroup; casino: RevenueGroup; aviator: RevenueGroup;
  deductions: Deductions; deposits: number; ggr: number; ngr: number;
};
type Settings = { payment_fee_bps: number; gaming_tax_bps: number; default_casino_share_bps: number };
type Adjustment = { id: string; adjustment_type: string; amount: number; reference: string | null; notes: string; occurred_at: string };
type Settlement = {
  id: string; period_from: string; period_to: string; gross_gaming_revenue: number;
  provider_share: number; status: string; payment_reference?: string | null; casino_providers?: { name?: string; code?: string } | null;
};

const adjustmentTypes = [
  "payment_fee","provider_fee","gaming_tax","chargeback","refund",
  "bonus_cost","affiliate_commission","other_cost","other_income",
] as const;

const emptySummary: Summary = {
  periodFrom: "", periodTo: "",
  sportsbook: { stakes: 0, payouts: 0, ggr: 0 },
  casino: { stakes: 0, payouts: 0, refunds: 0, providerShare: 0, ggr: 0 },
  aviator: { stakes: 0, payouts: 0, ggr: 0 },
  deductions: {
    bonusCost: 0, partnerCommission: 0, paymentFees: 0, providerFees: 0,
    chargebacks: 0, refunds: 0, gamingTax: 0, otherCost: 0, otherIncome: 0,
  },
  deposits: 0, ggr: 0, ngr: 0,
};

export default function Reports() {
  const router = useRouter();
  const { toast } = useToast();
  const [dateFrom, setDateFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [settings, setSettings] = useState<Settings>({ payment_fee_bps: 0, gaming_tax_bps: 0, default_casino_share_bps: 1500 });
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adjustment, setAdjustment] = useState({ type: "payment_fee", amount: "", reference: "", notes: "" });

  const adminFetch = useCallback(async (url: string, init?: RequestInit) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Admin session expired");
    const response = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}`, ...(init?.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Finance request failed");
    return body;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { await router.replace("/admin/login"); return; }
      const { data: profile } = await supabase.from("profiles").select("admin_role").eq("id", user.id).single();
      if (!profile || !canAccessAdminArea(profile.admin_role, "reports")) { await router.replace("/"); return; }

      const from = new Date(`${dateFrom}T00:00:00.000Z`).toISOString();
      const to = new Date(`${dateTo}T23:59:59.999Z`).toISOString();
      const body = await adminFetch(`/api/admin/revenue?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      setSummary(body.summary || emptySummary);
      setSettings(body.settings || settings);
      setAdjustments(body.adjustments || []);
      setSettlements(body.settlements || []);
      setCanManage(Boolean(body.canManage));
    } catch (error) {
      toast({
        title: "Revenue report could not be loaded",
        description: error instanceof Error ? error.message : "Run the revenue accounting migration first.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [adminFetch, dateFrom, dateTo, router, toast]);

  useEffect(() => { void load(); }, [load]);

  async function saveSettings() {
    try {
      await adminFetch("/api/admin/revenue", {
        method: "PATCH",
        body: JSON.stringify({
          paymentFeeBps: Number(settings.payment_fee_bps),
          gamingTaxBps: Number(settings.gaming_tax_bps),
          defaultCasinoShareBps: Number(settings.default_casino_share_bps),
        }),
      });
      toast({ title: "Finance settings saved" });
      await load();
    } catch (error) {
      toast({ title: "Settings were not saved", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
  }

  async function addAdjustment() {
    const amount = Number(adjustment.amount);
    if (!Number.isFinite(amount) || amount <= 0 || adjustment.notes.trim().length < 3) {
      toast({ title: "Enter a positive amount and a clear note", variant: "destructive" });
      return;
    }
    try {
      await adminFetch("/api/admin/revenue", {
        method: "POST",
        body: JSON.stringify({
          resource: "adjustment", type: adjustment.type, amount,
          reference: adjustment.reference.trim() || null, notes: adjustment.notes.trim(),
        }),
      });
      setAdjustment({ type: "payment_fee", amount: "", reference: "", notes: "" });
      toast({ title: "Finance entry recorded" });
      await load();
    } catch (error) {
      toast({ title: "Entry was not recorded", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
  }

  async function generateSettlements() {
    try {
      await adminFetch("/api/admin/revenue", {
        method: "POST",
        body: JSON.stringify({
          resource: "casino_settlements",
          from: new Date(`${dateFrom}T00:00:00.000Z`).toISOString(),
          to: new Date(`${dateTo}T23:59:59.999Z`).toISOString(),
        }),
      });
      toast({ title: "Casino provider settlements generated" });
      await load();
    } catch (error) {
      toast({ title: "Settlements were not generated", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
  }

  async function updateSettlement(id: string, status: "approved" | "paid" | "disputed") {
    const paymentReference = status === "paid" ? window.prompt("Enter provider payment reference")?.trim() : null;
    if (status === "paid" && !paymentReference) return;
    try {
      await adminFetch("/api/admin/revenue", {
        method: "PATCH",
        body: JSON.stringify({ resource: "settlement_status", id, status, paymentReference: paymentReference || null }),
      });
      toast({ title: `Settlement ${status}` });
      await load();
    } catch (error) {
      toast({ title: "Settlement was not updated", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
  }

  function exportCsv() {
    const rows = [
      ["metric","amount"],
      ["sportsbook_stakes",summary.sportsbook.stakes],["sportsbook_payouts",summary.sportsbook.payouts],["sportsbook_ggr",summary.sportsbook.ggr],
      ["casino_stakes",summary.casino.stakes],["casino_payouts",summary.casino.payouts],["casino_refunds",summary.casino.refunds || 0],["casino_ggr",summary.casino.ggr],
      ["aviator_stakes",summary.aviator.stakes],["aviator_payouts",summary.aviator.payouts],["aviator_ggr",summary.aviator.ggr],
      ["bonus_cost",summary.deductions.bonusCost],["partner_commission",summary.deductions.partnerCommission],
      ["payment_fees",summary.deductions.paymentFees],["provider_share",summary.casino.providerShare || 0],
      ["provider_fees",summary.deductions.providerFees],["chargebacks",summary.deductions.chargebacks],
      ["refunds",summary.deductions.refunds],["gaming_tax",summary.deductions.gamingTax],
      ["other_cost",summary.deductions.otherCost],["other_income",summary.deductions.otherIncome],
      ["ggr",summary.ggr],["ngr",summary.ngr],
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `revenue-${dateFrom}-to-${dateTo}.csv`; link.click();
    URL.revokeObjectURL(url);
  }

  return <AdminLayout><div className="space-y-6">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold"><BarChart3 className="h-6 w-6 text-primary"/>Revenue & Finance</h1><p className="mt-1 text-sm text-muted-foreground">Auditable sportsbook, casino and Aviator GGR/NGR reporting</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs"><span>From</span><Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)}/></label>
        <label className="grid gap-1 text-xs"><span>To</span><Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)}/></label>
        <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}/>Refresh</Button>
        <Button variant="outline" onClick={exportCsv}><Download className="mr-2 h-4 w-4"/>CSV</Button>
      </div>
    </div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric title="Total stakes" value={summary.sportsbook.stakes+summary.casino.stakes+summary.aviator.stakes} note="Settled wagers"/>
      <Metric title="GGR" value={summary.ggr} note="Stakes minus payouts"/>
      <Metric title="Total deductions" value={totalDeductions(summary)} note="Fees, bonuses, tax and partners"/>
      <Metric title="NGR" value={summary.ngr} note="Actual net gaming revenue" accent={summary.ngr >= 0 ? "success" : "danger"}/>
    </div>

    <Tabs defaultValue="breakdown">
      <TabsList className="flex h-auto flex-wrap"><TabsTrigger value="breakdown">Revenue breakdown</TabsTrigger><TabsTrigger value="deductions">Deductions</TabsTrigger><TabsTrigger value="settlements">Casino settlements</TabsTrigger>{canManage && <TabsTrigger value="settings">Finance controls</TabsTrigger>}</TabsList>

      <TabsContent value="breakdown" className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-3">
          <RevenueCard title="Sportsbook" data={summary.sportsbook}/>
          <RevenueCard title="Casino" data={summary.casino}/>
          <RevenueCard title="Aviator" data={summary.aviator}/>
        </div>
        <Card><CardHeader><CardTitle className="text-base">Revenue formula</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">GGR = settled stakes − payouts − game refunds. NGR = GGR + other income − bonuses − partner commissions − provider share − payment/provider fees − chargebacks/refunds − gaming tax − other costs.</CardContent></Card>
      </TabsContent>

      <TabsContent value="deductions">
        <Card><CardHeader><CardTitle>Deductions for selected period</CardTitle></CardHeader><CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Object.entries({
              "Bonus cost":summary.deductions.bonusCost,"Partner commission":summary.deductions.partnerCommission,
              "Casino provider share":summary.casino.providerShare || 0,"Payment fees":summary.deductions.paymentFees,
              "Provider fees":summary.deductions.providerFees,"Chargebacks":summary.deductions.chargebacks,
              "Refunds":summary.deductions.refunds,"Gaming tax":summary.deductions.gamingTax,
              "Other costs":summary.deductions.otherCost,"Other income":summary.deductions.otherIncome,
            }).map(([label,value]) => <div key={label} className="rounded-lg border p-4"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-mono text-lg font-bold">{money(value)}</div></div>)}
          </div>
          <div className="mt-6 overflow-x-auto rounded-lg border"><table className="w-full text-sm"><thead className="bg-muted/40"><tr><th className="p-3 text-left">Date</th><th className="p-3 text-left">Type</th><th className="p-3 text-left">Reference / note</th><th className="p-3 text-right">Amount</th></tr></thead><tbody>{adjustments.map((row) => <tr key={row.id} className="border-t"><td className="p-3">{new Date(row.occurred_at).toLocaleString()}</td><td className="p-3"><Badge variant="outline">{row.adjustment_type.replaceAll("_"," ")}</Badge></td><td className="p-3">{row.reference || row.notes}</td><td className="p-3 text-right font-mono">{money(row.amount)}</td></tr>)}{adjustments.length===0 && <tr><td className="p-8 text-center text-muted-foreground" colSpan={4}>No manual finance entries in this period.</td></tr>}</tbody></table></div>
        </CardContent></Card>
      </TabsContent>

      <TabsContent value="settlements">
        <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>Casino provider settlements</CardTitle>{canManage && <Button onClick={() => void generateSettlements()}><Calculator className="mr-2 h-4 w-4"/>Generate selected period</Button>}</div></CardHeader><CardContent>
          <div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm"><thead className="bg-muted/40"><tr><th className="p-3 text-left">Provider</th><th className="p-3 text-left">Period</th><th className="p-3 text-right">GGR</th><th className="p-3 text-right">Provider share</th><th className="p-3 text-left">Status</th><th className="p-3 text-right">Actions</th></tr></thead><tbody>{settlements.map((row) => <tr key={row.id} className="border-t"><td className="p-3">{row.casino_providers?.name || row.casino_providers?.code || "Provider"}</td><td className="p-3 text-xs">{new Date(row.period_from).toLocaleDateString()} – {new Date(row.period_to).toLocaleDateString()}</td><td className="p-3 text-right font-mono">{money(row.gross_gaming_revenue)}</td><td className="p-3 text-right font-mono">{money(row.provider_share)}</td><td className="p-3"><Badge variant="outline">{row.status}</Badge>{row.payment_reference && <div className="mt-1 text-xs text-muted-foreground">{row.payment_reference}</div>}</td><td className="p-3"><div className="flex justify-end gap-2">{canManage && row.status==="draft" && <><Button size="sm" onClick={() => void updateSettlement(row.id,"approved")}>Approve</Button><Button size="sm" variant="outline" onClick={() => void updateSettlement(row.id,"disputed")}>Dispute</Button></>}{canManage && row.status==="approved" && <Button size="sm" onClick={() => void updateSettlement(row.id,"paid")}>Mark paid</Button>}</div></td></tr>)}{settlements.length===0 && <tr><td className="p-8 text-center text-muted-foreground" colSpan={6}>No settlements generated yet.</td></tr>}</tbody></table></div>
        </CardContent></Card>
      </TabsContent>

      {canManage && <TabsContent value="settings" className="space-y-4">
        <Card><CardHeader><CardTitle>Automatic finance rates</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-3">
          <RateInput label="Payment fee %" value={settings.payment_fee_bps} onChange={(value) => setSettings({...settings,payment_fee_bps:value})}/>
          <RateInput label="Gaming tax %" value={settings.gaming_tax_bps} onChange={(value) => setSettings({...settings,gaming_tax_bps:value})}/>
          <RateInput label="Default casino share %" value={settings.default_casino_share_bps} onChange={(value) => setSettings({...settings,default_casino_share_bps:value})}/>
          <Button className="w-fit md:col-span-3" onClick={() => void saveSettings()}><Save className="mr-2 h-4 w-4"/>Save rates</Button>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Record finance adjustment</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="grid gap-2"><Label>Type</Label><Select value={adjustment.type} onValueChange={(type) => setAdjustment({...adjustment,type})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{adjustmentTypes.map((type) => <SelectItem key={type} value={type}>{type.replaceAll("_"," ")}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-2"><Label>Amount (USD)</Label><Input type="number" min="0.01" step="0.01" value={adjustment.amount} onChange={(event) => setAdjustment({...adjustment,amount:event.target.value})}/></div>
          <div className="grid gap-2"><Label>Reference</Label><Input value={adjustment.reference} onChange={(event) => setAdjustment({...adjustment,reference:event.target.value})} placeholder="Invoice / transaction ID"/></div>
          <div className="grid gap-2"><Label>Audit note</Label><Input value={adjustment.notes} onChange={(event) => setAdjustment({...adjustment,notes:event.target.value})} placeholder="Why this entry was recorded"/></div>
          <Button className="w-fit xl:col-span-4" onClick={() => void addAdjustment()}><WalletCards className="mr-2 h-4 w-4"/>Record entry</Button>
        </CardContent></Card>
      </TabsContent>}
    </Tabs>
  </div></AdminLayout>;
}

function Metric({ title, value, note, accent }: { title: string; value: number; note: string; accent?: "success" | "danger" }) {
  return <Card><CardContent className="p-5"><div className="text-xs text-muted-foreground">{title}</div><div className={`mt-2 font-mono text-2xl font-bold ${accent==="success"?"text-success":accent==="danger"?"text-danger":""}`}>{money(value)}</div><div className="mt-1 text-xs text-muted-foreground">{note}</div></CardContent></Card>;
}
function RevenueCard({ title, data }: { title: string; data: RevenueGroup }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><Line label="Stakes" value={data.stakes}/><Line label="Payouts" value={data.payouts}/>{Boolean(data.refunds) && <Line label="Game refunds" value={data.refunds || 0}/>}<div className="border-t pt-3"><Line label="GGR" value={data.ggr} strong/></div></CardContent></Card>;
}
function Line({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return <div className="flex items-center justify-between gap-4"><span className={strong?"font-semibold":"text-muted-foreground"}>{label}</span><span className={`font-mono ${strong?"font-bold":""}`}>{money(value)}</span></div>;
}
function RateInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <div className="grid gap-2"><Label>{label}</Label><Input type="number" min="0" max="100" step="0.01" value={value/100} onChange={(event) => onChange(Math.round(Number(event.target.value || 0)*100))}/></div>;
}
function money(value: unknown) { const number=Number(value || 0); return `${number<0?"-":""}$${Math.abs(number).toFixed(2)}`; }
function totalDeductions(summary: Summary) {
  const d=summary.deductions;
  return d.bonusCost+d.partnerCommission+(summary.casino.providerShare||0)+d.paymentFees+d.providerFees+d.chargebacks+d.refunds+d.gamingTax+d.otherCost-d.otherIncome;
}
