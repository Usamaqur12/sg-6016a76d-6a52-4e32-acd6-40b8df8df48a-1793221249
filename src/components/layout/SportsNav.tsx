import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  ChevronDown,
  ChevronRight,
  Home,
  Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CountryFlag } from "@/components/ui/CountryFlag";
import { cn } from "@/lib/utils";
import { fetchUpcomingEvents } from "@/services/sportsbookService";

type ActiveSport = {
  id: string;
  name: string;
  icon: string;
  count: number;
  leagues: Array<{ name: string; count: number; countryCode?: string }>;
};

const configuredSports = [
  { id: "football", name: "Football", icon: "⚽" },
  { id: "cricket", name: "Cricket", icon: "🏏" },
  { id: "tennis", name: "Tennis", icon: "🎾" },
  { id: "basketball", name: "Basketball", icon: "🏀" },
  { id: "esports", name: "Esports", icon: "🎮" },
  { id: "ice-hockey", name: "Ice Hockey", icon: "🏒" },
  { id: "baseball", name: "Baseball", icon: "⚾" },
  { id: "rugby", name: "Rugby", icon: "🏉" },
] as const;

function emptyConfiguredSports(): ActiveSport[] {
  return configuredSports.map((sport) => ({ ...sport, count: 0, leagues: [] }));
}

const sportIcons: Record<string, string> = {
  football: "⚽",
  cricket: "🏏",
  tennis: "🎾",
  basketball: "🏀",
  esports: "🎮",
  "ice-hockey": "🏒",
  hockey: "🏒",
  baseball: "⚾",
  rugby: "🏉",
};

export function SportsNav() {
  const router = useRouter();
  const [expandedSports, setExpandedSports] = useState<string[]>(["football"]);
  const [sports, setSports] = useState<ActiveSport[]>(emptyConfiguredSports);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadActiveSports() {
      try {
        const events = await fetchUpcomingEvents();
        const grouped = new Map<string, {
          name: string;
          count: number;
          leagues: Map<string, { count: number; countryCode?: string }>;
        }>();

        for (const event of events) {
          const isBettable = event.markets.some((market) =>
            market.outcomes.filter((outcome) => Number.isFinite(outcome.value) && outcome.value > 1).length >= 2
          );
          if (!isBettable) continue;

          const sportId = event.sportSlug === "hockey" ? "ice-hockey" : event.sportSlug;
          const current = grouped.get(sportId) || {
            name: event.sport,
            count: 0,
            leagues: new Map<string, { count: number; countryCode?: string }>(),
          };
          current.count += 1;
          const league = current.leagues.get(event.league);
          current.leagues.set(event.league, {
            count: (league?.count || 0) + 1,
            countryCode: league?.countryCode || event.leagueCountryCode,
          });
          grouped.set(sportId, current);
        }

        const configuredIds = new Set(configuredSports.map((sport) => sport.id));
        const toLeagues = (leagues: Map<string, { count: number; countryCode?: string }> | undefined) =>
          [...(leagues?.entries() || [])]
            .map(([name, value]) => ({ name, count: value.count, countryCode: value.countryCode }))
            .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));

        const nextSports: ActiveSport[] = configuredSports.map((sport) => {
          const live = grouped.get(sport.id);
          return {
            ...sport,
            count: live?.count || 0,
            leagues: toLeagues(live?.leagues),
          };
        });

        for (const [id, value] of grouped.entries()) {
          if (configuredIds.has(id as (typeof configuredSports)[number]["id"])) continue;
          nextSports.push({
            id,
            name: value.name,
            icon: sportIcons[id] || "🏆",
            count: value.count,
            leagues: toLeagues(value.leagues),
          });
        }

        if (active) setSports(nextSports);
      } catch (error) {
        console.error("Failed to load active sportsbook navigation", error);
        if (active) setSports(emptyConfiguredSports());
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadActiveSports();
    const timer = window.setInterval(() => void loadActiveSports(), 60_000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const toggleSport = (sportId: string) => {
    setExpandedSports((current) =>
      current.includes(sportId)
        ? current.filter((id) => id !== sportId)
        : [...current, sportId]
    );
  };

  const selectedSport = typeof router.query.sport === "string" ? router.query.sport : null;
  const selectedLeague = typeof router.query.league === "string" ? router.query.league : null;

  return (
    <aside className="w-[230px] border-r border-border bg-surface flex-shrink-0 hidden lg:block">
      <div className="h-full flex flex-col">
        <div className="p-2 border-b border-border">
          <div className="space-y-0.5">
            <Link href="/">
              <button className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-all duration-150">
                <Home className="h-3.5 w-3.5" />
                <span>Home</span>
              </button>
            </Link>
            <Link href="/sports">
              <button className={cn(
                "w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs font-semibold transition-all duration-150",
                router.pathname === "/sports"
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface-elevated"
              )}>
                <Trophy className="h-3.5 w-3.5" />
                <span>Active Sportsbook</span>
              </button>
            </Link>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-2">
            <p className="px-2.5 py-1.5 text-[10px] font-black text-subtle-foreground uppercase tracking-wider">
              Sports
            </p>
            <div className="space-y-0.5">
              {loading && (
                <p className="px-2.5 py-2 text-[10px] text-muted-foreground">Refreshing active market counts…</p>
              )}
              {sports.map((sport) => {
                const isExpanded = expandedSports.includes(sport.id);
                const isActive = selectedSport === sport.id;

                return (
                  <div key={sport.id}>
                    <button
                      onClick={() => {
                        toggleSport(sport.id);
                        void router.push({
                          pathname: "/sports",
                          query: { sport: sport.id },
                        });
                      }}
                      className={cn(
                        "w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs font-semibold transition-all duration-150",
                        isActive
                          ? "bg-primary/10 text-primary border border-primary/20"
                          : sport.count > 0
                            ? "text-foreground hover:bg-surface-elevated hover:text-primary"
                            : "text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{sport.icon}</span>
                        <span>{sport.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] bg-raised px-1.5 py-0.5 rounded font-mono font-bold">
                          {sport.count}
                        </span>
                        {sport.leagues.length > 0 && (
                          isExpanded
                            ? <ChevronDown className="h-3 w-3" />
                            : <ChevronRight className="h-3 w-3" />
                        )}
                      </div>
                    </button>

                    {sport.leagues.length > 0 && isExpanded && (
                      <div className="mt-0.5 ml-3 space-y-0.5 animate-slide-down">
                        {sport.leagues.map((league) => (
                          <Link
                            key={league.name}
                            href={{
                              pathname: "/sports",
                              query: { sport: sport.id, league: league.name },
                            }}
                          >
                            <button className={cn(
                              "w-full flex items-center justify-between px-2.5 py-1 rounded text-[11px] transition-all duration-150",
                              isActive && selectedLeague === league.name
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:text-foreground hover:bg-surface-elevated"
                            )}>
                              <span className="flex min-w-0 items-center gap-1.5">
                                <CountryFlag code={league.countryCode} label={league.name} className="h-3 w-4" />
                                <span className="truncate">{league.name}</span>
                              </span>
                              <span className="text-[10px] font-mono ml-1 flex-shrink-0">{league.count}</span>
                            </button>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="p-2 border-t border-border">
          <div className="p-2.5 rounded bg-gradient-to-br from-primary/15 via-primary/10 to-primary/5 border border-primary/20">
            <div className="flex items-center gap-1.5 mb-1">
              <Trophy className="h-3.5 w-3.5 text-primary" />
              <p className="text-xs font-bold text-primary">Live Sportsbook</p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Only active provider events with verified betting prices are listed.
            </p>
            <Button asChild size="sm" className="mt-2 w-full h-7 text-xs font-bold bg-primary-bright hover:bg-primary-hover text-background">
              <Link href="/sports">View active markets</Link>
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
