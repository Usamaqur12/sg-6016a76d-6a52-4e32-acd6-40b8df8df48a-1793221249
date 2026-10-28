import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { useBetSlip } from "@/hooks/useBetSlip";
import { supabase } from "@/integrations/supabase/client";
import { placeBet, type OddsAcceptance } from "@/services/bettingService";
import { useRouter } from "next/router";
import { cn } from "@/lib/utils";
import { systemBetPotentialReturn } from "@/lib/systemBetMath";

export function BetSlip() {
  const router = useRouter();
  const betSlip = useBetSlip();
  const [stake, setStake] = useState("10");
  const [isPlacing, setIsPlacing] = useState(false);
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [profile, setProfile] = useState<{ demo_balance: number } | null>(null);
  const [betType, setBetType] = useState<"single" | "multiple" | "system">("single");
  const [oddsAcceptance, setOddsAcceptance] = useState<OddsAcceptance>("none");
  const [oddsPreferenceLoaded, setOddsPreferenceLoaded] = useState(false);
  const [systemSize, setSystemSize] = useState(2);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user.id);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem("primebet:odds-acceptance");
    if (saved === "none" || saved === "higher" || saved === "any") {
      setOddsAcceptance(saved);
    }
    setOddsPreferenceLoaded(true);
  }, []);

  useEffect(() => {
    if (oddsPreferenceLoaded) {
      window.localStorage.setItem("primebet:odds-acceptance", oddsAcceptance);
    }
  }, [oddsAcceptance, oddsPreferenceLoaded]);

  useEffect(() => {
    if (systemSize >= betSlip.bets.length) setSystemSize(Math.max(2, betSlip.bets.length - 1));
  }, [betSlip.bets.length, systemSize]);

  const loadProfile = async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    
    if (data) {
      setProfile(data);
    }
  };

  const totalOdds = betSlip.bets.reduce((acc, bet) => acc * bet.odds, 1);
  const stakeAmount = parseFloat(stake) || 0;
  const systemQuote = systemBetPotentialReturn(betSlip.bets.map((bet) => bet.odds), systemSize, stakeAmount);
  const potentialWin = betType === "system" ? systemQuote.potentialReturn : stakeAmount * totalOdds;
  const potentialProfit = Math.max(potentialWin - stakeAmount, 0);
  const availableBalance = Number(profile?.demo_balance || 0);
  const stakeTooHigh = Boolean(profile && stakeAmount > availableBalance);
  const hasVerifiedIdentifiers = betSlip.bets.every(
    (bet) => bet.eventId && bet.marketId && bet.oddsId
  );
  const hasValidBetShape =
    (betType === "single" && betSlip.bets.length === 1) ||
    (betType === "multiple" && betSlip.bets.length >= 2) ||
    (betType === "system" && betSlip.bets.length >= 3 && systemSize >= 2 && systemSize < betSlip.bets.length);
  const isBetBuilder = betSlip.bets.length > 1 && new Set(betSlip.bets.map((bet) => bet.eventId)).size === 1;

  const handlePlaceBet = async () => {
    if (!user) {
      router.push("/auth/login");
      return;
    }

    if (betSlip.bets.length === 0 || stakeAmount <= 0) {
      return;
    }

    if (!hasVerifiedIdentifiers) {
      alert("This is a preview price. Select an event loaded from the live sportsbook database.");
      return;
    }

    if (!hasValidBetShape) {
      alert(betType === "single" ? "A single bet requires one selection." : "Choose at least two selections for a multiple bet.");
      return;
    }

    setIsPlacing(true);

    try {
      const betSelections = betSlip.bets.map((bet) => {
        if (!bet.eventId || !bet.marketId || !bet.oddsId) {
          throw new Error("Selection identifiers are missing");
        }
        return {
          eventId: bet.eventId,
          marketId: bet.marketId,
          oddsId: bet.oddsId,
          selection: bet.selection,
          oddsValue: bet.odds,
        };
      });

      const { success, error, bet } = await placeBet(
        user.id,
        betType,
        stakeAmount,
        betSelections,
        undefined,
        oddsAcceptance,
        systemSize
      );

      if (success) {
        betSlip.clearBets();
        setStake("10");
        
        const { data: updatedProfile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single();

        if (updatedProfile) {
          setProfile(updatedProfile);
        }

        alert(`✅ Bet placed successfully!\nBet ID: ${bet.id.substring(0, 8)}`);
      } else {
        alert(`❌ Failed to place bet: ${error}`);
      }
    } catch (error) {
      console.error("Place bet error:", error);
      alert("❌ Failed to place bet. Please try again.");
    } finally {
      setIsPlacing(false);
    }
  };

  return (
    <aside className="hidden lg:block w-[280px] border-l border-border bg-surface flex-shrink-0">
      <div className="betslip-sticky p-3">
        {/* Header with Tabs */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-black">Bet Slip</h2>
            {betSlip.bets.length > 0 && (
              <button
                onClick={betSlip.clearBets}
                className="text-[10px] font-bold text-danger hover:text-danger/80 transition-colors"
              >
                Clear All
              </button>
            )}
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-0.5 p-0.5 rounded bg-surface-elevated border border-border">
            {(["single", "multiple", "system"] as const).map((type) => (
              <button
                key={type}
                onClick={() => setBetType(type)}
                disabled={type === "system" && betSlip.bets.length < 3}
                title={type === "system" && betSlip.bets.length < 3 ? "Add at least 3 selections" : undefined}
                className={cn(
                  "flex-1 py-1.5 rounded text-[11px] font-bold capitalize transition-all disabled:cursor-not-allowed disabled:opacity-40",
                  betType === type
                    ? "bg-primary text-background shadow-sm"
                    : "text-subtle-foreground hover:text-foreground"
                )}
              >
                {type === "multiple" ? "multi" : type}
              </button>
            ))}
          </div>
        </div>

        {/* Bet Slip Content */}
        {betSlip.bets.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-12 h-12 rounded-full bg-surface-elevated border border-border flex items-center justify-center mx-auto mb-2">
              <span className="text-xl">🎯</span>
            </div>
            <p className="text-xs font-semibold mb-1">No selections yet</p>
            <p className="text-[10px] text-subtle-foreground">
              Click on odds to add them to your bet slip
            </p>
          </div>
        ) : (
          <>
            {betType === "system" && (
              <div className="mb-3 rounded border border-primary/20 bg-primary/5 p-2.5">
                <label className="block text-[10px] font-bold uppercase text-subtle-foreground">Round robin</label>
                <select className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-xs" value={systemSize} onChange={(event) => setSystemSize(Number(event.target.value))}>
                  {Array.from({ length: Math.max(betSlip.bets.length - 2, 0) }, (_, index) => index + 2).map((size) => <option key={size} value={size}>{size} from {betSlip.bets.length}</option>)}
                </select>
                <p className="mt-1 text-[10px] text-subtle-foreground">{systemQuote.lineCount} lines · ${systemQuote.lineStake.toFixed(2)} per line</p>
              </div>
            )}
            {/* Selections */}
            <div className="space-y-2 mb-3 max-h-[300px] overflow-y-auto">
              {betSlip.bets.map((bet, index) => (
                <div key={index} className="p-2.5 rounded bg-surface-elevated border border-border">
                  <div className="flex items-start justify-between mb-1.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">{bet.event}</p>
                      <p className="text-[10px] text-subtle-foreground">{bet.league}</p>
                    </div>
                    <button
                      onClick={() => betSlip.removeBet(index)}
                      className="ml-2 flex-shrink-0 p-1 rounded hover:bg-danger/10 text-danger transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">{bet.selection}</span>
                    <span className="text-xs font-mono font-bold text-primary">{bet.odds.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Stake Input */}
            <div className="space-y-2 mb-3">
              {isBetBuilder && betType === "multiple" && (
                <div className="rounded border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-2 text-[10px] text-cyan-300">
                  Bet Builder detected — same-event correlation rules will be checked before acceptance.
                </div>
              )}
              <label className="text-[11px] font-bold">Stake Amount</label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-subtle-foreground">$</span>
                <input
                  type="number"
                  value={stake}
                  onChange={(e) => setStake(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-6 pr-3 py-2 rounded bg-raised border border-border text-sm font-mono font-bold focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold text-subtle-foreground">Odds changes</label>
                <select value={oddsAcceptance} onChange={(event) => setOddsAcceptance(event.target.value as OddsAcceptance)} className="w-full rounded border border-border bg-raised px-2.5 py-2 text-[11px] font-semibold">
                  <option value="none">Reject every price change</option>
                  <option value="higher">Accept higher prices only</option>
                  <option value="any">Accept any current price</option>
                </select>
              </div>

              {/* Quick Stakes */}
              <div className="grid grid-cols-4 gap-1">
                {[5, 10, 25, 50].map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setStake(amount.toString())}
                    className="py-1.5 rounded bg-surface-elevated border border-border hover:border-primary/40 hover:bg-raised text-[11px] font-bold transition-all"
                  >
                    ${amount}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-4 gap-1">
                {[
                  { label: "+5", value: stakeAmount + 5 },
                  { label: "+10", value: stakeAmount + 10 },
                  { label: "×2", value: stakeAmount * 2 },
                  { label: "Clear", value: 0 },
                ].map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => setStake(action.value > 0 ? action.value.toFixed(2) : "")}
                    className="rounded border border-border bg-background py-1 text-[10px] font-bold text-subtle-foreground transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Calculation Summary */}
            <div className="space-y-1.5 mb-3 p-2.5 rounded bg-raised border border-border">
              <div className="flex items-center justify-between text-xs">
                <span className="text-subtle-foreground">Total Stake</span>
                <span className="font-mono font-bold">${stakeAmount.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-subtle-foreground">{betType === "system" ? "System Lines" : "Total Odds"}</span>
                <span className="font-mono font-bold">{betType === "system" ? systemQuote.lineCount : totalOdds.toFixed(2)}</span>
              </div>
              <div className="h-px bg-border my-1" />
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold">Potential Return</span>
                <span className="text-sm font-mono font-black text-primary">${potentialWin.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-subtle-foreground">Potential Profit</span>
                <span className="font-mono font-bold text-success">${potentialProfit.toFixed(2)}</span>
              </div>
              {profile && (
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-subtle-foreground">Available Balance</span>
                  <span className="font-mono font-semibold">${availableBalance.toFixed(2)}</span>
                </div>
              )}
            </div>

            {/* Place Bet Button */}
            <button
              onClick={handlePlaceBet}
              disabled={isPlacing || stakeAmount <= 0 || stakeTooHigh || !profile || !hasVerifiedIdentifiers || !hasValidBetShape}
              className="w-full py-3 rounded bg-primary-bright hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed text-background text-sm font-black uppercase tracking-wide transition-all glow-green-bright"
            >
              {isPlacing ? "Placing..." : "Place Bet"}
            </button>

            {!profile && (
              <p className="text-[10px] text-center text-subtle-foreground mt-2">
                Please log in to place bets
              </p>
            )}
            {profile && !hasVerifiedIdentifiers && (
              <p className="text-[10px] text-center text-warning mt-2">
                Preview selection—open Sports to choose a database-backed price.
              </p>
            )}
            {profile && hasVerifiedIdentifiers && !hasValidBetShape && (
              <p className="text-[10px] text-center text-subtle-foreground mt-2">
                {betType === "single" ? "Keep one selection for a single bet." : betType === "system" ? "System bets require at least 3 events." : "Multiple bets require at least two selections."}
              </p>
            )}
            {stakeTooHigh && (
              <p className="mt-2 text-center text-[10px] font-semibold text-danger">
                Stake exceeds your available balance.
              </p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
