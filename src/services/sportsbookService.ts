import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/database.types";

type Event = Database["public"]["Tables"]["events"]["Row"];
type Market = Database["public"]["Tables"]["markets"]["Row"];
type Odds = Database["public"]["Tables"]["odds"]["Row"];

const db = supabase;

export async function fetchLiveEvents() {
  const { data: events } = await db
    .from("events")
    .select("*, leagues(*), sports(*)")
    .eq("status", "live")
    .order("start_time", { ascending: true });
  return events || [];
}

export async function fetchUpcomingEvents(sportSlug?: string) {
  let query = db
    .from("events")
    .select("*, leagues(*), sports(*)")
    .eq("status", "upcoming")
    .order("start_time", { ascending: true })
    .limit(50);

  if (sportSlug) {
    const { data: sport } = await db.from("sports").select("id").eq("slug", sportSlug).single();
    if (sport) query = query.eq("sport_id", sport.id);
  }

  const { data: events } = await query;
  return events || [];
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