import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { ArrowLeft, Clock, Download, Receipt, RefreshCw, TrendingUp, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cancelBet, getUserBets } from "@/services/bettingService";
import { calculateCashoutOffer, processCashout } from "@/services/cashoutService";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

interface DisplaySelection {
  selection: string;
  odds: number;
  result?: string;
}

interface DisplayBet {
  id: string;
  type: string;
  status: string;
  stake: number;
  totalOdds: number;
  potentialReturn: number;
  payout: number;
  createdAt: string;
  selections: DisplaySelection[];
}

function normalizeBet(row: any): DisplayBet {
  const selections = (row.bet_selections || row.selections || []).map((selection: any) => ({
    selection: selection.selection,
    odds: Number(selection.odds_value ?? selection.oddsValue ?? 0),
    result: selection.result,
  }));

  return {
    id: row.id,
    type: row.type || row.bet_type || "single",
    status: row.status || "pending",
    stake: Number(row.stake || 0),
    totalOdds: Number(row.total_odds ?? row.totalOdds ?? 0),
    potentialReturn: Number(row.potential_return ?? row.potential_payout ?? row.potentialReturn ?? 0),
    payout: Number(row.payout || 0),
    createdAt: row.created_at || row.placed_at || new Date().toISOString(),
    selections,
  };
}

export default function MyBets() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [headerBalance, setHeaderBalance] = useState(0);
  const [bets, setBets] = useState<DisplayBet[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    void initialize();
  }, []);

  async function initialize() {
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    if (!authUser) {
      await router.push("/auth/login");
      return;
    }

    setUser({ id: authUser.id, email: authUser.email });

    const [{ data: nextProfile }, walletResult] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", authUser.id).maybeSingle(),
      supabase.rpc("get_user_wallet_balance" as any, { p_user_id: authUser.id }) as Promise<{ data: { cash_balance: number; bonus_balance: number } | null; error: any }>
    ]);

    setProfile(
      nextProfile ?? {
        id: authUser.id,
        email: authUser.email ?? "",
        full_name: authUser.user_metadata?.full_name ?? "Account",
        kyc_status: "pending",
        demo_balance: 0,
      }
    );

    if (!walletResult.error && walletResult.data) {
      setHeaderBalance(Number(walletResult.data.cash_balance || 0) + Number(walletResult.data.bonus_balance || 0));
    } else {
      setHeaderBalance(0);
    }
    
    await loadBets(authUser.id);
  }

  async function loadBets(userId = user?.id) {
    if (!userId) {
      return;
    }

    setLoading(true);
    const result = await getUserBets(userId, undefined, 250);

    if (result.success) {
      setBets((result.bets || []).map(normalizeBet));
    } else {
      toast({
        title: "Bets could not be loaded",
        description: result.error,
        variant: "destructive",
      });
    }

    setLoading(false);
  }

  const visible = useMemo(
    () =>
      bets.filter((bet) => {
        if (filter !== "all" && bet.status !== filter) {
          return false;
        }

        const needle = search.trim().toLowerCase();
        return (
          !needle ||
          bet.id.toLowerCase().includes(needle) ||
          bet.selections.some((selection) => selection.selection.toLowerCase().includes(needle))
        );
      }),
    [bets, filter, search]
  );

  function exportStatement() {
    const headers = [
      "bet_id",
      "placed_at",
      "type",
      "status",
      "stake",
      "total_odds",
      "potential_return",
      "payout",
      "selections",
    ];

    const rows = visible.map((bet) =>
      [
        bet.id,
        bet.createdAt,
        bet.type,
        bet.status,
        bet.stake,
        bet.totalOdds,
        bet.potentialReturn,
        bet.payout,
        bet.selections.map((item) => `${item.selection} @ ${item.odds}`).join(" | "),
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(",")
    );

    const blob = new Blob([[headers.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `primebet-bet-statement-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen flex flex-col bg-background pb-14 lg:pb-0">
      <Header
        user={
          user
            ? {
                email: profile?.email || user.email || "",
                balance: headerBalance,
              }
            : null
        }
        onAuthClick={() => router.push("/auth/login")}
      />
      <main className="flex-1">
        <div className="container max-w-6xl py-4 md:py-6">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Link href="/account">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold">
                  <Receipt className="h-6 w-6 text-primary" />
                  My Bets
                </h1>
                <p className="text-sm text-muted-foreground">Track selections, accept cash-out and export a statement.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void loadBets()} disabled={loading}>
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button onClick={exportStatement} disabled={!visible.length}>
                <Download className="mr-2 h-4 w-4" />
                Statement
              </Button>
            </div>
          </div>

          <div className="mb-4 grid gap-3 md:grid-cols-[1fr_280px]">
            <Tabs value={filter} onValueChange={setFilter}>
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="pending">Open</TabsTrigger>
                <TabsTrigger value="won">Won</TabsTrigger>
                <TabsTrigger value="lost">Lost</TabsTrigger>
                <TabsTrigger value="cashout">Cash-out</TabsTrigger>
              </TabsList>
            </Tabs>
            <Input placeholder="Search bet ID or selection" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-40 animate-pulse rounded-lg bg-surface" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-14">
                <Receipt className="mb-3 h-12 w-12 text-muted-foreground" />
                <p className="font-medium">No matching bets</p>
                <p className="text-sm text-muted-foreground">Your placed bets will appear here.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {visible.map((bet) => (
                <BetCard key={bet.id} bet={bet} userId={user!.id} onChanged={() => void loadBets(user!.id)} />
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
      <MobileBottomNav />
    </div>
  );
}

function BetCard({ bet, userId, onChanged }: { bet: DisplayBet; userId: string; onChanged: () => void }) {
  const { toast } = useToast();
  const [cancelling, setCancelling] = useState(false);
  const canCancel = bet.status === "pending" && Date.now() - new Date(bet.createdAt).getTime() <= 5 * 60_000;

  async function cancel() {
    if (!window.confirm("Cancel this bet and refund its stake? This is only allowed before an event starts.")) {
      return;
    }

    setCancelling(true);
    const result = await cancelBet(userId, bet.id);

    if (!result.success) {
      toast({ title: "Bet was not cancelled", description: result.error, variant: "destructive" });
    } else {
      toast({ title: "Bet cancelled", description: "The stake was returned to your wallet." });
      onChanged();
    }

    setCancelling(false);
  }

  return (
    <Card className={bet.status === "won" ? "border-success/30" : bet.status === "lost" ? "border-danger/30" : ""}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm capitalize">{bet.type} bet</CardTitle>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {bet.id.slice(0, 12)} · {new Date(bet.createdAt).toLocaleString()}
            </p>
          </div>
          <BetStatusBadge status={bet.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {bet.selections.map((selection, index) => (
            <div key={`${bet.id}-${index}`} className="rounded border border-border bg-background/50 p-2.5 text-xs">
              <div className="flex justify-between gap-3">
                <span className="font-medium">{selection.selection}</span>
                <span className="font-mono font-bold text-primary">{selection.odds.toFixed(2)}</span>
              </div>
              {selection.result && selection.result !== "pending" && (
                <span className="mt-1 block capitalize text-muted-foreground">{selection.result}</span>
              )}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
          <Figure label="Stake" value={`$${bet.stake.toFixed(2)}`} />
          <Figure label="Total odds" value={bet.totalOdds.toFixed(2)} />
          <Figure label="Potential return" value={`$${bet.potentialReturn.toFixed(2)}`} tone="success" />
          <Figure label="Paid" value={`$${bet.payout.toFixed(2)}`} />
        </div>
        {bet.status === "pending" && (
          <div className="space-y-3">
            <CashoutControls bet={bet} userId={userId} onChanged={onChanged} />
            {canCancel && (
              <div className="flex items-center justify-between rounded-lg border border-warning/30 bg-warning/5 p-3">
                <div>
                  <p className="text-sm font-bold">Cancellation window</p>
                  <p className="text-xs text-muted-foreground">
                    Available for five minutes, unless an event has already started.
                  </p>
                </div>
                <Button size="sm" variant="outline" disabled={cancelling} onClick={() => void cancel()}>
                  {cancelling ? "Cancelling…" : "Cancel bet"}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CashoutControls({ bet, userId, onChanged }: { bet: DisplayBet; userId: string; onChanged: () => void }) {
  const { toast } = useToast();
  const [offer, setOffer] = useState<number | null>(null);
  const [partial, setPartial] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function quote() {
    setBusy(true);
    setError(null);
    const result = await calculateCashoutOffer(bet.id);

    if (result.success && result.offer) {
      setOffer(result.offer.cashoutAmount);
    } else {
      setError(result.error || "Cash-out unavailable");
    }

    setBusy(false);
  }

  async function accept(type: "full" | "partial") {
    if (offer === null) {
      return;
    }

    const amount = type === "partial" ? Number(partial) : undefined;
    if (type === "partial" && (!Number.isFinite(amount) || amount <= 0 || amount >= offer)) {
      setError(`Partial amount must be below $${offer.toFixed(2)}`);
      return;
    }

    setBusy(true);
    const result = await processCashout(bet.id, userId, type, amount);

    if (!result.success) {
      setError(result.error || "Cash-out failed");
    } else {
      toast({
        title: type === "full" ? "Bet cashed out" : "Partial cash-out completed",
        description: `$${Number(result.cashoutAmount || 0).toFixed(2)} credited to the wallet.`,
      });
      onChanged();
    }

    setBusy(false);
  }

  if (offer === null) {
    return (
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold">Cash-out</p>
            <p className="text-xs text-muted-foreground">Offer is recalculated from current active prices.</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void quote()} disabled={busy}>
            <TrendingUp className="mr-2 h-4 w-4" />
            {busy ? "Quoting…" : "Get offer"}
          </Button>
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="flex-1">
          <p className="text-xs text-muted-foreground">Full cash-out offer</p>
          <p className="text-xl font-black text-primary">${offer.toFixed(2)}</p>
        </div>
        <div className="flex flex-1 gap-2">
          <Input
            type="number"
            min="0.01"
            max={Math.max(offer - 0.01, 0.01)}
            step="0.01"
            placeholder="Partial amount"
            value={partial}
            onChange={(event) => setPartial(event.target.value)}
          />
          <Button variant="outline" onClick={() => void accept("partial")} disabled={busy || !partial}>
            Partial
          </Button>
        </div>
        <Button onClick={() => void accept("full")} disabled={busy}>
          Accept full cash-out
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "success" }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-mono text-sm font-bold ${tone === "success" ? "text-success" : ""}`}>{value}</p>
    </div>
  );
}

function Status({ status }: { status: string }) {
  if (status === "pending") {
    return (
      <Badge variant="outline">
        <Clock className="mr-1 h-3 w-3" />
        Open
      </Badge>
    );
  }

  if (status === "won") {
    return (
      <Badge className="bg-success/15 text-success">
        <TrendingUp className="mr-1 h-3 w-3" />
        Won
      </Badge>
    );
  }

  if (status === "lost") {
    return (
      <Badge variant="destructive">
        <XCircle className="mr-1 h-3 w-3" />
        Lost
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="capitalize">
      {status}
    </Badge>
  );
}

function BetStatusBadge({ status }: { status: string }) {
  const configs: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string; className?: string }> = {
    pending: { 
      variant: "secondary", 
      label: "Pending",
      className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
    },
    won: { 
      variant: "default", 
      label: "Won",
      className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
    },
    lost: { 
      variant: "destructive", 
      label: "Lost",
      className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
    },
    void: { 
      variant: "outline", 
      label: "Void",
      className: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
    },
    cashout: { 
      variant: "default", 
      label: "Cashed Out",
      className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
    },
    cancelled: { 
      variant: "outline", 
      label: "Cancelled",
      className: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
    },
  };

  const config = configs[status] || { variant: "outline", label: status, className: "" };

  return (
    <Badge variant={config.variant} className={config.className}>
      {config.label}
    </Badge>
  );
}