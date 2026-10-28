import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  ArrowLeft, TrendingUp, TrendingDown, Trophy, XCircle, 
  Clock, Receipt, Wallet, Target, BarChart3, Calendar,
  FileCheck, AlertCircle, CheckCircle
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface BetStats {
  totalBets: number;
  activeBets: number;
  wonBets: number;
  lostBets: number;
  totalStaked: number;
  totalWinnings: number;
  totalLosses: number;
  profit: number;
  winRate: number;
  averageStake: number;
  averageOdds: number;
  biggestWin: number;
  biggestLoss: number;
}

interface SportStats {
  sport: string;
  bets: number;
  won: number;
  profit: number;
}

interface Document {
  id: string;
  document_type: string;
  status: string;
  uploaded_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
}

export default function Dashboard() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState<BetStats>({
    totalBets: 0,
    activeBets: 0,
    wonBets: 0,
    lostBets: 0,
    totalStaked: 0,
    totalWinnings: 0,
    totalLosses: 0,
    profit: 0,
    winRate: 0,
    averageStake: 0,
    averageOdds: 0,
    biggestWin: 0,
    biggestLoss: 0,
  });
  const [sportStats, setSportStats] = useState<SportStats[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [recentBets, setRecentBets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void initialize();
  }, []);

  async function initialize() {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    
    if (!authUser) {
      await router.push("/auth/login");
      return;
    }

    setUser(authUser);

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", authUser.id)
      .single();

    if (profile) {
      setProfile(profile);
      await Promise.all([
        loadBetStats(authUser.id),
        loadSportStats(authUser.id),
        loadDocuments(authUser.id),
        loadRecentBets(authUser.id),
      ]);
    }

    setLoading(false);
  }

  async function loadBetStats(userId: string) {
    const { data: bets } = await supabase
      .from("bets")
      .select("*")
      .eq("user_id", userId);

    if (bets && bets.length > 0) {
      const totalBets = bets.length;
      const activeBets = bets.filter(b => b.status === "pending").length;
      const wonBets = bets.filter(b => b.status === "won").length;
      const lostBets = bets.filter(b => b.status === "lost").length;
      const totalStaked = bets.reduce((sum, b) => sum + Number(b.stake || 0), 0);
      const totalWinnings = bets.filter(b => b.status === "won").reduce((sum, b) => sum + Number(b.payout || 0), 0);
      const totalLosses = bets.filter(b => b.status === "lost").reduce((sum, b) => sum + Number(b.stake || 0), 0);
      const profit = totalWinnings - totalLosses;
      const winRate = totalBets > 0 ? (wonBets / (wonBets + lostBets)) * 100 : 0;
      const averageStake = totalBets > 0 ? totalStaked / totalBets : 0;
      const averageOdds = totalBets > 0 ? bets.reduce((sum, b) => sum + Number(b.total_odds || 0), 0) / totalBets : 0;
      const biggestWin = Math.max(...bets.filter(b => b.status === "won").map(b => Number(b.payout || 0)), 0);
      const biggestLoss = Math.max(...bets.filter(b => b.status === "lost").map(b => Number(b.stake || 0)), 0);

      setStats({
        totalBets,
        activeBets,
        wonBets,
        lostBets,
        totalStaked,
        totalWinnings,
        totalLosses,
        profit,
        winRate,
        averageStake,
        averageOdds,
        biggestWin,
        biggestLoss,
      });
    }
  }

  async function loadSportStats(userId: string) {
    const { data: bets } = await supabase
      .from("bets")
      .select("id, status, stake, payout")
      .eq("user_id", userId);
    if (!bets?.length) {
      setSportStats([]);
      return;
    }

    const betIds = bets.map((bet) => bet.id);
    const { data: selections } = await supabase
      .from("bet_selections")
      .select("bet_id, market_id")
      .in("bet_id", betIds);
    const marketIds = [...new Set((selections || []).map((selection) => selection.market_id))];
    if (!marketIds.length) {
      setSportStats([]);
      return;
    }

    const { data: markets } = await supabase.from("markets").select("id, event_id").in("id", marketIds);
    const eventIds = [...new Set((markets || []).map((market) => market.event_id))];
    const { data: events } = eventIds.length
      ? await supabase.from("events").select("id, sport_id").in("id", eventIds)
      : { data: [] };
    const sportIds = [...new Set((events || []).map((event) => event.sport_id))];
    const { data: sports } = sportIds.length
      ? await supabase.from("sports").select("id, name").in("id", sportIds)
      : { data: [] };

    const marketToEvent = new Map((markets || []).map((market) => [market.id, market.event_id]));
    const eventToSport = new Map((events || []).map((event) => [event.id, event.sport_id]));
    const sportNames = new Map((sports || []).map((sport) => [sport.id, sport.name]));
    const selectionsByBet = new Map<string, string[]>();
    (selections || []).forEach((selection) => {
      const eventId = marketToEvent.get(selection.market_id);
      const sportId = eventId ? eventToSport.get(eventId) : undefined;
      const sportName = sportId ? sportNames.get(sportId) : undefined;
      if (!sportName) return;
      const names = selectionsByBet.get(selection.bet_id) || [];
      if (!names.includes(sportName)) names.push(sportName);
      selectionsByBet.set(selection.bet_id, names);
    });

    const totals = new Map<string, { bets: number; won: number; profit: number }>();
    bets.forEach((bet) => {
      const sportNamesForBet = selectionsByBet.get(bet.id) || [];
      if (!sportNamesForBet.length) return;
      const settledProfit = bet.status === "won"
        ? Number(bet.payout || 0) - Number(bet.stake || 0)
        : bet.status === "lost" ? -Number(bet.stake || 0) : 0;
      const allocatedProfit = settledProfit / sportNamesForBet.length;
      sportNamesForBet.forEach((sportName) => {
        const current = totals.get(sportName) || { bets: 0, won: 0, profit: 0 };
        current.bets += 1;
        current.won += bet.status === "won" ? 1 : 0;
        current.profit += allocatedProfit;
        totals.set(sportName, current);
      });
    });

    setSportStats(
      Array.from(totals.entries())
        .map(([sport, data]) => ({ sport, ...data }))
        .sort((a, b) => b.bets - a.bets)
    );
  }

  async function loadDocuments(userId: string) {
    const { data } = await supabase
      .from("kyc_documents")
      .select("id, document_type, status, uploaded_at, reviewed_at, rejection_reason")
      .eq("user_id", userId)
      .order("uploaded_at", { ascending: false });

    if (data) {
      setDocuments(data as Document[]);
    }
  }

  async function loadRecentBets(userId: string) {
    const { data } = await supabase
      .from("bets")
      .select("id, type, status, stake, total_odds, potential_return, payout, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5);

    if (data) {
      setRecentBets(data);
    }
  }

  const getDocumentIcon = (status: string) => {
    switch (status) {
      case "approved":
        return <CheckCircle className="h-4 w-4 text-success" />;
      case "rejected":
        return <XCircle className="h-4 w-4 text-danger" />;
      case "pending":
        return <Clock className="h-4 w-4 text-warning" />;
      default:
        return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getDocumentBadge = (status: string) => {
    switch (status) {
      case "approved":
        return <Badge className="bg-success/10 text-success border-success/30">Approved</Badge>;
      case "rejected":
        return <Badge variant="destructive">Rejected</Badge>;
      case "pending":
        return <Badge variant="outline" className="border-warning text-warning">Pending</Badge>;
      default:
        return <Badge variant="outline">Not Submitted</Badge>;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background pb-14 lg:pb-0">
      <Header
        user={user ? {
          email: profile?.email || user.email || "",
          balance: profile?.demo_balance || 0,
        } : null}
        onAuthClick={() => router.push("/auth/login")}
      />

      <main className="flex-1 container py-6">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/account">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold">Complete Dashboard</h1>
                <p className="text-sm text-muted-foreground">Your comprehensive betting analytics</p>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 animate-pulse rounded-lg bg-surface" />
              ))}
            </div>
          ) : (
            <Tabs defaultValue="overview" className="space-y-6">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="stats">Detailed Stats</TabsTrigger>
                <TabsTrigger value="documents">Documents</TabsTrigger>
              </TabsList>

              {/* Overview Tab */}
              <TabsContent value="overview" className="space-y-6">
                {/* Key Metrics */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card className="surface">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <Receipt className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <div className="text-2xl font-bold">{stats.totalBets}</div>
                          <div className="text-xs text-muted-foreground">Total Bets</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="surface">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
                          <Trophy className="h-5 w-5 text-success" />
                        </div>
                        <div>
                          <div className="text-2xl font-bold">{stats.wonBets}</div>
                          <div className="text-xs text-muted-foreground">Wins</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="surface">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
                          <Target className="h-5 w-5 text-warning" />
                        </div>
                        <div>
                          <div className="text-2xl font-bold">{stats.winRate.toFixed(1)}%</div>
                          <div className="text-xs text-muted-foreground">Win Rate</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className={`surface ${stats.profit >= 0 ? 'border-success/30' : 'border-danger/30'}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full ${stats.profit >= 0 ? 'bg-success/10' : 'bg-danger/10'} flex items-center justify-center`}>
                          {stats.profit >= 0 ? (
                            <TrendingUp className="h-5 w-5 text-success" />
                          ) : (
                            <TrendingDown className="h-5 w-5 text-danger" />
                          )}
                        </div>
                        <div>
                          <div className={`text-2xl font-bold font-mono ${stats.profit >= 0 ? 'text-success' : 'text-danger'}`}>
                            ${Math.abs(stats.profit).toFixed(2)}
                          </div>
                          <div className="text-xs text-muted-foreground">Net Profit/Loss</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Recent Bets */}
                <Card className="surface">
                  <CardHeader>
                    <CardTitle className="text-lg">Recent Bets</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {recentBets.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">No bets placed yet</p>
                    ) : (
                      <div className="space-y-3">
                        {recentBets.map((bet) => (
                          <div key={bet.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                            <div className="flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-full ${
                                bet.status === 'won' ? 'bg-success/10' :
                                bet.status === 'lost' ? 'bg-danger/10' :
                                'bg-warning/10'
                              } flex items-center justify-center`}>
                                {bet.status === 'won' ? <Trophy className="h-4 w-4 text-success" /> :
                                 bet.status === 'lost' ? <XCircle className="h-4 w-4 text-danger" /> :
                                 <Clock className="h-4 w-4 text-warning" />}
                              </div>
                              <div>
                                <div className="text-sm font-medium capitalize">{bet.type} Bet</div>
                                <div className="text-xs text-muted-foreground">
                                  {new Date(bet.created_at).toLocaleDateString()}
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-bold font-mono">${Number(bet.stake).toFixed(2)}</div>
                              <Badge variant={bet.status === 'won' ? 'default' : bet.status === 'lost' ? 'destructive' : 'outline'} className="text-xs">
                                {bet.status}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Detailed Stats Tab */}
              <TabsContent value="stats" className="space-y-6">
                {/* Financial Stats */}
                <Card className="surface">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Wallet className="h-5 w-5 text-primary" />
                      Financial Overview
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div className="p-4 rounded-lg border border-border">
                        <div className="text-xs text-muted-foreground mb-1">Total Staked</div>
                        <div className="text-xl font-bold font-mono">${stats.totalStaked.toFixed(2)}</div>
                      </div>
                      <div className="p-4 rounded-lg border border-border">
                        <div className="text-xs text-muted-foreground mb-1">Total Winnings</div>
                        <div className="text-xl font-bold font-mono text-success">${stats.totalWinnings.toFixed(2)}</div>
                      </div>
                      <div className="p-4 rounded-lg border border-border">
                        <div className="text-xs text-muted-foreground mb-1">Total Losses</div>
                        <div className="text-xl font-bold font-mono text-danger">${stats.totalLosses.toFixed(2)}</div>
                      </div>
                      <div className="p-4 rounded-lg border border-border">
                        <div className="text-xs text-muted-foreground mb-1">Average Stake</div>
                        <div className="text-xl font-bold font-mono">${stats.averageStake.toFixed(2)}</div>
                      </div>
                      <div className="p-4 rounded-lg border border-border">
                        <div className="text-xs text-muted-foreground mb-1">Average Odds</div>
                        <div className="text-xl font-bold font-mono">{stats.averageOdds.toFixed(2)}</div>
                      </div>
                      <div className="p-4 rounded-lg border border-border">
                        <div className="text-xs text-muted-foreground mb-1">Biggest Win</div>
                        <div className="text-xl font-bold font-mono text-success">${stats.biggestWin.toFixed(2)}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Bet Status Breakdown */}
                <Card className="surface">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-primary" />
                      Bet Status Breakdown
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="text-center p-4 rounded-lg bg-warning/5 border border-warning/20">
                        <div className="text-3xl font-bold">{stats.activeBets}</div>
                        <div className="text-sm text-muted-foreground mt-1">Active</div>
                      </div>
                      <div className="text-center p-4 rounded-lg bg-success/5 border border-success/20">
                        <div className="text-3xl font-bold">{stats.wonBets}</div>
                        <div className="text-sm text-muted-foreground mt-1">Won</div>
                      </div>
                      <div className="text-center p-4 rounded-lg bg-danger/5 border border-danger/20">
                        <div className="text-3xl font-bold">{stats.lostBets}</div>
                        <div className="text-sm text-muted-foreground mt-1">Lost</div>
                      </div>
                      <div className="text-center p-4 rounded-lg border border-border">
                        <div className="text-3xl font-bold">{stats.totalBets - stats.wonBets - stats.lostBets - stats.activeBets}</div>
                        <div className="text-sm text-muted-foreground mt-1">Other</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Documents Tab */}
              <TabsContent value="documents" className="space-y-6">
                <Card className="surface">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <FileCheck className="h-5 w-5 text-primary" />
                        Verified Documents
                      </CardTitle>
                      <Link href="/account/kyc">
                        <Button size="sm">Upload Documents</Button>
                      </Link>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {documents.length === 0 ? (
                      <div className="text-center py-8">
                        <FileCheck className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                        <p className="font-medium">No documents uploaded</p>
                        <p className="text-sm text-muted-foreground mt-1">Upload your ID and proof of address for account verification</p>
                        <Link href="/account/kyc">
                          <Button className="mt-4">Start KYC Verification</Button>
                        </Link>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {documents.map((doc) => (
                          <div key={doc.id} className="flex items-center justify-between p-4 rounded-lg border border-border">
                            <div className="flex items-center gap-3">
                              {getDocumentIcon(doc.status)}
                              <div>
                                <div className="text-sm font-medium capitalize">{doc.document_type.replace("_", " ")}</div>
                                <div className="text-xs text-muted-foreground">
                                  Uploaded {new Date(doc.uploaded_at).toLocaleDateString()}
                                  {doc.reviewed_at && ` · Reviewed ${new Date(doc.reviewed_at).toLocaleDateString()}`}
                                </div>
                                {doc.rejection_reason && (
                                  <div className="text-xs text-danger mt-1">{doc.rejection_reason}</div>
                                )}
                              </div>
                            </div>
                            {getDocumentBadge(doc.status)}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </main>

      <Footer />
      <MobileBottomNav />
    </div>
  );
}
