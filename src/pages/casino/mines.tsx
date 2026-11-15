import { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import {
  AlertTriangle,
  Bomb,
  CheckCircle2,
  Dice5,
  Gem,
  Loader2,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
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

type MinesGame = {
  id: string;
  stake: number;
  mine_count: number;
  revealed_cells: number[];
  mine_positions: number[];
  current_multiplier: number;
  potential_payout: number;
  payout: number;
  status: "active" | "lost" | "cashed_out";
  server_seed_hash: string;
  server_seed: string | null;
  client_seed: string;
  created_at: string;
  completed_at: string | null;
};

type MinesSettings = {
  min_stake: number;
  max_stake: number;
  min_mines: number;
  max_mines: number;
  max_payout: number;
};

type MinesState = {
  game: MinesGame | null;
  settings: MinesSettings;
};

const DEFAULT_SETTINGS: MinesSettings = {
  min_stake: 1,
  max_stake: 500,
  min_mines: 3,
  max_mines: 10,
  max_payout: 100000,
};

const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);

const formatUsd = (value: number) => `$${money(value)}`;

function makeId(prefix = "mindbet") {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function calculateMultiplier(mines: number, safePicks: number) {
  if (safePicks <= 0) return 1;
  let multiplier = 1;
  for (let index = 0; index < safePicks; index += 1) {
    multiplier *= (25 - index) / (25 - mines - index);
  }
  return Math.max(1.01, Math.floor(multiplier * 0.99 * 100) / 100);
}

export default function MinesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [state, setState] = useState<MinesState | null>(null);
  const [balance, setBalance] = useState(0);
  const [stake, setStake] = useState("10");
  const [mineCount, setMineCount] = useState(DEFAULT_SETTINGS.min_mines);
  const [clientSeed, setClientSeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [verification, setVerification] = useState<"valid" | "invalid" | null>(null);

  const settings = state?.settings || DEFAULT_SETTINGS;

  const loadBalance = useCallback(async () => {
    const result = await getMyWalletBalances();
    if (result.error) throw new Error(result.error);
    setBalance(Number(result.balances?.available || 0));
  }, []);

  const loadState = useCallback(async () => {
    const { data, error } = await (supabase as any).rpc("mines_get_state", {});
    if (error) throw error;
    if (!data) throw new Error("Mines did not return a game state.");
    const nextState = data as MinesState;
    setState(nextState);
    if (nextState.game?.status === "active") {
      setStake(String(nextState.game.stake));
      setMineCount(nextState.game.mine_count);
      setClientSeed(nextState.game.client_seed);
    }
  }, []);

  const refreshGame = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      await Promise.all([loadBalance(), loadState()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mines is temporarily unavailable.";
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [loadBalance, loadState]);

  useEffect(() => {
    let mounted = true;
    setClientSeed(makeId("mindbet"));

    const applySession = async (sessionUser: { id: string; email?: string } | null) => {
      if (!mounted) return;
      setUser(sessionUser);
      if (!sessionUser) {
        setState({ game: null, settings: DEFAULT_SETTINGS });
        setBalance(0);
        setLoading(false);
        setLoadError(null);
        return;
      }
      await refreshGame();
    };

    void supabase.auth.getUser().then(({ data }) =>
      applySession(data.user ? { id: data.user.id, email: data.user.email } : null),
    );

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(
        session?.user ? { id: session.user.id, email: session.user.email } : null,
      );
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [refreshGame]);

  const game = state?.game;
  const active = game?.status === "active";
  const revealed = useMemo(() => new Set(game?.revealed_cells || []), [game?.revealed_cells]);
  const mines = useMemo(() => new Set(game?.mine_positions || []), [game?.mine_positions]);

  const mineOptions = useMemo(() => {
    const preferred = [3, 5, 7, 10].filter(
      (value) => value >= settings.min_mines && value <= settings.max_mines,
    );
    if (!preferred.includes(settings.min_mines)) preferred.unshift(settings.min_mines);
    if (!preferred.includes(settings.max_mines)) preferred.push(settings.max_mines);
    return [...new Set(preferred)].sort((a, b) => a - b);
  }, [settings.max_mines, settings.min_mines]);

  const quickStakes = useMemo(() => {
    const candidates = [settings.min_stake, 5, 10, 25, 50, settings.max_stake];
    return [...new Set(candidates)]
      .filter((value) => value >= settings.min_stake && value <= settings.max_stake)
      .slice(0, 5);
  }, [settings.max_stake, settings.min_stake]);

  const safeTiles = 25 - (game?.mine_count || mineCount);
  const openedTiles = game?.revealed_cells.length || 0;
  const nextMultiplier = active
    ? calculateMultiplier(game.mine_count, Math.min(openedTiles + 1, safeTiles))
    : calculateMultiplier(mineCount, 1);
  const nextPayout = Math.min(
    settings.max_payout,
    Number(game?.stake || stake || 0) * nextMultiplier,
  );

  async function startGame() {
    if (!user) {
      await router.push("/auth/login?returnTo=/casino/mines");
      return;
    }

    const amount = Number(stake);
    if (
      !Number.isFinite(amount) ||
      amount < settings.min_stake ||
      amount > settings.max_stake
    ) {
      toast({
        title: "Invalid stake",
        description: `Stake must be between ${formatUsd(settings.min_stake)} and ${formatUsd(settings.max_stake)}.`,
        variant: "destructive",
      });
      return;
    }
    if (amount > balance) {
      toast({
        title: "Insufficient balance",
        description: `Your available balance is ${formatUsd(balance)}.`,
        variant: "destructive",
      });
      return;
    }
    if (mineCount < settings.min_mines || mineCount > settings.max_mines) {
      toast({
        title: "Invalid mine count",
        description: `Choose ${settings.min_mines} to ${settings.max_mines} mines.`,
        variant: "destructive",
      });
      return;
    }

    const seed = clientSeed.trim() || makeId("mindbet");
    setBusy(true);
    setVerification(null);
    try {
      const { data, error } = await (supabase as any).rpc("mines_start", {
        p_stake: Number(amount.toFixed(2)),
        p_mine_count: mineCount,
        p_client_seed: seed,
        p_idempotency_key: makeId("round"),
      });
      if (error) throw error;
      setClientSeed(seed);
      setState(data as MinesState);
      toast({
        title: "Mines round started",
        description: "The mine layout is hash-committed and locked.",
      });
      await loadBalance();
    } catch (error) {
      toast({
        title: "Round not started",
        description: error instanceof Error ? error.message : "Unable to start the round.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function pickCell(cell: number) {
    if (!active || busy || revealed.has(cell)) return;
    setBusy(true);
    try {
      const { data, error } = await (supabase as any).rpc("mines_pick", { p_cell: cell });
      if (error) throw error;
      const next = data as MinesState;
      setState(next);
      if (next.game?.status === "lost") {
        toast({
          title: "Mine hit",
          description: "The server seed is now available for verification.",
          variant: "destructive",
        });
      }
      if (next.game?.status === "cashed_out") {
        toast({
          title: "Board cleared",
          description: `${formatUsd(next.game.payout)} credited.`,
        });
      }
      await loadBalance();
    } catch (error) {
      toast({
        title: "Tile not opened",
        description: error instanceof Error ? error.message : "Unable to open this tile.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  function pickRandomTile() {
    if (!active || busy) return;
    const unopened = Array.from({ length: 25 }, (_, cell) => cell).filter(
      (cell) => !revealed.has(cell),
    );
    if (!unopened.length) return;
    const randomIndex = globalThis.crypto?.getRandomValues
      ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % unopened.length
      : Math.floor(Math.random() * unopened.length);
    void pickCell(unopened[randomIndex]);
  }

  async function cashOut() {
    if (!active || busy || !game?.revealed_cells.length) return;
    setBusy(true);
    try {
      const { data, error } = await (supabase as any).rpc("mines_cashout", {});
      if (error) throw error;
      const next = data as MinesState;
      setState(next);
      toast({
        title: "Cash-out complete",
        description: `${formatUsd(next.game?.payout || 0)} credited to your wallet.`,
      });
      await loadBalance();
    } catch (error) {
      toast({
        title: "Cash-out failed",
        description: error instanceof Error ? error.message : "Unable to cash out.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function verifyRound() {
    if (!game?.server_seed) return;
    const encoder = new TextEncoder();
    const seedDigest = await crypto.subtle.digest("SHA-256", encoder.encode(game.server_seed));
    const seedHash = Array.from(new Uint8Array(seedDigest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    const derived: number[] = [];
    let counter = 0;
    while (derived.length < game.mine_count) {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(`${game.server_seed}:${game.client_seed}:${counter}`),
      );
      const candidate = new DataView(digest).getUint32(0, false) % 25;
      if (!derived.includes(candidate)) derived.push(candidate);
      counter += 1;
    }

    const sameLayout =
      [...derived].sort((a, b) => a - b).join(",") ===
      [...game.mine_positions].sort((a, b) => a - b).join(",");
    setVerification(seedHash === game.server_seed_hash && sameLayout ? "valid" : "invalid");
  }

  function newRound() {
    setState((current) => (current ? { ...current, game: null } : current));
    setClientSeed(makeId("mindbet"));
    setVerification(null);
  }

  return (
    <>
      <Head>
        <title>MindBet Mines | Provably Fair Casino Game</title>
        <meta
          name="description"
          content="Play the server-authoritative, provably fair MindBet Mines game."
        />
      </Head>
      <div className="min-h-screen bg-[#050b12] pb-20 text-slate-100 lg:pb-0">
        <Header
          user={user ? { email: user.email || "", balance } : null}
          onAuthClick={() => void router.push("/auth/login?returnTo=/casino/mines")}
        />

        <main className="container px-3 py-4 sm:px-4 sm:py-6">
          <div className="mx-auto max-w-6xl space-y-4 sm:space-y-5">
            <section className="relative overflow-hidden rounded-2xl border border-cyan-400/20 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,.17),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,.15),transparent_38%),#07111d] p-4 shadow-[0_25px_80px_rgba(0,0,0,.35)] sm:rounded-3xl sm:p-7">
              <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-300 to-emerald-400 shadow-[0_0_35px_rgba(34,211,238,.3)] sm:h-14 sm:w-14">
                    <Bomb className="h-7 w-7 text-slate-950 sm:h-8 sm:w-8" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-2xl font-black tracking-tight sm:text-3xl">MindBet Mines</h1>
                      <Badge className="bg-emerald-400/15 text-emerald-300">Provably Fair</Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-400 sm:text-sm">
                      Reveal gems, avoid mines and cash out whenever you choose.
                    </p>
                  </div>
                </div>
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 sm:px-5 sm:text-right">
                  <div className="text-xs font-bold uppercase tracking-[.18em] text-slate-400">
                    Funded balance
                  </div>
                  <div className="mt-1 flex items-center gap-2 font-mono text-2xl font-black text-emerald-300 sm:justify-end">
                    <Wallet className="h-5 w-5" />
                    {formatUsd(balance)}
                  </div>
                </div>
              </div>
            </section>

            {loadError && (
              <div className="flex flex-col gap-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" />
                  <div>
                    <p className="font-bold text-rose-200">Mines is not ready</p>
                    <p className="mt-1 text-sm text-rose-200/70">{loadError}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="border-rose-300/30 bg-transparent"
                  onClick={() => void refreshGame()}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry
                </Button>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-[360px_1fr] lg:gap-5">
              <Card className="order-2 border-slate-700/70 bg-[#0a1624] text-slate-100 lg:order-1">
                <CardContent className="space-y-5 p-4 sm:p-5">
                  <div>
                    <label className="text-xs font-bold uppercase tracking-[.16em] text-slate-400">
                      Stake (USD)
                    </label>
                    <Input
                      className="mt-2 border-slate-700 bg-[#07111d] font-mono text-lg"
                      type="number"
                      inputMode="decimal"
                      min={settings.min_stake}
                      max={settings.max_stake}
                      step="0.01"
                      value={stake}
                      disabled={active || busy}
                      onChange={(event) => setStake(event.target.value)}
                    />
                    <div className="mt-2 grid grid-cols-5 gap-2">
                      {quickStakes.map((amount) => (
                        <button
                          key={amount}
                          type="button"
                          disabled={active || busy}
                          onClick={() => setStake(String(amount))}
                          className="rounded-lg border border-slate-700 bg-slate-800/60 py-2 text-[11px] font-bold hover:border-cyan-400/50 disabled:opacity-50"
                        >
                          {formatUsd(amount)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold uppercase tracking-[.16em] text-slate-400">
                      Mines
                    </label>
                    <div className="mt-2 grid grid-cols-4 gap-2">
                      {mineOptions.map((count) => (
                        <button
                          key={count}
                          type="button"
                          disabled={active || busy}
                          onClick={() => setMineCount(count)}
                          className={`rounded-xl border py-3 font-mono font-black transition ${
                            mineCount === count
                              ? "border-cyan-300 bg-cyan-300/15 text-cyan-200"
                              : "border-slate-700 bg-slate-800/60 hover:border-cyan-400/40"
                          } disabled:opacity-50`}
                        >
                          {count}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-slate-700 bg-[#07111d] p-3">
                      <div className="text-[10px] font-bold uppercase tracking-[.15em] text-slate-500">
                        Multiplier
                      </div>
                      <div className="mt-1 font-mono text-xl font-black text-cyan-300">
                        {Number(game?.current_multiplier || 1).toFixed(2)}x
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-700 bg-[#07111d] p-3">
                      <div className="text-[10px] font-bold uppercase tracking-[.15em] text-slate-500">
                        Cash-out
                      </div>
                      <div className="mt-1 font-mono text-xl font-black text-emerald-300">
                        {formatUsd(game?.potential_payout || Number(stake || 0))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-700 bg-[#07111d] p-3">
                      <div className="text-[10px] font-bold uppercase tracking-[.15em] text-slate-500">
                        Next safe tile
                      </div>
                      <div className="mt-1 font-mono text-lg font-black text-amber-300">
                        {nextMultiplier.toFixed(2)}x
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-700 bg-[#07111d] p-3">
                      <div className="text-[10px] font-bold uppercase tracking-[.15em] text-slate-500">
                        Next payout
                      </div>
                      <div className="mt-1 font-mono text-lg font-black text-amber-300">
                        {formatUsd(nextPayout)}
                      </div>
                    </div>
                  </div>

                  {!active ? (
                    <Button
                      className="h-12 w-full bg-gradient-to-r from-cyan-400 to-emerald-400 text-base font-black text-slate-950"
                      disabled={busy || loading}
                      onClick={() => void startGame()}
                    >
                      {busy ? (
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      ) : (
                        <Sparkles className="mr-2 h-5 w-5" />
                      )}
                      {busy ? "Starting..." : game ? "Start New Round" : "Start Game"}
                    </Button>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        className="h-12 border-cyan-300/30 bg-cyan-400/5 font-bold text-cyan-200"
                        disabled={busy}
                        onClick={pickRandomTile}
                      >
                        <Dice5 className="mr-2 h-4 w-4" />
                        Random
                      </Button>
                      <Button
                        className="h-12 bg-emerald-400 font-black text-slate-950"
                        disabled={busy || !game.revealed_cells.length}
                        onClick={() => void cashOut()}
                      >
                        {busy ? "Processing..." : `Cash Out ${formatUsd(game.potential_payout)}`}
                      </Button>
                    </div>
                  )}

                  {game && !active && (
                    <Button
                      variant="outline"
                      className="w-full border-slate-700 bg-transparent"
                      onClick={newRound}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      New Round
                    </Button>
                  )}

                  <p className="text-xs leading-relaxed text-slate-500">
                    <LockKeyhole className="mr-1 inline h-3.5 w-3.5" />
                    Server-side wallet, account and responsible-play limits are checked before every funded round.
                  </p>
                </CardContent>
              </Card>

              <Card className="order-1 overflow-hidden border-slate-700/70 bg-[#081421] text-slate-100 lg:order-2">
                <CardContent className="p-3 sm:p-6">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold">
                        {loading
                          ? "Loading round"
                          : active
                            ? "Round active"
                            : game?.status === "lost"
                              ? "Mine revealed"
                              : game?.status === "cashed_out"
                                ? "Cashed out"
                                : "Choose your setup"}
                      </div>
                      <div className="text-xs text-slate-500">
                        {active
                          ? `${openedTiles} of ${safeTiles} safe tiles opened`
                          : "The layout is generated and committed on the server."}
                      </div>
                    </div>
                    {game && (
                      <Badge
                        variant="outline"
                        className={
                          game.status === "lost"
                            ? "border-rose-400/40 text-rose-300"
                            : game.status === "cashed_out"
                              ? "border-emerald-400/40 text-emerald-300"
                              : "border-cyan-400/40 text-cyan-300"
                        }
                      >
                        {game.status.replace("_", " ")}
                      </Badge>
                    )}
                  </div>

                  <div className="mx-auto grid max-w-2xl grid-cols-5 gap-1.5 sm:gap-3">
                    {Array.from({ length: 25 }, (_, cell) => {
                      const isRevealed = revealed.has(cell);
                      const isMine = !active && mines.has(cell);
                      return (
                        <button
                          key={cell}
                          type="button"
                          aria-label={
                            isMine
                              ? `Mine at tile ${cell + 1}`
                              : isRevealed
                                ? `Safe tile ${cell + 1}`
                                : `Open tile ${cell + 1}`
                          }
                          disabled={!active || busy || isRevealed}
                          onClick={() => void pickCell(cell)}
                          className={`group aspect-square rounded-lg border transition-all sm:rounded-2xl ${
                            isMine
                              ? "border-rose-400/50 bg-rose-500/15"
                              : isRevealed
                                ? "border-emerald-300/50 bg-emerald-400/15"
                                : "border-slate-700 bg-gradient-to-br from-slate-800 to-slate-900 hover:-translate-y-0.5 hover:border-cyan-300/60 hover:shadow-[0_8px_24px_rgba(34,211,238,.12)]"
                          } disabled:cursor-default`}
                        >
                          {loading ? (
                            <span className="mx-auto block h-3 w-3 animate-pulse rounded-full bg-slate-700" />
                          ) : isMine ? (
                            <Bomb className="mx-auto h-6 w-6 text-rose-300 sm:h-9 sm:w-9" />
                          ) : isRevealed ? (
                            <Gem className="mx-auto h-6 w-6 text-emerald-300 sm:h-9 sm:w-9" />
                          ) : (
                            <span className="font-mono text-[10px] text-slate-600 sm:text-xs">
                              {cell + 1}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {game && (
                    <div className="mt-5 rounded-2xl border border-slate-700 bg-[#050d17] p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-cyan-300" />
                        <span className="text-sm font-bold">Provably-fair verification</span>
                      </div>
                      <p className="mb-3 text-xs leading-relaxed text-slate-500">
                        The commitment is published before play. The secret seed and complete mine layout are disclosed only after the round ends.
                      </p>
                      <div className="space-y-2 font-mono text-[10px] text-slate-500">
                        <div>
                          <span className="text-slate-400">Commitment:</span>{" "}
                          <span className="break-all">{game.server_seed_hash}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Client seed:</span>{" "}
                          <span className="break-all">{game.client_seed}</span>
                        </div>
                        {game.server_seed && (
                          <div>
                            <span className="text-slate-400">Server seed:</span>{" "}
                            <span className="break-all">{game.server_seed}</span>
                          </div>
                        )}
                      </div>
                      {game.server_seed && (
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-slate-700"
                            onClick={() => void verifyRound()}
                          >
                            Verify round
                          </Button>
                          {verification === "valid" && (
                            <span className="flex items-center gap-1 text-xs font-bold text-emerald-300">
                              <CheckCircle2 className="h-4 w-4" />
                              Hash and mine layout verified
                            </span>
                          )}
                          {verification === "invalid" && (
                            <span className="text-xs font-bold text-rose-300">
                              Verification failed
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </main>

        <Footer />
        <MobileBottomNav />
      </div>
    </>
  );
}
