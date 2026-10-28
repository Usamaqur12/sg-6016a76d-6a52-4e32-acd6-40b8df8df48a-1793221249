import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { supabase } from "@/integrations/supabase/client";
import {
  getUserResponsibleGamingSettings,
  setResponsibleGamingLimit,
  setSelfExclusion,
} from "@/services/responsibleGamingService";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Ban, Clock, ShieldCheck } from "lucide-react";

type LimitType = "daily_stake" | "weekly_stake" | "monthly_stake";
interface ActiveLimit { id: string; limit_type: string; limit_value: number; current_usage: number | null; period_end: string; }
interface ActiveExclusion { exclusion_type: string; end_date: string | null; }

export default function ResponsiblePlaySettings() {
  const router = useRouter();
  const { toast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [balance, setBalance] = useState(0);
  const [limits, setLimits] = useState<ActiveLimit[]>([]);
  const [exclusion, setExclusion] = useState<ActiveExclusion | null>(null);
  const [values, setValues] = useState<Record<LimitType, string>>({ daily_stake: "", weekly_stake: "", monthly_stake: "" });
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { void initialize(); }, []);

  async function initialize() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { await router.push("/auth/login"); return; }
    setUserId(user.id);
    setEmail(user.email || "");
    const { data: profile } = await supabase.from("profiles").select("demo_balance").eq("id", user.id).single();
    setBalance(Number(profile?.demo_balance || 0));
    await loadSettings(user.id);
  }

  async function loadSettings(id = userId) {
    if (!id) return;
    setLoading(true);
    const result = await getUserResponsibleGamingSettings(id);
    if (!result.success) toast({ title: "Could not load controls", description: result.error, variant: "destructive" });
    else {
      setLimits((result.limits || []) as ActiveLimit[]);
      setExclusion((result.exclusion || null) as ActiveExclusion | null);
    }
    setLoading(false);
  }

  async function saveLimit(type: LimitType) {
    if (!userId) return;
    const amount = Number(values[type]);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Enter a valid positive limit", variant: "destructive" });
      return;
    }
    setSaving(type);
    const result = await setResponsibleGamingLimit(userId, type, amount);
    if (!result.success) toast({ title: "Limit not saved", description: result.error, variant: "destructive" });
    else { toast({ title: "Limit saved", description: "Active limits can be reduced immediately but cannot be increased until the period ends." }); setValues((current) => ({ ...current, [type]: "" })); await loadSettings(userId); }
    setSaving(null);
  }

  async function activateExclusion(type: "timeout" | "self_exclusion" | "permanent", days?: number) {
    if (!userId) return;
    const description = type === "permanent" ? "permanently" : `for ${days} days`;
    if (!window.confirm(`This will block betting ${description}. It cannot be ended early. Continue?`)) return;
    setSaving(type);
    const result = await setSelfExclusion(userId, type, days, "User requested from responsible-play controls");
    if (!result.success) toast({ title: "Self-exclusion failed", description: result.error, variant: "destructive" });
    else { toast({ title: "Self-exclusion activated", description: `Betting is blocked ${description}.` }); await loadSettings(userId); }
    setSaving(null);
  }

  const labelFor = (type: LimitType) => type === "daily_stake" ? "Daily stake limit" : type === "weekly_stake" ? "Weekly stake limit" : "Monthly stake limit";

  return (
    <div className="min-h-screen flex flex-col bg-background pb-14 lg:pb-0">
      <Header user={{ email, balance }} onAuthClick={() => router.push("/auth/login")} />
      <main className="flex-1 container py-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <Link href="/account/settings"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-2" />Back to settings</Button></Link>
          <div><h1 className="text-2xl font-bold">Responsible Play Controls</h1><p className="text-sm text-muted-foreground mt-1">Set binding stake limits or block betting access.</p></div>

          {exclusion && <Card className="border-danger/40"><CardContent className="p-5 flex items-start gap-3"><Ban className="h-5 w-5 text-danger mt-0.5" /><div><div className="font-semibold">Self-exclusion active</div><p className="text-sm text-muted-foreground">Type: {exclusion.exclusion_type.replaceAll("_", " ")} · End: {exclusion.end_date ? new Date(exclusion.end_date).toLocaleString() : "Permanent"}</p></div></CardContent></Card>}

          <Card className="surface">
            <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" />Stake limits</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              {loading ? <p className="text-sm text-muted-foreground">Loading controls…</p> : (["daily_stake", "weekly_stake", "monthly_stake"] as LimitType[]).map((type) => {
                const active = limits.find((limit) => limit.limit_type === type);
                return <div key={type} className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end border-b border-border pb-5 last:border-0 last:pb-0"><div><Label>{labelFor(type)}</Label>{active ? <div className="text-xs text-muted-foreground mt-2">Used {Number(active.current_usage || 0).toFixed(2)} of {Number(active.limit_value).toFixed(2)} <Badge variant="outline" className="ml-2">Active</Badge><br />Resets {new Date(active.period_end).toLocaleString()}</div> : <p className="text-xs text-muted-foreground mt-2">No active limit</p>}</div><Input type="number" min="1" step="1" value={values[type]} onChange={(event) => setValues((current) => ({ ...current, [type]: event.target.value }))} placeholder="Amount" /><Button onClick={() => void saveLimit(type)} disabled={saving === type}>{saving === type ? "Saving…" : "Set limit"}</Button></div>;
              })}
            </CardContent>
          </Card>

          <Card className="surface border-warning/30">
            <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5 text-warning" />Time-out and self-exclusion</CardTitle></CardHeader>
            <CardContent><p className="text-sm text-muted-foreground mb-4">These controls take effect immediately and cannot be cancelled early. Account login may remain available for support and account history, but new bets are blocked.</p><div className="flex flex-wrap gap-3"><Button variant="outline" onClick={() => void activateExclusion("timeout", 1)} disabled={!!saving || !!exclusion}>24-hour timeout</Button><Button variant="outline" onClick={() => void activateExclusion("timeout", 7)} disabled={!!saving || !!exclusion}>7-day timeout</Button><Button variant="destructive" onClick={() => void activateExclusion("self_exclusion", 180)} disabled={!!saving || !!exclusion}>6-month exclusion</Button><Button variant="destructive" onClick={() => void activateExclusion("permanent")} disabled={!!saving || !!exclusion}>Permanent exclusion</Button></div></CardContent>
          </Card>
        </div>
      </main>
      <Footer />
      <MobileBottomNav />
    </div>
  );
}
