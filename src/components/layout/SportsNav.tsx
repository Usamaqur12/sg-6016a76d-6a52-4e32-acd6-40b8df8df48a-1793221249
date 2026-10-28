import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  ChevronDown,
  ChevronRight,
  Star,
  TrendingUp,
  Trophy,
  Home,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SportsNav() {
  const router = useRouter();
  const [expandedSports, setExpandedSports] = useState<string[]>(["football"]);

  const sports = [
    {
      id: "football",
      name: "Football",
      icon: "⚽",
      count: 245,
      leagues: [
        { name: "Premier League", count: 28 },
        { name: "La Liga", count: 24 },
        { name: "Serie A", count: 26 },
        { name: "Bundesliga", count: 22 },
        { name: "Champions League", count: 18 },
      ],
    },
    {
      id: "cricket",
      name: "Cricket",
      icon: "🏏",
      count: 89,
      leagues: [
        { name: "IPL", count: 16 },
        { name: "Big Bash", count: 8 },
        { name: "T20 World Cup", count: 12 },
        { name: "Test Series", count: 6 },
      ],
    },
    {
      id: "tennis",
      name: "Tennis",
      icon: "🎾",
      count: 156,
      leagues: [
        { name: "ATP Tour", count: 45 },
        { name: "WTA Tour", count: 38 },
        { name: "Grand Slams", count: 16 },
      ],
    },
    {
      id: "basketball",
      name: "Basketball",
      icon: "🏀",
      count: 98,
      leagues: [
        { name: "NBA", count: 30 },
        { name: "EuroLeague", count: 18 },
        { name: "FIBA", count: 14 },
      ],
    },
    {
      id: "esports",
      name: "Esports",
      icon: "🎮",
      count: 67,
      leagues: [
        { name: "League of Legends", count: 24 },
        { name: "CS:GO", count: 18 },
        { name: "Dota 2", count: 15 },
      ],
    },
    {
      id: "hockey",
      name: "Ice Hockey",
      icon: "🏒",
      count: 54,
    },
    {
      id: "baseball",
      name: "Baseball",
      icon: "⚾",
      count: 42,
    },
    {
      id: "rugby",
      name: "Rugby",
      icon: "🏉",
      count: 31,
    },
  ];

  const toggleSport = (sportId: string) => {
    setExpandedSports((prev) =>
      prev.includes(sportId)
        ? prev.filter((id) => id !== sportId)
        : [...prev, sportId]
    );
  };

  const quickLinks = [
    { icon: Home, label: "Home", href: "/", variant: "default" },
    { icon: Star, label: "Favorites", count: 12, href: "/", variant: "favorites" },
    { icon: TrendingUp, label: "Popular", count: 45, href: "/", variant: "popular" },
    { icon: Trophy, label: "Featured", count: 8, href: "/", variant: "featured" },
  ];

  return (
    <aside className="w-[230px] border-r border-border bg-surface flex-shrink-0 hidden lg:block">
      <div className="h-full flex flex-col">
        {/* Quick Links */}
        <div className="p-2 border-b border-border">
          <div className="space-y-0.5">
            {quickLinks.map((link) => {
              const Icon = link.icon;
              const isHome = link.label === "Home";
              return (
                <Link key={link.label} href={link.href}>
                  <button
                    className={cn(
                      "w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs font-semibold transition-all duration-150",
                      isHome
                        ? "bg-primary/10 text-primary border border-primary/20"
                        : "text-muted-foreground hover:text-foreground hover:bg-surface-elevated"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5" />
                      <span>{link.label}</span>
                    </div>
                    {link.count && (
                      <span className="text-[10px] bg-raised px-1.5 py-0.5 rounded font-mono font-bold">
                        {link.count}
                      </span>
                    )}
                  </button>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Sports List */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-2">
            <p className="px-2.5 py-1.5 text-[10px] font-black text-subtle-foreground uppercase tracking-wider">
              All Sports
            </p>
            <div className="space-y-0.5">
              {sports.map((sport) => {
                const isExpanded = expandedSports.includes(sport.id);
                const isActive = router.pathname.includes(sport.id);

                return (
                  <div key={sport.id}>
                    {/* Sport Header */}
                    <button
                      onClick={() => sport.leagues && toggleSport(sport.id)}
                      className={cn(
                        "w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs font-semibold transition-all duration-150",
                        isActive
                          ? "bg-primary/10 text-primary border border-primary/20"
                          : "text-foreground hover:bg-surface-elevated hover:text-primary"
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
                        {sport.leagues && (
                          <>
                            {isExpanded ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                          </>
                        )}
                      </div>
                    </button>

                    {/* Leagues */}
                    {sport.leagues && isExpanded && (
                      <div className="mt-0.5 ml-3 space-y-0.5 animate-slide-down">
                        {sport.leagues.map((league) => (
                          <Link key={league.name} href={`/${sport.id}`}>
                            <button className="w-full flex items-center justify-between px-2.5 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-all duration-150">
                              <span className="truncate">{league.name}</span>
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

        {/* Bottom CTA */}
        <div className="p-2 border-t border-border">
          <div className="p-2.5 rounded bg-gradient-to-br from-primary/15 via-primary/10 to-primary/5 border border-primary/20">
            <div className="flex items-center gap-1.5 mb-1">
              <Trophy className="h-3.5 w-3.5 text-primary" />
              <p className="text-xs font-bold text-primary">Sign Up Bonus</p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Get started with exclusive welcome offers
            </p>
            <Button asChild size="sm" className="w-full h-7 text-xs font-bold bg-primary-bright hover:bg-primary-hover text-background">
              <Link href="/sports">Explore Sports</Link>
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
