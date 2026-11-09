import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/database.types";
import type {
  SportsbookEvent,
  SportsbookMarket,
  SportsbookOutcome,
} from "@/types/sportsbook";
import { leagueCountryCode, teamCountryCode } from "@/lib/countryFlags";

type Event = Database["public"]["Tables"]["events"]["Row"];
type Market = Database["public"]["Tables"]["markets"]["Row"];
type Odds = Database["public"]["Tables"]["odds"]["Row"];

type RawSportsbookEvent = Event & {
  leagues: { name: string; country: string | null } | null;
  sports: { name: string; slug: string } | null;
  markets: Array<Market & { odds: Odds[] }>;
};

const db = supabase;

function formatKickoff(value: string) {
  const kickoff = new Date(value);
  if (Number.isNaN(kickoff.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(kickoff);
}

function outcomeKey(selection: string): "Home" | "Draw" | "Away" | null {
  const normalized = selection.trim().toLowerCase();
  if (["home", "1", "team 1"].includes(normalized)) return "Home";
  if (["draw", "x", "tie"].includes(normalized)) return "Draw";
  if (["away", "2", "team 2"].includes(normalized)) return "Away";
  return null;
}

function mapSportsbookEvent(event: RawSportsbookEvent): SportsbookEvent {
  const markets: SportsbookMarket[] = (event.markets || [])
    .filter((market) => market.status === "active")
    .map((market) => ({
      id: market.id,
      name: market.name,
      type: market.type,
      outcomes: (market.odds || [])
        .filter((odd) => odd.is_active && !odd.is_locked)
        .map((odd): SportsbookOutcome => ({
          id: odd.id,
          marketId: market.id,
          selection: odd.selection,
          value: Number(odd.value),
        })),
    }));

  const primaryMarket = markets.find((market) => market.type === "match_result")
    || markets.find((market) => market.outcomes.length > 0);
  const outcomes: SportsbookEvent["outcomes"] = {};

  for (const outcome of primaryMarket?.outcomes || []) {
    const key = outcomeKey(outcome.selection);
    if (key) outcomes[key] = outcome;
  }

  const isLive = event.status === "live";
  const hasScore = event.live_score_home != null || event.live_score_away != null;
  const metadata = event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
    ? event.metadata as Record<string, unknown>
    : {};
  const providerScore = metadata.providerScore && typeof metadata.providerScore === "object" && !Array.isArray(metadata.providerScore)
    ? metadata.providerScore as Record<string, unknown>
    : null;
  const providerVisuals = metadata.providerVisuals && typeof metadata.providerVisuals === "object" && !Array.isArray(metadata.providerVisuals)
    ? metadata.providerVisuals as Record<string, unknown>
    : null;
  const eventLeagueCountryCode = leagueCountryCode(event.leagues?.name, event.leagues?.country);

  return {
    id: event.id,
    sport: event.sports?.name || "Sport",
    sportSlug: event.sports?.slug || "sport",
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    league: event.leagues?.name || "Imported fixtures",
    leagueCountryCode: eventLeagueCountryCode,
    leagueLogoUrl: typeof providerVisuals?.leagueLogoUrl === "string" ? providerVisuals.leagueLogoUrl : undefined,
    homeCountryCode: teamCountryCode(event.home_team, eventLeagueCountryCode),
    awayCountryCode: teamCountryCode(event.away_team, eventLeagueCountryCode),
    homeTeamLogoUrl: typeof providerVisuals?.homeTeamLogoUrl === "string" ? providerVisuals.homeTeamLogoUrl : undefined,
    awayTeamLogoUrl: typeof providerVisuals?.awayTeamLogoUrl === "string" ? providerVisuals.awayTeamLogoUrl : undefined,
    startTime: formatKickoff(event.start_time),
    startTimeIso: event.start_time,
    isLive,
    liveScore: hasScore
      ? {
          home: Number(event.live_score_home || 0),
          away: Number(event.live_score_away || 0),
          homeDisplay: typeof providerScore?.home === "string" ? providerScore.home : undefined,
          awayDisplay: typeof providerScore?.away === "string" ? providerScore.away : undefined,
          updatedAt: typeof providerScore?.updatedAt === "string" ? providerScore.updatedAt : undefined,
        }
      : undefined,
    liveMinute: event.live_minute ?? undefined,
    homeOdds: outcomes.Home?.value || 0,
    drawOdds: outcomes.Draw?.value,
    awayOdds: outcomes.Away?.value || 0,
    marketCount: markets.length,
    outcomes,
    markets,
  };
}

function isBettableEvent(event: SportsbookEvent) {
  return event.markets.some((market) =>
    market.outcomes.filter((outcome) =>
      Number.isFinite(outcome.value) && outcome.value > 1
    ).length >= 2
  );
}

const eventSelect = "*, leagues(name, country), sports(name, slug), markets(*, odds(*))";

export async function fetchLiveEvents(): Promise<SportsbookEvent[]> {
  const { data: events, error } = await db
    .from("events")
    .select(eventSelect)
    .eq("status", "live")
    .eq("is_suspended", false)
    .order("start_time", { ascending: true });

  if (error) throw error;
  return ((events || []) as unknown as RawSportsbookEvent[])
    .map(mapSportsbookEvent)
    .filter(isBettableEvent);
}

export async function fetchUpcomingEvents(sportSlug?: string): Promise<SportsbookEvent[]> {
  let query = db
    .from("events")
    .select(eventSelect)
    .in("status", ["upcoming", "live"])
    .eq("is_suspended", false)
    .order("start_time", { ascending: true })
    .limit(50);

  if (sportSlug) {
    const { data: sport, error: sportError } = await db
      .from("sports")
      .select("id")
      .eq("slug", sportSlug)
      .maybeSingle();

    if (sportError) throw sportError;
    if (!sport) return [];
    query = query.eq("sport_id", sport.id);
  }

  const { data: events, error } = await query;
  if (error) throw error;
  return ((events || []) as unknown as RawSportsbookEvent[])
    .map(mapSportsbookEvent)
    .filter(isBettableEvent);
}

export async function fetchEventById(eventId: string) {
  const { data: event } = await db
    .from("events")
    .select("*, leagues(*), sports(*)")
    .eq("id", eventId)
    .single();
  return event;
}

export async function fetchMarketsByEventId(eventId: string) {
  const { data: markets } = await db
    .from("markets")
    .select("*")
    .eq("event_id", eventId)
    .eq("status", "active");
  return markets || [];
}

export async function fetchOddsByMarketId(marketId: string): Promise<Odds[]> {
  const { data: odds } = await db
    .from("odds")
    .select("*")
    .eq("market_id", marketId)
    .eq("is_active", true);
  return odds || [];
}

export async function enrichMarketWithOdds(market: Market): Promise<Market & { odds: Odds[] }> {
  const odds = await fetchOddsByMarketId(market.id);
  return { ...market, odds };
}

export async function enrichEventWithMarkets(event: Event): Promise<Event & { markets: Array<Market & { odds: Odds[] }> }> {
  const markets = await fetchMarketsByEventId(event.id);
  const enrichedMarkets = await Promise.all(markets.map(enrichMarketWithOdds));
  return { ...event, markets: enrichedMarkets };
}

export async function fetchEventDetails(eventId: string): Promise<(Event & { markets: Array<Market & { odds: Odds[] }> }) | null> {
  const event = await fetchEventById(eventId);
  if (!event) return null;
  return enrichEventWithMarkets(event);
}
