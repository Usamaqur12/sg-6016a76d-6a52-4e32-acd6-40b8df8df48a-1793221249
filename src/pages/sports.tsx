import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { AlertTriangle, Receipt, RefreshCw, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const db = supabase;
import { Header } from "@/components/layout/Header";
import { SportsNav } from "@/components/layout/SportsNav";
import { BetSlip } from "@/components/layout/BetSlip";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { MobileBetSlipDrawer } from "@/components/layout/MobileBetSlipDrawer";
import { EventRow } from "@/components/sportsbook/EventRow";
import { EventMarketsModal } from "@/components/sportsbook/EventMarketsModal";
import {
  SportsbookToolbar,
  type SportsbookSort,
  type SportsbookView,
} from "@/components/sportsbook/SportsbookToolbar";
import { useBetSlip } from "@/hooks/useBetSlip";
import { placeBet, type OddsAcceptance } from "@/services/bettingService";
import { fetchUpcomingEvents } from "@/services/sportsbookService";
import { getUserFavoriteEventIds, toggleFavorite } from "@/services/favoritesService";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SportsbookEvent, SportsbookOutcome } from "@/types/sportsbook";

type ProfileSummary = { balance: number };

export default function Sports() {
  const router = useRouter();
  const { toast } = useToast();
  const betSlip = useBetSlip();
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [events, setEvents] = useState<SportsbookEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [selectedSport, setSelectedSport] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<SportsbookEvent | null>(null);
  const [isMobileBetSlipOpen, setIsMobileBetSlipOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<SportsbookView>("all");
  const [sort, setSort] = useState<SportsbookSort>("soonest");

  const loadProfile = useCallback(async (userId: string) => {
    const { data } = await db
      .from("wallet_accounts")
      .select("balance")
      .eq("user_id", userId)
      .maybeSingle();
    setProfile({ balance: Number(data?.balance ?? 0) });
  }, []);

  async function loadEvents() {
    try {
      setEventsLoading(true);
      const eventsData = await fetchUpcomingEvents(selectedSport || undefined);
      if (!eventsData) {
        console.error("Failed to load events");
        return;
      }
      setEvents(eventsData as any);
    } catch (error: any) {
      console.error("Error loading events:", error);
      toast({
        title: "Error loading events",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setEventsLoading(false);
    }
  }

  const loadFavorites = useCallback(async (userId: string) => {
    const result = await getUserFavoriteEventIds(userId);
    setFavorites(result.eventIds);
  }, []);

  useEffect(() => {
    void loadEvents();

    db.auth.getSession().then(({ data: { session } }) => {
      const nextUser = session?.user
        ? { id: session.user.id, email: session.user.email }
        : null;
      setUser(nextUser);
      if (nextUser) {
        void loadProfile(nextUser.id);
        void loadFavorites(nextUser.id);
      }
    });

    const { data: { subscription } } = db.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user
        ? { id: session.user.id, email: session.user.email }
        : null;
      setUser(nextUser);
      if (nextUser) {
        void loadProfile(nextUser.id);
        void loadFavorites(nextUser.id);
      } else {
        setProfile(null);
        setFavorites([]);
      }
    });

    return () => subscription.unsubscribe();
  }, [loadEvents, loadFavorites, loadProfile]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadEvents();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [loadEvents]);

  useEffect(() => {
    const eventId = typeof router.query.event === "string" ? router.query.event : null;
    if (!eventId || events.length === 0) return;
    const event = events.find((candidate) => candidate.id === eventId);
    if (event) setSelectedEvent(event);
  }, [events, router.query.event]);

  const visibleEvents = useMemo(() => {
    const requestedSport = typeof router.query.sport === "string" ? router.query.sport : null;
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = events.filter((event) => {
      if (requestedSport && event.sportSlug !== requestedSport) return false;
      if (view === "live" && !event.isLive) return false;
      if (view === "upcoming" && event.isLive) return false;
      if (view === "favorites" && !favorites.includes(event.id)) return false;
      if (!normalizedQuery) return true;
      return [event.homeTeam, event.awayTeam, event.league, event.sport]
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    });

    return [...filtered].sort((left, right) => {
      if (sort === "markets") return right.marketCount - left.marketCount;
      if (sort === "odds") {
        const leftMax = Math.max(left.homeOdds, left.drawOdds || 0, left.awayOdds);
        const rightMax = Math.max(right.homeOdds, right.drawOdds || 0, right.awayOdds);
        return rightMax - leftMax;
      }
      if (sort === "league") return left.league.localeCompare(right.league);
      if (left.isLive !== right.isLive) return left.isLive ? -1 : 1;
      return new Date(left.startTimeIso).getTime() - new Date(right.startTimeIso).getTime();
    });
  }, [events, favorites, query, router.query.sport, sort, view]);

  const groupedEvents = useMemo(() => {
    const groups = new Map<string, SportsbookEvent[]>();
    for (const event of visibleEvents) {
      const key = `${event.sport}|${event.league}`;
      groups.set(key, [...(groups.get(key) || []), event]);
    }
    return [...groups.entries()];
  }, [visibleEvents]);

  const selectedOdds = useMemo(
    () => new Set(betSlip.bets.flatMap((bet) => [bet.id, `${bet.event}-${bet.selection}`])),
    [betSlip.bets]
  );

  function addOutcome(event: SportsbookEvent, outcome: SportsbookOutcome, marketName: string) {
    betSlip.addBet({
      id: outcome.id,
      eventId: event.id,
      marketId: outcome.marketId,
      oddsId: outcome.id,
      event: `${event.homeTeam} vs ${event.awayTeam}`,
      league: event.league,
      market: marketName,
      selection: outcome.selection,
      odds: outcome.value,
    });
  }

  async function handlePlaceBet(type: string, stake: number, oddsAcceptance: OddsAcceptance = "none", systemSize = 2) {
    if (!user) {
      await router.push("/auth/login");
      return;
    }

    const selections = betSlip.bets.filter(
      (bet) => bet.eventId && bet.marketId && bet.oddsId
    );
    if (selections.length !== betSlip.bets.length) {
      throw new Error("A preview selection cannot be submitted");
    }

    const result = await placeBet(
      user.id,
      type as "single" | "multiple" | "system",
      stake,
      selections.map((bet) => {
        if (!bet.eventId || !bet.marketId || !bet.oddsId) {
          throw new Error("Selection identifiers are missing");
        }
        return {
          eventId: bet.eventId,
          marketId: bet.marketId,
          oddsId: bet.oddsId,
          selection: bet.selection,
          oddsValue: bet.odds,
        };
      }),
      undefined,
      oddsAcceptance,
      systemSize
    );

    if (!result.success) throw new Error(result.error || "Bet was rejected");

    betSlip.clearBets();
    await loadProfile(user.id);
  }

  async function handleToggleFavorite(eventId: string) {
    if (!user) {
      await router.push("/auth/login");
      return;
    }

    const wasFavorite = favorites.includes(eventId);
    setFavorites((current) => wasFavorite ? current.filter((id) => id !== eventId) : [...current, eventId]);
    const result = await toggleFavorite(user.id, eventId);
    if (!result.success) {
      setFavorites((current) => wasFavorite ? [...new Set([...current, eventId])] : current.filter((id) => id !== eventId));
      toast({ title: "Favourite not saved", description: result.error, variant: "destructive" });
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background pb-14 lg:pb-0">
      <Header
        user={profile ? { email: user?.email || "", balance: profile.balance } : null}
        onAuthClick={() => router.push("/auth/login")}
      />

      <div className="flex-1 flex">
        <aside className="hidden lg:block flex-shrink-0">
          <SportsNav />
        </aside>

        <main className="flex-1 min-w-0 overflow-x-hidden">
          <div className="p-2 md:p-3 space-y-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-primary" />
                <div>
                  <h1 className="text-xl font-bold">All Sports</h1>
                  <p className="text-xs text-muted-foreground">Database-backed events and verified prices</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => void loadEvents()} disabled={eventsLoading}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${eventsLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>

            <SportsbookToolbar
              query={query}
              onQueryChange={setQuery}
              view={view}
              onViewChange={setView}
              sort={sort}
              onSortChange={setSort}
              resultCount={visibleEvents.length}
              favoriteCount={favorites.length}
            />

            {eventsLoading ? (
              <div className="surface rounded-md p-10 text-center text-sm text-muted-foreground">
                Loading sportsbook events…
              </div>
            ) : eventsError ? (
              <div className="surface rounded-md p-8 text-center border border-danger/30">
                <AlertTriangle className="h-7 w-7 text-danger mx-auto mb-2" />
                <p className="font-semibold mb-1">Sportsbook feed unavailable</p>
                <p className="text-xs text-muted-foreground mb-4">{eventsError}</p>
                <Button size="sm" onClick={() => void loadEvents()}>Try again</Button>
              </div>
            ) : groupedEvents.length === 0 ? (
              events.length === 0 ? (
                <div className="surface rounded-md p-10 text-center">
                  <p className="font-semibold mb-1">No live sportsbook data yet</p>
                  <p className="text-sm text-muted-foreground">
                    Live sportsbook tables are connected, but no active events are available right now. Refresh after the next provider sync or check back once new fixtures are imported.
                  </p>
                </div>
              ) : (
                <div className="surface rounded-md p-10 text-center">
                  <p className="font-semibold mb-1">No matching events</p>
                  <p className="text-sm text-muted-foreground">
                    Try another search, sport, view or sorting option.
                  </p>
                </div>
              )
            ) : (
              groupedEvents.map(([group, groupEvents]) => {
                const [sport, league] = group.split("|");
                return (
                  <section key={group}>
                    <div className="flex items-center gap-2 mb-2">
                      <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                        {sport} · {league}
                      </h2>
                      <Badge variant="outline" className="h-4 text-[10px] px-1">
                        {groupEvents.length}
                      </Badge>
                    </div>
                    <div className="surface rounded-md overflow-hidden">
                      {groupEvents.map((event) => (
                        <EventRow
                          key={event.id}
                          event={event}
                          onOddsClick={(_selection, _odds, outcome) => {
                            if (outcome) addOutcome(event, outcome, "Match Result");
                          }}
                          selectedOdds={selectedOdds}
                          isFavorite={favorites.includes(event.id)}
                          onToggleFavorite={() => void handleToggleFavorite(event.id)}
                          onOpenMarkets={() => setSelectedEvent(event)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })
            )}
          </div>
        </main>

        <div className="hidden lg:block lg:w-80">
          <BetSlip />
        </div>
      </div>

      {betSlip.bets.length > 0 && (
        <Button
          onClick={() => setIsMobileBetSlipOpen(true)}
          className="fixed right-4 bottom-20 z-30 lg:hidden h-12 rounded-full px-4 shadow-xl"
          aria-label={`Open bet slip with ${betSlip.bets.length} selections`}
        >
          <Receipt className="h-4 w-4 mr-2" />
          Bet Slip
          <Badge className="ml-2 bg-background text-foreground">{betSlip.bets.length}</Badge>
        </Button>
      )}

      <MobileBetSlipDrawer
        selections={betSlip.bets.map((bet) => ({
          id: bet.id,
          eventName: bet.event,
          selection: bet.selection,
          odds: bet.odds,
          market: bet.market || "Match Result",
        }))}
        onRemove={(id) => {
          const index = betSlip.bets.findIndex((bet) => bet.id === id);
          if (index >= 0) betSlip.removeBet(index);
        }}
        onClear={betSlip.clearBets}
        onPlaceBet={handlePlaceBet}
        balance={profile?.balance || 0}
        isOpen={isMobileBetSlipOpen}
        onClose={() => setIsMobileBetSlipOpen(false)}
      />

      <Footer />
      <MobileBottomNav />

      <EventMarketsModal
        event={selectedEvent}
        open={Boolean(selectedEvent)}
        onClose={() => setSelectedEvent(null)}
        onOddsClick={(_selection, _odds, outcome, market) => {
          if (selectedEvent && outcome) {
            addOutcome(selectedEvent, outcome, market?.name || "Market");
          }
        }}
        selectedOdds={selectedOdds}
        isFavorite={Boolean(selectedEvent && favorites.includes(selectedEvent.id))}
        onToggleFavorite={selectedEvent ? () => void handleToggleFavorite(selectedEvent.id) : undefined}
      />
    </div>
  );
}
