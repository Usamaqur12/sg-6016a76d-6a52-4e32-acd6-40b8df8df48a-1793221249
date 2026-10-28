import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Award, CheckCircle, Crown, Gift, Medal, Target, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type Mission = { id: string; name: string; description: string; metric: string; target_value: number; reward_points: number; progress: number; completed: boolean; claimed: boolean; ends_at: string };
type LeaderboardRow = { rank: number; display_name: string; points: number; tier: string; is_current: boolean };
type LoyaltyAccount = { points: number; lifetime_points: number; tier: string };

export default function RewardsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [loyalty, setLoyalty] = useState<LoyaltyAccount>({ points: 0, lifetime_points: 0, tier: "bronze" });
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);

  useEffect(() => { void initialize(); }, []);

  async function initialize() {
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) { await router.push("/auth/login"); return; }
    setUser(currentUser);
    const [{ data: currentProfile }, { data: account }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", currentUser.id).single(),
      (supabase as any).from("loyalty_accounts").select("points,lifetime_points,tier").eq("user_id", currentUser.id).maybeSingle(),
    ]);
    setProfile(currentProfile || null);
    if (account) setLoyalty(account as LoyaltyAccount);
    await loadRewards();
    setLoading(false);
  }

  async function loadRewards() {
    const [missionsResult, leaderboardResult, accountResult, flagsResult] = await Promise.all([
      (supabase as any).rpc("get_my_missions"),
      (supabase as any).rpc("get_public_leaderboard", { p_limit: 20 }),
      (supabase as any).from("loyalty_accounts").select("points,lifetime_points,tier").maybeSingle(),
      (supabase as any).from("feature_flags").select("key,is_enabled").in("key", ["missions", "leaderboards"]),
    ]);
    const flags = new Map(((flagsResult.data || []) as Array<{ key: string; is_enabled: boolean }>).map((flag) => [flag.key, flag.is_enabled]));
    setMissions(flags.get("missions") === false ? [] : (missionsResult.data || []) as Mission[]);
    setLeaderboard(flags.get("leaderboards") === false ? [] : (leaderboardResult.data || []) as LeaderboardRow[]);
    if (accountResult.data) setLoyalty(accountResult.data as LoyaltyAccount);
  }

  async function claimReward(mission: Mission) {
    setClaiming(mission.id);
    const { data, error } = await (supabase as any).rpc("claim_mission_reward", { p_mission_id: mission.id });
    if (error) toast({ title: "Reward not claimed", description: error.message, variant: "destructive" });
    else { toast({ title: `${Number(data?.points_awarded || mission.reward_points)} points added` }); await loadRewards(); }
    setClaiming(null);
  }

  return <div className="min-h-screen bg-background pb-14 lg:pb-0">
    <Header user={profile ? { email: user?.email || "", balance: Number(profile.demo_balance || 0) } : null} onAuthClick={() => router.push("/auth/login")} />
    <main className="container py-6">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><div className="mb-1 flex items-center gap-2 text-primary"><Gift className="h-5 w-5" /><span className="text-xs font-black uppercase tracking-[0.2em]">Rewards centre</span></div><h1 className="text-3xl font-black">Missions & leaderboard</h1><p className="mt-1 text-sm text-muted-foreground">Complete weekly play-money missions, collect loyalty points and climb the privacy-safe leaderboard.</p></div><Badge variant="outline" className="w-fit capitalize">{loyalty.tier} tier</Badge></div>
      <div className="mb-6 grid gap-4 sm:grid-cols-3"><Card className="surface border-primary/20"><CardContent className="flex items-center gap-4 p-5"><Award className="h-8 w-8 text-primary" /><div><p className="text-2xl font-black font-mono">{loyalty.points.toLocaleString()}</p><p className="text-xs text-muted-foreground">Available points</p></div></CardContent></Card><Card className="surface"><CardContent className="flex items-center gap-4 p-5"><Crown className="h-8 w-8 text-gold" /><div><p className="text-2xl font-black capitalize">{loyalty.tier}</p><p className="text-xs text-muted-foreground">Current tier</p></div></CardContent></Card><Card className="surface"><CardContent className="flex items-center gap-4 p-5"><Trophy className="h-8 w-8 text-warning" /><div><p className="text-2xl font-black font-mono">{loyalty.lifetime_points.toLocaleString()}</p><p className="text-xs text-muted-foreground">Lifetime points</p></div></CardContent></Card></div>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
        <Card className="surface"><CardHeader><CardTitle className="flex items-center gap-2"><Target className="h-5 w-5 text-primary" />Weekly missions</CardTitle><CardDescription>Progress is calculated from settled and placed demo bets in each mission window.</CardDescription></CardHeader><CardContent className="space-y-4">{loading ? <p className="text-sm text-muted-foreground">Loading missions…</p> : missions.length === 0 ? <p className="text-sm text-muted-foreground">No active missions right now.</p> : missions.map((mission) => { const percent = Math.min(100, Math.round((Number(mission.progress) / Math.max(Number(mission.target_value), 1)) * 100)); return <div key={mission.id} className="rounded-xl border border-border p-4"><div className="flex gap-3"><div className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-full ${mission.claimed ? "bg-success/10 text-success" : "bg-primary/10 text-primary"}`}>{mission.claimed ? <CheckCircle className="h-5 w-5" /> : <Target className="h-5 w-5" />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-bold">{mission.name}</p><p className="text-xs text-muted-foreground">{mission.description}</p></div><Badge variant="outline">+{mission.reward_points} pts</Badge></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-gradient-to-r from-primary to-primary-bright" style={{ width: `${percent}%` }} /></div><div className="mt-2 flex items-center justify-between text-xs"><span className="font-mono">{Number(mission.progress).toLocaleString()} / {Number(mission.target_value).toLocaleString()}</span>{mission.claimed ? <span className="font-semibold text-success">Claimed</span> : mission.completed ? <Button size="sm" onClick={() => void claimReward(mission)} disabled={claiming === mission.id}>{claiming === mission.id ? "Claiming…" : "Claim reward"}</Button> : <span className="text-muted-foreground">Ends {new Date(mission.ends_at).toLocaleDateString()}</span>}</div></div></div></div>; })}</CardContent></Card>
        <Card className="surface"><CardHeader><CardTitle className="flex items-center gap-2"><Medal className="h-5 w-5 text-gold" />Leaderboard</CardTitle><CardDescription>Names are masked to protect customer privacy.</CardDescription></CardHeader><CardContent className="space-y-2">{leaderboard.map((row) => <div key={`${row.rank}-${row.display_name}`} className={`grid grid-cols-[32px_1fr_auto] items-center gap-2 rounded-lg border p-3 ${row.is_current ? "border-primary bg-primary/5" : "border-border"}`}><span className={`font-mono text-sm font-black ${row.rank <= 3 ? "text-gold" : "text-muted-foreground"}`}>#{row.rank}</span><div><p className="text-sm font-semibold">{row.display_name}{row.is_current ? " · You" : ""}</p><p className="text-[10px] capitalize text-muted-foreground">{row.tier}</p></div><span className="font-mono text-sm font-bold">{row.points.toLocaleString()}</span></div>)}</CardContent></Card>
      </div>
    </main>
    <Footer /><MobileBottomNav />
  </div>;
}
