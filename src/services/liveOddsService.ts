import { useCallback, useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export interface LiveOdds {
  eventId: string;
  marketId: string;
  odds: number;
  previousOdds?: number;
  trend?: "up" | "down" | "stable";
  lastUpdate: string;
}

export interface LiveEvent {
  id: string;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  isLive: boolean;
  score?: { home: number; away: number };
  markets: {
    id: string;
    name: string;
    outcomes: Array<{
      id: string;
      name: string;
      odds: number;
      previousOdds?: number;
      trend?: "up" | "down" | "stable";
    }>;
  }[];
}

interface EventRow {
  id: string;
  sport_id: string;
  league_id: string | null;
  home_team: string;
  away_team: string;
  start_time: string;
  status: string;
  live_score_home: number | null;
  live_score_away: number | null;
}

interface SportRow {
  id: string;
  name: string;
}

interface LeagueRow {
  id: string;
  name: string;
}

interface MarketRow {
  id: string;
  event_id: string;
  name: string;
  status: string;
}

interface OddsRow {
  id: string;
  market_id: string;
  selection: string;
  value: number;
  updated_at: string | null;
}

function getTrend(currentOdds: number, previousOdds?: number) {
  if (previousOdds === undefined) {
    return "stable" as const;
  }

  if (currentOdds > previousOdds) {
    return "up" as const;
  }

  if (currentOdds < previousOdds) {
    return "down" as const;
  }

  return "stable" as const;
}

function mergePreviousOdds(previousEvents: LiveEvent[], nextEvents: LiveEvent[]) {
  const previousOutcomeOdds = new Map<string, number>();

  previousEvents.forEach((event) => {
    event.markets.forEach((market) => {
      market.outcomes.forEach((outcome) => {
        previousOutcomeOdds.set(outcome.id, outcome.odds);
      });
    });
  });

  return nextEvents.map((event) => ({
    ...event,
    markets: event.markets.map((market) => ({
      ...market,
      outcomes: market.outcomes.map((outcome) => {
        const previousOdds = previousOutcomeOdds.get(outcome.id);
        return {
          ...outcome,
          previousOdds,
          trend: getTrend(outcome.odds, previousOdds),
        };
      }),
    })),
  }));
}

async function fetchLiveEvents(limit = 8) {
  const { data: eventRows, error: eventError } = await supabase
    .from("events")
    .select("id, sport_id, league_id, home_team, away_team, start_time, status, live_score_home, live_score_away")
    .in("status", ["live", "upcoming"])
    .order("start_time", { ascending: true })
    .limit(limit);

  if (eventError) {
    return { events: [] as LiveEvent[], error: eventError.message };
  }

  const events = (eventRows ?? []) as EventRow[];
  if (events.length === 0) {
    return { events: [] as LiveEvent[], error: null };
  }

  const sportIds = [...new Set(events.map((event) => event.sport_id))];
  const leagueIds = [...new Set(events.map((event) => event.league_id).filter(Boolean))] as string[];
  const eventIds = events.map((event) => event.id);

  const [{ data: sportRows, error: sportError }, { data: leagueRows, error: leagueError }, { data: marketRows, error: marketError }] =
    await Promise.all([
      sportIds.length > 0 ? supabase.from("sports").select("id, name").in("id", sportIds) : Promise.resolve({ data: [], error: null }),
      leagueIds.length > 0 ? supabase.from("leagues").select("id, name").in("id", leagueIds) : Promise.resolve({ data: [], error: null }),
      supabase.from("markets").select("id, event_id, name, status").in("event_id", eventIds).eq("status", "active"),
    ]);

  if (sportError || leagueError || marketError) {
    return {
      events: [] as LiveEvent[],
      error: sportError?.message || leagueError?.message || marketError?.message || "Live feed could not be loaded",
    };
  }

  const markets = (marketRows ?? []) as MarketRow[];
  const marketIds = markets.map((market) => market.id);

  const { data: oddsRows, error: oddsError } =
    marketIds.length > 0
      ? await supabase
          .from("odds")
          .select("id, market_id, selection, value, updated_at")
          .in("market_id", marketIds)
          .eq("is_active", true)
          .eq("is_locked", false)
      : { data: [], error: null };

  if (oddsError) {
    return { events: [] as LiveEvent[], error: oddsError.message };
  }

  const sportsById = new Map(((sportRows ?? []) as SportRow[]).map((sport) => [sport.id, sport.name]));
  const leaguesById = new Map(((leagueRows ?? []) as LeagueRow[]).map((league) => [league.id, league.name]));
  const oddsByMarketId = new Map<string, OddsRow[]>();

  ((oddsRows ?? []) as OddsRow[]).forEach((odd) => {
    const existing = oddsByMarketId.get(odd.market_id) ?? [];
    existing.push(odd);
    oddsByMarketId.set(odd.market_id, existing);
  });

  const marketsByEventId = new Map<string, LiveEvent["markets"]>();

  markets.forEach((market) => {
    const outcomes = (oddsByMarketId.get(market.id) ?? []).map((odd) => ({
      id: odd.id,
      name: odd.selection,
      odds: Number(odd.value),
      previousOdds: undefined,
      trend: "stable" as const,
    }));

    if (outcomes.length === 0) {
      return;
    }

    const existing = marketsByEventId.get(market.event_id) ?? [];
    existing.push({
      id: market.id,
      name: market.name,
      outcomes,
    });
    marketsByEventId.set(market.event_id, existing);
  });

  const liveEvents = events
    .map((event) => ({
      id: event.id,
      sport: sportsById.get(event.sport_id) ?? "Sport",
      league: event.league_id ? leaguesById.get(event.league_id) ?? "League" : "League",
      homeTeam: event.home_team,
      awayTeam: event.away_team,
      startTime: event.start_time,
      isLive: event.status === "live",
      score:
        event.live_score_home !== null && event.live_score_away !== null
          ? { home: event.live_score_home, away: event.live_score_away }
          : undefined,
      markets: marketsByEventId.get(event.id) ?? [],
    }))
    .filter((event) => event.markets.length > 0);

  return { events: liveEvents, error: null };
}

export const liveOddsService = {
  fetchLiveEvents,
};

export function useLiveOdds() {
  const [connected, setConnected] = useState(false);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshEvents = useCallback(async () => {
    const result = await fetchLiveEvents();

    if (result.error) {
      setError(result.error);
      return;
    }

    setError(null);
    setLiveEvents((previousEvents) => mergePreviousOdds(previousEvents, result.events));
  }, []);

  useEffect(() => {
    let isMounted = true;
    const channel: RealtimeChannel = supabase
      .channel("live-odds-feed-" + Date.now())
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => {
        void refreshEvents();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "markets" }, () => {
        void refreshEvents();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "odds" }, () => {
        void refreshEvents();
      });

    async function initialize() {
      await refreshEvents();

      if (!isMounted) {
        void supabase.removeChannel(channel);
        return;
      }

      channel.subscribe((status) => {
        if (!isMounted) {
          return;
        }

        setConnected(status === "SUBSCRIBED");

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setError("Realtime connection failed");
        }
      });
    }

    void initialize();

    return () => {
      isMounted = false;
      void supabase.removeChannel(channel);
    };
  }, [refreshEvents]);

  return { connected, liveEvents, error };
}