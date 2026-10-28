import { z } from "zod";

export const providerTypes = ["openligadb", "thesportsdb_demo", "thesportsdb_live", "sportmonks"] as const;
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
  liveMinute?: number | null;
  markets: [];
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
    const responses = await Promise.allSettled([
      fetchJson(`https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=${today}&l=${leagueId}`),
      fetchJson(`https://www.thesportsdb.com/api/v1/json/123/eventsnextleague.php?id=${leagueId}`),
    ]);
    const rawEvents = responses.flatMap((response) => response.status === "fulfilled" ? arrayFromProviderBody(response.value) : []);
    if (rawEvents.length === 0 && responses.every((response) => response.status === "rejected")) {
      throw new Error("TheSportsDB development feed is unavailable");
    }
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
  if (config.provider_type === "sportmonks") return fetchSportmonks(config, apiKey);
  return fetchSportsDb(config, apiKey);
}

