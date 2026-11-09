import { supabaseAdmin } from "@/lib/server/supabaseAdmin";
import { decryptProviderSecret } from "@/lib/server/providerSecrets";
import {
  fetchProviderEvents,
  type NormalizedSportsEvent,
  type SportsProviderConfig,
} from "@/lib/server/sportsProviders";

export interface ManagedSportsProvider extends SportsProviderConfig {
  priority: number;
  sync_interval_seconds: number;
  status: string;
  last_sync_at: string | null;
}

type ProviderFailure = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

function providerFailure(error: unknown): ProviderFailure {
  if (error instanceof Error) return { message: error.message };
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return {
      code: typeof value.code === "string" ? value.code : undefined,
      message: typeof value.message === "string" ? value.message : undefined,
      details: typeof value.details === "string" ? value.details : undefined,
      hint: typeof value.hint === "string" ? value.hint : undefined,
    };
  }
  return {};
}

function providerErrorMessage(error: unknown) {
  const failure = providerFailure(error);
  return failure.message || failure.details || failure.hint || "Provider sync failed";
}

function ingestionPayload(event: NormalizedSportsEvent) {
  return {
    provider_id: event.providerId,
    provider_event_id: event.providerEventId,
    sport_name: event.sport.name,
    sport_slug: event.sport.slug,
    sport_icon: event.sport.icon || null,
    league_name: event.league.name,
    league_slug: event.league.slug,
    country: event.league.country || null,
    home_team: event.homeTeam,
    away_team: event.awayTeam,
    start_time: event.startTime,
    status: event.status,
    home_score: event.homeScore ?? null,
    away_score: event.awayScore ?? null,
    live_minute: event.liveMinute ?? null,
    resume_markets: !event.suspendMarkets,
    markets: event.markets,
  };
}

function normalizedTeamName(value: string) {
  return value.toLowerCase().replace(/\b(cricket club|cricket|cc|women|w)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

type ExistingEvent = {
  id: string;
  provider_id: string | null;
  provider_event_id: string | null;
  home_team: string;
  away_team: string;
  start_time: string;
  metadata: unknown;
};

async function findExistingEvent(event: NormalizedSportsEvent, sportId: string): Promise<ExistingEvent | null> {
  const { data: mapped, error: mapError } = await supabaseAdmin
    .from("provider_event_map")
    .select("event_id")
    .eq("provider_id", event.providerId)
    .eq("provider_event_id", event.providerEventId)
    .maybeSingle();
  if (mapError) throw mapError;

  if (mapped?.event_id) {
    const { data, error } = await supabaseAdmin
      .from("events")
      .select("id, provider_id, provider_event_id, home_team, away_team, start_time, metadata")
      .eq("id", mapped.event_id)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as ExistingEvent;
  }

  const { data: exact, error: exactError } = await supabaseAdmin
    .from("events")
    .select("id, provider_id, provider_event_id, home_team, away_team, start_time, metadata")
    .eq("provider_id", event.providerId)
    .eq("provider_event_id", event.providerEventId)
    .maybeSingle();
  if (exactError) throw exactError;
  if (exact) return exact as ExistingEvent;

  // Score and odds feeds normally use different event ids. Reconcile them by
  // sport, team pair and a narrow kickoff window so the score feed enriches
  // the bettable event instead of creating a duplicate fixture.
  const kickoff = new Date(event.startTime).getTime();
  const from = new Date(kickoff - 6 * 60 * 60 * 1000).toISOString();
  const to = new Date(kickoff + 6 * 60 * 60 * 1000).toISOString();
  const { data: candidates, error: candidateError } = await supabaseAdmin
    .from("events")
    .select("id, provider_id, provider_event_id, home_team, away_team, start_time, metadata")
    .eq("sport_id", sportId)
    .gte("start_time", from)
    .lte("start_time", to)
    .limit(30);
  if (candidateError) throw candidateError;

  const home = normalizedTeamName(event.homeTeam);
  const away = normalizedTeamName(event.awayTeam);
  return ((candidates || []) as ExistingEvent[]).find((candidate) =>
    normalizedTeamName(candidate.home_team) === home
    && normalizedTeamName(candidate.away_team) === away
  ) || null;
}

async function recordCricketIncidents(event: NormalizedSportsEvent, eventId: string) {
  if (!event.incidents?.length) return;
  const rows = event.incidents.map((incident) => ({
    provider_id: event.providerId,
    update_id: `incident:${event.providerEventId}:${incident.providerIncidentId}`,
    event_id: eventId,
    payload: {
      incident: incident.type,
      incident_id: incident.providerIncidentId,
      incident_description: incident.description || null,
      live_minute: incident.sequence ?? null,
      team_side: incident.teamSide || "neutral",
      home_score: incident.homeScore ?? event.homeScore ?? null,
      away_score: incident.awayScore ?? event.awayScore ?? null,
    },
  }));
  const { error } = await supabaseAdmin
    .from("feed_updates")
    .upsert(rows, { onConflict: "provider_id,update_id", ignoreDuplicates: true });
  if (error) throw error;
}

async function queueAutomaticMatchResult(event: NormalizedSportsEvent, eventId: string) {
  if (!event.settlementWinner || event.status !== "finished" || event.homeScore == null || event.awayScore == null) return;
  const { data: markets, error: marketError } = await supabaseAdmin
    .from("markets")
    .select("id, odds(selection)")
    .eq("event_id", eventId)
    .eq("type", "match_result");
  if (marketError) throw marketError;

  const resultMarkets = (markets || []).flatMap((market: any) => {
    const selections = Array.isArray(market.odds) ? market.odds.map((odd: any) => String(odd.selection).toLowerCase()) : [];
    return selections.includes(event.settlementWinner!.toLowerCase())
      ? [{ market_id: market.id, winning_selection: event.settlementWinner }]
      : [];
  });
  if (resultMarkets.length === 0) return;

  const { error } = await supabaseAdmin.rpc("record_event_result_and_queue", {
    p_event_id: eventId,
    p_status: "finished",
    p_home_score: event.homeScore,
    p_away_score: event.awayScore,
    p_market_results: resultMarkets,
    p_provider_reference: `${event.providerId}:${event.providerEventId}:finished:${event.settlementWinner}`,
  });
  if (error) throw error;
}

async function importProviderEventDirect(event: NormalizedSportsEvent) {
  const { data: sport, error: sportError } = await supabaseAdmin
    .from("sports")
    .upsert({
      name: event.sport.name,
      slug: event.sport.slug,
      icon: event.sport.icon || null,
      is_active: true,
    }, { onConflict: "slug" })
    .select("id")
    .single();

  if (sportError) throw sportError;

  const { data: league, error: leagueError } = await supabaseAdmin
    .from("leagues")
    .upsert({
      sport_id: sport.id,
      name: event.league.name,
      slug: event.league.slug,
      country: event.league.country || null,
      is_active: true,
    }, { onConflict: "sport_id,slug" })
    .select("id")
    .single();

  if (leagueError) throw leagueError;

  const existing = await findExistingEvent(event, sport.id);

  const existingMetadata = existing?.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
    ? existing.metadata as Record<string, unknown>
    : {};
  const eventRecord = {
    sport_id: sport.id,
    league_id: league.id,
    home_team: event.homeTeam,
    away_team: event.awayTeam,
    start_time: event.startTime,
    status: event.status,
    live_score_home: event.homeScore ?? null,
    live_score_away: event.awayScore ?? null,
    live_minute: event.liveMinute ?? null,
    provider_id: existing?.provider_id || event.providerId,
    provider_event_id: existing?.provider_event_id || event.providerEventId,
    is_suspended: Boolean(event.suspendMarkets) || ["finished", "cancelled", "postponed"].includes(event.status),
    metadata: {
      ...existingMetadata,
      source: event.markets.length > 0 ? "odds-feed" : (existingMetadata.source || "score-feed"),
      providerId: existing?.provider_id || event.providerId,
      providerEventId: existing?.provider_event_id || event.providerEventId,
      scoreOnly: event.markets.length === 0 && !existing?.provider_id,
      providerSources: {
        ...(existingMetadata.providerSources && typeof existingMetadata.providerSources === "object"
          ? existingMetadata.providerSources as Record<string, unknown>
          : {}),
        [event.providerId]: event.providerEventId,
      },
      providerVisuals: {
        ...(existingMetadata.providerVisuals && typeof existingMetadata.providerVisuals === "object"
          ? existingMetadata.providerVisuals as Record<string, unknown>
          : {}),
        ...(event.league.logoUrl ? { leagueLogoUrl: event.league.logoUrl } : {}),
        ...(event.homeTeamLogoUrl ? { homeTeamLogoUrl: event.homeTeamLogoUrl } : {}),
        ...(event.awayTeamLogoUrl ? { awayTeamLogoUrl: event.awayTeamLogoUrl } : {}),
      },
      ...(event.scoreLabels ? {
        providerScore: {
          home: event.scoreLabels.home,
          away: event.scoreLabels.away,
          updatedAt: event.scoreUpdatedAt || new Date().toISOString(),
        },
      } : {}),
    },
    updated_at: new Date().toISOString(),
  };

  let eventId: string;
  if (existing?.id) {
    const { error } = await supabaseAdmin
      .from("events")
      .update(eventRecord)
      .eq("id", existing.id);
    if (error) throw error;
    eventId = existing.id;
  } else {
    const { data: inserted, error } = await supabaseAdmin
      .from("events")
      .insert(eventRecord)
      .select("id")
      .single();

    if (error) throw error;
    eventId = inserted.id;
  }

  const { error: mapError } = await supabaseAdmin
    .from("provider_event_map")
    .upsert({
      provider_id: event.providerId,
      provider_event_id: event.providerEventId,
      event_id: eventId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "provider_id,provider_event_id" });
  if (mapError) throw mapError;

  if (event.markets.length > 0) {
    const { error } = await supabaseAdmin
      .from("markets")
      .update({ status: "suspended" })
      .eq("event_id", eventId);
    if (error) throw error;
  }

  for (const market of event.markets) {
    let marketQuery = supabaseAdmin
      .from("markets")
      .select("id")
      .eq("event_id", eventId)
      .eq("type", market.type);

    marketQuery = market.line == null
      ? marketQuery.is("line", null)
      : marketQuery.eq("line", market.line);

    const { data: existingMarket, error: marketLookupError } = await marketQuery.maybeSingle();
    if (marketLookupError) throw marketLookupError;

    const marketRecord = {
      event_id: eventId,
      name: market.name,
      type: market.type,
      line: market.line ?? null,
      status: market.status || "active",
    };

    let marketId: string;
    if (existingMarket?.id) {
      const { error } = await supabaseAdmin
        .from("markets")
        .update(marketRecord)
        .eq("id", existingMarket.id);
      if (error) throw error;
      marketId = existingMarket.id;
    } else {
      const { data: insertedMarket, error } = await supabaseAdmin
        .from("markets")
        .insert(marketRecord)
        .select("id")
        .single();
      if (error) throw error;
      marketId = insertedMarket.id;
    }

    const { error: suspendOddsError } = await supabaseAdmin
      .from("odds")
      .update({ is_active: false, is_locked: true, updated_at: new Date().toISOString() })
      .eq("market_id", marketId);
    if (suspendOddsError) throw suspendOddsError;

    for (const outcome of market.outcomes) {
      const { data: existingOdd, error: oddLookupError } = await supabaseAdmin
        .from("odds")
        .select("id")
        .eq("market_id", marketId)
        .eq("selection", outcome.selection)
        .maybeSingle();

      if (oddLookupError) throw oddLookupError;

      const oddRecord = {
        market_id: marketId,
        selection: outcome.selection,
        value: outcome.value,
        is_active: outcome.active ?? true,
        is_locked: event.status !== "upcoming" && event.status !== "live",
        last_provider_update: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (existingOdd?.id) {
        const { error } = await supabaseAdmin
          .from("odds")
          .update(oddRecord)
          .eq("id", existingOdd.id);
        if (error) throw error;
      } else {
        const { error } = await supabaseAdmin.from("odds").insert(oddRecord);
        if (error) throw error;
      }
    }
  }


  if (event.suspendMarkets || ["finished", "cancelled", "postponed"].includes(event.status)) {
    const { error } = await supabaseAdmin
      .from("markets")
      .update({ status: "suspended" })
      .eq("event_id", eventId);
    if (error) throw error;
  }

  await recordCricketIncidents(event, eventId);
  await queueAutomaticMatchResult(event, eventId);

  return eventId;
}

export async function syncSportsProvider(provider: ManagedSportsProvider, mode: "test" | "sync") {
  const startedAt = Date.now();

  try {
    const apiKey = decryptProviderSecret(provider.encrypted_api_key);
    const events = await fetchProviderEvents(provider, apiKey);
    let ingested = 0;

    if (mode === "sync") {
      for (const event of events.slice(0, 500)) {
        // Public/free score providers do not supply betting markets. Import
        // their fixtures directly so display does not depend on optional feed
        // ingestion migrations. Odds-capable providers still use the atomic
        // ingestion RPC for market and price reconciliation.
        if (event.markets.length === 0 || provider.provider_type === "the_odds_api") {
          await importProviderEventDirect(event);
        } else {
          const { error } = await supabaseAdmin.rpc("ingest_sports_feed_event", {
            p_update_id: event.updateId,
            p_payload: ingestionPayload(event),
          });
          if (error) throw error;
        }
        ingested += 1;
      }
    }

    const now = new Date().toISOString();
    const { error: providerUpdateError } = await supabaseAdmin
      .from("sports_feed_providers")
      .update({
        status: "healthy",
        last_sync_at: mode === "sync" ? now : provider.last_sync_at,
        last_success_at: now,
        last_error: null,
        last_event_count: events.length,
        updated_at: now,
      })
      .eq("id", provider.id);

    if (providerUpdateError) throw providerUpdateError;

    return {
      ok: true,
      providerId: provider.id,
      eventCount: events.length,
      ingested,
      latencyMs: Date.now() - startedAt,
      sample: events.slice(0, 3).map((event) => ({
        providerEventId: event.providerEventId,
        event: `${event.homeTeam} vs ${event.awayTeam}`,
        league: event.league.name,
        status: event.status,
        score: event.scoreLabels
          ? `${event.scoreLabels.home ?? "–"}-${event.scoreLabels.away ?? "–"}`
          : event.homeScore == null ? null : `${event.homeScore}-${event.awayScore ?? 0}`,
        startTime: event.startTime,
      })),
    };
  } catch (error) {
    const failure = providerFailure(error);
    const message = providerErrorMessage(error);

    console.error("Provider sync failed", {
      providerId: provider.id,
      code: failure.code,
      message: failure.message,
      details: failure.details,
      hint: failure.hint,
    });

    await supabaseAdmin
      .from("sports_feed_providers")
      .update({
        status: "error",
        last_sync_at: mode === "sync" ? new Date().toISOString() : provider.last_sync_at,
        last_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", provider.id);

    throw new Error(message);
  }
}
