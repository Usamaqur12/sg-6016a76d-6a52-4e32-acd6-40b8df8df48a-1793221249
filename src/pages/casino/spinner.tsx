import { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck, Sparkles, Trophy, Wallet } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { getMyWalletBalances } from "@/services/walletService";
import { useToast } from "@/hooks/use-toast";

type SpinnerGame = {
  id: string;
  stake: number;
  segment_index: number;
  multiplier: number;
  payout: number;
  server_seed: string;
  server_seed_hash: string;
  client_seed: string;
  created_at: string;
};

type SpinnerSettings = {
  is_enabled: boolean;
  is_paused: boolean;
  maintenance_message: string;
  min_stake: number;
  max_stake: number;
  max_payout: number;
  max_user_daily_wager: number;
  theoretical_rtp: number;
};

type SpinnerState = {
  settings: SpinnerSettings;
  segments: number[];
  history: SpinnerGame[];
};

const DEFAULT_SEGMENTS = [
  0, 0.5, 1, 0, 1.5, 0.5, 0, 2,
  1, 0.5, 0, 1, 3, 0.5, 0, 1.5,
  1, 0, 5, 0.5, 1, 0, 1.5, 1,
];

const DEFAULT_SETTINGS: SpinnerSettings = {
  is_enabled: true,
  is_paused: false,
  maintenance_message: "Spinner is temporarily unavailable",
  min_stake: 1,
  max_stake: 500,
  max_payout: 100000,
  max_user_daily_wager: 10000,
  theoretical_rtp: 95.83,
};

const money = (value: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));

const usd = (value: number) => "$" + money(value);
const makeId = () => globalThis.crypto?.randomUUID?.() || "spinner-" + Date.now() + "-" + Math.random().toString(16).slice(2);
const segmentLabel = (value: number) => value === 0 ? "MISS" : Number(value).toFixed(value % 1 ? 1 : 0) + "x";

export default function SpinnerPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [state, setState] = useState<SpinnerState | null>(null);
  const [balance, setBalance] = useState(0);
  const [stake, setStake] = useState("10");
  const [lastStake, setLastStake] = useState("10");
  const [clientSeed, setClientSeed] = useState("");
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SpinnerGame | null>(null);
  const [verification, setVerification] = useState<"valid" | "invalid" | null>(null);
  const [loadError, setLoadError] = useState("");

  const settings = state?.settings || DEFAULT_SETTINGS;
  const segments = state?.segments?.length === 24 ? state.segments : DEFAULT_SEGMENTS;
  const history = state?.history || [];

  const loadBalance = useCallback(async () => {
    const wallet = await getMyWalletBalances();
    if (wallet.error) throw new Error(wallet.error);
    setBalance(Number(wallet.balances?.available || 0));
  }, []);

  const loadState = useCallback(async () => {
    const { data, error } = await (supabase as any).rpc("spinner_get_state");
    if (error) throw error;
    setState(data as SpinnerState);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoadError("");
      await Promise.all([loadState(), loadBalance()]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Spinner is unavailable.");
    }
  }, [loadBalance, loadState]);

  useEffect(() => {
    let mounted = true;
    setClientSeed(makeId());
    void supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      const next = data.user ? { id: data.user.id, email: data.user.email } : null;
      setUser(next);
      if (next) void refresh();
      else void loadState().catch(() => undefined);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user ? { id: session.user.id, email: session.user.email } : null;
      setUser(next);
      if (next) void refresh();
      else setBalance(0);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadState, refresh]);

  const wheelGradient = useMemo(() => {
    const colors = ["#0ea5e9", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#14b8a6"];
    return "conic-gradient(" + segments.map((_, index) => {
      const start = index * 15;
      const end = start + 15;
      const color = segments[index] === 0 ? "#172033" : colors[index % colors.length];
      return color + " " + start + "deg " + end + "deg";
    }).join(",") + ")";
  }, [segments]);

  const stats = useMemo(() => history.reduce(
    (total, game) => ({
      wager: total.wager + Number(game.stake || 0),
      payout: total.payout + Number(game.payout || 0),
      wins: total.wins + (Number(game.payout || 0) > 0 ? 1 : 0),
    }),
    { wager: 0, payout: 0, wins: 0 },
  ), [history]);

  function setClampedStake(value: number) {
    const next = Math.min(settings.max_stake, Math.max(settings.min_stake, value));
    setStake(next.toFixed(2).replace(/\.00$/, ""));
  }

  async function spin() {
    if (!user) {
      await router.push("/auth/login?returnTo=/casino/spinner");
      return;
    }
    if (!settings.is_enabled || settings.is_paused) {
      toast({ title: "Spinner is unavailable", description: settings.maintenance_message, variant: "destructive" });
      return;
    }
    const amount = Number(stake);
    if (!Number.isFinite(amount) || amount < settings.min_stake || amount > settings.max_stake) {
      toast({ title: "Invalid stake", description: "Enter " + usd(settings.min_stake) + " to " + usd(settings.max_stake) + ".", variant: "destructive" });
      return;
    }
    if (amount > balance) {
      toast({ title: "Insufficient balance", description: "Available: " + usd(balance), variant: "destructive" });
      return;
    }

    setSpinning(true);
    setResult(null);
    setVerification(null);
    const seed = clientSeed.trim() || makeId();
    const { data, error } = await (supabase as any).rpc("spinner_spin", {
      p_stake: Number(amount.toFixed(2)),
      p_client_seed: seed,
      p_idempotency_key: makeId(),
    });

    if (error) {
      toast({ title: "Spin failed", description: error.message, variant: "destructive" });
      setSpinning(false);
      return;
    }

    const payload = data as { game: SpinnerGame; state: SpinnerState };
    const game = payload.game;
    const segmentAngle = 360 / segments.length;
    const target = 360 - (game.segment_index * segmentAngle + segmentAngle / 2);
    setRotation((current) => Math.ceil(current / 360) * 360 + 2160 + target);
    setLastStake(String(amount));
    setClientSeed(seed);

    window.setTimeout(() => {
      setResult(game);
      setState(payload.state);
      setSpinning(false);
      void loadBalance();
      toast({
        title: game.multiplier > 0 ? segmentLabel(game.multiplier) + " winner" : "No win this spin",
        description: game.payout > 0 ? usd(game.payout) + " credited." : "Try another provably-fair spin.",
        variant: game.multiplier > 0 ? "default" : "destructive",
      });
    }, 4100);
  }

  async function verifyResult() {
    if (!result) return;
    const encoder = new TextEncoder();
    const seedDigest = await crypto.subtle.digest("SHA-256", encoder.encode(result.server_seed));
    const seedHash = Array.from(new Uint8Array(seedDigest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const outcomeDigest = await crypto.subtle.digest("SHA-256", encoder.encode(result.server_seed + ":" + result.client_seed));
    const derivedIndex = new DataView(outcomeDigest).getUint32(0, false) % 24;
    setVerification(seedHash === result.server_seed_hash && derivedIndex === result.segment_index ? "valid" : "invalid");
  }

  return (
    <>
      <Head>
        <title>MindBet Spinner | Provably Fair Wheel</title>
        <meta name="description" content="Spin the server-authoritative, provably-fair MindBet multiplier wheel." />
      </Head>
      <div className="min-h-screen bg-[#050912] pb-20 text-slate-100 lg:pb-0">
        <Header user={user ? { email: user.email || "", balance } : null} onAuthClick={() => void router.push("/auth/login?returnTo=/casino/spinner")} />

        <main className="container px-3 py-5 sm:px-4 sm:py-7">
          <div className="mx-auto max-w-6xl space-y-5">
            <section className="overflow-hidden rounded-3xl border border-fuchsia-400/20 bg-[radial-gradient(circle_at_top_left,rgba(168,85,247,.18),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(34,211,238,.14),transparent_35%),#0a1020] p-5 sm:p-7">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-400 via-violet-400 to-cyan-300 shadow-[0_0_35px_rgba(168,85,247,.35)]">
                    <Sparkles className="h-8 w-8 text-slate-950" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-3xl font-black">MindBet Spinner</h1>
                      <Badge className="bg-emerald-400/15 text-emerald-300">Provably Fair</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-400">Fixed 24-segment multiplier wheel · 95.83% theoretical RTP</p>
                  </div>
                </div>
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-5 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Funded balance</p>
                  <p className="mt-1 flex items-center gap-2 font-mono text-2xl font-black text-emerald-300"><Wallet className="h-5 w-5" />{usd(balance)}</p>
                </div>
              </div>
            </section>

            {loadError && (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4">
                <p className="text-sm text-rose-200">{loadError}</p>
                <Button variant="outline" size="sm" onClick={() => void refresh()}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>
              </div>
            )}

            {(!settings.is_enabled || settings.is_paused) && (
              <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-amber-100">
                <p className="font-bold">Spinner is paused</p>
                <p className="text-sm opacity-70">{settings.maintenance_message}</p>
              </div>
            )}

            <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
              <Card className="overflow-hidden border-slate-700/70 bg-[#091321] text-slate-100">
                <CardContent className="relative flex min-h-[420px] items-center justify-center p-5 sm:min-h-[620px]">
                  <div className="absolute top-5 z-20 h-0 w-0 border-x-[16px] border-t-[28px] border-x-transparent border-t-amber-300 drop-shadow-[0_4px_8px_rgba(251,191,36,.5)]" />
                  <div
                    className="relative aspect-square w-full max-w-[520px] rounded-full border-[10px] border-slate-800 shadow-[0_0_0_3px_rgba(255,255,255,.08),0_30px_90px_rgba(0,0,0,.55)] transition-transform duration-[4000ms] ease-[cubic-bezier(.12,.65,.12,1)]"
                    style={{ background: wheelGradient, transform: "rotate(" + rotation + "deg)" }}
                  >
                    {segments.map((value, index) => {
                      const angle = index * 15 + 7.5;
                      return (
                        <div key={index} className="pointer-events-none absolute left-1/2 top-1/2 h-1/2 w-12 -translate-x-1/2 -translate-y-full origin-bottom text-center" style={{ transform: "translate(-50%,-100%) rotate(" + angle + "deg)" }}>
                          <span className="mt-3 inline-block -rotate-90 rounded bg-black/25 px-1 py-0.5 font-mono text-[8px] font-black text-white sm:mt-5 sm:text-[10px]">{segmentLabel(value)}</span>
                        </div>
                      );
                    })}
                    <div className="absolute left-1/2 top-1/2 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-8 border-slate-800 bg-gradient-to-br from-fuchsia-400 to-cyan-300 shadow-xl">
                      {spinning ? <Loader2 className="h-10 w-10 animate-spin text-slate-950" /> : <Trophy className="h-10 w-10 text-slate-950" />}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-700/70 bg-[#0a1624] text-slate-100">
                <CardContent className="space-y-5 p-5">
                  <div>
                    <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Stake (USD)</label>
                    <Input className="mt-2 border-slate-700 bg-[#07111d] font-mono text-lg" type="number" inputMode="decimal" min={settings.min_stake} max={settings.max_stake} step="0.01" value={stake} disabled={spinning} onChange={(event) => setStake(event.target.value)} />
                    <div className="mt-2 grid grid-cols-4 gap-2">
                      <button disabled={spinning} onClick={() => setClampedStake(Number(stake || 0) / 2)} className="rounded-lg border border-slate-700 py-2 text-xs font-bold disabled:opacity-50">Half</button>
                      <button disabled={spinning} onClick={() => setClampedStake(Number(stake || 0) * 2)} className="rounded-lg border border-slate-700 py-2 text-xs font-bold disabled:opacity-50">Double</button>
                      <button disabled={spinning} onClick={() => setClampedStake(Math.min(balance, settings.max_stake))} className="rounded-lg border border-slate-700 py-2 text-xs font-bold disabled:opacity-50">Max</button>
                      <button disabled={spinning} onClick={() => setClampedStake(Number(lastStake))} className="rounded-lg border border-slate-700 py-2 text-xs font-bold disabled:opacity-50">Repeat</button>
                    </div>
                  </div>

                  <Button className="h-14 w-full bg-gradient-to-r from-fuchsia-400 via-violet-400 to-cyan-300 text-lg font-black text-slate-950" disabled={spinning || !settings.is_enabled || settings.is_paused} onClick={() => void spin()}>
                    {spinning ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" />Spinning…</> : <><Sparkles className="mr-2 h-5 w-5" />Spin Wheel</>}
                  </Button>

                  <div className="grid grid-cols-3 gap-2">
                    <Stat label="Wager" value={usd(stats.wager)} />
                    <Stat label="Payout" value={usd(stats.payout)} />
                    <Stat label="Net" value={usd(stats.payout - stats.wager)} positive={stats.payout - stats.wager >= 0} />
                  </div>

                  {result && (
                    <div className="rounded-2xl border border-fuchsia-400/20 bg-fuchsia-400/5 p-4 text-center">
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Last result</p>
                      <p className="mt-2 font-mono text-4xl font-black text-fuchsia-300">{segmentLabel(result.multiplier)}</p>
                      <p className="mt-1 text-sm text-slate-400">Payout {usd(result.payout)}</p>
                      <Button size="sm" variant="outline" className="mt-3 border-slate-700" onClick={() => void verifyResult()}><ShieldCheck className="mr-2 h-4 w-4" />Verify result</Button>
                      {verification === "valid" && <p className="mt-2 flex items-center justify-center gap-1 text-xs font-bold text-emerald-300"><CheckCircle2 className="h-4 w-4" />Seed and segment verified</p>}
                      {verification === "invalid" && <p className="mt-2 text-xs font-bold text-rose-300">Verification failed</p>}
                    </div>
                  )}

                  <p className="text-xs leading-relaxed text-slate-500">The result is generated and hash-committed on the server. The fixed paytable cannot be changed for a specific player or spin.</p>
                </CardContent>
              </Card>
            </div>

            <Card className="border-slate-700/70 bg-[#091321] text-slate-100">
              <CardContent className="p-5">
                <h2 className="text-lg font-black">Recent verified spins</h2>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {history.length === 0 ? (
                    <p className="text-sm text-slate-500">Your completed spins will appear here.</p>
                  ) : history.map((game) => (
                    <div key={game.id} className="flex items-center justify-between rounded-xl border border-slate-700 bg-[#050d17] p-3">
                      <div><p className="font-mono text-lg font-black">{segmentLabel(game.multiplier)}</p><p className="text-[10px] text-slate-500">{new Date(game.created_at).toLocaleString()}</p></div>
                      <div className="text-right"><p className="font-mono text-sm font-bold">{usd(game.payout)}</p><p className="text-[10px] text-slate-500">Stake {usd(game.stake)}</p></div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </main>

        <Footer />
        <MobileBottomNav />
      </div>
    </>
  );
}

function Stat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return <div className="rounded-xl border border-slate-700 bg-[#07111d] p-3 text-center"><p className="text-[9px] font-bold uppercase text-slate-500">{label}</p><p className={"mt-1 font-mono text-xs font-black " + (positive === undefined ? "" : positive ? "text-emerald-300" : "text-rose-300")}>{value}</p></div>;
}
