import { useEffect, useState } from "react";
import { CircleDot, Flag, Goal, Star } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SportsbookMarket, SportsbookOutcome } from "@/types/sportsbook";
import { supabase } from "@/integrations/supabase/client";

type TimelineItem = { id: string; incident_type: string; match_minute: number | null; team_side: string | null; score_home: number | null; score_away: number | null; description: string | null; created_at: string };
type EventStatistics = { home_stats?: Record<string, number>; away_stats?: Record<string, number>; provider_updated_at?: string | null; updated_at?: string | null; [key: string]: unknown };
type LineupPlayer = { number?: number; name: string; position?: string };
type EventLineup = { id: string; team_side: string; team_name?: string; formation: string | null; players: LineupPlayer[] };

interface EventMarketsModalProps {
  event: {
    id: string;
    league: string;
    homeTeam: string;
    awayTeam: string;
    homeOdds: number;
    drawOdds?: number;
    awayOdds: number;
    startTime: string;
    isLive?: boolean;
    liveScore?: { home: number; away: number };
    liveMinute?: number;
    marketCount?: number;
    markets?: SportsbookMarket[];
  } | null;
  open: boolean;
  onClose: () => void;
  onOddsClick: (selection: string, odds: number, outcome?: SportsbookOutcome, market?: SportsbookMarket) => void;
  selectedOdds: Set<string>;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
}

export function EventMarketsModal({
  event,
  open,
  onClose,
  selectedOdds,
  onOddsClick,
  isFavorite = false,
  onToggleFavorite,
}: EventMarketsModalProps) {
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [statistics, setStatistics] = useState<EventStatistics | null>(null);
  const [lineups, setLineups] = useState<EventLineup[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  useEffect(() => {
    if (!open || !event?.id) { setTimeline([]); setStatistics(null); setLineups([]); return; }
    let active = true; setTimelineLoading(true);
    void Promise.all([
      (supabase as any).from("event_timeline").select("*").eq("event_id", event.id).order("match_minute", { ascending: false }).limit(50),
      (supabase as any).from("event_statistics").select("*").eq("event_id", event.id).maybeSingle(),
      (supabase as any).from("event_lineups").select("*").eq("event_id", event.id).order("team_side", { ascending: true }),
    ]).then(([timelineResult, statisticsResult, lineupsResult]) => { if (active) { setTimeline((timelineResult.data || []) as TimelineItem[]); setStatistics((statisticsResult.data || null) as EventStatistics | null); setLineups((lineupsResult.data || []) as EventLineup[]); setTimelineLoading(false); } });
    return () => { active = false; };
  }, [event?.id, open]);
  if (!event) return null;

  const markets = event.markets || [];
  const statisticRows = [
    ["Possession", "possession", "%"], ["Shots", "shots", ""], ["On target", "shots_on_target", ""],
    ["Corners", "corners", ""], ["Yellow cards", "yellow_cards", ""], ["Red cards", "red_cards", ""],
  ] as const;
  const statisticValue = (side: "home" | "away", key: string) => Number(statistics?.[`${key}_${side}`] ?? statistics?.[`${side}_stats`]?.[key] ?? 0);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0">
        <DialogHeader className="p-6 pb-4 border-b border-border">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm text-muted-foreground">{event.league}</span>
                {event.isLive && event.liveScore && (
                  <Badge variant="outline" className="badge-live gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                    <span className="text-[10px] font-semibold">LIVE</span>
                    <span className="text-[10px] font-mono">
                      {event.liveScore.home}-{event.liveScore.away}
                    </span>
                    {event.liveMinute && <span className="text-[10px]">{event.liveMinute}&apos;</span>}
                  </Badge>
                )}
              </div>
              <DialogTitle className="text-2xl">
                {event.homeTeam} vs {event.awayTeam}
              </DialogTitle>
            </div>
            {onToggleFavorite && <Button variant="ghost" size="icon" aria-label={isFavorite ? "Remove event from favorites" : "Add event to favorites"} onClick={onToggleFavorite}>
              <Star className={`h-5 w-5 ${isFavorite ? "fill-gold text-gold" : "text-muted-foreground"}`} />
            </Button>}
          </div>
        </DialogHeader>

        <ScrollArea className="h-[62vh]">
          <div className="p-6 space-y-6">
            {event.isLive && <section className="rounded-lg border border-danger/20 bg-danger/5 p-4"><div className="mb-3 flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-bold"><CircleDot className="h-4 w-4 text-danger" />Live match timeline</h3>{event.liveScore && <span className="font-mono text-sm font-black">{event.liveScore.home}–{event.liveScore.away}</span>}</div>{timelineLoading ? <p className="text-xs text-muted-foreground">Loading incidents…</p> : timeline.length === 0 ? <p className="text-xs text-muted-foreground">No detailed provider incidents received yet. Score and minute will continue to update.</p> : <div className="space-y-2">{timeline.map((item) => <div key={item.id} className="grid grid-cols-[44px_20px_1fr_auto] items-center gap-2 rounded border border-border bg-background/70 p-2 text-xs"><span className="font-mono font-bold">{item.match_minute ?? "–"}&apos;</span>{item.incident_type === "goal" ? <Goal className="h-4 w-4 text-success" /> : item.incident_type === "red_card" ? <span className="h-4 w-3 rounded-sm bg-danger" /> : <Flag className="h-4 w-4 text-warning" />}<span className="capitalize">{item.description || item.incident_type.replaceAll("_", " ")}{item.team_side && item.team_side !== "neutral" ? ` · ${item.team_side}` : ""}</span>{item.score_home !== null && item.score_away !== null && <span className="font-mono font-bold">{item.score_home}–{item.score_away}</span>}</div>)}</div>}</section>}
            {statistics && <section className="rounded-lg border border-border bg-surface/60 p-4"><div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-bold">Match statistics</h3>{(statistics.provider_updated_at || statistics.updated_at) && <span className="text-[10px] text-muted-foreground">Updated {new Date(String(statistics.provider_updated_at || statistics.updated_at)).toLocaleTimeString()}</span>}</div><div className="space-y-3">{statisticRows.map(([label, key, suffix]) => { const home = statisticValue("home", key); const away = statisticValue("away", key); const total = Math.max(home + away, 1); return <div key={key}><div className="mb-1 grid grid-cols-[42px_1fr_42px] items-center gap-3 text-xs"><span className="text-right font-mono font-bold">{home}{suffix}</span><span className="text-center text-muted-foreground">{label}</span><span className="font-mono font-bold">{away}{suffix}</span></div><div className="grid grid-cols-2 gap-1"><div className="flex h-1.5 justify-end overflow-hidden rounded-l bg-muted"><span className="h-full bg-primary" style={{ width: `${(home / total) * 100}%` }} /></div><div className="h-1.5 overflow-hidden rounded-r bg-muted"><span className="block h-full bg-warning" style={{ width: `${(away / total) * 100}%` }} /></div></div></div>; })}</div></section>}
            {lineups.length > 0 && <section className="rounded-lg border border-border p-4"><h3 className="mb-4 text-sm font-bold">Confirmed lineups</h3><div className="grid gap-4 md:grid-cols-2">{lineups.map((lineup) => <div key={lineup.id} className="rounded border border-border bg-background/70 p-3"><div className="mb-3 flex items-center justify-between"><span className="font-semibold">{lineup.team_name || (lineup.team_side === "home" ? event.homeTeam : event.awayTeam)}</span>{lineup.formation && <Badge variant="outline">{lineup.formation}</Badge>}</div><div className="space-y-1.5">{(lineup.players || []).map((player, index) => <div key={`${lineup.id}-${player.number || index}`} className="grid grid-cols-[28px_1fr_auto] items-center text-xs"><span className="font-mono text-muted-foreground">{player.number || "–"}</span><span>{player.name}</span><span className="text-[10px] text-muted-foreground">{player.position || ""}</span></div>)}</div></div>)}</div></section>}
            {markets.length === 0 ? (
              <div className="text-center py-12">
                <p className="font-semibold mb-1">Markets unavailable</p>
                <p className="text-sm text-muted-foreground">
                  This event is preview-only or its markets are currently suspended.
                </p>
              </div>
            ) : (
              markets.map((market) => (
                <section key={market.id} className="space-y-3">
                  <h3 className="font-semibold text-sm">{market.name}</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {market.outcomes.map((outcome) => {
                      const selected = selectedOdds.has(outcome.id);
                      return (
                        <button
                          key={outcome.id}
                          onClick={() => onOddsClick(outcome.selection, outcome.value, outcome, market)}
                          className={`odds-button p-3 text-left ${selected ? "odds-button-selected" : ""}`}
                        >
                          <div className="text-sm font-medium mb-1">{outcome.selection}</div>
                          <div className="font-mono font-bold text-lg">{outcome.value.toFixed(2)}</div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
