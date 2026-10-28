import { supabase } from "@/integrations/supabase/client";

const db = supabase;
import { useLiveOdds } from "@/services/liveOddsService";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Minus, Radio, Clock } from "lucide-react";
import { useBetSlip } from "@/hooks/useBetSlip";

export function LiveOddsFeed() {
  const { connected, liveEvents, error } = useLiveOdds();
  const { addBet } = useBetSlip();

  if (error) {
    return (
      <Card className="surface">
        <CardContent className="p-6 text-center">
          <p className="text-sm text-muted-foreground">Unable to load live odds</p>
        </CardContent>
      </Card>
    );
  }

  if (liveEvents.length === 0) {
    return (
      <Card className="surface">
        <CardContent className="p-6 text-center">
          <Radio className="h-12 w-12 mx-auto mb-3 text-muted-foreground animate-pulse" />
          <p className="text-sm text-muted-foreground">Connecting to live feed...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Radio className="h-5 w-5 text-danger animate-pulse" />
          Live Betting
        </h3>
        <Badge variant={connected ? "default" : "outline"} className={connected ? "bg-success/15 text-success" : ""}>
          {connected ? "● Live" : "○ Offline"}
        </Badge>
      </div>

      <div className="grid gap-3">
        {liveEvents.map(event => (
          <Card key={event.id} className="surface hover:border-primary/30 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-xs">
                      {event.sport}
                    </Badge>
                    {event.isLive && (
                      <Badge variant="destructive" className="text-xs animate-pulse">
                        ● LIVE
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{event.league}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">
                    {event.isLive ? (
                      <span className="flex items-center gap-1 text-danger">
                        <Clock className="h-3 w-3" />
                        In Progress
                      </span>
                    ) : (
                      new Date(event.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    )}
                  </p>
                </div>
              </div>

              <div className="mb-3">
                <div className="flex items-center justify-between py-2">
                  <span className="font-medium">{event.homeTeam}</span>
                  {event.score && <span className="text-xl font-bold font-mono">{event.score.home}</span>}
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="font-medium">{event.awayTeam}</span>
                  {event.score && <span className="text-xl font-bold font-mono">{event.score.away}</span>}
                </div>
              </div>

              {event.markets[0] && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">{event.markets[0].name}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {event.markets[0].outcomes.map(outcome => (
                      <Button
                        key={outcome.id}
                        variant="outline"
                        size="sm"
                        className="flex flex-col items-center p-2 h-auto hover:border-primary hover:bg-primary/5 transition-all"
                        onClick={() => addBet({
                          eventId: event.id,
                          marketId: event.markets[0].id,
                          oddsId: outcome.id,
                          event: `${event.homeTeam} vs ${event.awayTeam}`,
                          league: event.league,
                          market: event.markets[0].name,
                          selection: outcome.name,
                          odds: outcome.odds,
                        })}
                      >
                        <span className="text-xs mb-1 text-center line-clamp-1">{outcome.name}</span>
                        <div className="flex items-center gap-1">
                          <span className="font-bold font-mono text-primary">{outcome.odds.toFixed(2)}</span>
                          {outcome.trend === "up" && (
                            <TrendingUp className="h-3 w-3 text-success" />
                          )}
                          {outcome.trend === "down" && (
                            <TrendingDown className="h-3 w-3 text-danger" />
                          )}
                          {outcome.trend === "stable" && (
                            <Minus className="h-3 w-3 text-muted-foreground" />
                          )}
                        </div>
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}