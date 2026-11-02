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
    resume_markets: false,
    markets: event.markets,
  };
}

async function importScoreOnlyEvent(event: NormalizedSportsEvent) {
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

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("events")
    .select("id")
    .eq("provider_id", event.providerId)
    .eq("provider_event_id", event.providerEventId)
    .maybeSingle();

  if (lookupError) throw lookupError;

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
    provider_id: event.providerId,
    provider_event_id: event.providerEventId,
    is_suspended: ["finished", "cancelled", "postponed"].includes(event.status),
    metadata: {
      source: "score-feed",
      providerId: event.providerId,
      providerEventId: event.providerEventId,
      scoreOnly: true,
    },
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { error } = await supabaseAdmin
      .from("events")
      .update(eventRecord)
      .eq("id", existing.id);
    if (error) throw error;
    return existing.id;
  }

  const { data: inserted, error } = await supabaseAdmin
    .from("events")
    .insert(eventRecord)
    .select("id")
    .single();

  if (error) throw error;
  return inserted.id;
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
        if (event.markets.length === 0) {
          await importScoreOnlyEvent(event);
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
        score: event.homeScore == null ? null : `${event.homeScore}-${event.awayScore ?? 0}`,
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
