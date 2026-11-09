import { Star, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CountryFlag } from "@/components/ui/CountryFlag";
import { SportsEntityBadge } from "@/components/ui/SportsEntityBadge";
import { cn } from "@/lib/utils";
import type { SportsbookOutcome } from "@/types/sportsbook";

interface EventRowProps {
  event: {
    id: string;
    homeTeam: string;
    awayTeam: string;
    league?: string;
    leagueCountryCode?: string;
    leagueLogoUrl?: string;
    homeCountryCode?: string;
    awayCountryCode?: string;
    homeTeamLogoUrl?: string;
    awayTeamLogoUrl?: string;
    startTime: string;
    isLive?: boolean;
    liveScore?: { home: number; away: number; homeDisplay?: string; awayDisplay?: string };
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
    <div className="event-row min-w-0 overflow-hidden px-2 py-2.5 sm:px-3">
      <div className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-[120px_minmax(0,1fr)_auto] lg:items-center">
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
          <div className="mb-0.5 flex min-w-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-subtle-foreground">
            <SportsEntityBadge imageUrl={event.leagueLogoUrl} label={event.league || "League"} className="h-4 w-4 text-[6px]" />
            <CountryFlag code={event.leagueCountryCode} label={event.league} className="h-3 w-4" />
            <span className="truncate">{event.league}</span>
          </div>
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
                    <span className="flex min-w-0 items-center gap-1.5">
                      <SportsEntityBadge imageUrl={event.homeTeamLogoUrl} label={event.homeTeam} />
                      <CountryFlag code={event.homeCountryCode} label={event.homeTeam} className="h-3 w-4" />
                      <span className="truncate">{event.homeTeam}</span>
                    </span>
                    <span className="ml-2 font-mono font-bold text-primary">{event.liveScore.homeDisplay || event.liveScore.home}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <SportsEntityBadge imageUrl={event.awayTeamLogoUrl} label={event.awayTeam} />
                      <CountryFlag code={event.awayCountryCode} label={event.awayTeam} className="h-3 w-4" />
                      <span className="truncate">{event.awayTeam}</span>
                    </span>
                    <span className="ml-2 font-mono font-bold text-primary">{event.liveScore.awayDisplay || event.liveScore.away}</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-0.5">
                  <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
                    <SportsEntityBadge imageUrl={event.homeTeamLogoUrl} label={event.homeTeam} />
                    <CountryFlag code={event.homeCountryCode} label={event.homeTeam} className="h-3 w-4" />
                    <span className="truncate">{event.homeTeam}</span>
                  </p>
                  <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
                    <SportsEntityBadge imageUrl={event.awayTeamLogoUrl} label={event.awayTeam} />
                    <CountryFlag code={event.awayCountryCode} label={event.awayTeam} className="h-3 w-4" />
                    <span className="truncate">{event.awayTeam}</span>
                  </p>
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
        <div className="flex w-full min-w-0 items-center gap-1.5 lg:w-auto">
          {!event.outcomes?.Home || !event.outcomes?.Away ? (
            <div className="flex h-8 min-w-0 flex-1 items-center justify-center rounded border border-border bg-muted/40 px-2 text-[10px] font-semibold text-muted-foreground">
              Scores only · odds unavailable
            </div>
          ) : event.homeOdds && event.drawOdds && event.awayOdds ? (
            <div className="grid min-w-0 flex-1 grid-cols-3 gap-1 lg:flex lg:flex-none lg:items-center">
              <button
                onClick={() => onOddsClick("Home", event.homeOdds, event.outcomes?.Home)}
                className={cn(
                  "odds-button w-full min-w-0 lg:w-auto lg:min-w-[60px]",
                  isSelected(`${event.homeTeam} vs ${event.awayTeam}`, "Home") && "odds-button-selected"
                )}
              >
                {event.homeOdds.toFixed(2)}
              </button>
              <button
                onClick={() => onOddsClick("Draw", event.drawOdds, event.outcomes?.Draw)}
                className={cn(
                  "odds-button w-full min-w-0 lg:w-auto lg:min-w-[60px]",
                  isSelected(`${event.homeTeam} vs ${event.awayTeam}`, "Draw") && "odds-button-selected"
                )}
              >
                {event.drawOdds.toFixed(2)}
              </button>
              <button
                onClick={() => onOddsClick("Away", event.awayOdds, event.outcomes?.Away)}
                className={cn(
                  "odds-button w-full min-w-0 lg:w-auto lg:min-w-[60px]",
                  isSelected(`${event.homeTeam} vs ${event.awayTeam}`, "Away") && "odds-button-selected"
                )}
              >
                {event.awayOdds.toFixed(2)}
              </button>
            </div>
          ) : (
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-1 lg:flex lg:flex-none lg:items-center">
              <button
                onClick={() => onOddsClick("Home", event.homeOdds, event.outcomes?.Home)}
                className={cn(
                  "odds-button w-full min-w-0 lg:w-auto lg:min-w-[60px]",
                  isSelected(`${event.homeTeam} vs ${event.awayTeam}`, "Home") && "odds-button-selected"
                )}
              >
                {event.homeOdds?.toFixed(2)}
              </button>
              <button
                onClick={() => onOddsClick("Away", event.awayOdds, event.outcomes?.Away)}
                className={cn(
                  "odds-button w-full min-w-0 lg:w-auto lg:min-w-[60px]",
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
            className="h-8 shrink-0 px-1.5 text-[10px] font-bold text-primary hover:text-primary-bright hover:bg-primary/10 sm:px-2 sm:text-[11px]"
          >
            +{event.marketCount}
            <ChevronRight className="h-3 w-3 ml-0.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
