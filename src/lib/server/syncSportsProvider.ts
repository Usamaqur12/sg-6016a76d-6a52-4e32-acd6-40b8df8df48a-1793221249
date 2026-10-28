import { supabaseAdmin } from "@/lib/server/supabaseAdmin";
import { decryptProviderSecret } from "@/lib/server/providerSecrets";
import { fetchProviderEvents, type NormalizedSportsEvent, type SportsProviderConfig } from "@/lib/server/sportsProviders";

export interface ManagedSportsProvider extends SportsProviderConfig {
  priority: number;
  sync_interval_seconds: number;
  status: string;
  last_sync_at: string | null;
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

export async function syncSportsProvider(provider: ManagedSportsProvider, mode: "test" | "sync") {
  const startedAt = Date.now();
  try {
    const apiKey = decryptProviderSecret(provider.encrypted_api_key);
    const events = await fetchProviderEvents(provider, apiKey);
    let ingested = 0;

    if (mode === "sync") {
      for (const event of events.slice(0, 500)) {
        const { error } = await supabaseAdmin.rpc("ingest_sports_feed_event", {
          p_update_id: event.updateId,
          p_payload: ingestionPayload(event),
        });
        if (error) throw error;
        ingested += 1;
      }
    }

    const now = new Date().toISOString();
    await supabaseAdmin.from("sports_feed_providers").update({
      status: "healthy",
      last_sync_at: mode === "sync" ? now : provider.last_sync_at,
      last_success_at: now,
      last_error: null,
      last_event_count: events.length,
      updated_at: now,
    }).eq("id", provider.id);

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
    const message = error instanceof Error ? error.message : "Provider sync failed";
    await supabaseAdmin.from("sports_feed_providers").update({
      status: "error",
      last_sync_at: mode === "sync" ? new Date().toISOString() : provider.last_sync_at,
      last_error: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("id", provider.id);
    throw new Error(message);
  }
}
