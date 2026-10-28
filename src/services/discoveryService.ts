import { supabase } from "@/integrations/supabase/client";

export interface SportsbookSearchResult {
  id: string;
  type: "event" | "league" | "sport";
  title: string;
  subtitle: string;
  isLive?: boolean;
  icon?: string | null;
  href: string;
}

export interface SportsbookResult {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  startTime: string;
  status: string;
  league: string;
  sport: string;
  sportSlug: string;
  settledMarkets: Array<{ id: string; name: string; result: string }>;
}

export interface SportsbookStatistics {
  totalEvents: number;
  liveEvents: number;
  finishedEvents: number;
  upcomingEvents: number;
  settledMarkets: number;
  sports: Array<{
    name: string;
    slug: string;
    total: number;
    live: number;
    finished: number;
  }>;
}

type SearchEventRow = {
  id: string;
  home_team: string;
  away_team: string;
  start_time: string;
  status: string | null;
  leagues: { name: string } | null;
  sports: { name: string; slug: string };
};

type ResultEventRow = SearchEventRow & {
  live_score_home: number | null;
  live_score_away: number | null;
  markets: Array<{ id: string; name: string; result: string | null; status: string | null }> | null;
};

function safePattern(query: string) {
  return `%${query.trim().replace(/[\\%_]/g, "\\$&")}%`;
}

function eventToSearchResult(event: SearchEventRow): SportsbookSearchResult {
  const isLive = event.status === "live";
  return {
    id: event.id,
    type: "event",
    title: `${event.home_team} vs ${event.away_team}`,
    subtitle: `${event.leagues?.name || event.sports.name} • ${isLive ? "Live now" : new Date(event.start_time).toLocaleString()}`,
    isLive,
    icon: "🏆",
    href: `${isLive ? "/live" : "/sports"}?event=${event.id}`,
  };
}

export async function searchSportsbook(query: string): Promise<{
  results: SportsbookSearchResult[];
  error?: string;
}> {
  try {
    const normalized = query.trim();
    const eventSelect = "id, home_team, away_team, start_time, status, leagues(name), sports!inner(name, slug)";

    if (!normalized) {
      const { data, error } = await supabase
        .from("events")
        .select(eventSelect)
        .in("status", ["upcoming", "live"])
        .eq("is_suspended", false)
        .order("start_time", { ascending: true })
        .limit(8);
      if (error) throw error;
      return { results: ((data || []) as unknown as SearchEventRow[]).map(eventToSearchResult) };
    }

    const pattern = safePattern(normalized);
    const [homeEvents, awayEvents, leagues, sports] = await Promise.all([
      supabase.from("events").select(eventSelect).in("status", ["upcoming", "live"]).eq("is_suspended", false).ilike("home_team", pattern).limit(8),
      supabase.from("events").select(eventSelect).in("status", ["upcoming", "live"]).eq("is_suspended", false).ilike("away_team", pattern).limit(8),
      supabase.from("leagues").select("id, name, country, sports(name, slug)").eq("is_active", true).ilike("name", pattern).limit(5),
      supabase.from("sports").select("id, name, slug, icon").eq("is_active", true).ilike("name", pattern).limit(5),
    ]);

    const error = homeEvents.error || awayEvents.error || leagues.error || sports.error;
    if (error) throw error;

    const eventMap = new Map<string, SearchEventRow>();
    for (const event of [...(homeEvents.data || []), ...(awayEvents.data || [])] as unknown as SearchEventRow[]) {
      eventMap.set(event.id, event);
    }

    const eventResults = [...eventMap.values()].slice(0, 8).map(eventToSearchResult);
    const leagueResults: SportsbookSearchResult[] = (leagues.data || []).map((league) => {
      const sport = league.sports as unknown as { name: string; slug: string } | null;
      return {
        id: league.id,
        type: "league",
        title: league.name,
        subtitle: `${sport?.name || "Sport"}${league.country ? ` • ${league.country}` : ""}`,
        icon: "🏅",
        href: sport?.slug ? `/sports?sport=${encodeURIComponent(sport.slug)}` : "/sports",
      };
    });
    const sportResults: SportsbookSearchResult[] = (sports.data || []).map((sport) => ({
      id: sport.id,
      type: "sport",
      title: sport.name,
      subtitle: "Browse active events",
      icon: sport.icon || "🏆",
      href: `/sports?sport=${encodeURIComponent(sport.slug)}`,
    }));

    return { results: [...eventResults, ...leagueResults, ...sportResults].slice(0, 15) };
  } catch (error) {
    console.error("Sportsbook search failed", error);
    return { results: [], error: error instanceof Error ? error.message : "Search unavailable" };
  }
}

export async function getSportsbookResults(options?: {
  sportSlug?: string;
  limit?: number;
}): Promise<{ results: SportsbookResult[]; error?: string }> {
  try {
    let query = supabase
      .from("events")
      .select(`
        id, home_team, away_team, start_time, status,
        live_score_home, live_score_away,
        leagues(name), sports!inner(name, slug),
        markets(id, name, result, status)
      `)
      .in("status", ["finished", "cancelled"])
      .order("start_time", { ascending: false })
      .limit(options?.limit || 100);

    if (options?.sportSlug) query = query.eq("sports.slug", options.sportSlug);
    const { data, error } = await query;
    if (error) throw error;

    const results = ((data || []) as unknown as ResultEventRow[]).map((event) => ({
      id: event.id,
      homeTeam: event.home_team,
      awayTeam: event.away_team,
      homeScore: event.live_score_home,
      awayScore: event.live_score_away,
      startTime: event.start_time,
      status: event.status || "finished",
      league: event.leagues?.name || event.sports.name,
      sport: event.sports.name,
      sportSlug: event.sports.slug,
      settledMarkets: (event.markets || [])
        .filter((market) => market.status === "settled" && market.result)
        .map((market) => ({ id: market.id, name: market.name, result: market.result || "" })),
    }));
    return { results };
  } catch (error) {
    console.error("Results load failed", error);
    return { results: [], error: error instanceof Error ? error.message : "Results unavailable" };
  }
}

export async function getSportsbookStatistics(): Promise<{
  statistics: SportsbookStatistics | null;
  error?: string;
}> {
  try {
    const { data, error } = await supabase
      .from("events")
      .select("id, status, sports!inner(name, slug), markets(status)")
      .order("start_time", { ascending: false })
      .limit(1000);
    if (error) throw error;

    type Row = {
      id: string;
      status: string | null;
      sports: { name: string; slug: string };
      markets: Array<{ status: string | null }> | null;
    };
    const rows = (data || []) as unknown as Row[];
    const sportMap = new Map<string, SportsbookStatistics["sports"][number]>();

    for (const event of rows) {
      const current = sportMap.get(event.sports.slug) || {
        name: event.sports.name,
        slug: event.sports.slug,
        total: 0,
        live: 0,
        finished: 0,
      };
      current.total += 1;
      if (event.status === "live") current.live += 1;
      if (event.status === "finished") current.finished += 1;
      sportMap.set(event.sports.slug, current);
    }

    return {
      statistics: {
        totalEvents: rows.length,
        liveEvents: rows.filter((event) => event.status === "live").length,
        finishedEvents: rows.filter((event) => event.status === "finished").length,
        upcomingEvents: rows.filter((event) => event.status === "upcoming").length,
        settledMarkets: rows.reduce(
          (total, event) => total + (event.markets || []).filter((market) => market.status === "settled").length,
          0
        ),
        sports: [...sportMap.values()].sort((left, right) => right.total - left.total),
      },
    };
  } catch (error) {
    console.error("Statistics load failed", error);
    return { statistics: null, error: error instanceof Error ? error.message : "Statistics unavailable" };
  }
}
