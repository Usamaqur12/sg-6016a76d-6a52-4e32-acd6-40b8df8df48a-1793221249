import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Users, TrendingUp, Wallet, FileCheck, 
  ArrowUpRight, ArrowDownRight, DollarSign,
  AlertTriangle, TrendingDown, Activity, Landmark, ShieldAlert,
  Headphones, Radio, ServerCog, CheckSquare
} from "lucide-react";

interface OperationsSummary {
  queues: {
    pendingDeposits: number;
    pendingWithdrawals: number;
    pendingApprovals: number;
    openSupportTickets: number;
    pendingKyc: number;
    unreviewedRiskFlags: number;
  };
  system: {
    pendingJobs: number;
    failedJobs: number;
    liveEvents: number;
    upcomingEvents: number;
    enabledProviders: number;
    unhealthyProviders: number;
  };
}

interface RiskAlert {
  userId: string;
  userName: string;
  riskType: string;
  riskScore: number;
  details: string;
  timestamp: string;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [riskAlertsLoading, setRiskAlertsLoading] = useState(true);
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalBets: 0,
    totalStake: 0,
    totalPayout: 0,
    pendingKYC: 0,
    activeBets: 0,
  });
  const [riskAlerts, setRiskAlerts] = useState<RiskAlert[]>([]);
  const [operations, setOperations] = useState<OperationsSummary | null>(null);

  useEffect(() => {
    loadDashboardStats();
    loadRiskAlerts();
    loadOperations();
  }, []);

  async function loadOperations() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const response = await fetch("/api/admin/dashboard", {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      if (response.ok) setOperations(await response.json());
    } catch (error) {
      console.error("Error loading operations dashboard:", error);
    }
  }

  async function loadDashboardStats() {
    setLoading(true);

    // Get total users
    const { count: userCount } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true });

    // Get total bets
    const { count: betCount } = await supabase
      .from("bets")
      .select("*", { count: "exact", head: true });

    // Get bet stats
    const { data: bets } = await supabase
      .from("bets")
      .select("stake, payout, status");

    const totalStake = bets?.reduce((sum, b) => sum + b.stake, 0) || 0;
    const totalPayout = bets?.reduce((sum, b) => sum + (b.payout || 0), 0) || 0;
    const activeBets = bets?.filter(b => b.status === "pending").length || 0;

    // Get pending KYC
    const { count: kycCount } = await supabase
      .from("kyc_documents")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");

    setStats({
      totalUsers: userCount || 0,
      totalBets: betCount || 0,
      totalStake,
      totalPayout,
      pendingKYC: kycCount || 0,
      activeBets,
    });

    setLoading(false);
  }

  async function loadRiskAlerts() {
    setRiskAlertsLoading(true);
    const alerts: RiskAlert[] = [];

    try {
      // Query 1: Users with high win rates (>70% with 10+ bets)
      const { data: highWinRateUsers } = await supabase
        .from("bets")
        .select(`
          user_id,
          status,
          profiles!inner(full_name)
        `)
        .in("status", ["won", "lost"]);

      if (highWinRateUsers) {
        const userStats = highWinRateUsers.reduce((acc: any, bet: any) => {
          if (!acc[bet.user_id]) {
            acc[bet.user_id] = { 
              name: bet.profiles?.full_name || "Unknown User",
              total: 0, 
              won: 0 
            };
          }
          acc[bet.user_id].total++;
          if (bet.status === "won") acc[bet.user_id].won++;
          return acc;
        }, {});

        Object.entries(userStats).forEach(([userId, stats]: [string, any]) => {
          if (stats.total >= 10) {
            const winRate = (stats.won / stats.total) * 100;
            if (winRate > 70) {
              alerts.push({
                userId,
                userName: stats.name,
                riskType: "High Win Rate",
                riskScore: Math.min(99, Math.round(winRate)),
                details: `${stats.won}/${stats.total} bets won (${winRate.toFixed(1)}%)`,
                timestamp: new Date().toISOString(),
              });
            }
          }
        });
      }

      // Query 2: Large stake bets (>$1000)
      const { data: largeBets } = await supabase
        .from("bets")
        .select(`
          user_id,
          stake,
          created_at,
          profiles!inner(full_name)
        `)
        .gte("stake", 1000)
        .order("created_at", { ascending: false })
        .limit(5);

      if (largeBets) {
        largeBets.forEach((bet: any) => {
          alerts.push({
            userId: bet.user_id,
            userName: bet.profiles?.full_name || "Unknown User",
            riskType: "Large Stake",
            riskScore: Math.min(99, Math.round((bet.stake / 100))),
            details: `$${bet.stake.toFixed(2)} stake placed`,
            timestamp: bet.created_at,
          });
        });
      }

      // Query 3: Rapid betting (>5 bets in last hour)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: recentBets } = await supabase
        .from("bets")
        .select(`
          user_id,
          created_at,
          profiles!inner(full_name)
        `)
        .gte("created_at", oneHourAgo);

      if (recentBets) {
        const rapidBetting = recentBets.reduce((acc: any, bet: any) => {
          if (!acc[bet.user_id]) {
            acc[bet.user_id] = {
              name: bet.profiles?.full_name || "Unknown User",
              count: 0,
            };
          }
          acc[bet.user_id].count++;
          return acc;
        }, {});

        Object.entries(rapidBetting).forEach(([userId, data]: [string, any]) => {
          if (data.count > 5) {
            alerts.push({
              userId,
              userName: data.name,
              riskType: "Rapid Betting",
              riskScore: Math.min(99, data.count * 10),
              details: `${data.count} bets in last hour`,
              timestamp: new Date().toISOString(),
            });
          }
        });
      }

      // Sort by risk score descending and take top 10
      alerts.sort((a, b) => b.riskScore - a.riskScore);
      setRiskAlerts(alerts.slice(0, 10));
    } catch (error) {
      console.error("Error loading risk alerts:", error);
    }

    setRiskAlertsLoading(false);
  }

  function getRiskBadgeColor(score: number) {
    if (score >= 80) return "bg-danger text-danger-foreground";
    if (score >= 60) return "bg-warning text-warning-foreground";
    return "bg-muted text-muted-foreground";
  }

  return (
    <AdminLayout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Welcome to PrimeBet Admin Portal</p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-32 rounded-lg animate-pulse bg-surface" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {/* Total Users */}
              <Card className="surface">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Users</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.totalUsers.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground mt-1">Registered accounts</p>
                </CardContent>
              </Card>

              {/* Total Bets */}
              <Card className="surface">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Bets</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.totalBets.toLocaleString()}</div>
                  <p className="text-xs text-success flex items-center gap-1 mt-1">
                    <ArrowUpRight className="h-3 w-3" />
                    {stats.activeBets} active
                  </p>
                </CardContent>
              </Card>

              {/* Total Stake */}
              <Card className="surface">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Stakes</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold font-mono">${stats.totalStake.toFixed(2)}</div>
                  <p className="text-xs text-muted-foreground mt-1">All time</p>
                </CardContent>
              </Card>

              {/* Total Payouts */}
              <Card className="surface">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Payouts</CardTitle>
                  <Wallet className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold font-mono">${stats.totalPayout.toFixed(2)}</div>
                  <p className="text-xs text-muted-foreground mt-1">Winnings paid</p>
                </CardContent>
              </Card>

              {/* Pending KYC */}
              <Card className="surface">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Pending KYC</CardTitle>
                  <FileCheck className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.pendingKYC}</div>
                  {stats.pendingKYC > 0 ? (
                    <p className="text-xs text-warning flex items-center gap-1 mt-1">
                      <ArrowUpRight className="h-3 w-3" />
                      Requires review
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">All clear</p>
                  )}
                </CardContent>
              </Card>

              {/* House Edge */}
              <Card className="surface">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">House Edge</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold font-mono">
                    ${(stats.totalStake - stats.totalPayout).toFixed(2)}
                  </div>
                  <p className="text-xs text-success flex items-center gap-1 mt-1">
                    <ArrowUpRight className="h-3 w-3" />
                    {stats.totalStake > 0 ? (((stats.totalStake - stats.totalPayout) / stats.totalStake) * 100).toFixed(1) : 0}%
                  </p>
                </CardContent>
              </Card>
            </div>

            {operations && (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold">Operations queues</h2>
                    <p className="text-xs text-muted-foreground">Items requiring staff attention</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void loadOperations()}>
                    <Activity className="mr-2 h-4 w-4" />Refresh
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-6 md:grid-cols-3 xl:grid-cols-6">
                  {[
                    { label: "Deposits", value: operations.queues.pendingDeposits, icon: Landmark, href: "/admin/payments" },
                    { label: "Withdrawals", value: operations.queues.pendingWithdrawals, icon: Wallet, href: "/admin/payments" },
                    { label: "Approvals", value: operations.queues.pendingApprovals, icon: CheckSquare, href: "/admin/payments" },
                    { label: "KYC review", value: operations.queues.pendingKyc, icon: FileCheck, href: "/admin/kyc" },
                    { label: "Support", value: operations.queues.openSupportTickets, icon: Headphones, href: "/admin/support" },
                    { label: "Risk flags", value: operations.queues.unreviewedRiskFlags, icon: ShieldAlert, href: "/admin/risk" },
                  ].map((item) => (
                    <button key={item.label} onClick={() => router.push(item.href)} className="rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50">
                      <div className="flex items-center justify-between"><item.icon className="h-4 w-4 text-muted-foreground" /><span className={item.value > 0 ? "text-warning" : "text-success"}>{item.value}</span></div>
                      <p className="mt-2 text-xs font-medium">{item.label}</p>
                    </button>
                  ))}
                </div>

                <Card className="surface mb-6">
                  <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><ServerCog className="h-5 w-5" />Live platform status</CardTitle></CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <button onClick={() => router.push("/admin/sports")} className="rounded-lg border p-3 text-left"><Radio className="mb-2 h-4 w-4 text-primary" /><div className="text-2xl font-bold">{operations.system.liveEvents}</div><div className="text-xs text-muted-foreground">Live events · {operations.system.upcomingEvents} upcoming</div></button>
                    <button onClick={() => router.push("/admin/providers")} className="rounded-lg border p-3 text-left"><Activity className="mb-2 h-4 w-4 text-primary" /><div className="text-2xl font-bold">{operations.system.enabledProviders}</div><div className="text-xs text-muted-foreground">Enabled providers · {operations.system.unhealthyProviders} unhealthy</div></button>
                    <button onClick={() => router.push("/admin/monitoring")} className="rounded-lg border p-3 text-left"><ServerCog className="mb-2 h-4 w-4 text-primary" /><div className="text-2xl font-bold">{operations.system.pendingJobs}</div><div className="text-xs text-muted-foreground">Pending jobs · {operations.system.failedJobs} failed</div></button>
                    <button onClick={() => router.push("/admin/readiness")} className="rounded-lg border p-3 text-left"><CheckSquare className="mb-2 h-4 w-4 text-primary" /><div className="text-sm font-bold">Launch readiness</div><div className="mt-2 text-xs text-muted-foreground">Check secrets, database and external services</div></button>
                  </CardContent>
                </Card>
              </>
            )}

            {/* High-Risk Betting Patterns Widget */}
            <Card className="surface mb-6">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-danger/10 flex items-center justify-center">
                    <AlertTriangle className="h-5 w-5 text-danger" />
                  </div>
                  <div>
                    <CardTitle className="text-lg font-bold">High-Risk Betting Patterns</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">Suspicious activity requiring review</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadRiskAlerts}
                  disabled={riskAlertsLoading}
                >
                  <Activity className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
              </CardHeader>
              <CardContent>
                {riskAlertsLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-16 rounded-lg animate-pulse bg-background" />
                    ))}
                  </div>
                ) : riskAlerts.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="h-12 w-12 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-3">
                      <TrendingDown className="h-6 w-6 text-success" />
                    </div>
                    <p className="text-sm font-medium">No High-Risk Activity Detected</p>
                    <p className="text-xs text-muted-foreground mt-1">All betting patterns appear normal</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {riskAlerts.map((alert, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg bg-background border border-border hover:border-primary/50 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-semibold truncate">{alert.userName}</span>
                              <Badge variant="outline" className="text-[10px] px-1.5 h-5">
                                {alert.riskType}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">{alert.details}</p>
                            <p className="text-[10px] text-muted-foreground mt-1">
                              {new Date(alert.timestamp).toLocaleString()}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-2 flex-shrink-0">
                            <Badge className={getRiskBadgeColor(alert.riskScore)}>
                              Risk: {alert.riskScore}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => router.push(`/admin/users?search=${alert.userId}`)}
                            >
                              Review
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
