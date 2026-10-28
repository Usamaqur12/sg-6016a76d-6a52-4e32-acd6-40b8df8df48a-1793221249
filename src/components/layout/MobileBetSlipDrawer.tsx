import { useEffect, useState } from "react";
import { X, Trash2, Receipt, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { OddsAcceptance } from "@/services/bettingService";
import { systemBetPotentialReturn } from "@/lib/systemBetMath";

interface BetSelection {
  id: string;
  eventName: string;
  selection: string;
  odds: number;
  market: string;
}

interface MobileBetSlipDrawerProps {
  selections: BetSelection[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onPlaceBet: (type: string, stake: number, oddsAcceptance: OddsAcceptance, systemSize?: number) => void | Promise<void>;
  balance: number;
  isOpen: boolean;
  onClose: () => void;
}

type BetType = "single" | "multiple" | "system";

export function MobileBetSlipDrawer({
  selections,
  onRemove,
  onClear,
  onPlaceBet,
  balance,
  isOpen,
  onClose,
}: MobileBetSlipDrawerProps) {
  const [betType, setBetType] = useState<BetType>("single");
  const [stake, setStake] = useState<string>("");
  const [isPlacing, setIsPlacing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [oddsAcceptance, setOddsAcceptance] = useState<OddsAcceptance>("none");
  const [oddsPreferenceLoaded, setOddsPreferenceLoaded] = useState(false);
  const [systemSize, setSystemSize] = useState(2);

  useEffect(() => {
    if (selections.length > 1 && betType === "single") setBetType("multiple");
    if (selections.length === 1 && betType === "multiple") setBetType("single");
  }, [betType, selections.length]);

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
    if (systemSize >= selections.length) setSystemSize(Math.max(2, selections.length - 1));
  }, [selections.length, systemSize]);

  const totalOdds = selections.reduce((acc, sel) => acc * sel.odds, 1);
  const systemQuote = systemBetPotentialReturn(selections.map((selection) => selection.odds), systemSize, parseFloat(stake) || 0);
  const potentialWin = betType === "system" ? systemQuote.potentialReturn : stake ? parseFloat(stake) * totalOdds : 0;
  const potentialProfit = Math.max(potentialWin - (parseFloat(stake) || 0), 0);

  const handlePlaceBet = async () => {
    const stakeAmount = parseFloat(stake);
    
    if (!stake || stakeAmount <= 0) {
      alert("Please enter a valid stake amount");
      return;
    }

    if (stakeAmount > balance) {
      alert("Insufficient balance");
      return;
    }

    if (selections.length === 0) {
      alert("Please add selections to your bet slip");
      return;
    }

    setIsPlacing(true);
    setPlaceError(null);
    try {
      await onPlaceBet(betType, stakeAmount, oddsAcceptance, systemSize);
      setStake("");
      onClose();
    } catch (error) {
      console.error("Place bet error:", error);
      setPlaceError(error instanceof Error ? error.message : "Bet could not be placed");
    } finally {
      setIsPlacing(false);
    }
  };

  const quickStakes = [5, 10, 25, 50];

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-surface border-t border-border shadow-2xl lg:hidden animate-in slide-in-from-bottom duration-300">
        {/* Handle */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between px-4 py-2 border-b border-border bg-surface/50"
        >
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold">Bet Slip</span>
            {selections.length > 0 && (
              <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
                {selections.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selections.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onClear();
                }}
                className="h-7 w-7 p-0 hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
            {isExpanded ? (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </button>

        {/* Content */}
        {isExpanded && (
          <div className="max-h-[70vh] flex flex-col">
            {selections.length === 0 ? (
              /* Empty State */
              <div className="flex items-center justify-center p-8">
                <div className="text-center space-y-2">
                  <div className="w-12 h-12 mx-auto rounded-full bg-gradient-to-br from-muted/10 to-transparent border-2 border-dashed border-muted/20 flex items-center justify-center">
                    <Receipt className="h-6 w-6 text-muted-foreground/50" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">No Selections</p>
                    <p className="text-xs text-muted-foreground">Tap odds to add bets</p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Bet Type Tabs */}
                <Tabs value={betType} onValueChange={(value) => setBetType(value as BetType)} className="border-b border-border">
                  <TabsList className="w-full grid grid-cols-3 h-10 rounded-none bg-transparent p-0">
                    <TabsTrigger
                      value="single"
                      className="text-xs font-semibold rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary"
                    >
                      Single
                    </TabsTrigger>
                    <TabsTrigger
                      value="multiple"
                      className="text-xs font-semibold rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary"
                      disabled={selections.length < 2}
                    >
                      Multiple
                    </TabsTrigger>
                    <TabsTrigger
                      value="system"
                      className="text-xs font-semibold rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary"
                      disabled={selections.length < 3}
                      title={selections.length < 3 ? "Add at least 3 selections" : undefined}
                    >
                      System
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                {betType === "system" && (
                  <div className="border-b border-border bg-primary/5 p-3">
                    <label className="text-[10px] font-bold uppercase text-muted-foreground">Round robin</label>
                    <select className="mt-1 h-9 w-full rounded border border-border bg-background px-2 text-xs" value={systemSize} onChange={(event) => setSystemSize(Number(event.target.value))}>
                      {Array.from({ length: Math.max(selections.length - 2, 0) }, (_, index) => index + 2).map((size) => <option key={size} value={size}>{size} from {selections.length}</option>)}
                    </select>
                    <p className="mt-1 text-[10px] text-muted-foreground">{systemQuote.lineCount} lines · ${systemQuote.lineStake.toFixed(2)} each</p>
                  </div>
                )}

                {/* Selections */}
                <ScrollArea className="flex-1 custom-scrollbar">
                  <div className="p-3 space-y-2">
                    {selections.map((selection) => (
                      <div
                        key={selection.id}
                        className="p-2.5 rounded bg-background border border-border"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate leading-tight">
                              {selection.eventName}
                            </p>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {selection.market}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 p-0 hover:bg-danger/10 hover:text-danger flex-shrink-0"
                            onClick={() => onRemove(selection.id)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-primary">
                            {selection.selection}
                          </span>
                          <span className="text-xs font-mono font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                            {selection.odds.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                {/* Stake Input */}
                <div className="p-3 border-t border-border space-y-2 bg-surface/50">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                      Stake
                    </label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-xs">
                        $
                      </span>
                      <Input
                        type="number"
                        value={stake}
                        onChange={(e) => setStake(e.target.value)}
                        placeholder="0.00"
                        className="pl-6 pr-2.5 font-mono text-right h-10 bg-background border-border text-sm"
                        min="0"
                        max={balance}
                        step="0.01"
                      />
                    </div>

                    {/* Quick Stakes */}
                    <div className="flex gap-1.5">
                      {quickStakes.map((amount) => (
                        <Button
                          key={amount}
                          variant="outline"
                          size="sm"
                          className="flex-1 text-[10px] h-7 font-mono font-semibold hover:bg-primary/10 hover:border-primary hover:text-primary"
                          onClick={() => setStake(amount.toString())}
                        >
                          ${amount}
                        </Button>
                      ))}
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[
                        { label: "+5", value: (parseFloat(stake) || 0) + 5 },
                        { label: "+10", value: (parseFloat(stake) || 0) + 10 },
                        { label: "×2", value: (parseFloat(stake) || 0) * 2 },
                        { label: "Clear", value: 0 },
                      ].map((action) => (
                        <Button
                          key={action.label}
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[10px] font-bold"
                          onClick={() => setStake(action.value > 0 ? action.value.toFixed(2) : "")}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* Bet Summary */}
                  <div className="space-y-1 pt-1.5 border-t border-border/50">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">Total Odds</span>
                      <span className="font-mono font-bold text-primary">
                        {totalOdds.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Potential Return</span>
                      <span className="font-mono font-bold text-success text-base">
                        ${potentialWin.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">Potential Profit</span>
                      <span className="font-mono font-bold text-success">${potentialProfit.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] pt-1 border-t border-border/30">
                      <span className="text-muted-foreground">Balance</span>
                      <span className="font-mono font-semibold">
                        ${balance.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <label className="block space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Odds changes</span>
                    <select value={oddsAcceptance} onChange={(event) => setOddsAcceptance(event.target.value as OddsAcceptance)} className="h-9 w-full rounded border border-border bg-background px-2 text-xs">
                      <option value="none">Reject changes</option>
                      <option value="higher">Accept higher only</option>
                      <option value="any">Accept any current price</option>
                    </select>
                  </label>

                  {/* Place Bet Button */}
                  <Button
                    className={cn(
                      "w-full font-bold h-11 shadow-sm text-sm",
                      "bg-primary hover:bg-primary/90 active:scale-[0.98]",
                      "disabled:opacity-50"
                    )}
                    onClick={handlePlaceBet}
                    disabled={isPlacing || !stake || parseFloat(stake) <= 0 || parseFloat(stake) > balance || (betType === "system" && selections.length < 3)}
                  >
                    {isPlacing ? "Placing…" : "Place Bet"}
                  </Button>
                  {placeError && (
                    <p className="text-xs text-danger text-center">{placeError}</p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
