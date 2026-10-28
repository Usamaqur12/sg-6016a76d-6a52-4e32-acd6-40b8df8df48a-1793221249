import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/router";
import { AlertTriangle, Receipt, RefreshCw } from "lucide-react";
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

interface SportsbookCataloguePageProps {
  title: string;
  description: string;
  icon: ReactNode;
  sportSlug?: string;
  liveOnly?: boolean;
}

export function SportsbookCataloguePage({
  title,
  description,
  icon,
  sportSlug,
  liveOnly = false,
}: SportsbookCataloguePageProps) {
  const router = useRouter();
  const { toast } = useToast();
  const betSlip = useBetSlip();
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [events, setEvents] = useState<SportsbookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<SportsbookEvent | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<SportsbookView>(liveOnly ? "live" : "all");
  const [sort, setSort] = useState<SportsbookSort>("soonest");

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await db.rpc("get_user_wallet_balance", {
      p_user_id: userId
    });
    
    if (!error && data) {
      setBalance(Number(data.cash_balance || 0) + Number(data.bonus_balance || 0));
    } else {
      setBalance(0);
    }
  }, []);

  const loadFavorites = useCallback(async (userId: string) => {
    const result = await getUserFavoriteEventIds(userId);
    setFavorites(result.eventIds);
  }, []);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    const eventsData = await fetchUpcomingEvents(sportSlug);
    if (!eventsData) throw new Error("Failed to fetch events");
    setEvents(eventsData as any);
    setLoading(false);
  }, [sportSlug]);

  useEffect(() => {
    void loadEvents();
    db.auth.getSession().then(({ data: { session } }) => {
      const nextUser = session?.user ? { id: session.user.id, email: session.user.email } : null;
      setUser(nextUser);
      if (nextUser) {
        void loadProfile(nextUser.id);
        void loadFavorites(nextUser.id);
      }
    });

    const { data: { subscription } } = db.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ? { id: session.user.id, email: session.user.email } : null;
      setUser(nextUser);
      if (nextUser) {
        void loadProfile(nextUser.id);
        void loadFavorites(nextUser.id);
      } else {
        setBalance(null);
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
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = events.filter((event) => {
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
  }, [events, favorites, query, sort, view]);

  const groupedEvents = useMemo(() => {
    const groups = new Map<string, SportsbookEvent[]>();
    for (const event of visibleEvents) {
      const key = event.league;
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

  async function submitBet(type: string, stake: number, oddsAcceptance: OddsAcceptance = "none", systemSize = 2) {
    if (!user) {
      await router.push("/auth/login");
      return;
    }

    const selections = betSlip.bets.map((bet) => {
      if (!bet.eventId || !bet.marketId || !bet.oddsId) {
        throw new Error("A preview selection cannot be submitted");
      }
      return {
        eventId: bet.eventId,
        marketId: bet.marketId,
        oddsId: bet.oddsId,
        selection: bet.selection,
        oddsValue: bet.odds,
      };
    });

    const result = await placeBet(
      user.id,
      type as "single" | "multiple" | "system",
      stake,
      selections,
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
        user={balance !== null ? { email: user?.email || "", balance } : null}
        onAuthClick={() => router.push("/auth/login")}
      />
      <div className="flex-1 flex">
        <aside className="hidden lg:block flex-shrink-0"><SportsNav /></aside>
        <main className="flex-1 min-w-0 overflow-x-hidden">
          <div className="p-2 md:p-3 space-y-4">
            <div className="flex items-center justify-between mb-4 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                {icon}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="text-xl font-bold truncate">{title}</h1>
                    {liveOnly && <Badge variant="destructive" className="text-[10px]">LIVE</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{description}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => void loadEvents()} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
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
              liveOnly={liveOnly}
            />

            {loading ? (
              <div className="surface rounded-md p-10 text-center text-sm text-muted-foreground">Loading events…</div>
            ) : error ? (
              <div className="surface rounded-md p-8 text-center border border-danger/30">
                <AlertTriangle className="h-7 w-7 text-danger mx-auto mb-2" />
                <p className="font-semibold mb-1">Feed unavailable</p>
                <p className="text-xs text-muted-foreground mb-4">{error}</p>
                <Button size="sm" onClick={() => void loadEvents()}>Try again</Button>
              </div>
            ) : groupedEvents.length === 0 ? (
              events.length === 0 ? (
                <div className="surface rounded-md p-10 text-center">
                  <p className="font-semibold mb-1">Live events not synced yet</p>
                  <p className="text-sm text-muted-foreground">
                    The sportsbook is connected to the live database, but no active event records are available yet. Refresh after the feed sync completes or ask an admin to run a provider sync.
                  </p>
                </div>
              ) : (
                <div className="surface rounded-md p-10 text-center">
                  <p className="font-semibold mb-1">No matching events</p>
                  <p className="text-sm text-muted-foreground">Try another search, view or sorting option.</p>
                </div>
              )
            ) : (
              groupedEvents.map(([league, leagueEvents]) => (
                <section key={league}>
                  <div className="flex items-center gap-2 mb-2">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">{league}</h2>
                    <Badge variant="outline" className="h-4 text-[10px] px-1">{leagueEvents.length}</Badge>
                  </div>
                  <div className="surface rounded-md overflow-hidden">
                    {leagueEvents.map((event) => (
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
              ))
            )}
          </div>
        </main>
        <div className="hidden lg:block lg:w-80"><BetSlip /></div>
      </div>

      {betSlip.bets.length > 0 && (
        <Button
          onClick={() => setMobileOpen(true)}
          className="fixed right-4 bottom-20 z-30 lg:hidden h-12 rounded-full px-4 shadow-xl"
        >
          <Receipt className="h-4 w-4 mr-2" /> Bet Slip
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
        onPlaceBet={submitBet}
        balance={balance || 0}
        isOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />

      <Footer />
      <MobileBottomNav />
      <EventMarketsModal
        event={selectedEvent}
        open={Boolean(selectedEvent)}
        onClose={() => setSelectedEvent(null)}
        onOddsClick={(_selection, _odds, outcome, market) => {
          if (selectedEvent && outcome) addOutcome(selectedEvent, outcome, market?.name || "Market");
        }}
        selectedOdds={selectedOdds}
        isFavorite={Boolean(selectedEvent && favorites.includes(selectedEvent.id))}
        onToggleFavorite={selectedEvent ? () => void handleToggleFavorite(selectedEvent.id) : undefined}
      />
    </div>
  );
}
