import { z } from "zod";

export const providerTypes = ["openligadb", "the_odds_api", "thesportsdb_demo", "thesportsdb_live", "sportmonks"] as const;
export type SportsProviderType = (typeof providerTypes)[number];

export interface SportsProviderConfig {
  id: string;
  name: string;
  provider_type: SportsProviderType;
  encrypted_api_key?: string | null;
  settings: Record<string, unknown> | null;
  is_enabled: boolean;
  is_demo: boolean;
}

export interface NormalizedSportsEvent {
  updateId: string;
  providerId: string;
  providerEventId: string;
  sport: { name: string; slug: string; icon?: string };
  league: { name: string; slug: string; country?: string };
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  status: "upcoming" | "live" | "finished" | "cancelled" | "postponed";
  homeScore?: number | null;
  awayScore?: number | null;
  scoreLabels?: { home: string | null; away: string | null };
  scoreUpdatedAt?: string | null;
  liveMinute?: number | null;
  markets: Array<{
    name: string;
    type: string;
    line?: number | null;
    status?: "active" | "suspended";
    outcomes: Array<{
      selection: string;
      value: number;
      active?: boolean;
    }>;
  }>;
}

const sportsDbEventSchema = z.object({
  idEvent: z.union([z.string(), z.number()]).transform(String),
  strTimestamp: z.string().nullish(),
  dateEvent: z.string().nullish(),
  strTime: z.string().nullish(),
  strSport: z.string().nullish(),
  strLeague: z.string().nullish(),
  strCountry: z.string().nullish(),
  strHomeTeam: z.string().nullish(),
  strAwayTeam: z.string().nullish(),
  intHomeScore: z.union([z.string(), z.number()]).nullish(),
  intAwayScore: z.union([z.string(), z.number()]).nullish(),
  strStatus: z.string().nullish(),
  strProgress: z.string().nullish(),
  strPostponed: z.string().nullish(),
}).passthrough();

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function score(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
}

function isoTimestamp(timestamp?: string | null, date?: string | null, time?: string | null) {
  const candidate = timestamp || (date ? `${date}T${time || "00:00:00"}` : null);
  if (!candidate) return new Date().toISOString();
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(candidate) ? candidate : `${candidate}Z`;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function sportsDbStatus(statusValue?: string | null, postponed?: string | null) {
  const status = (statusValue || "").toUpperCase();
  if ((postponed || "").toLowerCase() === "yes" || ["PST", "POSTPONED"].includes(status)) return "postponed" as const;
  if (["CANC", "CANCELLED", "ABD", "ABANDONED"].includes(status)) return "cancelled" as const;
  if (["FT", "AET", "PEN", "FINAL", "FINISHED"].includes(status)) return "finished" as const;
  if (["1H", "2H", "HT", "ET", "P", "BT", "INT", "LIVE", "IN PLAY"].includes(status)) return "live" as const;
  return "upcoming" as const;
}

function normalizeSportsDbEvent(rawValue: unknown, providerId: string): NormalizedSportsEvent | null {
  const parsed = sportsDbEventSchema.safeParse(rawValue);
  if (!parsed.success) return null;
  const raw = parsed.data;
  if (!raw.strHomeTeam || !raw.strAwayTeam) return null;
  const status = sportsDbStatus(raw.strStatus, raw.strPostponed);
  const homeScore = score(raw.intHomeScore);
  const awayScore = score(raw.intAwayScore);
  const minuteMatch = raw.strProgress?.match(/\d+/);
  const sportName = raw.strSport || "Soccer";
  const leagueName = raw.strLeague || "Imported fixtures";
  const startTime = isoTimestamp(raw.strTimestamp, raw.dateEvent, raw.strTime);
  return {
    updateId: `${raw.idEvent}:${status}:${homeScore ?? "x"}:${awayScore ?? "x"}:${raw.strProgress || startTime}`,
    providerId,
    providerEventId: raw.idEvent,
    sport: { name: sportName === "Soccer" ? "Football" : sportName, slug: sportName === "Soccer" ? "football" : slugify(sportName), icon: sportName === "Soccer" ? "⚽" : "🏆" },
    league: { name: leagueName, slug: slugify(leagueName), country: raw.strCountry || undefined },
    homeTeam: raw.strHomeTeam,
    awayTeam: raw.strAwayTeam,
    startTime,
    status,
    homeScore,
    awayScore,
    liveMinute: status === "live" && minuteMatch ? Number(minuteMatch[0]) : null,
    markets: [],
  };
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
  return response.json();
}

function arrayFromProviderBody(body: any) {
  if (Array.isArray(body)) return body;
  for (const key of ["events", "livescore", "livescores", "data"]) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  return [];
}

async function fetchSportsDb(config: SportsProviderConfig, apiKey: string | null) {
  const settings = config.settings || {};
  if (config.provider_type === "thesportsdb_demo") {
    const leagueId = String(settings.leagueId || "4328").replace(/[^0-9]/g, "") || "4328";
    const today = new Date().toISOString().slice(0, 10);
    const [teamProbe, ...scheduleResponses] = await Promise.allSettled([
      fetchJson("https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=Arsenal"),
      fetchJson(`https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=${today}&l=${leagueId}`),
      fetchJson(`https://www.thesportsdb.com/api/v1/json/123/eventsnextleague.php?id=${leagueId}`),
    ]);

    if (teamProbe.status === "rejected") {
      throw new Error("TheSportsDB free v1 connection check failed");
    }
    const arsenal = Array.isArray((teamProbe.value as any)?.teams)
      ? (teamProbe.value as any).teams.find((team: any) => String(team?.strTeam || "").toLowerCase() === "arsenal")
      : null;
    if (!arsenal?.idTeam) {
      throw new Error("TheSportsDB free v1 returned an invalid Arsenal team response");
    }

    const rawEvents = scheduleResponses.flatMap((response) =>
      response.status === "fulfilled" ? arrayFromProviderBody(response.value) : []
    );
    const uniqueEvents = [...new Map(rawEvents.map((event: any) => [String(event?.idEvent || ""), event])).values()];
    return uniqueEvents.map((item) => normalizeSportsDbEvent(item, config.id)).filter(Boolean) as NormalizedSportsEvent[];
  }

  if (!apiKey) throw new Error("TheSportsDB Live API key is missing");
  const sport = slugify(String(settings.sport || "soccer"));
  const body = await fetchJson(`https://www.thesportsdb.com/api/v2/json/livescore/${sport}`, {
    headers: { "X-API-KEY": apiKey },
  });
  return arrayFromProviderBody(body).map((item) => normalizeSportsDbEvent(item, config.id)).filter(Boolean) as NormalizedSportsEvent[];
}

const oddsApiEventSchema = z.object({
  id: z.string().min(1),
  sport_key: z.string().min(1),
  sport_title: z.string().min(1),
  commence_time: z.string().min(1),
  home_team: z.string().min(1),
  away_team: z.string().min(1),
  bookmakers: z.array(z.object({
    key: z.string(),
    title: z.string(),
    last_update: z.string().nullish(),
    markets: z.array(z.object({
      key: z.string(),
      last_update: z.string().nullish(),
      outcomes: z.array(z.object({
        name: z.string(),
        price: z.number(),
        point: z.number().nullish(),
      }).passthrough()),
    }).passthrough()),
  }).passthrough()),
}).passthrough();

const oddsApiSportSchema = z.object({
  key: z.string().min(1),
  group: z.string().min(1),
  title: z.string().min(1),
  active: z.boolean(),
  has_outrights: z.boolean().optional(),
}).passthrough();

const oddsApiScoreEventSchema = z.object({
  id: z.string().min(1),
  completed: z.boolean(),
  home_team: z.string().min(1),
  away_team: z.string().min(1),
  scores: z.array(z.object({
    name: z.string().min(1),
    score: z.union([z.string(), z.number()]).transform(String),
  }).passthrough()).nullable(),
  last_update: z.string().nullish(),
}).passthrough();

// Major competitions that The Odds API currently marks as supporting
// Scores & Results in its official sports coverage table.
const verifiedResultSportKeys = [
  "americanfootball_nfl",
  "baseball_mlb",
  "basketball_nba",
  "basketball_wnba",
  "basketball_ncaab",
  "icehockey_nhl",
  "soccer_epl",
  "soccer_uefa_champs_league",
  "soccer_spain_la_liga",
  "soccer_germany_bundesliga",
  "soccer_italy_serie_a",
  "soccer_france_ligue_one",
] as const;

function cricketScoreNumber(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function oddsApiSport(sportKey: string, sportTitle: string) {
  const prefix = sportKey.toLowerCase().split("_")[0];
  const known: Record<string, { name: string; slug: string; icon: string }> = {
    soccer: { name: "Football", slug: "football", icon: "⚽" },
    cricket: { name: "Cricket", slug: "cricket", icon: "🏏" },
    tennis: { name: "Tennis", slug: "tennis", icon: "🎾" },
    basketball: { name: "Basketball", slug: "basketball", icon: "🏀" },
    icehockey: { name: "Ice Hockey", slug: "ice-hockey", icon: "🏒" },
    baseball: { name: "Baseball", slug: "baseball", icon: "⚾" },
    americanfootball: { name: "American Football", slug: "american-football", icon: "🏈" },
    boxing: { name: "Boxing", slug: "boxing", icon: "🥊" },
    mma: { name: "MMA", slug: "mma", icon: "🥋" },
    golf: { name: "Golf", slug: "golf", icon: "⛳" },
    handball: { name: "Handball", slug: "handball", icon: "🤾" },
    tabletennis: { name: "Table Tennis", slug: "table-tennis", icon: "🏓" },
    volleyball: { name: "Volleyball", slug: "volleyball", icon: "🏐" },
    aussierules: { name: "Aussie Rules", slug: "aussie-rules", icon: "🏉" },
  };
  if (known[prefix]) return known[prefix];
  if (prefix.startsWith("rugby")) return { name: "Rugby", slug: "rugby", icon: "🏉" };

  const fallbackName = sportTitle.split(" - ")[0] || sportTitle || "Sport";
  return { name: fallbackName, slug: slugify(fallbackName), icon: "🏆" };
}

async function fetchTheOddsApi(config: SportsProviderConfig, apiKey: string | null) {
  if (!apiKey) throw new Error("The Odds API key is missing");

  const settings = config.settings || {};
  const sportKey = String(settings.sportKey || "soccer_epl").trim();
  const regions = String(settings.regions || "eu").trim().toLowerCase();
  const bookmakerKey = String(settings.bookmakerKey || "onexbet").trim().toLowerCase();
  const maxCompetitions = Math.min(Math.max(Number(settings.maxCompetitions || 8), 1), 20);

  if (!/^[a-z0-9_]{3,80}$/i.test(sportKey)) throw new Error("Invalid The Odds API sport key");
  if (!/^(us|us2|uk|eu|au|ca|fr|se|fi)(,(us|us2|uk|eu|au|ca|fr|se|fi))*$/.test(regions)) {
    throw new Error("Invalid The Odds API region");
  }

  let sportKeys = [sportKey];
  if (["cricket_active", "verified_results_active"].includes(sportKey)) {
    const sportsUrl = new URL("https://api.the-odds-api.com/v4/sports/");
    sportsUrl.searchParams.set("apiKey", apiKey);
    const sportsBody = await fetchJson(sportsUrl.toString());
    const activeSports = (Array.isArray(sportsBody) ? sportsBody : [])
      .map((value) => oddsApiSportSchema.safeParse(value))
      .filter((result) => result.success)
      .map((result) => result.data)
      .filter((sport) => sport.active && !sport.has_outrights);
    const excludedSportKeys = new Set(Array.isArray(settings.excludedSportKeys)
      ? settings.excludedSportKeys.filter((value): value is string => typeof value === "string")
      : []);

    if (sportKey === "cricket_active") {
      sportKeys = activeSports
        .filter((sport) => sport.group.toLowerCase() === "cricket" || sport.key.startsWith("cricket_"))
        .sort((left, right) => left.title.localeCompare(right.title))
        .slice(0, maxCompetitions)
        .map((sport) => sport.key);
    } else {
      const activeKeys = new Set(activeSports.map((sport) => sport.key));
      sportKeys = verifiedResultSportKeys
        .filter((key) => activeKeys.has(key) && !excludedSportKeys.has(key))
        .slice(0, maxCompetitions);
    }
    if (sportKeys.length === 0) return [];
  }

  const responses = await Promise.allSettled(sportKeys.map(async (activeSportKey) => {
    const url = new URL(`https://api.the-odds-api.com/v4/sports/${activeSportKey}/odds/`);
    url.searchParams.set("regions", regions);
    url.searchParams.set("markets", "h2h");
    url.searchParams.set("oddsFormat", "decimal");
    url.searchParams.set("dateFormat", "iso");
    url.searchParams.set("apiKey", apiKey);
    const scoresUrl = new URL(`https://api.the-odds-api.com/v4/sports/${activeSportKey}/scores/`);
    scoresUrl.searchParams.set("dateFormat", "iso");
    scoresUrl.searchParams.set("apiKey", apiKey);

    const [oddsResult, scoresResult] = await Promise.allSettled([
      fetchJson(url.toString()),
      fetchJson(scoresUrl.toString()),
    ]);
    if (oddsResult.status === "rejected") throw oddsResult.reason;
    return {
      odds: Array.isArray(oddsResult.value) ? oddsResult.value : [],
      scores: scoresResult.status === "fulfilled" && Array.isArray(scoresResult.value)
        ? scoresResult.value
        : [],
    };
  }));

  const rawEvents = responses.flatMap((response) => response.status === "fulfilled" ? response.value.odds : []);
  const rawScores = responses.flatMap((response) => response.status === "fulfilled" ? response.value.scores : []);
  if (rawEvents.length === 0 && responses.every((response) => response.status === "rejected")) {
    const firstFailure = responses.find((response) => response.status === "rejected");
    throw firstFailure && firstFailure.status === "rejected"
      ? firstFailure.reason
      : new Error("The Odds API cricket requests failed");
  }

  const scoresByEventId = new Map(rawScores.flatMap((value) => {
    const parsed = oddsApiScoreEventSchema.safeParse(value);
    return parsed.success ? [[parsed.data.id, parsed.data] as const] : [];
  }));

  const normalized = rawEvents.map((value): NormalizedSportsEvent | null => {
    const parsed = oddsApiEventSchema.safeParse(value);
    if (!parsed.success) return null;

    const event = parsed.data;
    const scoreEvent = scoresByEventId.get(event.id);
    const preferred = event.bookmakers.find((bookmaker) =>
      bookmaker.key.toLowerCase() === bookmakerKey
      && bookmaker.markets.some((market) => market.key === "h2h")
    );
    const bookmaker = preferred || event.bookmakers.find((candidate) =>
      candidate.markets.some((market) => market.key === "h2h")
    );
    const h2h = bookmaker?.markets.find((market) => market.key === "h2h");
    if (!bookmaker || !h2h) return null;

    const normalizedOutcomes = h2h.outcomes.flatMap((outcome) => {
      const selection = outcome.name === event.home_team
        ? "Home"
        : outcome.name === event.away_team
          ? "Away"
          : ["draw", "tie"].includes(outcome.name.toLowerCase())
            ? "Draw"
            : null;
      const value = Number(outcome.price);
      return selection && Number.isFinite(value) && value > 1
        ? [{ selection, value, active: true }]
        : [];
    });

    if (!normalizedOutcomes.some((outcome) => outcome.selection === "Home")
      || !normalizedOutcomes.some((outcome) => outcome.selection === "Away")) {
      return null;
    }

    const startTime = isoTimestamp(event.commence_time);
    const kickoffMs = new Date(startTime).getTime();
    const liveAgeMs = Date.now() - kickoffMs;
    const homeScoreLabel = scoreEvent?.scores?.find((entry) => entry.name === event.home_team)?.score || null;
    const awayScoreLabel = scoreEvent?.scores?.find((entry) => entry.name === event.away_team)?.score || null;
    const hasProviderScore = homeScoreLabel !== null || awayScoreLabel !== null;
    const status = scoreEvent?.completed
      ? "finished" as const
      : hasProviderScore || (liveAgeMs >= 0 && liveAgeMs <= 6 * 60 * 60 * 1000)
        ? "live" as const
        : "upcoming" as const;
    const normalizedSport = oddsApiSport(event.sport_key, event.sport_title);
    const oddsFingerprint = normalizedOutcomes
      .map((outcome) => `${outcome.selection}:${outcome.value}`)
      .join("|");

    return {
      updateId: `${event.id}:${bookmaker.key}:${h2h.last_update || bookmaker.last_update || startTime}:${oddsFingerprint}`,
      providerId: config.id,
      providerEventId: event.id,
      sport: normalizedSport,
      league: {
        name: event.sport_title,
        slug: slugify(event.sport_title),
        country: regions.toUpperCase(),
      },
      homeTeam: event.home_team,
      awayTeam: event.away_team,
      startTime,
      status,
      homeScore: cricketScoreNumber(homeScoreLabel),
      awayScore: cricketScoreNumber(awayScoreLabel),
      scoreLabels: hasProviderScore ? { home: homeScoreLabel, away: awayScoreLabel } : undefined,
      scoreUpdatedAt: scoreEvent?.last_update || null,
      liveMinute: null,
      markets: [{
        name: "Match Result",
        type: "match_result",
        status: "active",
        outcomes: normalizedOutcomes,
      }],
    };
  }).filter(Boolean) as NormalizedSportsEvent[];

  return [...new Map(normalized.map((event) => [event.providerEventId, event])).values()];
}

function participantName(participants: any[], location: "home" | "away") {
  const participant = participants.find((item) => item?.meta?.location === location);
  return participant?.name || null;
}

function participantScore(scores: any[], participantId: unknown) {
  const entries = scores.filter((item) => String(item?.participant_id) === String(participantId));
  const preferred = entries.find((item) => String(item?.description || "").toUpperCase() === "CURRENT") || entries.at(-1);
  return score(preferred?.score?.goals ?? preferred?.score);
}

async function fetchSportmonks(config: SportsProviderConfig, apiKey: string | null) {
  if (!apiKey) throw new Error("Sportmonks API token is missing");
  const settings = config.settings || {};
  const endpoint = settings.latestOnly ? "latest" : "inplay";
  const url = new URL(`https://api.sportmonks.com/v3/football/livescores/${endpoint}`);
  url.searchParams.set("api_token", apiKey);
  url.searchParams.set("include", "scores;participants;league");
  if (settings.leagueId) url.searchParams.set("filters", `fixtureLeagues:${String(settings.leagueId).replace(/[^0-9]/g, "")}`);
  const body = await fetchJson(url.toString());
  const fixtures = arrayFromProviderBody(body);
  return fixtures.map((fixture: any): NormalizedSportsEvent | null => {
    const participants = Array.isArray(fixture?.participants) ? fixture.participants : [];
    const homeParticipant = participants.find((item: any) => item?.meta?.location === "home");
    const awayParticipant = participants.find((item: any) => item?.meta?.location === "away");
    const homeTeam = participantName(participants, "home");
    const awayTeam = participantName(participants, "away");
    if (!fixture?.id || !homeTeam || !awayTeam) return null;
    const homeScore = participantScore(fixture.scores || [], homeParticipant?.id);
    const awayScore = participantScore(fixture.scores || [], awayParticipant?.id);
    const leagueName = fixture.league?.name || "Live football";
    return {
      updateId: `${fixture.id}:${fixture.state_id || "live"}:${homeScore ?? "x"}:${awayScore ?? "x"}:${fixture.last_played_at || fixture.updated_at || "current"}`,
      providerId: config.id,
      providerEventId: String(fixture.id),
      sport: { name: "Football", slug: "football", icon: "⚽" },
      league: { name: leagueName, slug: slugify(leagueName), country: fixture.league?.country?.name || undefined },
      homeTeam,
      awayTeam,
      startTime: isoTimestamp(fixture.starting_at),
      status: "live",
      homeScore,
      awayScore,
      liveMinute: score(fixture?.periods?.at?.(-1)?.minutes),
      markets: [],
    };
  }).filter(Boolean) as NormalizedSportsEvent[];
}

const openLigaMatchSchema = z.object({
  matchID: z.union([z.string(), z.number()]).transform(String),
  matchDateTimeUTC: z.string().nullish(),
  matchDateTime: z.string().nullish(),
  leagueName: z.string().nullish(),
  leagueShortcut: z.string().nullish(),
  lastUpdateDateTime: z.string().nullish(),
  matchIsFinished: z.boolean().nullish(),
  team1: z.object({ teamName: z.string().min(1) }),
  team2: z.object({ teamName: z.string().min(1) }),
  matchResults: z.array(z.object({
    pointsTeam1: z.number(),
    pointsTeam2: z.number(),
    resultOrderID: z.number().nullish(),
  }).passthrough()).nullish(),
  goals: z.array(z.object({
    scoreTeam1: z.number(),
    scoreTeam2: z.number(),
    matchMinute: z.number().nullish(),
  }).passthrough()).nullish(),
}).passthrough();

async function fetchOpenLigaDb(config: SportsProviderConfig) {
  const shortcut = String(config.settings?.leagueShortcut || "bl1").trim();
  if (!/^[a-z0-9_-]{2,30}$/i.test(shortcut)) throw new Error("Invalid OpenLigaDB league shortcut");
  const body = await fetchJson(`https://api.openligadb.de/getmatchdata/${encodeURIComponent(shortcut)}`);
  const matches = Array.isArray(body) ? body : [];
  const now = Date.now();
  return matches.map((value): NormalizedSportsEvent | null => {
    const parsed = openLigaMatchSchema.safeParse(value);
    if (!parsed.success) return null;
    const match = parsed.data;
    const startTime = isoTimestamp(match.matchDateTimeUTC || match.matchDateTime);
    const ageMinutes = Math.floor((now - new Date(startTime).getTime()) / 60_000);
    const status = match.matchIsFinished
      ? "finished" as const
      : ageMinutes >= 0 && ageMinutes <= 300
        ? "live" as const
        : ageMinutes > 300
          ? "postponed" as const
          : "upcoming" as const;
    const result = [...(match.matchResults || [])].sort((left, right) => Number(left.resultOrderID || 0) - Number(right.resultOrderID || 0)).at(-1);
    const lastGoal = (match.goals || []).at(-1);
    const homeScore = result?.pointsTeam1 ?? lastGoal?.scoreTeam1 ?? (status === "live" ? 0 : null);
    const awayScore = result?.pointsTeam2 ?? lastGoal?.scoreTeam2 ?? (status === "live" ? 0 : null);
    const leagueName = match.leagueName || `OpenLigaDB ${shortcut.toUpperCase()}`;
    return {
      updateId: `${match.matchID}:${match.lastUpdateDateTime || startTime}:${status}:${homeScore ?? "x"}:${awayScore ?? "x"}`,
      providerId: config.id,
      providerEventId: match.matchID,
      sport: { name: "Football", slug: "football", icon: "⚽" },
      league: { name: leagueName, slug: slugify(leagueName), country: "Europe" },
      homeTeam: match.team1.teamName,
      awayTeam: match.team2.teamName,
      startTime,
      status,
      homeScore,
      awayScore,
      liveMinute: status === "live" ? Math.min(Math.max(lastGoal?.matchMinute || ageMinutes, 0), 130) : null,
      markets: [],
    };
  }).filter(Boolean) as NormalizedSportsEvent[];
}

export async function fetchProviderEvents(config: SportsProviderConfig, apiKey: string | null) {
  if (config.provider_type === "openligadb") return fetchOpenLigaDb(config);
  if (config.provider_type === "the_odds_api") return fetchTheOddsApi(config, apiKey);
  if (config.provider_type === "sportmonks") return fetchSportmonks(config, apiKey);
  return fetchSportsDb(config, apiKey);
}

