import { useState, useEffect } from "react";
import { Header } from "@/components/layout/Header";
import { SportsNav } from "@/components/layout/SportsNav";
import { BetSlip } from "@/components/layout/BetSlip";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { MobileBetSlipDrawer } from "@/components/layout/MobileBetSlipDrawer";
import { EventCard } from "@/components/sportsbook/EventCard";
import { EventRow } from "@/components/sportsbook/EventRow";
import { EventMarketsModal } from "@/components/sportsbook/EventMarketsModal";
import { useBetSlip } from "@/hooks/useBetSlip";
import { fetchUpcomingEvents } from "@/services/sportsbookService";
import { placeBet, type OddsAcceptance } from "@/services/bettingService";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trophy, PlayCircle, Clock, Receipt, CheckCircle } from "lucide-react";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { SportsbookEvent, SportsbookOutcome } from "@/types/sportsbook";
import Link from "next/link";
import { getUserFavoriteEventIds, toggleFavorite as persistFavorite } from "@/services/favoritesService";
import { LiveOddsFeed } from "@/components/sportsbook/LiveOddsFeed";
import { SEO } from "@/components/SEO";

type ProfileSummary = {
  balance: number;
};

export default function Home() {
  const router = useRouter();
  const [selectedEvent, setSelectedEvent] = useState<SportsbookEvent | null>(null);
  const [showMarketsModal, setShowMarketsModal] = useState(false);
  const betSlip = useBetSlip();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);
  const [sportsbookEvents, setSportsbookEvents] = useState<SportsbookEvent[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [mobileBetSlipOpen, setMobileBetSlipOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
    void fetchUpcomingEvents()
      .then(() => {
        setFeedLoading(false);
      })
      .finally(() => setFeedLoading(false));
    
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        void loadProfile(session.user.id);
        void getUserFavoriteEventIds(session.user.id).then((result) => { if (!result.error) setFavorites(result.eventIds || []); });
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        void loadProfile(session.user.id);
        void getUserFavoriteEventIds(session.user.id).then((result) => { if (!result.error) setFavorites(result.eventIds || []); });
      } else {
        setProfile(null);
        setFavorites([]);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadProfile = async (userId: string) => {
    const { data } = await supabase
      .from("wallet_accounts")
      .select("balance")
      .eq("user_id", userId)
      .maybeSingle();

    setProfile({ balance: Number(data?.balance ?? 0) });
  };

  function handleOddsClick(event: SportsbookEvent, outcome?: SportsbookOutcome, marketName = "Match Result") {
    if (!outcome) return;
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

  const handleAuthClick = () => {
    router.push("/auth/login");
  };

  const toggleFavorite = async (eventId: string) => {
    if (!user) { await router.push("/auth/login?returnTo=/"); return; }
    const wasFavorite = favorites.includes(eventId);
    setFavorites((prev) =>
      prev.includes(eventId)
        ? prev.filter((id) => id !== eventId)
        : [...prev, eventId]
    );
    const result = await persistFavorite(user.id, eventId);
    if (!result.success) setFavorites((prev) => wasFavorite ? [...new Set([...prev, eventId])] : prev.filter((id) => id !== eventId));
  };

  async function handlePlaceBet(type: string, stake: number, oddsAcceptance: OddsAcceptance = "none", systemSize = 2) {
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

  const liveEvents = sportsbookEvents.filter((event) => event.isLive).slice(0, 4);
  const topEvents = sportsbookEvents.filter((event) => !event.isLive).slice(0, 6);
  const cricketEvents = sportsbookEvents.filter((event) => event.sportSlug === "cricket").slice(0, 4);
  const esportsEvents = sportsbookEvents.filter((event) => event.sportSlug === "esports").slice(0, 4);

  const recentBets: Array<{
    event: string;
    selection: string;
    odds: number;
    stake: number;
    status: string;
  }> = [];

  useEffect(() => {
    async function loadFeaturedEvents() {
      try {
        const eventsData = await fetchUpcomingEvents();
        if (!eventsData || !Array.isArray(eventsData)) {
          console.error("Failed to load events");
          return;
        }
        setSportsbookEvents(eventsData.slice(0, 6) as any);
      } catch (error: any) {
        console.error("Failed to load events:", error);
      }
    }

    void loadFeaturedEvents();
  }, []);

  if (!mounted) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <div className="h-12 border-b border-border animate-pulse bg-surface" />
        <div className="flex-1 flex">
          <div className="hidden lg:block w-56 border-r border-border animate-pulse bg-surface" />
          <div className="flex-1 p-3 space-y-3">
            <div className="h-20 rounded-md animate-pulse bg-surface" />
            <div className="h-16 rounded-md animate-pulse bg-surface" />
          </div>
          <div className="hidden lg:block w-80 border-l border-border animate-pulse bg-surface" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background pb-14 lg:pb-0">
      <SEO 
        title="Premier Sports Betting & Casino"
        description="Experience the thrill of sports betting and casino games with PrimeBet. Live odds, instant payouts, and 24/7 support."
      />

      <Header
        user={profile ? { email: user?.email || "", balance: profile.balance } : null}
        onAuthClick={handleAuthClick}
      />

      <div className="flex-1 flex">
        <SportsNav />

        {/* Main Content */}
        <main className="flex-1 min-w-0 overflow-x-hidden">
          {/* Hero Promo Banner */}
          <div className="border-b border-border">
            <div className="container py-4">
              <div className="relative overflow-hidden rounded-lg bg-gradient-to-br from-primary/20 via-primary/10 to-background border border-primary/30 p-6 md:p-8">
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48cGF0dGVybiBpZD0iZ3JpZCIgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cGF0aCBkPSJNIDQwIDAgTCAwIDAgMCA0MCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJyZ2JhKDAsIDIyOSwgMjU1LCAwLjA1KSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-30" />
                <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <h2 className="text-2xl md:text-3xl font-black">Start Betting Today</h2>
                  <Button size="lg" onClick={handleAuthClick} className="bg-primary hover:bg-primary/90 text-background font-black glow-cyan">
                    Create Account →
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Main Content Grid: Center + Right Widgets */}
          <div className="flex">
            {/* Center Content */}
            <div className="flex-1 p-2 md:p-3 space-y-4">
              {feedLoading ? (
                <Card className="surface border-border">
                  <div className="p-6 md:p-8 text-sm text-muted-foreground">Loading live fixtures…</div>
                </Card>
              ) : feedError ? (
                <Card className="surface border-danger/30">
                  <div className="p-6 md:p-8 space-y-2">
                    <h2 className="text-lg font-black">Fixtures are unavailable right now</h2>
                    <p className="text-sm text-muted-foreground">
                      Live data sync is connected, but the current sportsbook query could not load fixtures. You can still review completed matches in Results.
                    </p>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/results">View Results</Link>
                    </Button>
                  </div>
                </Card>
              ) : sportsbookEvents.length === 0 ? (
                <Card className="surface border-border">
                  <div className="p-6 md:p-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-2">
                      <h2 className="text-lg font-black">No active betting events right now</h2>
                      <p className="text-sm text-muted-foreground">
                        The live score feed is connected and completed matches are available, but this provider does not publish bettable odds. Check verified final scores in Results or enable an odds-capable provider for active markets.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm">
                        <Link href="/results">View Results</Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href="/sports">Open Sportsbook</Link>
                      </Button>
                    </div>
                  </div>
                </Card>
              ) : (
                <>
                  {liveEvents.length > 0 && (
                    <section>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-danger live-pulse" />
                          <h2 className="text-sm font-black">Live Now</h2>
                          <Badge variant="destructive" className="h-4 text-[10px] px-1.5">
                            {liveEvents.length}
                          </Badge>
                        </div>
                         <Button asChild variant="ghost" size="sm" className="h-6 px-2 text-[10px] font-bold hover:text-primary"><Link href="/live">View All →</Link></Button>
                      </div>
                      <div className="surface rounded-md overflow-hidden">
                        {liveEvents.map((event, idx) => (
                          <EventRow
                            key={event.id}
                            event={event}
                            onOddsClick={(_selection, _odds, outcome) => handleOddsClick(event, outcome)}
                            selectedOdds={new Set(betSlip.bets.map(b => `${b.event}-${b.selection}`))}
                            isFavorite={favorites.includes(event.id)}
                            onToggleFavorite={() => toggleFavorite(event.id)}
                            onOpenMarkets={() => { setSelectedEvent(event); setShowMarketsModal(true); }}
                          />
                        ))}
                      </div>
                    </section>
                  )}

                  <section>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Trophy className="h-3.5 w-3.5 text-gold" />
                        <h2 className="text-sm font-black">Top Events</h2>
                      </div>
                       <Button asChild variant="ghost" size="sm" className="h-6 px-2 text-[10px] font-bold hover:text-primary"><Link href="/sports">View All →</Link></Button>
                    </div>
                    <div className="surface rounded-md overflow-hidden">
                      <div className="px-3 py-1.5 bg-surface-elevated border-b border-border grid grid-cols-[1fr_auto] lg:grid-cols-[140px_1fr_auto] gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
                        <span className="hidden lg:block">Time</span>
                        <span>Match</span>
                        <span className="text-right">1 X 2</span>
                      </div>
                      {topEvents.map((event) => (
                        <EventRow
                          key={event.id}
                          event={event}
                          onOddsClick={(_selection, _odds, outcome) => handleOddsClick(event, outcome)}
                          selectedOdds={new Set(betSlip.bets.map(b => `${b.event}-${b.selection}`))}
                          isFavorite={favorites.includes(event.id)}
                          onToggleFavorite={() => toggleFavorite(event.id)}
                          onOpenMarkets={() => { setSelectedEvent(event); setShowMarketsModal(true); }}
                        />
                      ))}
                    </div>
                  </section>

                  {cricketEvents.length > 0 && (
                    <section>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-base">🏏</span>
                          <h2 className="text-sm font-black">Cricket</h2>
                          <Badge className="h-4 text-[10px] px-1.5 badge-popular">Popular</Badge>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                        {cricketEvents.map((event) => (
                          <EventCard
                            key={event.id}
                            event={event}
                            onOddsClick={(_selection, _odds, outcome) => handleOddsClick(event, outcome)}
                            selectedOdds={new Set(betSlip.bets.map(b => `${b.event}-${b.selection}`))}
                            isFavorite={favorites.includes(event.id)}
                            onToggleFavorite={() => toggleFavorite(event.id)}
                            onOpenMarkets={() => { setSelectedEvent(event); setShowMarketsModal(true); }}
                          />
                        ))}
                      </div>
                    </section>
                  )}

                  {esportsEvents.length > 0 && (
                    <section>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-base">🎮</span>
                          <h2 className="text-sm font-black">Esports</h2>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                        {esportsEvents.map((event) => (
                          <EventCard
                            key={event.id}
                            event={event}
                            onOddsClick={(_selection, _odds, outcome) => handleOddsClick(event, outcome)}
                            selectedOdds={new Set(betSlip.bets.map(b => `${b.event}-${b.selection}`))}
                            isFavorite={favorites.includes(event.id)}
                            onToggleFavorite={() => toggleFavorite(event.id)}
                            onOpenMarkets={() => { setSelectedEvent(event); setShowMarketsModal(true); }}
                          />
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>

            {/* Right Sidebar Widgets - Hidden on mobile, shown on large screens */}
            <aside className="hidden xl:block w-64 p-2 space-y-3 flex-shrink-0">
              {/* Live Odds Feed */}
              <LiveOddsFeed />

              {/* Live Casino Widget */}
              <Card className="overflow-hidden border-border bg-surface">
                <div className="relative h-32 bg-gradient-to-br from-danger/20 via-danger/10 to-background overflow-hidden">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <PlayCircle className="h-12 w-12 text-danger opacity-60" />
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-background to-transparent">
                    <p className="text-xs font-bold mb-0.5">Live Casino</p>
                    <p className="text-[10px] text-muted-foreground">50+ live dealers online</p>
                  </div>
                </div>
                <div className="p-2">
                   <Button asChild size="sm" className="w-full h-7 text-xs font-bold" variant="outline"><Link href="/casino">Play Now</Link></Button>
                </div>
              </Card>

              {/* Live Stream Widget */}
              <Card className="border-border bg-surface p-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-danger live-pulse" />
                  <p className="text-xs font-bold">Live Streams</p>
                </div>
                <div className="space-y-2">
                  {liveEvents.slice(0, 2).map((stream) => (
                    <div key={stream.id} className="flex items-center justify-between p-2 rounded bg-surface-elevated hover:bg-surface transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-semibold truncate">{stream.homeTeam} vs {stream.awayTeam}</p>
                        <p className="text-[10px] text-muted-foreground">{stream.league}</p>
                      </div>
                      <PlayCircle className="h-4 w-4 text-primary flex-shrink-0" />
                    </div>
                  ))}
                </div>
              </Card>

              {/* Recent Bets Widget */}
              <Card className="border-border bg-surface p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="h-3.5 w-3.5" />
                  <p className="text-xs font-bold">Recent Bets</p>
                </div>
                <ScrollArea className="h-48">
                  <div className="space-y-1.5">
                    {recentBets.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground text-center py-8">
                        Sign in to view recent bet activity.
                      </p>
                    ) : recentBets.map((bet, idx) => (
                      <div key={idx} className="p-2 rounded bg-surface-elevated">
                        <div className="flex items-start justify-between mb-1">
                          <p className="text-[11px] font-semibold truncate flex-1">{bet.event}</p>
                          <Badge
                            variant={bet.status === "won" ? "default" : "outline"}
                            className={cn(
                              "h-4 text-[9px] px-1 ml-1 flex-shrink-0",
                              bet.status === "won" && "bg-success/15 text-success border-success/30"
                            )}
                          >
                            {bet.status}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-muted-foreground">{bet.selection}</span>
                          <span className="font-mono font-bold">${bet.stake} @ {bet.odds}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </Card>
            </aside>
          </div>
        </main>

        {/* Bet Slip */}
        <BetSlip />
      </div>

      {betSlip.bets.length > 0 && (
        <Button
          onClick={() => setMobileBetSlipOpen(true)}
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
        onPlaceBet={handlePlaceBet}
        balance={profile?.balance || 0}
        isOpen={mobileBetSlipOpen}
        onClose={() => setMobileBetSlipOpen(false)}
      />

      <Footer />
      <MobileBottomNav />

      {selectedEvent && (
        <EventMarketsModal
          event={selectedEvent}
          open={showMarketsModal}
          onClose={() => { setShowMarketsModal(false); setSelectedEvent(null); }}
          onOddsClick={(_selection, _odds, outcome, market) => {
            handleOddsClick(selectedEvent, outcome, market?.name || "Market");
          }}
          selectedOdds={new Set(betSlip.bets.flatMap((bet) => [bet.id, `${bet.event}-${bet.selection}`]))}
          isFavorite={favorites.includes(selectedEvent.id)}
          onToggleFavorite={() => void toggleFavorite(selectedEvent.id)}
        />
      )}
    </div>
  );
}