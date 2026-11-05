import { useEffect, useRef, useState } from "react";
import {
  Activity,
  BellRing,
  CheckCircle2,
  Gauge,
  History,
  Plane,
  Save,
  ShieldCheck,
  Timer,
  WalletCards,
  XCircle,
  Zap,
} from "lucide-react";
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
  betting_seconds: number;
  cooldown_seconds: number;
  growth_rate: number;
  min_stake: number;
  max_stake: number;
  max_multiplier: number;
  max_payout: number;
  house_edge_percent: number;
  max_bets_per_round: number;
  max_round_exposure: number;
  max_user_daily_wager: number;
  max_user_daily_loss: number;
  auto_cashout_enabled: boolean;
  min_auto_cashout: number;
  max_auto_cashout: number;
  reminder_minutes: number;
  high_exposure_alert_percent: number;
  low_data_mode_default: boolean;
  sound_enabled_default: boolean;
  vibration_enabled_default: boolean;
  dual_approval_required: boolean;
};

type NumericKey =
  | "betting_seconds"
  | "cooldown_seconds"
  | "growth_rate"
  | "min_stake"
  | "max_stake"
  | "max_multiplier"
  | "max_payout"
  | "house_edge_percent"
  | "max_bets_per_round"
  | "max_round_exposure"
  | "max_user_daily_wager"
  | "max_user_daily_loss"
  | "min_auto_cashout"
  | "max_auto_cashout"
  | "reminder_minutes"
  | "high_exposure_alert_percent";

type State = {
  phase: string;
  current_multiplier: number;
  settings: Partial<Settings>;
  round: null | {
    round_number: number;
    server_seed_hash: string;
    crash_multiplier: number | null;
  };
  history: Array<{ round_number: number; crash_multiplier: number }>;
};

type Dashboard = {
  settings: Settings;
  pending_settings: Record<string, unknown> | null;
  pending_settings_by: string | null;
  pending_settings_at: string | null;
  metrics: {
    wager_24h: number;
    payout_24h: number;
    gross_gaming_revenue_24h: number;
    rtp_24h: number;
    active_bets: number;
    round_exposure: number;
    round_exposure_percent: number;
  };
  alerts: Array<{
    id: string;
    alert_type: string;
    severity: string;
    message: string;
    created_at: string;
  }>;
  versions: Array<{
    id: string;
    reason: string;
    created_at: string;
    changed_by: string;
    approved_by: string | null;
  }>;
};

const defaults: Settings = {
  is_enabled: true,
  is_paused: false,
  maintenance_message: "Aviator is temporarily unavailable",
  betting_seconds: 8,
  cooldown_seconds: 3,
  growth_rate: 0.115,
  min_stake: 1,
  max_stake: 1000,
  max_multiplier: 1000,
  max_payout: 100000,
  house_edge_percent: 1,
  max_bets_per_round: 5000,
  max_round_exposure: 1000000,
  max_user_daily_wager: 10000,
  max_user_daily_loss: 5000,
  auto_cashout_enabled: true,
  min_auto_cashout: 1.1,
  max_auto_cashout: 1000,
  reminder_minutes: 30,
  high_exposure_alert_percent: 80,
  low_data_mode_default: false,
  sound_enabled_default: true,
  vibration_enabled_default: true,
  dual_approval_required: false,
};

const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

function aviatorOperationError(error: { message?: string } | null | undefined) {
  const message = error?.message || "Aviator operation failed";
  if (/aviator_admin_|schema cache|does not exist/i.test(message)) {
    return "Advanced Aviator database objects are not active. Run supabase/migrations/20261105100000_advanced_aviator_controls.sql in Supabase SQL Editor, then reload this page.";
  }
  return message;
}

export default function AviatorAdminPage() {
  const { toast } = useToast();
  const initialized = useRef(false);
  const [game, setGame] = useState<State | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [dashboardError, setDashboardError] = useState("");
  const [form, setForm] = useState<Settings>(defaults);
  const [reason, setReason] = useState("Operational settings update");
  const [approvalReason, setApprovalReason] = useState("Reviewed and approved");
  const [saving, setSaving] = useState(false);

  async function loadState() {
    const { data, error } = await (supabase as any).rpc("aviator_get_state");
    if (!error && data) setGame(data as State);
  }

  async function loadDashboard(showError = false) {
    const { data, error } = await (supabase as any).rpc(
      "aviator_admin_get_dashboard"
    );
    if (error) {
      const description = aviatorOperationError(error);
      setDashboardError(description);
      if (showError) {
        toast({
          title: "Advanced Aviator controls not ready",
          description,
          variant: "destructive",
        });
      }
      return;
    }
    setDashboardError("");
    const next = data as Dashboard;
    setDashboard(next);
    if (!initialized.current) {
      setForm({ ...defaults, ...next.settings });
      initialized.current = true;
    }
  }

  useEffect(() => {
    void loadState();
    void loadDashboard(true);
    const timer = window.setInterval(() => {
      void loadState();
      void loadDashboard(false);
    }, 3000);
    return () => window.clearInterval(timer);
  }, []);

  function numeric(key: NumericKey, value: string) {
    setForm((current) => ({ ...current, [key]: Number(value) }));
  }

  function preset(name: "steady" | "standard" | "turbo") {
    if (name === "steady") {
      setForm((current) => ({
        ...current,
        betting_seconds: 10,
        cooldown_seconds: 4,
        growth_rate: 0.08,
      }));
    }
    if (name === "standard") {
      setForm((current) => ({
        ...current,
        betting_seconds: 8,
        cooldown_seconds: 3,
        growth_rate: 0.115,
      }));
    }
    if (name === "turbo") {
      setForm((current) => ({
        ...current,
        betting_seconds: 5,
        cooldown_seconds: 2,
        growth_rate: 0.18,
      }));
    }
  }

  async function save() {
    setSaving(true);
    const { data, error } = await (supabase as any).rpc(
      "aviator_admin_update_advanced_settings",
      { p_settings: form, p_reason: reason }
    );
    if (error) {
      toast({
        title: "Settings not saved",
        description: aviatorOperationError(error),
        variant: "destructive",
      });
    } else {
      const result = data as { status: string; state?: State };
      if (result.state) setGame(result.state);
      toast({
        title:
          result.status === "pending"
            ? "Approval requested"
            : "Aviator settings saved",
        description:
          result.status === "pending"
            ? "A different super admin must approve this configuration."
            : form.is_paused
              ? "Active bets were refunded safely."
              : "New settings apply to future rounds.",
      });
      await loadDashboard();
    }
    setSaving(false);
  }

  async function decidePending(approve: boolean) {
    setSaving(true);
    const { data, error } = await (supabase as any).rpc(
      "aviator_admin_approve_pending",
      { p_approve: approve, p_reason: approvalReason }
    );
    if (error) {
      toast({
        title: "Approval failed",
        description: aviatorOperationError(error),
        variant: "destructive",
      });
    } else {
      toast({
        title: approve ? "Configuration approved" : "Configuration rejected",
      });
      const result = data as { state?: State };
      if (result.state) setGame(result.state);
      initialized.current = false;
      await loadDashboard();
    }
    setSaving(false);
  }

  async function acknowledgeAlert(alertId: string) {
    const { error } = await (supabase as any).rpc(
      "aviator_admin_acknowledge_alert",
      { p_alert_id: alertId }
    );
    if (!error) await loadDashboard();
  }

  const metrics = dashboard?.metrics;

  return (
    <AdminLayout>
      <div className="space-y-5">
        {dashboardError && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
            <p className="font-semibold text-warning">Advanced Aviator database migration required</p>
            <p className="mt-1 text-muted-foreground">{dashboardError}</p>
          </div>
        )}
        <section className="relative overflow-hidden rounded-[28px] border border-cyan-400/15 bg-[#07111f] p-6 text-white shadow-[0_25px_70px_rgba(0,0,0,.35)]">
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at 78% 30%,rgba(34,211,238,.18),transparent 27%),radial-gradient(circle at 15% 100%,rgba(16,185,129,.13),transparent 30%)",
            }}
          />
          <div className="relative z-10 grid gap-6 xl:grid-cols-[1fr_auto] xl:items-center">
            <div>
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-300 to-emerald-400">
                  <Plane className="h-7 w-7 text-slate-950" />
                </div>
                <div>
                  <h1 className="text-3xl font-black">
                    Aviator Control Center
                  </h1>
                  <p className="text-sm text-slate-400">
                    Fairness-safe operations, risk limits and monitoring
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {(game?.history || []).slice(0, 8).map((round) => (
                  <span
                    key={round.round_number}
                    className={
                      "rounded-full border px-3 py-1 font-mono text-xs font-black " +
                      (Number(round.crash_multiplier) >= 2
                        ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-300"
                        : "border-rose-400/30 bg-rose-400/10 text-rose-300")
                    }
                  >
                    {Number(round.crash_multiplier).toFixed(2)}x
                  </span>
                ))}
              </div>
            </div>
            <div className="grid min-w-[320px] grid-cols-3 gap-2">
              <HeroStat
                label="Round"
                value={"#" + (game?.round?.round_number || "—")}
                icon={<Activity className="h-4 w-4" />}
              />
              <HeroStat
                label="Phase"
                value={game?.phase || "loading"}
                icon={<Zap className="h-4 w-4" />}
              />
              <HeroStat
                label="Live"
                value={Number(game?.current_multiplier || 1).toFixed(2) + "x"}
                icon={<Gauge className="h-4 w-4" />}
              />
            </div>
          </div>
        </section>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Metric label="24h wager" value={"$" + money(metrics?.wager_24h || 0)} />
          <Metric label="24h payout" value={"$" + money(metrics?.payout_24h || 0)} />
          <Metric
            label="24h GGR"
            value={"$" + money(metrics?.gross_gaming_revenue_24h || 0)}
          />
          <Metric label="RTP" value={money(metrics?.rtp_24h || 0) + "%"} />
          <Metric label="Active bets" value={String(metrics?.active_bets || 0)} />
          <Metric
            label="Exposure"
            value={money(metrics?.round_exposure_percent || 0) + "%"}
            danger={(metrics?.round_exposure_percent || 0) >= form.high_exposure_alert_percent}
          />
        </div>

        {dashboard?.pending_settings && (
          <Card className="border-amber-400/40 bg-amber-400/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-amber-400" />
                Pending maker-checker approval
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Proposed {dashboard.pending_settings_at
                  ? new Date(dashboard.pending_settings_at).toLocaleString()
                  : "recently"}. A different super admin must approve or reject it.
              </p>
              <Input
                value={approvalReason}
                onChange={(event) => setApprovalReason(event.target.value)}
                placeholder="Approval reason"
              />
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void decidePending(true)} disabled={saving}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Approve
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void decidePending(false)}
                  disabled={saving}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Reject
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-5 xl:grid-cols-[1fr_350px]">
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-primary" />
                    Game operations
                  </CardTitle>
                  <Badge variant={form.is_paused ? "destructive" : "outline"}>
                    {form.is_paused ? "Paused" : "Running"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <Toggle
                  title="Game enabled"
                  description="Allow new provably-fair rounds"
                  checked={form.is_enabled}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, is_enabled: value }))
                  }
                />
                <Toggle
                  title="Pause safely"
                  description="Refund active bets before pausing"
                  checked={form.is_paused}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, is_paused: value }))
                  }
                />
                <div className="sm:col-span-2">
                  <TextField
                    label="Maintenance message"
                    value={form.maintenance_message}
                    maxLength={240}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        maintenance_message: value,
                      }))
                    }
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Timer className="h-5 w-5 text-primary" />
                    Round experience
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => preset("steady")}>
                      Steady
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => preset("standard")}>
                      Standard
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => preset("turbo")}>
                      Turbo
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-3">
                <Field label="Betting window" hint="3–30 seconds" value={form.betting_seconds} min={3} max={30} step={1} suffix="sec" onChange={(value) => numeric("betting_seconds", value)} />
                <Field label="Cooldown" hint="2–15 seconds" value={form.cooldown_seconds} min={2} max={15} step={1} suffix="sec" onChange={(value) => numeric("cooldown_seconds", value)} />
                <Field label="Flight speed" hint="Visual growth curve" value={form.growth_rate} min={0.03} max={0.5} step={0.005} suffix="rate" onChange={(value) => numeric("growth_rate", value)} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <WalletCards className="h-5 w-5 text-primary" />
                  Stake, payout and customer limits
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Minimum stake" hint="Smallest accepted bet" value={form.min_stake} min={0.01} max={100000} step={0.01} suffix="USD" onChange={(value) => numeric("min_stake", value)} />
                <Field label="Maximum stake" hint="Per customer, per round" value={form.max_stake} min={0.01} max={100000} step={0.01} suffix="USD" onChange={(value) => numeric("max_stake", value)} />
                <Field label="Maximum payout" hint="Per winning cash-out" value={form.max_payout} min={1} max={10000000} step={1} suffix="USD" onChange={(value) => numeric("max_payout", value)} />
                <Field label="Maximum multiplier" hint="Mathematical cap" value={form.max_multiplier} min={2} max={100000} step={1} suffix="x" onChange={(value) => numeric("max_multiplier", value)} />
                <Field label="Daily wager limit" hint="Per customer, rolling 24h" value={form.max_user_daily_wager} min={1} max={10000000} step={1} suffix="USD" onChange={(value) => numeric("max_user_daily_wager", value)} />
                <Field label="Daily loss limit" hint="Per customer, rolling 24h" value={form.max_user_daily_loss} min={1} max={10000000} step={1} suffix="USD" onChange={(value) => numeric("max_user_daily_loss", value)} />
                <Field label="Round bet capacity" hint="All customers combined" value={form.max_bets_per_round} min={1} max={100000} step={1} suffix="bets" onChange={(value) => numeric("max_bets_per_round", value)} />
                <Field label="Round exposure cap" hint="Maximum projected payout" value={form.max_round_exposure} min={1} max={100000000} step={1} suffix="USD" onChange={(value) => numeric("max_round_exposure", value)} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-primary" />
                  Automatic cash-out
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-3">
                <Toggle
                  title="Auto cash-out"
                  description="Allow customers to preselect a fair cash-out multiplier"
                  checked={form.auto_cashout_enabled}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      auto_cashout_enabled: value,
                    }))
                  }
                />
                <Field label="Minimum auto cash-out" hint="Lowest allowed target" value={form.min_auto_cashout} min={1.01} max={form.max_multiplier} step={0.01} suffix="x" onChange={(value) => numeric("min_auto_cashout", value)} />
                <Field label="Maximum auto cash-out" hint="Cannot exceed multiplier cap" value={form.max_auto_cashout} min={form.min_auto_cashout} max={form.max_multiplier} step={0.01} suffix="x" onChange={(value) => numeric("max_auto_cashout", value)} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  Fairness, alerts and player experience
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Statistical house edge" hint="Future rounds only" value={form.house_edge_percent} min={0} max={10} step={0.1} suffix="%" onChange={(value) => numeric("house_edge_percent", value)} />
                <Field label="Exposure alert" hint="Warn at percentage of cap" value={form.high_exposure_alert_percent} min={1} max={100} step={1} suffix="%" onChange={(value) => numeric("high_exposure_alert_percent", value)} />
                <Field label="Play reminder" hint="Responsible-play interval" value={form.reminder_minutes} min={5} max={240} step={5} suffix="min" onChange={(value) => numeric("reminder_minutes", value)} />
                <Toggle title="Dual approval" description="Sensitive saves require another super admin" checked={form.dual_approval_required} onChange={(value) => setForm((current) => ({ ...current, dual_approval_required: value }))} />
                <Toggle title="Low-data default" description="Reduce animation and polling by default" checked={form.low_data_mode_default} onChange={(value) => setForm((current) => ({ ...current, low_data_mode_default: value }))} />
                <Toggle title="Sound default" description="Default game sound preference" checked={form.sound_enabled_default} onChange={(value) => setForm((current) => ({ ...current, sound_enabled_default: value }))} />
                <Toggle title="Vibration default" description="Default mobile haptic preference" checked={form.vibration_enabled_default} onChange={(value) => setForm((current) => ({ ...current, vibration_enabled_default: value }))} />
                <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                  <div className="font-semibold">Outcome protection enforced</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    A fresh seed is generated and hash-committed before every round.
                    No control targets a customer, stake, active bet or active round.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BellRing className="h-5 w-5 text-primary" />
                  Open alerts
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(dashboard?.alerts || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No open Aviator alerts.</p>
                ) : (
                  dashboard?.alerts.map((alert) => (
                    <div key={alert.id} className="flex items-start justify-between gap-3 rounded-xl border p-3">
                      <div>
                        <Badge variant={alert.severity === "critical" ? "destructive" : "outline"}>
                          {alert.alert_type}
                        </Badge>
                        <p className="mt-2 text-sm font-semibold">{alert.message}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(alert.created_at).toLocaleString()}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => void acknowledgeAlert(alert.id)}>
                        Acknowledge
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-4">
            <Card className="sticky top-6 overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-emerald-400 via-cyan-400 to-fuchsia-500" />
              <CardHeader>
                <CardTitle>Publish configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Summary label="Round timing" value={form.betting_seconds + "s + " + form.cooldown_seconds + "s"} />
                <Summary label="Stake range" value={"$" + form.min_stake + " – $" + form.max_stake} />
                <Summary label="Round exposure" value={"$" + money(form.max_round_exposure)} />
                <Summary label="Daily wager" value={"$" + money(form.max_user_daily_wager)} />
                <Summary label="House edge" value={form.house_edge_percent + "%"} />
                <Summary label="Approval" value={form.dual_approval_required ? "Maker-checker" : "Immediate"} />
                <div>
                  <Label>Required audit reason</Label>
                  <Input
                    className="mt-2"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Why are these settings changing?"
                  />
                </div>
                <Button
                  className="h-12 w-full bg-gradient-to-r from-emerald-400 to-cyan-400 font-black text-slate-950"
                  onClick={() => void save()}
                  disabled={saving || reason.trim().length < 5}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? "Saving…" : "Save Aviator Settings"}
                </Button>
                <p className="text-center text-[10px] text-muted-foreground">
                  Changes are versioned, audit logged and apply only to future rounds.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <History className="h-4 w-4" />
                  Recent configuration history
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(dashboard?.versions || []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No versions recorded yet.</p>
                ) : (
                  dashboard?.versions.slice(0, 6).map((version) => (
                    <div key={version.id} className="border-b pb-3 last:border-0">
                      <p className="text-xs font-semibold">{version.reason}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {new Date(version.created_at).toLocaleString()}
                        {version.approved_by ? " · dual approved" : ""}
                      </p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </AdminLayout>
  );
}

function HeroStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur">
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-slate-400">
        {icon}
        {label}
      </div>
      <div className="mt-2 truncate text-sm font-black capitalize">{value}</div>
    </div>
  );
}

function Metric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <Card className={danger ? "border-rose-400/50" : ""}>
      <CardContent className="p-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className={danger ? "mt-2 font-mono text-xl font-black text-rose-400" : "mt-2 font-mono text-xl font-black"}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function Toggle({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border p-4">
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <Label>{label}</Label>
        <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>
      </div>
      <div className="relative">
        <Input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(event.target.value)}
          className="pr-14 font-mono font-bold"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted-foreground">
          {suffix}
        </span>
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  maxLength,
  onChange,
}: {
  label: string;
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        className="mt-2"
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/70 pb-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-bold">{value}</span>
    </div>
  );
}
