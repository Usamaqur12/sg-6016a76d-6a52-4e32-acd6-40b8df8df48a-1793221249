import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";

const db = supabase;
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trophy, Medal, TrendingUp, DollarSign, Target, Calendar } from "lucide-react";

interface MatchResult {
  id: string;
  home_team: string;
  away_team: string;
  live_score_home: number | null;
  live_score_away: number | null;
  status: string;
  start_time: string;
  sport: { name: string };
  league: { name: string };
}

interface LeaderboardEntry {
  rank: number;
  user_id: string;
  username: string;
  total_profit: number;
  total_bets: number;
  won_bets: number;
  win_rate: number;
  roi: number;
}

type TimePeriod = "today" | "week" | "month" | "all";
type LeaderboardMetric = "profit" | "winrate" | "wins";

export default function Results() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [balance, setBalance] = useState(0);
  const [results, setResults] = useState<MatchResult[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSport, setSelectedSport] = useState<string>("all");
  const [selectedLeague, setSelectedLeague] = useState<string>("all");
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("week");
  const [leaderboardMetric, setLeaderboardMetric] = useState<LeaderboardMetric>("profit");
  const [sports, setSports] = useState<Array<{ name: string }>>([]);
  const [leagues, setLeagues] = useState<Array<{ name: string }>>([]);

  useEffect(() => {
    void checkAuth();
    void loadSportsAndLeagues();
    const { data: { subscription } } = db.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        void loadBalance(session.user.id);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    void loadResults();
  }, [selectedSport, selectedLeague]);

  useEffect(() => {
    void loadLeaderboard();
  }, [timePeriod, leaderboardMetric]);

  async function checkAuth() {
    const { data: { session } } = await db.auth.getSession();
    setUser(session?.user ?? null);
    if (session?.user) {
      await loadBalance(session.user.id);
    }
  }

  async function loadBalance(userId: string) {
    const { data } = await db
      .from("wallet_accounts")
      .select("balance")
      .eq("user_id", userId)
      .maybeSingle();
    setBalance(Number(data?.balance ?? 0));
  }

  async function loadSportsAndLeagues() {
    const [sportsResult, leaguesResult] = await Promise.all([
      db.from("sports").select("name").order("name"),
      db.from("leagues").select("name").order("name"),
    ]);

    if (sportsResult.data) setSports(sportsResult.data);
    if (leaguesResult.data) setLeagues(leaguesResult.data);
  }

  async function loadResults() {
    setLoading(true);
    try {
      let query = db
        .from("events")
        .select(`
          id,
          home_team,
          away_team,
          live_score_home,
          live_score_away,
          status,
          start_time,
          sport:sports(name),
          league:leagues(name)
        `)
        .in("status", ["finished", "postponed", "cancelled"])
        .order("start_time", { ascending: false })
        .limit(50);

      if (selectedSport !== "all") {
        const { data: sportData } = await db
          .from("sports")
          .select("id")
          .eq("name", selectedSport)
          .single();
        if (sportData) query = query.eq("sport_id", sportData.id);
      }

      if (selectedLeague !== "all") {
        const { data: leagueData } = await db
          .from("leagues")
          .select("id")
          .eq("name", selectedLeague)
          .single();
        if (leagueData) query = query.eq("league_id", leagueData.id);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Failed to load results:", error);
        setResults([]);
      } else if (data) {
        setResults(data.map(r => ({
          ...r,
          sport: r.sport || { name: "Unknown" },
          league: r.league || { name: "Unknown" },
        })));
      }
    } catch (error) {
      console.error("Failed to load results:", error);
    } finally {
      setLoading(false);
    }
  }

  async function loadLeaderboard() {
    try {
      const now = new Date();
      let startDate = new Date();

      switch (timePeriod) {
        case "today":
          startDate.setHours(0, 0, 0, 0);
          break;
        case "week":
          startDate.setDate(now.getDate() - 7);
          break;
        case "month":
          startDate.setMonth(now.getMonth() - 1);
          break;
        case "all":
          startDate = new Date(0);
          break;
      }

      const { data: betsData } = await db
        .from("bets")
        .select("user_id, stake, status, payout, settled_at")
        .gte("created_at", startDate.toISOString())
        .in("status", ["won", "lost"]);

      if (!betsData || betsData.length === 0) {
        setLeaderboard([]);
        return;
      }

      // Aggregate stats by user
      const userStats = new Map<string, { totalProfit: number; totalBets: number; wonBets: number; totalWagered: number }>();

      for (const bet of betsData) {
        const current = userStats.get(bet.user_id) || { totalProfit: 0, totalBets: 0, wonBets: 0, totalWagered: 0 };
        current.totalBets++;
        current.totalWagered += Number(bet.stake);

        if (bet.status === "won") {
          current.wonBets++;
          current.totalProfit += Number(bet.payout || 0) - Number(bet.stake);
        } else if (bet.status === "lost") {
          current.totalProfit -= Number(bet.stake);
        }

        userStats.set(bet.user_id, current);
      }

      // Get profiles for usernames
      const userIds = Array.from(userStats.keys());
      const { data: profiles } = await db
        .from("profiles")
        .select("id, username")
        .in("id", userIds);

      const profileMap = new Map(profiles?.map(p => [p.id, p.username || "Anonymous"]) || []);

      // Build leaderboard entries
      const entries: LeaderboardEntry[] = Array.from(userStats.entries()).map(([userId, stats]) => ({
        rank: 0,
        user_id: userId,
        username: profileMap.get(userId) || "Anonymous",
        total_profit: stats.totalProfit,
        total_bets: stats.totalBets,
        won_bets: stats.wonBets,
        win_rate: stats.totalBets > 0 ? (stats.wonBets / stats.totalBets) * 100 : 0,
        roi: stats.totalWagered > 0 ? (stats.totalProfit / stats.totalWagered) * 100 : 0,
      }));

      // Sort by selected metric
      entries.sort((a, b) => {
        switch (leaderboardMetric) {
          case "profit":
            return b.total_profit - a.total_profit;
          case "winrate":
            return b.win_rate - a.win_rate;
          case "wins":
            return b.won_bets - a.won_bets;
          default:
            return 0;
        }
      });

      // Assign ranks
      entries.forEach((entry, idx) => {
        entry.rank = idx + 1;
      });

      setLeaderboard(entries.slice(0, 10));
    } catch (error) {
      console.error("Failed to load leaderboard:", error);
      setLeaderboard([]);
    }
  }

  function getResultBadge(result: MatchResult) {
    if (result.status === "cancelled") return <Badge variant="outline">Cancelled</Badge>;
    if (result.status === "postponed") return <Badge variant="secondary">Postponed</Badge>;
    if (result.live_score_home === null || result.live_score_away === null) {
      return <Badge variant="secondary">No Score</Badge>;
    }
    return null;
  }

  const rankIcons = [
    { icon: Trophy, color: "text-gold" },
    { icon: Medal, color: "text-gray-400" },
    { icon: Medal, color: "text-amber-700" },
  ];

  return (
    <div className="min-h-screen bg-gradient flex flex-col">
      <Header
        user={user ? { email: user.email || "", balance } : null}
        onAuthClick={() => router.push("/auth/login")}
      />

      <main className="flex-1 container mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-3xl font-black mb-2">Match Results & Leaderboard</h1>
          <p className="text-muted-foreground">Completed matches and top performers</p>
        </div>

        <Tabs defaultValue="results" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="results">Match Results</TabsTrigger>
            <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
          </TabsList>

          <TabsContent value="results" className="space-y-4">
            {/* Filters */}
            <Card className="surface border-border p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <Select value={selectedSport} onValueChange={setSelectedSport}>
                  <SelectTrigger className="w-full sm:w-48">
                    <SelectValue placeholder="All Sports" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sports</SelectItem>
                    {sports.map(sport => (
                      <SelectItem key={sport.name} value={sport.name}>
                        {sport.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={selectedLeague} onValueChange={setSelectedLeague}>
                  <SelectTrigger className="w-full sm:w-48">
                    <SelectValue placeholder="All Leagues" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Leagues</SelectItem>
                    {leagues.map(league => (
                      <SelectItem key={league.name} value={league.name}>
                        {league.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </Card>

            {/* Results */}
            {loading ? (
              <Card className="surface border-border p-8 text-center">
                <p className="text-muted-foreground">Loading results...</p>
              </Card>
            ) : results.length === 0 ? (
              <Card className="surface border-border p-8 text-center">
                <p className="text-muted-foreground">No completed matches found</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {results.map((result) => (
                  <Card key={result.id} className="surface border-border hover:border-primary/50 transition-colors">
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {result.league.name}
                          </Badge>
                          {getResultBadge(result)}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {new Date(result.start_time).toLocaleDateString()}
                        </p>
                      </div>

                      <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center">
                        <div className="text-right">
                          <p className="font-bold text-lg">{result.home_team}</p>
                        </div>

                        <div className="flex items-center gap-2 px-4">
                          {result.status === "finished" && result.live_score_home !== null && result.live_score_away !== null ? (
                            <>
                              <span className={`text-2xl font-black ${result.live_score_home > result.live_score_away ? "text-success" : ""}`}>
                                {result.live_score_home}
                              </span>
                              <span className="text-muted-foreground">-</span>
                              <span className={`text-2xl font-black ${result.live_score_away > result.live_score_home ? "text-success" : ""}`}>
                                {result.live_score_away}
                              </span>
                            </>
                          ) : (
                            <span className="text-sm text-muted-foreground">vs</span>
                          )}
                        </div>

                        <div>
                          <p className="font-bold text-lg">{result.away_team}</p>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="leaderboard" className="space-y-4">
            {/* Leaderboard Filters */}
            <Card className="surface border-border p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <Select value={timePeriod} onValueChange={(v) => setTimePeriod(v as TimePeriod)}>
                  <SelectTrigger className="w-full sm:w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">
                      <Calendar className="inline h-4 w-4 mr-2" />
                      Today
                    </SelectItem>
                    <SelectItem value="week">This Week</SelectItem>
                    <SelectItem value="month">This Month</SelectItem>
                    <SelectItem value="all">All Time</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={leaderboardMetric} onValueChange={(v) => setLeaderboardMetric(v as LeaderboardMetric)}>
                  <SelectTrigger className="w-full sm:w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="profit">
                      <DollarSign className="inline h-4 w-4 mr-2" />
                      Total Profit
                    </SelectItem>
                    <SelectItem value="winrate">
                      <Target className="inline h-4 w-4 mr-2" />
                      Win Rate
                    </SelectItem>
                    <SelectItem value="wins">
                      <Trophy className="inline h-4 w-4 mr-2" />
                      Total Wins
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </Card>

            {/* Leaderboard */}
            {leaderboard.length === 0 ? (
              <Card className="surface border-border p-8 text-center">
                <p className="text-muted-foreground">No betting activity for this period</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {leaderboard.map((entry) => {
                  const RankIcon = entry.rank <= 3 ? rankIcons[entry.rank - 1].icon : null;
                  const rankColor = entry.rank <= 3 ? rankIcons[entry.rank - 1].color : "text-muted-foreground";

                  return (
                    <Card key={entry.user_id} className="surface border-border hover:border-primary/50 transition-colors">
                      <div className="p-4">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-surface-elevated">
                            {RankIcon ? (
                              <RankIcon className={`h-6 w-6 ${rankColor}`} />
                            ) : (
                              <span className="font-black text-lg text-muted-foreground">#{entry.rank}</span>
                            )}
                          </div>

                          <div className="flex-1">
                            <p className="font-bold text-lg">{entry.username}</p>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                              <span>{entry.total_bets} bets</span>
                              <span>•</span>
                              <span>{entry.won_bets} won</span>
                            </div>
                          </div>

                          <div className="text-right">
                            {leaderboardMetric === "profit" && (
                              <p className={`text-2xl font-black ${entry.total_profit >= 0 ? "text-success" : "text-danger"}`}>
                                ${entry.total_profit.toFixed(2)}
                              </p>
                            )}
                            {leaderboardMetric === "winrate" && (
                              <p className="text-2xl font-black text-primary">
                                {entry.win_rate.toFixed(1)}%
                              </p>
                            )}
                            {leaderboardMetric === "wins" && (
                              <p className="text-2xl font-black text-gold">
                                {entry.won_bets}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground mt-1">
                              ROI: {entry.roi.toFixed(1)}%
                            </p>
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      <Footer />
    </div>
  );
}