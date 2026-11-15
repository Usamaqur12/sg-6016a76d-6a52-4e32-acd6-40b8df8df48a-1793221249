import { useEffect, useRef, useState } from "react";
import { Activity, Download, Gauge, Save, Sparkles, WalletCards } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Settings = {
  is_enabled: boolean;
  is_paused: boolean;
  maintenance_message: string;
  min_stake: number;
  max_stake: number;
  max_payout: number;
  max_user_daily_wager: number;
};

type Spin = {
  id: string;
  stake: number;
  multiplier: number;
  payout: number;
  segment_index: number;
  created_at: string;
};

type Dashboard = {
  settings: Settings;
  metrics: {
    wager_24h: number;
    payout_24h: number;
    ggr_24h: number;
    spins_24h: number;
    rtp_24h: number;
  };
  segments: number[];
  recent_spins: Spin[];
};

const defaults: Settings = {
  is_enabled: true,
  is_paused: false,
  maintenance_message: "Spinner is temporarily unavailable",
  min_stake: 1,
  max_stake: 500,
  max_payout: 100000,
  max_user_daily_wager: 10000,
};

const money = (value: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));

function dbError(error: { message?: string } | null | undefined) {
  const message = error?.message || "Spinner operation failed";
  if (/spinner_|schema cache|does not exist/i.test(message)) {
    return "Run supabase/migrations/20261115150000_mindbet_spinner.sql in Supabase SQL Editor, then reload.";
  }
  return message;
}

export default function SpinnerAdminPage() {
  const { toast } = useToast();
  const initialized = useRef(false);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [form, setForm] = useState<Settings>(defaults);
  const [reason, setReason] = useState("Spinner operational settings update");
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");

  async function load(showToast = false) {
    const { data, error } = await (supabase as any).rpc("spinner_admin_get_dashboard");
    if (error) {
      const description = dbError(error);
      setLoadError(description);
      if (showToast) toast({ title: "Spinner controls not ready", description, variant: "destructive" });
      return;
    }
    const next = data as Dashboard;
    setDashboard(next);
    setLoadError("");
    if (!initialized.current) {
      setForm({ ...defaults, ...next.settings });
      initialized.current = true;
    }
  }

  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => void load(false), 5000);
    return () => window.clearInterval(timer);
  }, []);

  function numeric(key: keyof Settings, value: string) {
    setForm((current) => ({ ...current, [key]: Number(value) }));
  }

  async function save() {
    setSaving(true);
    const { data, error } = await (supabase as any).rpc("spinner_admin_update_settings", {
      p_settings: form,
      p_reason: reason.trim(),
    });
    if (error) {
      toast({ title: "Spinner settings not saved", description: dbError(error), variant: "destructive" });
    } else {
      setDashboard(data as Dashboard);
      toast({ title: "Spinner settings saved", description: "Changes apply to future spins only." });
    }
    setSaving(false);
  }

  function exportCsv() {
    const spins = dashboard?.recent_spins || [];
    if (!spins.length) return;
    const quote = (value: unknown) => '"' + String(value ?? "").replace(/"/g, '""') + '"';
    const rows = [
      ["spin_id", "created_at", "segment", "stake", "multiplier", "payout"],
      ...spins.map((spin) => [spin.id, spin.created_at, spin.segment_index, spin.stake, spin.multiplier, spin.payout]),
    ];
    const csv = rows.map((row) => row.map(quote).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "mindbet-spinner-" + new Date().toISOString().slice(0, 10) + ".csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const metrics = dashboard?.metrics;

  return (
    <AdminLayout>
      <div className="space-y-5">
        {loadError && <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning">{loadError}</div>}

        <section className="relative overflow-hidden rounded-[28px] border border-fuchsia-400/20 bg-[#08101f] p-6 text-white">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(168,85,247,.2),transparent_30%),radial-gradient(circle_at_15%_100%,rgba(34,211,238,.13),transparent_32%)]" />
          <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-400 to-cyan-300"><Sparkles className="h-8 w-8 text-slate-950" /></div>
              <div><h1 className="text-3xl font-black">Spinner Control Center</h1><p className="text-sm text-slate-400">Availability, funded limits, monitoring and audit controls</p></div>
            </div>
            <div className="flex gap-2">
              <Badge variant={form.is_enabled && !form.is_paused ? "outline" : "destructive"}>{!form.is_enabled ? "Disabled" : form.is_paused ? "Paused" : "Running"}</Badge>
              <Badge variant="outline" className="border-emerald-400/30 text-emerald-300">Fixed 95.83% RTP</Badge>
            </div>
          </div>
        </section>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="24h wager" value={"$" + money(metrics?.wager_24h || 0)} icon={<WalletCards />} />
          <Metric label="24h payout" value={"$" + money(metrics?.payout_24h || 0)} icon={<WalletCards />} />
          <Metric label="24h GGR" value={"$" + money(metrics?.ggr_24h || 0)} icon={<Gauge />} />
          <Metric label="24h spins" value={String(metrics?.spins_24h || 0)} icon={<Activity />} />
          <Metric label="Actual RTP" value={money(metrics?.rtp_24h || 0) + "%"} icon={<Gauge />} />
        </div>

        <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
          <div className="space-y-5">
            <Card>
              <CardHeader><CardTitle>Game operations</CardTitle></CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <Toggle title="Game enabled" description="Allow new funded spins" checked={form.is_enabled} onChange={(value) => setForm((current) => ({ ...current, is_enabled: value }))} />
                <Toggle title="Pause Spinner" description="Stop new spins safely" checked={form.is_paused} onChange={(value) => setForm((current) => ({ ...current, is_paused: value }))} />
                <div className="sm:col-span-2"><Label>Maintenance message</Label><Input className="mt-2" value={form.maintenance_message} maxLength={240} onChange={(event) => setForm((current) => ({ ...current, maintenance_message: event.target.value }))} /></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Stake and payout limits</CardTitle></CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field label="Minimum stake" value={form.min_stake} min={1} max={500} step={0.01} suffix="USD" onChange={(value) => numeric("min_stake", value)} />
                <Field label="Maximum stake" value={form.max_stake} min={1} max={500} step={0.01} suffix="USD" onChange={(value) => numeric("max_stake", value)} />
                <Field label="Maximum payout" value={form.max_payout} min={1} max={1000000} step={1} suffix="USD" onChange={(value) => numeric("max_payout", value)} />
                <Field label="Daily wager limit" value={form.max_user_daily_wager} min={1} max={10000000} step={1} suffix="USD" onChange={(value) => numeric("max_user_daily_wager", value)} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle>Recent spins</CardTitle><Button size="sm" variant="outline" onClick={exportCsv} disabled={!dashboard?.recent_spins.length}><Download className="mr-2 h-4 w-4" />CSV</Button></CardHeader>
              <CardContent className="space-y-2">
                {(dashboard?.recent_spins || []).length === 0 ? <p className="text-sm text-muted-foreground">No spins recorded yet.</p> : dashboard?.recent_spins.map((spin) => (
                  <div key={spin.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-xl border p-3">
                    <div><p className="font-mono text-xs font-bold">{spin.id.slice(0, 8)}</p><p className="text-[10px] text-muted-foreground">{new Date(spin.created_at).toLocaleString()}</p></div>
                    <span className="font-mono font-black">{Number(spin.multiplier).toFixed(2)}x</span>
                    <span className="font-mono text-sm">{"$" + money(spin.payout)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <aside>
            <Card className="sticky top-6 overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-fuchsia-400 via-violet-400 to-cyan-300" />
              <CardHeader><CardTitle>Publish configuration</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <Summary label="Stake range" value={"$" + form.min_stake + " – $" + form.max_stake} />
                <Summary label="Maximum payout" value={"$" + money(form.max_payout)} />
                <Summary label="Daily wager" value={"$" + money(form.max_user_daily_wager)} />
                <Summary label="Theoretical RTP" value="95.83%" />
                <div><Label>Required audit reason</Label><Input className="mt-2" value={reason} onChange={(event) => setReason(event.target.value)} /></div>
                <Button className="h-12 w-full bg-gradient-to-r from-fuchsia-400 to-cyan-300 font-black text-slate-950" disabled={saving || reason.trim().length < 5} onClick={() => void save()}><Save className="mr-2 h-4 w-4" />{saving ? "Saving…" : "Save Spinner Settings"}</Button>
                <p className="text-center text-[10px] text-muted-foreground">The segment paytable and individual outcomes cannot be edited from this panel.</p>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </AdminLayout>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <Card><CardContent className="p-4"><div className="flex items-center gap-2 text-[10px] font-bold uppercase text-muted-foreground"><span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>{label}</div><p className="mt-2 font-mono text-xl font-black">{value}</p></CardContent></Card>;
}

function Toggle({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="flex items-center justify-between gap-3 rounded-2xl border p-4"><div><p className="font-semibold">{title}</p><p className="text-xs text-muted-foreground">{description}</p></div><Switch checked={checked} onCheckedChange={onChange} /></div>;
}

function Field({ label, value, min, max, step, suffix, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix: string; onChange: (value: string) => void }) {
  return <div><Label>{label}</Label><div className="relative mt-2"><Input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(event.target.value)} className="pr-16 font-mono font-bold" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted-foreground">{suffix}</span></div></div>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between border-b pb-3 text-sm"><span className="text-muted-foreground">{label}</span><span className="font-mono font-bold">{value}</span></div>;
}
