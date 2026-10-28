import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, AlertCircle, Flame, Lock, Pause, Play, Plus, RefreshCw, Save, Trash2, TrendingDown, TrendingUp, Unlock } from "lucide-react";
import { configureSportMargin, getExposureDashboard, manuallyUpdateOdds, toggleEventSuspension, toggleMarketSuspension, toggleOddsLock } from "@/services/tradingService";
import { canAccessAdminArea } from "@/lib/adminRoles";
import { useToast } from "@/hooks/use-toast";

interface EventControl { id: string; home_team: string; away_team: string; start_time: string; status: string | null; is_suspended: boolean; }
interface MarketControl { id: string; event_id: string; name: string; status: string | null; }
interface OddsControl { id: string; market_id: string; selection: string; value: number; is_locked: boolean; is_active: boolean | null; }
interface SportControl { id: string; name: string; slug: string; }
interface EarlyPayoutRule { id: string; name: string; sport_slug: string; market_type: string; minimum_lead: number; minimum_minute: number; is_enabled: boolean; }
interface OddsHistory { id: string; odds_id: string; old_value: number; new_value: number; change_reason: string | null; created_at: string; }
interface Dashboard { totalTurnover: number; totalLiability: number; maxPotentialPayout: number; suspendedMarketsCount: number; highRiskEvents: Array<{ event_id: string; total_liability: number; risk_level: string; events?: { home_team: string; away_team: string } }>; }

export default function TradingControlCenter() {
  const router = useRouter();
  const { toast } = useToast();
  const [adminId, setAdminId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [events, setEvents] = useState<EventControl[]>([]);
  const [markets, setMarkets] = useState<MarketControl[]>([]);
  const [odds, setOdds] = useState<OddsControl[]>([]);
  const [sports, setSports] = useState<SportControl[]>([]);
  const [oddsDrafts, setOddsDrafts] = useState<Record<string, string>>({});
  const [sportId, setSportId] = useState("");
  const [margin, setMargin] = useState("5");
  const [earlyRules, setEarlyRules] = useState<EarlyPayoutRule[]>([]);
  const [oddsHistory, setOddsHistory] = useState<OddsHistory[]>([]);
  const [earlyDraft, setEarlyDraft] = useState({ name: "Football two-goal lead", sportSlug: "football", minimumLead: "2", minimumMinute: "75", enabled: false });

  useEffect(() => { void initialize(); }, []);

  async function initialize() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { await router.push("/admin/login"); return; }
    const { data: profile } = await supabase.from("profiles").select("admin_role").eq("id", user.id).single();
    if (!profile || !canAccessAdminArea(profile.admin_role, "trading")) { await router.push("/"); return; }
    setAdminId(user.id);
    await loadData();
  }

  async function loadData() {
    setLoading(true);
    const [dashboardResult, eventsResult, marketsResult, oddsResult, sportsResult, earlyResult, historyResult] = await Promise.all([
      getExposureDashboard(),
      supabase.from("events").select("id, home_team, away_team, start_time, status, is_suspended").in("status", ["upcoming", "live"]).order("start_time").limit(100),
      supabase.from("markets").select("id, event_id, name, status").in("status", ["active", "suspended"]).limit(300),
      supabase.from("odds").select("id, market_id, selection, value, is_locked, is_active").eq("is_active", true).limit(500),
      supabase.from("sports").select("id, name, slug").eq("is_active", true).order("display_order"),
      (supabase as any).from("early_payout_rules").select("*").order("created_at", { ascending: false }),
      (supabase as any).from("odds_history").select("*").order("created_at", { ascending: false }).limit(100),
    ]);
    if (dashboardResult.success) setDashboard(dashboardResult.dashboard as Dashboard);
    if (eventsResult.error || marketsResult.error || oddsResult.error || sportsResult.error || earlyResult.error || historyResult.error) {
      const error = eventsResult.error || marketsResult.error || oddsResult.error || sportsResult.error || earlyResult.error || historyResult.error;
      toast({ title: "Trading data load failed", description: error?.message, variant: "destructive" });
    }
    setEvents((eventsResult.data || []) as EventControl[]);
    setMarkets((marketsResult.data || []) as MarketControl[]);
    setOdds((oddsResult.data || []) as OddsControl[]);
    setSports((sportsResult.data || []) as SportControl[]);
    setEarlyRules((earlyResult.data || []) as EarlyPayoutRule[]);
    setOddsHistory((historyResult.data || []) as OddsHistory[]);
    if (!sportId && sportsResult.data?.[0]) setSportId(sportsResult.data[0].id);
    setLoading(false);
  }

  const eventNames = useMemo(() => new Map(events.map((event) => [event.id, `${event.home_team} vs ${event.away_team}`])), [events]);
  const marketNames = useMemo(() => new Map(markets.map((market) => [market.id, `${eventNames.get(market.event_id) || "Unknown event"} · ${market.name}`])), [markets, eventNames]);
  const latestMovement = useMemo(() => new Map(oddsHistory.map((entry) => [entry.odds_id, entry])), [oddsHistory]);
  const maximumLiability = Math.max(...(dashboard?.highRiskEvents || []).map((row) => Number(row.total_liability || 0)), 1);

  async function switchEvent(event: EventControl) {
    if (!adminId) return;
    setProcessing(event.id);
    const result = await toggleEventSuspension(event.id, !event.is_suspended, adminId, "Manual trading control");
    if (!result.success) toast({ title: "Event update failed", description: result.error, variant: "destructive" });
    else setEvents((current) => current.map((item) => item.id === event.id ? { ...item, is_suspended: !item.is_suspended } : item));
    setProcessing(null);
  }

  async function switchMarket(market: MarketControl) {
    if (!adminId) return;
    const suspend = market.status !== "suspended";
    setProcessing(market.id);
    const result = await toggleMarketSuspension(market.id, suspend, adminId, "Manual trading control");
    if (!result.success) toast({ title: "Market update failed", description: result.error, variant: "destructive" });
    else setMarkets((current) => current.map((item) => item.id === market.id ? { ...item, status: suspend ? "suspended" : "active" } : item));
    setProcessing(null);
  }

  async function switchOddsLock(item: OddsControl) {
    if (!adminId) return;
    setProcessing(item.id);
    const result = await toggleOddsLock(item.id, !item.is_locked, adminId, "Manual trading control");
    if (!result.success) toast({ title: "Odds lock failed", description: result.error, variant: "destructive" });
    else setOdds((current) => current.map((odd) => odd.id === item.id ? { ...odd, is_locked: !odd.is_locked } : odd));
    setProcessing(null);
  }

  async function saveOdds(item: OddsControl) {
    if (!adminId) return;
    const value = Number(oddsDrafts[item.id] ?? item.value);
    if (!Number.isFinite(value) || value <= 1.01) { toast({ title: "Odds must be greater than 1.01", variant: "destructive" }); return; }
    setProcessing(item.id);
    const result = await manuallyUpdateOdds(item.id, value, adminId, "Manual trading price update");
    if (!result.success) toast({ title: "Odds update failed", description: result.error, variant: "destructive" });
    else { setOdds((current) => current.map((odd) => odd.id === item.id ? { ...odd, value } : odd)); setOddsDrafts((current) => ({ ...current, [item.id]: String(value) })); toast({ title: "Odds updated" }); }
    setProcessing(null);
  }

  async function saveMargin() {
    if (!adminId || !sportId) return;
    const value = Number(margin);
    if (!Number.isFinite(value) || value < 0 || value > 50) { toast({ title: "Margin must be between 0 and 50%", variant: "destructive" }); return; }
    setProcessing("margin");
    const result = await configureSportMargin(sportId, value, adminId);
    if (!result.success) toast({ title: "Margin update failed", description: result.error, variant: "destructive" });
    else toast({ title: "Sport margin updated" });
    setProcessing(null);
  }

  async function saveEarlyRule(rule?: EarlyPayoutRule, enabledOverride?: boolean) {
    const values = rule ? { name: rule.name, sportSlug: rule.sport_slug, minimumLead: String(rule.minimum_lead), minimumMinute: String(rule.minimum_minute), enabled: enabledOverride ?? rule.is_enabled } : earlyDraft;
    const lead = Number(values.minimumLead); const minute = Number(values.minimumMinute);
    if (values.name.trim().length < 3 || !values.sportSlug || !Number.isInteger(lead) || lead < 1 || !Number.isInteger(minute) || minute < 1) { toast({ title: "Enter a valid rule name, lead and minute", variant: "destructive" }); return; }
    setProcessing(rule?.id || "early-new");
    const { error } = await (supabase as any).rpc("save_early_payout_rule", { p_id: rule?.id || null, p_name: values.name.trim(), p_sport_slug: values.sportSlug, p_market_type: "match_result", p_minimum_lead: lead, p_minimum_minute: minute, p_is_enabled: values.enabled });
    if (error) toast({ title: "Early-payout rule save failed", description: error.message, variant: "destructive" });
    else { toast({ title: rule ? "Early-payout rule updated" : "Early-payout rule added" }); await loadData(); }
    setProcessing(null);
  }

  async function deleteEarlyRule(rule: EarlyPayoutRule) {
    if (!window.confirm(`Remove ${rule.name}? Historical awards will be preserved.`)) return;
    setProcessing(rule.id);
    const { error } = await (supabase as any).rpc("delete_early_payout_rule", { p_id: rule.id });
    if (error) toast({ title: "Rule could not be removed", description: error.message, variant: "destructive" }); else await loadData();
    setProcessing(null);
  }

  if (loading && !dashboard) return <div className="flex items-center justify-center min-h-screen">Loading trading controls…</div>;

  return (
    <AdminLayout><div className="p-2 sm:p-6 space-y-6">
      <div className="flex items-center justify-between gap-4"><div><h1 className="text-3xl font-bold">Trading Control Center</h1><p className="text-muted-foreground mt-1">Suspend inventory, lock prices and manage margin</p></div><Button variant="outline" onClick={() => void loadData()} disabled={loading}><RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />Refresh</Button></div>
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Pending Turnover</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{dashboard?.totalTurnover?.toFixed(2) || "0.00"}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Liability</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-warning">{dashboard?.totalLiability?.toFixed(2) || "0.00"}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Max Payout</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-danger">{dashboard?.maxPotentialPayout?.toFixed(2) || "0.00"}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Suspended Markets</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{dashboard?.suspendedMarketsCount || 0}</div></CardContent></Card>
      </div>

      {!!dashboard?.highRiskEvents?.length && <Card><CardHeader><CardTitle className="flex items-center gap-2"><AlertCircle className="h-5 w-5 text-danger" />High-Risk Events</CardTitle></CardHeader><CardContent className="space-y-2">{dashboard.highRiskEvents.map((row) => <div key={row.event_id} className="flex items-center justify-between border border-border rounded p-3"><div><div className="font-medium">{row.events ? `${row.events.home_team} vs ${row.events.away_team}` : row.event_id}</div><div className="text-sm text-muted-foreground">Liability {row.total_liability.toFixed(2)}</div></div><Badge variant={row.risk_level === "critical" ? "destructive" : "outline"}>{row.risk_level}</Badge></div>)}</CardContent></Card>}

      <Tabs defaultValue="events" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap"><TabsTrigger value="events">Events</TabsTrigger><TabsTrigger value="markets">Markets</TabsTrigger><TabsTrigger value="odds">Odds</TabsTrigger><TabsTrigger value="risk">Risk heatmap</TabsTrigger><TabsTrigger value="margins">Margins</TabsTrigger><TabsTrigger value="early">Early payout</TabsTrigger></TabsList>
        <TabsContent value="events"><Card><CardHeader><CardTitle>Event Control</CardTitle><CardDescription>Suspending an event blocks all new selections in the atomic betting function.</CardDescription></CardHeader><CardContent className="space-y-2">{events.length === 0 ? <p className="text-sm text-muted-foreground">No active events.</p> : events.map((event) => <div key={event.id} className="flex items-center justify-between gap-4 border border-border rounded p-3"><div><div className="font-medium">{event.home_team} vs {event.away_team}</div><div className="text-xs text-muted-foreground">{event.status} · {new Date(event.start_time).toLocaleString()}</div></div><Button size="sm" variant={event.is_suspended ? "default" : "outline"} onClick={() => void switchEvent(event)} disabled={processing === event.id}>{event.is_suspended ? <Play className="h-4 w-4 mr-2" /> : <Pause className="h-4 w-4 mr-2" />}{event.is_suspended ? "Resume" : "Suspend"}</Button></div>)}</CardContent></Card></TabsContent>
        <TabsContent value="markets"><Card><CardHeader><CardTitle>Market Control</CardTitle><CardDescription>Resume or suspend individual markets.</CardDescription></CardHeader><CardContent className="space-y-2">{markets.length === 0 ? <p className="text-sm text-muted-foreground">No markets.</p> : markets.map((market) => <div key={market.id} className="flex items-center justify-between gap-4 border border-border rounded p-3"><div><div className="font-medium">{market.name}</div><div className="text-xs text-muted-foreground">{eventNames.get(market.event_id) || market.event_id}</div></div><Button size="sm" variant={market.status === "suspended" ? "default" : "outline"} onClick={() => void switchMarket(market)} disabled={processing === market.id}>{market.status === "suspended" ? "Resume" : "Suspend"}</Button></div>)}</CardContent></Card></TabsContent>
        <TabsContent value="odds"><Card><CardHeader><CardTitle>Odds Management</CardTitle><CardDescription>Manual changes are written to odds history and audit logs. The movement indicator compares the most recent recorded price.</CardDescription></CardHeader><CardContent className="space-y-2">{odds.length === 0 ? <p className="text-sm text-muted-foreground">No active odds.</p> : odds.map((item) => { const movement = latestMovement.get(item.id); const change = movement ? Number(movement.new_value) - Number(movement.old_value) : 0; return <div key={item.id} className="grid gap-3 sm:grid-cols-[1fr_90px_110px_auto_auto] sm:items-center border border-border rounded p-3"><div><div className="font-medium">{item.selection}</div><div className="text-xs text-muted-foreground line-clamp-1">{marketNames.get(item.market_id) || item.market_id}</div></div><div className={`flex items-center gap-1 text-xs font-mono ${change > 0 ? "text-success" : change < 0 ? "text-danger" : "text-muted-foreground"}`}>{change > 0 ? <TrendingUp className="h-4 w-4" /> : change < 0 ? <TrendingDown className="h-4 w-4" /> : <Activity className="h-4 w-4" />}{change ? `${change > 0 ? "+" : ""}${change.toFixed(2)}` : "stable"}</div><Input type="number" min="1.02" step="0.01" value={oddsDrafts[item.id] ?? String(item.value)} onChange={(event) => setOddsDrafts((current) => ({ ...current, [item.id]: event.target.value }))} disabled={item.is_locked} /><Button size="sm" onClick={() => void saveOdds(item)} disabled={processing === item.id || item.is_locked}><Save className="h-4 w-4 mr-2" />Save</Button><Button size="sm" variant="outline" onClick={() => void switchOddsLock(item)} disabled={processing === item.id}>{item.is_locked ? <Unlock className="h-4 w-4 mr-2" /> : <Lock className="h-4 w-4 mr-2" />}{item.is_locked ? "Unlock" : "Lock"}</Button></div>; })}</CardContent></Card></TabsContent>
        <TabsContent value="risk"><Card><CardHeader><CardTitle className="flex items-center gap-2"><Flame className="h-5 w-5 text-danger" />Liability heatmap</CardTitle><CardDescription>Darker rows indicate a larger share of current high-risk liability. Prioritize those events for price review or suspension.</CardDescription></CardHeader><CardContent>{!dashboard?.highRiskEvents?.length ? <p className="text-sm text-muted-foreground">No high-risk event exposure.</p> : <div className="grid gap-3 md:grid-cols-2">{dashboard.highRiskEvents.map((row) => { const intensity = Math.max(12, Math.round((Number(row.total_liability || 0) / maximumLiability) * 100)); const event = events.find((item) => item.id === row.event_id); return <div key={row.event_id} className="relative overflow-hidden rounded-xl border border-danger/20 p-4"><div className="absolute inset-y-0 left-0 bg-danger/15" style={{ width: `${intensity}%` }} /><div className="relative"><div className="flex items-start justify-between gap-3"><div><p className="font-bold">{row.events ? `${row.events.home_team} vs ${row.events.away_team}` : eventNames.get(row.event_id) || row.event_id}</p><p className="mt-1 text-xs text-muted-foreground">Liability share {intensity}% · {Number(row.total_liability).toFixed(2)}</p></div><Badge variant={row.risk_level === "critical" ? "destructive" : "outline"}>{row.risk_level}</Badge></div>{event && <Button className="mt-4" size="sm" variant={event.is_suspended ? "outline" : "destructive"} onClick={() => void switchEvent(event)} disabled={processing === event.id}>{event.is_suspended ? "Resume event" : "Suspend event"}</Button>}</div></div>; })}</div>}</CardContent></Card></TabsContent>
        <TabsContent value="margins"><Card><CardHeader><CardTitle>Sport Margin</CardTitle><CardDescription>Configure the default trading margin for a sport.</CardDescription></CardHeader><CardContent className="grid gap-4 max-w-lg"><div className="grid gap-2"><Label>Sport</Label><Select value={sportId} onValueChange={setSportId}><SelectTrigger><SelectValue placeholder="Select sport" /></SelectTrigger><SelectContent>{sports.map((sport) => <SelectItem key={sport.id} value={sport.id}>{sport.name}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label>Margin (%)</Label><Input type="number" min="0" max="50" step="0.1" value={margin} onChange={(event) => setMargin(event.target.value)} /></div><Button onClick={() => void saveMargin()} disabled={processing === "margin"}>{processing === "margin" ? "Saving…" : "Update margin"}</Button></CardContent></Card></TabsContent>
        <TabsContent value="early" className="space-y-4"><Card><CardHeader><CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" />Add early-payout rule</CardTitle><CardDescription>A trusted live feed must supply both score and match minute. New rules start disabled by default.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-5"><label className="space-y-2 lg:col-span-2"><Label>Rule name</Label><Input value={earlyDraft.name} onChange={(event) => setEarlyDraft((current) => ({ ...current, name: event.target.value }))} /></label><label className="space-y-2"><Label>Sport</Label><select className="h-10 w-full rounded border border-input bg-background px-3 text-sm" value={earlyDraft.sportSlug} onChange={(event) => setEarlyDraft((current) => ({ ...current, sportSlug: event.target.value }))}>{sports.map((sport) => <option key={sport.id} value={sport.slug}>{sport.name}</option>)}</select></label><label className="space-y-2"><Label>Minimum lead</Label><Input type="number" min="1" max="20" value={earlyDraft.minimumLead} onChange={(event) => setEarlyDraft((current) => ({ ...current, minimumLead: event.target.value }))} /></label><label className="space-y-2"><Label>Minimum minute</Label><Input type="number" min="1" max="200" value={earlyDraft.minimumMinute} onChange={(event) => setEarlyDraft((current) => ({ ...current, minimumMinute: event.target.value }))} /></label><label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" checked={earlyDraft.enabled} onChange={(event) => setEarlyDraft((current) => ({ ...current, enabled: event.target.checked }))} />Enable immediately</label><Button className="w-fit" onClick={() => void saveEarlyRule()} disabled={processing === "early-new"}>{processing === "early-new" ? "Saving…" : "Add rule"}</Button></CardContent></Card><Card><CardHeader><CardTitle>Configured rules</CardTitle><CardDescription>When the threshold is reached, qualifying match-result selections are permanently marked won.</CardDescription></CardHeader><CardContent className="space-y-3">{earlyRules.length === 0 ? <p className="text-sm text-muted-foreground">No early-payout rules configured.</p> : earlyRules.map((rule) => <div key={rule.id} className="flex flex-col gap-3 rounded border border-border p-4 lg:flex-row lg:items-center"><div className="flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{rule.name}</span><Badge variant={rule.is_enabled ? "default" : "outline"}>{rule.is_enabled ? "Enabled" : "Disabled"}</Badge></div><p className="mt-1 text-xs text-muted-foreground capitalize">{rule.sport_slug} · {rule.market_type.replaceAll("_", " ")} · lead by {rule.minimum_lead} after minute {rule.minimum_minute}</p></div><div className="flex gap-2"><Button size="sm" variant={rule.is_enabled ? "outline" : "default"} disabled={processing === rule.id} onClick={() => void saveEarlyRule(rule,!rule.is_enabled)}>{rule.is_enabled ? "Disable" : "Enable"}</Button><Button size="sm" variant="destructive" disabled={processing === rule.id} onClick={() => void deleteEarlyRule(rule)}><Trash2 className="mr-1 h-3.5 w-3.5" />Remove</Button></div></div>)}</CardContent></Card></TabsContent>
      </Tabs>
    </div></AdminLayout>
  );
}
