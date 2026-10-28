import { Star, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SportsbookOutcome } from "@/types/sportsbook";

interface EventRowProps {
  event: {
    id: string;
    homeTeam: string;
    awayTeam: string;
    league?: string;
    startTime: string;
    isLive?: boolean;
    liveScore?: { home: number; away: number };
    liveMinute?: number;
    homeOdds: number;
    drawOdds?: number;
    awayOdds: number;
    marketCount: number;
    outcomes?: Partial<Record<"Home" | "Draw" | "Away", SportsbookOutcome>>;
  };
  onOddsClick: (selection: string, odds: number, outcome?: SportsbookOutcome) => void;
  selectedOdds: Set<string>;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  onOpenMarkets?: () => void;
}

export function EventRow({
  event,
  onOddsClick,
  selectedOdds,
  isFavorite,
  onToggleFavorite,
  onOpenMarkets,
}: EventRowProps) {
  const isSelected = (eventName: string, selection: string) => {
    return selectedOdds.has(`${eventName}-${selection}`);
  };

  return (
    <div className="event-row px-3 py-2.5">
      <div className="grid grid-cols-[auto_1fr_auto] lg:grid-cols-[120px_1fr_auto] gap-2 items-center">
        {/* Time + Favorite */}
        <div className="hidden lg:flex items-center gap-2">
          <button
            onClick={onToggleFavorite}
            className="flex-shrink-0 p-1 rounded hover:bg-surface-elevated transition-colors"
          >
            <Star className={cn("h-3.5 w-3.5", isFavorite ? "fill-gold text-gold" : "text-subtle-foreground")} />
          </button>
          <div className="flex flex-col min-w-0">
            {event.isLive ? (
              <>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-danger live-pulse" />
                  <span className="badge-live">LIVE</span>
                </div>
                <span className="text-[10px] text-subtle-foreground font-mono">{event.liveMinute}'</span>
              </>
            ) : (
              <span className="text-xs font-mono font-bold text-subtle-foreground">{event.startTime}</span>
            )}
          </div>
        </div>

        {/* Teams + League */}
        <div className="min-w-0">
          <p className="text-[10px] text-subtle-foreground font-bold uppercase tracking-wide mb-0.5 truncate">
            {event.league}
          </p>
          <div className="flex items-center gap-2">
            {/* Mobile Favorite */}
            <button
              onClick={onToggleFavorite}
              className="lg:hidden flex-shrink-0 p-1"
            >
              <Star className={cn("h-3 w-3", isFavorite ? "fill-gold text-gold" : "text-subtle-foreground")} />
            </button>

            <div className="flex-1 min-w-0">
              {event.isLive && event.liveScore ? (
                <div className="space-y-0.5">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="truncate">{event.homeTeam}</span>
                    <span className="ml-2 font-mono font-bold text-primary">{event.liveScore.home}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="truncate">{event.awayTeam}</span>
                    <span className="ml-2 font-mono font-bold text-primary">{event.liveScore.away}</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold truncate">{event.homeTeam}</p>
                  <p className="text-xs font-semibold truncate">{event.awayTeam}</p>
                </div>
              )}
            </div>

            {/* Mobile Live Badge */}
            {event.isLive && (
              <div className="lg:hidden flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-danger live-pulse" />
                <span className="badge-live">{event.liveMinute}'</span>
              </div>
            )}
          </div>
        </div>

        {/* Odds + Markets */}
        <div className="flex items-center gap-1.5">
          {!event.outcomes?.Home || !event.outcomes?.Away ? (
            <div className="flex h-8 min-w-[132px] items-center justify-center rounded border border-border bg-muted/40 px-3 text-[10px] font-semibold text-muted-foreground">
              Scores only · odds unavailable
            </div>
          ) : event.homeOdds && event.drawOdds && event.awayOdds ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => onOddsClick("Home", event.homeOdds, event.outcomes?.Home)}
                className={cn(
                  "odds-button min-w-[52px] lg:min-w-[60px]",
                  isSelected(`${event.homeTeam} vs ${event.awayTeam}`, "Home") && "odds-button-selected"
                )}
              >
                {event.homeOdds.toFixed(2)}
              </button>
              <button
                onClick={() => onOddsClick("Draw", event.drawOdds, event.outcomes?.Draw)}
                className={cn(
                  "odds-button min-w-[52px] lg:min-w-[60px]",
                  isSelected(`${event.homeTeam} vs ${event.awayTeam}`, "Draw") && "odds-button-selected"
                )}
              >
                {event.drawOdds.toFixed(2)}
              </button>
              <button
                onClick={() => onOddsClick("Away", event.awayOdds, event.outcomes?.Away)}
                className={cn(
                  "odds-button min-w-[52px] lg:min-w-[60px]",
                  isSelected(`${event.homeTeam} vs ${event.awayTeam}`, "Away") && "odds-button-selected"
                )}
              >
                {event.awayOdds.toFixed(2)}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={() => onOddsClick("Home", event.homeOdds, event.outcomes?.Home)}
                className={cn(
                  "odds-button min-w-[60px]",
                  isSelected(`${event.homeTeam} vs ${event.awayTeam}`, "Home") && "odds-button-selected"
                )}
              >
                {event.homeOdds?.toFixed(2)}
              </button>
              <button
                onClick={() => onOddsClick("Away", event.awayOdds, event.outcomes?.Away)}
                className={cn(
                  "odds-button min-w-[60px]",
                  isSelected(`${event.homeTeam} vs ${event.awayTeam}`, "Away") && "odds-button-selected"
                )}
              >
                {event.awayOdds?.toFixed(2)}
              </button>
            </div>
          )}
          
          <Button
            onClick={onOpenMarkets}
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-[11px] font-bold text-primary hover:text-primary-bright hover:bg-primary/10"
          >
            +{event.marketCount}
            <ChevronRight className="h-3 w-3 ml-0.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
