import { Star, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SportsbookOutcome } from "@/types/sportsbook";

interface EventCardProps {
  event: {
    id: string;
    homeTeam: string;
    awayTeam: string;
    league: string;
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

export function EventCard({
  event,
  onOddsClick,
  selectedOdds,
  isFavorite,
  onToggleFavorite,
  onOpenMarkets,
}: EventCardProps) {
  const isSelected = (eventName: string, selection: string) => {
    return selectedOdds.has(`${eventName}-${selection}`);
  };

  return (
    <div className="surface-elevated rounded-md overflow-hidden card-interactive">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-surface border-b border-border">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            onClick={onToggleFavorite}
            className="flex-shrink-0 p-1 rounded hover:bg-surface-elevated transition-colors"
          >
            <Star className={cn("h-3.5 w-3.5", isFavorite ? "fill-gold text-gold" : "text-subtle-foreground")} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] text-subtle-foreground font-bold uppercase tracking-wide truncate">
              {event.league}
            </p>
          </div>
          {event.isLive && (
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-danger live-pulse" />
              <span className="badge-live">{event.liveMinute}'</span>
            </div>
          )}
        </div>
        {!event.isLive && (
          <span className="text-[11px] font-mono font-bold text-subtle-foreground">{event.startTime}</span>
        )}
      </div>

      {/* Content */}
      <div className="p-3">
        {/* Teams */}
        {event.isLive && event.liveScore ? (
          <div className="space-y-1.5 mb-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold truncate flex-1">{event.homeTeam}</span>
              <span className="ml-2 text-lg font-mono font-black text-primary">{event.liveScore.home}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold truncate flex-1">{event.awayTeam}</span>
              <span className="ml-2 text-lg font-mono font-black text-primary">{event.liveScore.away}</span>
            </div>
          </div>
        ) : (
          <div className="space-y-1 mb-3">
            <p className="text-sm font-semibold truncate">{event.homeTeam}</p>
            <p className="text-sm font-semibold truncate">{event.awayTeam}</p>
          </div>
        )}

        {/* Odds */}
        {!event.outcomes?.Home || !event.outcomes?.Away ? (
          <div className="mb-2 flex h-12 items-center justify-center rounded border border-border bg-muted/40 px-3 text-xs font-semibold text-muted-foreground">
            Live-score feed · odds unavailable
          </div>
        ) : event.homeOdds && event.drawOdds && event.awayOdds ? (
          <div className="grid grid-cols-3 gap-1.5 mb-2">
            <button
              onClick={() => onOddsClick("Home", event.homeOdds, event.outcomes?.Home)}
              className={cn(
                "odds-button flex flex-col items-center py-2",
                isSelected(`${event.homeTeam} vs ${event.awayTeam}`, "Home") && "odds-button-selected"
              )}
            >
              <span className="text-[9px] text-subtle-foreground font-bold mb-0.5">1</span>
              <span className="text-sm font-mono font-bold">{event.homeOdds.toFixed(2)}</span>
            </button>
            <button
              onClick={() => onOddsClick("Draw", event.drawOdds, event.outcomes?.Draw)}
              className={cn(
                "odds-button flex flex-col items-center py-2",
                isSelected(`${event.homeTeam} vs ${event.awayTeam}`, "Draw") && "odds-button-selected"
              )}
            >
              <span className="text-[9px] text-subtle-foreground font-bold mb-0.5">X</span>
              <span className="text-sm font-mono font-bold">{event.drawOdds.toFixed(2)}</span>
            </button>
            <button
              onClick={() => onOddsClick("Away", event.awayOdds, event.outcomes?.Away)}
              className={cn(
                "odds-button flex flex-col items-center py-2",
                isSelected(`${event.homeTeam} vs ${event.awayTeam}`, "Away") && "odds-button-selected"
              )}
            >
              <span className="text-[9px] text-subtle-foreground font-bold mb-0.5">2</span>
              <span className="text-sm font-mono font-bold">{event.awayOdds.toFixed(2)}</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 mb-2">
            <button
              onClick={() => onOddsClick("Home", event.homeOdds, event.outcomes?.Home)}
              className={cn(
                "odds-button flex flex-col items-center py-2",
                isSelected(`${event.homeTeam} vs ${event.awayTeam}`, "Home") && "odds-button-selected"
              )}
            >
              <span className="text-[9px] text-subtle-foreground font-bold mb-0.5">Home</span>
              <span className="text-sm font-mono font-bold">{event.homeOdds?.toFixed(2)}</span>
            </button>
            <button
              onClick={() => onOddsClick("Away", event.awayOdds, event.outcomes?.Away)}
              className={cn(
                "odds-button flex flex-col items-center py-2",
                isSelected(`${event.homeTeam} vs ${event.awayTeam}`, "Away") && "odds-button-selected"
              )}
            >
              <span className="text-[9px] text-subtle-foreground font-bold mb-0.5">Away</span>
              <span className="text-sm font-mono font-bold">{event.awayOdds?.toFixed(2)}</span>
            </button>
          </div>
        )}

        {/* More Markets */}
        <Button
          onClick={onOpenMarkets}
          size="sm"
          variant="ghost"
          className="w-full h-7 text-[11px] font-bold text-primary hover:text-primary-bright hover:bg-primary/10"
        >
          <TrendingUp className="h-3 w-3 mr-1.5" />
          +{event.marketCount} Markets
        </Button>
      </div>
    </div>
  );
}
