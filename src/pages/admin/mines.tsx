import { useEffect, useRef, useState } from "react";
import { Activity, Bomb, DollarSign, Gauge, Save, ShieldCheck, WalletCards } from "lucide-react";
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
  min_mines: number;
  max_mines: number;
  max_payout: number;
  house_edge_percent: number;
  max_user_daily_wager: number;
  updated_at?: string;
};

type Dashboard = {
  settings: Settings;
  metrics: {
    wager_24h: number;
    payout_24h: number;
    ggr_24h: number;
    active_rounds: number;
    current_exposure: number;
  };
  recent_rounds: Array<{
    id: string;
    stake: number;
    mine_count: number;
    status: string;
    multiplier: number;
    payout: number;
    created_at: string;
  }>;
};

const defaults: Settings = {
  is_enabled: true,
  is_paused: false,
  maintenance_message: "Mines is temporarily unavailable",
  min_stake: 1,
  max_stake: 500,
  min_mines: 3,
  max_mines: 10,
  max_payout: 100000,
  house_edge_percent: 1,
  max_user_daily_wager: 10000,
};

const money = (value: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));

function operationError(error: { message?: string } | null | undefined) {
  const message = error?.message || "Mines operation failed";
  if (/mines_settings|mines_admin_|schema cache|does not exist/i.test(message)) {
    return "Run supabase/migrations/20261115130000_mines_admin_controls.sql in Supabase SQL Editor, then reload.";
  }
  return message;
}

export default function MinesAdminPage() {
  const { toast } = useToast();
  const initialized = useRef(false);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [form, setForm] = useState<Settings>(defaults);
  const [reason, setReason] = useState("Mines operational settings update");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  async function loadDashboard(showToast = false) {
    const { data, error } = await (supabase as any).rpc("mines_admin_get_dashboard");
    if (error) {
      const description = operationError(error);
      setLoadError(description);
      if (showToast) toast({ title: "Mines controls not ready", description, variant: "destructive" });
      setLoading(false);
      return;
    }
    const next = data as Dashboard;
    setDashboard(next);
    setLoadError("");
    if (!initialized.current) {
      setForm({ ...defaults, ...next.settings });
      initialized.current = true;
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadDashboard(true);
    const timer = window.setInterval(() => void loadDashboard(false), 5000);
    return () => window.clearInterval(timer);
  }, []);

  function numberField(key: keyof Settings, value: string) {
    setForm((current) => ({ ...current, [key]: Number(value) }));
  }

  async function save() {
    setSaving(true);
    const payload = {
      is_enabled: form.is_enabled,
      is_paused: form.is_paused,
      maintenance_message: form.maintenance_message.trim(),
      min_stake: form.min_stake,
      max_stake: form.max_stake,
      min_mines: form.min_mines,
      max_mines: form.max_mines,
      max_payout: form.max_payout,
      house_edge_percent: form.house_edge_percent,
      max_user_daily_wager: form.max_user_daily_wager,
    };
    const { data, error } = await (supabase as any).rpc("mines_admin_update_settings", {
      p_settings: payload,
      p_reason: reason.trim(),
    });
    if (error) {
      toast({ title: "Mines settings not saved", description: operationError(error), variant: "destructive" });
    } else {
      setDashboard(data as Dashboard);
      toast({
        title: "Mines settings saved",
        description: form.is_paused
          ? "New rounds are paused. Existing rounds can finish safely."
          : "Limits now apply to future rounds.",
      });
    }
    setSaving(false);
  }

  const metrics = dashboard?.metrics;

  return (
    <AdminLayout>
      <div className="space-y-5">
        {loadError && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
            <p className="font-semibold text-warning">Mines database patch required</p>
            <p className="mt-1 text-muted-foreground">{loadError}</p>
          </div>
        )}

        <section className="relative overflow-hidden rounded-[28px] border border-cyan-400/15 bg-[#07111f] p-6 text-white shadow-[0_25px_70px_rgba(0,0,0,.35)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(34,211,238,.18),transparent_28%),radial-gradient(circle_at_15%_100%,rgba(16,185,129,.14),transparent_32%)]" />
          <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-300 to-emerald-400">
                <Bomb className="h-8 w-8 text-slate-950" />
              </div>
              <div>
                <h1 className="text-3xl font-black">Mines Control Center</h1>
                <p className="text-sm text-slate-400">Fairness-safe limits, monitoring and audit controls</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={form.is_enabled && !form.is_paused ? "outline" : "destructive"} className="px-3 py-1.5">
                {!form.is_enabled ? "Disabled" : form.is_paused ? "Paused" : "Running"}
              </Badge>
              <Badge variant="outline" className="border-emerald-400/30 text-emerald-300">Outcomes locked</Badge>
            </div>
          </div>
        </section>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric icon={<DollarSign />} label="24h wager" value={"$" + money(metrics?.wager_24h || 0)} />
          <Metric icon={<WalletCards />} label="24h payout" value={"$" + money(metrics?.payout_24h || 0)} />
          <Metric icon={<Gauge />} label="24h GGR" value={"$" + money(metrics?.ggr_24h || 0)} />
          <Metric icon={<Activity />} label="Active rounds" value={String(metrics?.active_rounds || 0)} />
          <Metric icon={<ShieldCheck />} label="Exposure" value={"$" + money(metrics?.current_exposure || 0)} />
        </div>

        <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
          <div className="space-y-5">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5 text-primary" />Game operations</CardTitle></CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <Toggle title="Game enabled" description="Allow customers to start new rounds" checked={form.is_enabled} onChange={(value) => setForm((current) => ({ ...current, is_enabled: value }))} />
                <Toggle title="Pause new rounds" description="Existing rounds can still finish safely" checked={form.is_paused} onChange={(value) => setForm((current) => ({ ...current, is_paused: value }))} />
                <div className="sm:col-span-2">
                  <Label>Maintenance message</Label>
                  <Input className="mt-2" maxLength={240} value={form.maintenance_message} onChange={(event) => setForm((current) => ({ ...current, maintenance_message: event.target.value }))} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><WalletCards className="h-5 w-5 text-primary" />Stake, payout and risk limits</CardTitle></CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Field label="Minimum stake" hint="$1–$500" value={form.min_stake} min={1} max={500} step={0.01} suffix="USD" onChange={(value) => numberField("min_stake", value)} />
                <Field label="Maximum stake" hint="Per round" value={form.max_stake} min={1} max={500} step={0.01} suffix="USD" onChange={(value) => numberField("max_stake", value)} />
                <Field label="Maximum payout" hint="Per round" value={form.max_payout} min={1} max={1000000} step={1} suffix="USD" onChange={(value) => numberField("max_payout", value)} />
                <Field label="Minimum mines" hint="3–10" value={form.min_mines} min={3} max={10} step={1} suffix="mines" onChange={(value) => numberField("min_mines", value)} />
                <Field label="Maximum mines" hint="3–10" value={form.max_mines} min={3} max={10} step={1} suffix="mines" onChange={(value) => numberField("max_mines", value)} />
                <Field label="House edge" hint="Future rounds only" value={form.house_edge_percent} min={0} max={10} step={0.1} suffix="%" onChange={(value) => numberField("house_edge_percent", value)} />
                <Field label="Daily wager limit" hint="Per customer, rolling 24h" value={form.max_user_daily_wager} min={1} max={10000000} step={1} suffix="USD" onChange={(value) => numberField("max_user_daily_wager", value)} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Recent Mines rounds</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {loading ? (
                  <p className="text-sm text-muted-foreground">Loading rounds…</p>
                ) : (dashboard?.recent_rounds || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No Mines rounds recorded yet.</p>
                ) : dashboard?.recent_rounds.map((round) => (
                  <div key={round.id} className="grid grid-cols-[1fr_auto] gap-3 rounded-xl border p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
                    <div>
                      <p className="font-mono text-xs font-bold">{round.id.slice(0, 8)}</p>
                      <p className="text-xs text-muted-foreground">{new Date(round.created_at).toLocaleString()}</p>
                    </div>
                    <Badge variant={round.status === "lost" ? "destructive" : "outline"}>{round.status.replace("_", " ")}</Badge>
                    <span className="font-mono text-sm">{round.mine_count} mines</span>
                    <span className="font-mono text-sm font-bold">{"$" + money(round.payout)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <aside>
            <Card className="sticky top-6 overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-emerald-400 via-cyan-400 to-fuchsia-500" />
              <CardHeader><CardTitle>Publish configuration</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <Summary label="Stake range" value={"$" + form.min_stake + " – $" + form.max_stake} />
                <Summary label="Mine range" value={form.min_mines + " – " + form.max_mines} />
                <Summary label="Maximum payout" value={"$" + money(form.max_payout)} />
                <Summary label="Daily wager" value={"$" + money(form.max_user_daily_wager)} />
                <Summary label="House edge" value={form.house_edge_percent + "%"} />
                <div>
                  <Label>Required audit reason</Label>
                  <Input className="mt-2" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why are these settings changing?" />
                </div>
                <Button className="h-12 w-full bg-gradient-to-r from-emerald-400 to-cyan-400 font-black text-slate-950" disabled={saving || reason.trim().length < 5} onClick={() => void save()}>
                  <Save className="mr-2 h-4 w-4" />{saving ? "Saving…" : "Save Mines Settings"}
                </Button>
                <p className="text-center text-[10px] leading-relaxed text-muted-foreground">
                  Changes are audit logged and affect future rounds only. Mine positions and live outcomes cannot be edited.
                </p>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </AdminLayout>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <Card><CardContent className="p-4"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>{label}</div><p className="mt-2 font-mono text-xl font-black">{value}</p></CardContent></Card>;
}

function Toggle({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="flex items-center justify-between gap-3 rounded-2xl border p-4"><div><p className="font-semibold">{title}</p><p className="text-xs text-muted-foreground">{description}</p></div><Switch checked={checked} onCheckedChange={onChange} /></div>;
}

function Field({ label, hint, value, min, max, step, suffix, onChange }: { label: string; hint: string; value: number; min: number; max: number; step: number; suffix: string; onChange: (value: string) => void }) {
  return <div className="space-y-2"><div><Label>{label}</Label><p className="mt-1 text-[10px] text-muted-foreground">{hint}</p></div><div className="relative"><Input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(event.target.value)} className="pr-16 font-mono font-bold" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted-foreground">{suffix}</span></div></div>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between border-b border-border/70 pb-3 text-sm"><span className="text-muted-foreground">{label}</span><span className="font-mono font-bold">{value}</span></div>;
}
