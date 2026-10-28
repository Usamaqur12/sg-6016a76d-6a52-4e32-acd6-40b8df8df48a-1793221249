import { useState, useEffect } from "react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { supabase } from "@/integrations/supabase/client";
import { useRouter } from "next/router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Play, Star, TrendingUp, Zap, Trophy, Dices, Flame } from "lucide-react";

const casinoGames = [
  {
    id: 1,
    name: "Mega Fortune",
    provider: "NetEnt",
    category: "slots",
    image: "🎰",
    popular: true,
    new: false,
  },
  {
    id: 2,
    name: "Lightning Roulette",
    provider: "Evolution",
    category: "live",
    image: "🎡",
    popular: true,
    new: false,
  },
  {
    id: 3,
    name: "Blackjack Royal Pairs",
    provider: "Evolution",
    category: "table",
    image: "🃏",
    popular: false,
    new: false,
  },
  {
    id: 4,
    name: "Book of Dead",
    provider: "Play'n GO",
    category: "slots",
    image: "📖",
    popular: true,
    new: false,
  },
  {
    id: 5,
    name: "Crazy Time",
    provider: "Evolution",
    category: "live",
    image: "🎪",
    popular: true,
    new: true,
  },
  {
    id: 6,
    name: "Starburst",
    provider: "NetEnt",
    category: "slots",
    image: "✨",
    popular: true,
    new: false,
  },
  {
    id: 7,
    name: "European Roulette",
    provider: "NetEnt",
    category: "table",
    image: "🎲",
    popular: false,
    new: false,
  },
  {
    id: 8,
    name: "Mega Moolah",
    provider: "Microgaming",
    category: "jackpot",
    image: "🦁",
    popular: true,
    new: false,
  },
  {
    id: 9,
    name: "Monopoly Live",
    provider: "Evolution",
    category: "live",
    image: "🎩",
    popular: true,
    new: true,
  },
  {
    id: 10,
    name: "Gonzo's Quest",
    provider: "NetEnt",
    category: "slots",
    image: "🗿",
    popular: true,
    new: false,
  },
  {
    id: 11,
    name: "Baccarat",
    provider: "Evolution",
    category: "table",
    image: "🎴",
    popular: false,
    new: false,
  },
  {
    id: 12,
    name: "Divine Fortune",
    provider: "NetEnt",
    category: "jackpot",
    image: "🏛️",
    popular: false,
    new: false,
  },
];

export default function CasinoPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const [category, setCategory] = useState<string>("all");
  const [favorites, setFavorites] = useState<number[]>([]);
  const [providerGames, setProviderGames] = useState<any[]>([]);
  const [casinoEnabled, setCasinoEnabled] = useState(false);
  const [launchingGame, setLaunchingGame] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user.id);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    fetch("/api/casino/games").then(async (response) => response.ok ? response.json() : null).then((payload) => {
      if (!payload?.enabled) return;
      setCasinoEnabled(true);
      setProviderGames((payload.games || []).map((game: any) => ({
        id: game.id, name: game.name, provider: game.casino_providers?.name || "Casino provider", category: game.category,
        image: game.thumbnail_url || "🎰", popular: game.is_popular, new: game.is_new, realProvider: true,
      })));
    }).catch(() => undefined);
  }, []);

  const loadProfile = async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    
    if (data) {
      setProfile(data);
    }
  };

  const handleAuthClick = () => {
    router.push("/auth/login");
  };

  const handlePlayGame = async (gameId: string | number) => {
    if (!user) {
      router.push("/auth/login");
      return;
    }
    if (!casinoEnabled || typeof gameId === "number") {
      alert("Casino game launch requires licensed provider setup. Contact support for activation.");
      return;
    }
    setLaunchingGame(String(gameId));
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch("/api/casino/session", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token || ""}` }, body: JSON.stringify({ gameId }) });
      const payload = await response.json();
      if (!response.ok || !payload.launchUrl) throw new Error(payload.error || "Game launch failed");
      window.location.assign(payload.launchUrl);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Game launch failed");
      setLaunchingGame(null);
    }
  };

  const toggleFavorite = (gameId: number) => {
    setFavorites((prev) =>
      prev.includes(gameId) ? prev.filter((id) => id !== gameId) : [...prev, gameId]
    );
  };

  const displayedGames = providerGames.length ? providerGames : casinoGames;
  const filteredGames = category === "all" 
    ? displayedGames
    : displayedGames.filter(game => game.category === category);

  if (!mounted) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <div className="h-16 border-b border-border animate-pulse bg-surface" />
        <div className="flex-1 p-4 space-y-4">
          <div className="h-40 rounded-lg animate-pulse bg-surface" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-48 rounded-lg animate-pulse bg-surface" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background pb-14 lg:pb-0">
      <Header
        user={
          profile
            ? {
                email: user?.email || "",
                balance: profile.demo_balance || 0,
              }
            : null
        }
        onAuthClick={handleAuthClick}
      />

      <main className="flex-1 container py-6">
        {/* Hero Banner */}
        <Card className="mb-6 bg-gradient-to-r from-gold/20 to-gold/5 border-gold/20">
          <CardContent className="p-8 flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold mb-2">Casino Lobby</h1>
              <p className="text-lg text-muted-foreground mb-4">
                {casinoEnabled ? "Licensed-provider catalogue connection is active" : "Casino games currently unavailable"}
              </p>
              {!user && (
                <Button size="lg" className="bg-gold hover:bg-gold/90 text-background" onClick={() => void router.push("/auth/register?returnTo=/casino")}>
                  Sign Up to Play
                </Button>
              )}
            </div>
            <div className="hidden md:block text-6xl">🎰</div>
          </CardContent>
        </Card>

        {/* Category Filter */}
        <div className="mb-6">
          <Tabs value={category} onValueChange={setCategory}>
            <TabsList className="bg-surface">
              <TabsTrigger value="all" className="gap-2">
                <TrendingUp className="h-4 w-4" />
                All Games
              </TabsTrigger>
              <TabsTrigger value="slots" className="gap-2">
                🎰 Slots
              </TabsTrigger>
              <TabsTrigger value="live" className="gap-2">
                <Zap className="h-4 w-4 text-danger" />
                Live Casino
              </TabsTrigger>
              <TabsTrigger value="table" className="gap-2">
                🎲 Table Games
              </TabsTrigger>
              <TabsTrigger value="jackpot" className="gap-2">
                <Trophy className="h-4 w-4 text-gold" />
                Jackpots
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Popular Games Section */}
        {category === "all" && (
          <section className="mb-8">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Star className="h-5 w-5 text-gold" />
              Popular Games
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
              {displayedGames.filter(g => g.popular).slice(0, 6).map((game) => (
                <Card key={game.id} className="group cursor-pointer surface-hover overflow-hidden">
                  <CardContent className="p-0">
                    <div className="aspect-square bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center text-6xl relative overflow-hidden">
                      {game.image}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Button
                          size="sm"
                          className="gap-2"
                          onClick={() => handlePlayGame(game.id)}
                        >
                          <Play className="h-4 w-4" />
                          {launchingGame === String(game.id) ? "Launching..." : "Play"}
                        </Button>
                      </div>
                      {game.new && (
                        <Badge className="absolute top-2 right-2 bg-success text-success-foreground">
                          NEW
                        </Badge>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(game.id);
                        }}
                        className="absolute top-2 left-2 p-1.5 rounded-full bg-background/80 hover:bg-background transition-colors"
                      >
                        <Star
                          className={`h-4 w-4 ${
                            favorites.includes(game.id)
                              ? "fill-gold text-gold"
                              : "text-muted-foreground"
                          }`}
                        />
                      </button>
                    </div>
                    <div className="p-3">
                      <h3 className="font-semibold text-sm mb-1 truncate">{game.name}</h3>
                      <p className="text-xs text-muted-foreground truncate">{game.provider}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* All Games */}
        <section>
          <h2 className="text-xl font-bold mb-4">
            {category === "all" ? "All Games" : 
             category === "slots" ? "Slot Games" :
             category === "live" ? "Live Casino" :
             category === "table" ? "Table Games" : "Jackpot Games"}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {filteredGames.map((game) => (
              <Card key={game.id} className="group cursor-pointer surface-hover overflow-hidden">
                <CardContent className="p-0">
                  <div className="aspect-square bg-gradient-to-br from-muted/20 to-muted/5 flex items-center justify-center text-6xl relative overflow-hidden">
                    {game.image}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Button
                        size="sm"
                        className="gap-2"
                        onClick={() => handlePlayGame(game.id)}
                      >
                        <Play className="h-4 w-4" />
                          {launchingGame === String(game.id) ? "Launching..." : "Play"}
                      </Button>
                    </div>
                    {game.new && (
                      <Badge className="absolute top-2 right-2 bg-success text-success-foreground">
                        NEW
                      </Badge>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(game.id);
                      }}
                      className="absolute top-2 left-2 p-1.5 rounded-full bg-background/80 hover:bg-background transition-colors"
                    >
                      <Star
                        className={`h-4 w-4 ${
                          favorites.includes(game.id)
                            ? "fill-gold text-gold"
                            : "text-muted-foreground"
                        }`}
                      />
                    </button>
                  </div>
                  <div className="p-3">
                    <h3 className="font-semibold text-sm mb-1 truncate">{game.name}</h3>
                    <p className="text-xs text-muted-foreground truncate">{game.provider}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <Footer />
      <MobileBottomNav />
    </div>
  );
}
