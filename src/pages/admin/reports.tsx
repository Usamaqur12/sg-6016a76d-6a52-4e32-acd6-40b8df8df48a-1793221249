import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  BarChart3, TrendingUp, DollarSign, Users, 
  Receipt, Download, Calendar, FileText 
} from "lucide-react";
import { canAccessAdminArea } from "@/lib/adminRoles";

export default function Reports() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [allBets, setAllBets] = useState<any[]>([]);
  const [allProfiles, setAllProfiles] = useState<any[]>([]);
  const [reportType, setReportType] = useState("bets");
  const [dateFrom, setDateFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [financialStats, setFinancialStats] = useState({
    totalStakes: 0,
    totalPayouts: 0,
    netRevenue: 0,
    avgBetSize: 0,
  });
  const [userStats, setUserStats] = useState({
    totalUsers: 0,
    activeUsers: 0,
    newUsers: 0,
    verifiedUsers: 0,
  });
  const [bettingStats, setBettingStats] = useState({
    totalBets: 0,
    pendingBets: 0,
    settledBets: 0,
    winRate: 0,
  });

  useEffect(() => {
    checkAdmin();
  }, []);

  async function checkAdmin() {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      router.push("/auth/login");
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (!profile || !canAccessAdminArea(profile.admin_role, "reports")) {
      router.push("/");
      return;
    }

    setUser(user);
    loadReports();
  }

  async function loadReports() {
    setLoading(true);

    // Financial stats
    const { data: bets } = await supabase
      .from("bets")
      .select("*");

    if (bets) {
      setAllBets(bets);
      const totalStakes = bets.reduce((sum, bet) => sum + Number(bet.stake ?? 0), 0);
      const totalPayouts = bets
        .filter((bet) => bet.status === "won")
        .reduce((sum, bet) => sum + Number(bet.payout ?? 0), 0);
      const netRevenue = totalStakes - totalPayouts;
      const avgBetSize = bets.length > 0 ? totalStakes / bets.length : 0;

      setFinancialStats({ totalStakes, totalPayouts, netRevenue, avgBetSize });

      const totalBets = bets.length;
      const pendingBets = bets.filter((bet) => bet.status === "pending").length;
      const settledBets = bets.filter((bet) => bet.status !== "pending").length;
      const wonBets = bets.filter((bet) => bet.status === "won").length;
      const winRate = settledBets > 0 ? (wonBets / settledBets) * 100 : 0;

      setBettingStats({ totalBets, pendingBets, settledBets, winRate });
    }

    // User stats
    const { data: profiles } = await supabase
      .from("profiles")
      .select("*");

    if (profiles) {
      setAllProfiles(profiles);
      const totalUsers = profiles.length;
      const verifiedUsers = profiles.filter(p => p.kyc_status === "approved").length;
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const newUsers = profiles.filter(
        p => new Date(p.created_at) > thirtyDaysAgo
      ).length;

      setUserStats({
        totalUsers,
        activeUsers: totalUsers,
        newUsers,
        verifiedUsers,
      });
    }

    setLoading(false);
  }

  const dateFilteredBets = useMemo(() => filterByDate(allBets, dateFrom, dateTo), [allBets, dateFrom, dateTo]);
  const dateFilteredProfiles = useMemo(() => filterByDate(allProfiles, dateFrom, dateTo), [allProfiles, dateFrom, dateTo]);
  const customRows = reportType === "users" ? dateFilteredProfiles : dateFilteredBets;

  const downloadReport = (type: string) => {
    if (!type.includes("CSV")) {
      window.print();
      return;
    }
    if (type.startsWith("Users")) {
      downloadCsv("users-report.csv", ["id", "email", "full_name", "kyc_status", "is_suspended", "created_at"], allProfiles);
    } else if (type.startsWith("Betting")) {
      downloadCsv("betting-report.csv", ["id", "user_id", "type", "stake", "total_odds", "potential_return", "status", "payout", "created_at"], allBets);
    } else if (type.startsWith("Financial")) {
      downloadCsv("financial-report.csv", ["id", "user_id", "stake", "payout", "status", "created_at"], allBets);
    } else {
      downloadCsv("platform-report.csv", ["metric", "value"], [
        { metric: "total_stakes", value: financialStats.totalStakes },
        { metric: "total_payouts", value: financialStats.totalPayouts },
        { metric: "net_revenue", value: financialStats.netRevenue },
        { metric: "total_bets", value: bettingStats.totalBets },
        { metric: "total_users", value: userStats.totalUsers },
      ]);
    }
  };

  const downloadCustomReport = () => {
    if (reportType === "users") {
      downloadCsv(`users-${dateFrom}-to-${dateTo}.csv`, ["id", "email", "full_name", "country", "kyc_status", "is_suspended", "created_at"], customRows);
    } else if (reportType === "financial") {
      downloadCsv(`financial-${dateFrom}-to-${dateTo}.csv`, ["id", "user_id", "stake", "payout", "status", "created_at"], customRows);
    } else {
      downloadCsv(`bets-${dateFrom}-to-${dateTo}.csv`, ["id", "user_id", "type", "stake", "total_odds", "potential_return", "status", "payout", "created_at"], customRows);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold mb-1 flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-primary" />
              Reports & Analytics
            </h1>
            <p className="text-sm text-muted-foreground">
              View platform performance and export reports
            </p>
          </div>
          <Button className="gap-2" onClick={() => downloadReport("All CSV")}>
            <Download className="h-4 w-4" />
            Export All
          </Button>
        </div>

        {/* Overview Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="surface">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <DollarSign className="h-5 w-5 text-success" />
                <Badge className="bg-success/10 text-success border-success/30">Revenue</Badge>
              </div>
              <div className="text-2xl font-bold font-mono">${financialStats.netRevenue.toFixed(0)}</div>
              <div className="text-xs text-muted-foreground mt-1">Net Revenue</div>
            </CardContent>
          </Card>

          <Card className="surface">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <Users className="h-5 w-5 text-primary" />
                <Badge className="badge-popular">Users</Badge>
              </div>
              <div className="text-2xl font-bold">{userStats.totalUsers}</div>
              <div className="text-xs text-muted-foreground mt-1">Total Users</div>
            </CardContent>
          </Card>

          <Card className="surface">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <Receipt className="h-5 w-5 text-warning" />
                <Badge className="badge-featured">Bets</Badge>
              </div>
              <div className="text-2xl font-bold">{bettingStats.totalBets}</div>
              <div className="text-xs text-muted-foreground mt-1">Total Bets</div>
            </CardContent>
          </Card>

          <Card className="surface">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <TrendingUp className="h-5 w-5 text-success" />
                <Badge variant="outline">Win Rate</Badge>
              </div>
              <div className="text-2xl font-bold">{bettingStats.winRate.toFixed(1)}%</div>
              <div className="text-xs text-muted-foreground mt-1">User Wins</div>
            </CardContent>
          </Card>
        </div>

        {/* Report Tabs */}
        <Tabs defaultValue="financial">
          <TabsList className="bg-surface">
            <TabsTrigger value="financial">Financial</TabsTrigger>
            <TabsTrigger value="betting">Betting Activity</TabsTrigger>
            <TabsTrigger value="users">User Analytics</TabsTrigger>
            <TabsTrigger value="custom">Custom Reports</TabsTrigger>
          </TabsList>

          <TabsContent value="financial">
            <div className="grid gap-4">
              <Card className="surface">
                <CardHeader>
                  <CardTitle className="text-lg">Financial Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-sm text-muted-foreground mb-1">Total Stakes</div>
                      <div className="text-xl font-bold font-mono">${financialStats.totalStakes.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground mb-1">Total Payouts</div>
                      <div className="text-xl font-bold font-mono text-danger">${financialStats.totalPayouts.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground mb-1">Net Revenue</div>
                      <div className="text-xl font-bold font-mono text-success">${financialStats.netRevenue.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground mb-1">Avg Bet Size</div>
                      <div className="text-xl font-bold font-mono">${financialStats.avgBetSize.toFixed(2)}</div>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-6">
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadReport("Financial")}>
                      <Download className="h-4 w-4" />
                      Download PDF
                    </Button>
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadReport("Financial CSV")}>
                      <FileText className="h-4 w-4" />
                      Export CSV
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="betting">
            <Card className="surface">
              <CardHeader>
                <CardTitle className="text-lg">Betting Activity Report</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Total Bets</div>
                    <div className="text-xl font-bold">{bettingStats.totalBets}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Pending</div>
                    <div className="text-xl font-bold text-warning">{bettingStats.pendingBets}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Settled</div>
                    <div className="text-xl font-bold">{bettingStats.settledBets}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Win Rate</div>
                    <div className="text-xl font-bold text-success">{bettingStats.winRate.toFixed(1)}%</div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadReport("Betting")}>
                    <Download className="h-4 w-4" />
                    Download PDF
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadReport("Betting CSV")}>
                    <FileText className="h-4 w-4" />
                    Export CSV
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="users">
            <Card className="surface">
              <CardHeader>
                <CardTitle className="text-lg">User Analytics Report</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Total Users</div>
                    <div className="text-xl font-bold">{userStats.totalUsers}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Active Users</div>
                    <div className="text-xl font-bold text-success">{userStats.activeUsers}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">New (30d)</div>
                    <div className="text-xl font-bold text-primary">{userStats.newUsers}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Verified</div>
                    <div className="text-xl font-bold text-success">{userStats.verifiedUsers}</div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadReport("Users")}>
                    <Download className="h-4 w-4" />
                    Download PDF
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadReport("Users CSV")}>
                    <FileText className="h-4 w-4" />
                    Export CSV
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="custom">
            <Card className="surface">
              <CardHeader>
                <CardTitle className="text-lg">Custom Report Builder</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-5">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="grid gap-2"><Label>Report</Label><Select value={reportType} onValueChange={setReportType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bets">Betting activity</SelectItem><SelectItem value="financial">Financial bets</SelectItem><SelectItem value="users">New users</SelectItem></SelectContent></Select></div>
                    <div className="grid gap-2"><Label htmlFor="report-from">From</Label><Input id="report-from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></div>
                    <div className="grid gap-2"><Label htmlFor="report-to">To</Label><Input id="report-to" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></div>
                  </div>
                  <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3"><Calendar className="h-8 w-8 text-primary" /><div><div className="font-medium">{customRows.length} matching records</div><div className="text-xs text-muted-foreground">{dateFrom} through {dateTo}, inclusive</div></div></div>
                    <Button className="gap-2" onClick={downloadCustomReport} disabled={loading || !customRows.length}><Download className="h-4 w-4" />Generate CSV</Button>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm"><thead className="bg-muted/50"><tr><th className="p-3 text-left">ID</th><th className="p-3 text-left">Type / Email</th><th className="p-3 text-left">Status</th><th className="p-3 text-right">Amount</th><th className="p-3 text-left">Created</th></tr></thead><tbody>{customRows.slice(0, 10).map((row) => <tr key={row.id} className="border-t border-border"><td className="max-w-40 truncate p-3 font-mono text-xs">{row.id}</td><td className="p-3">{reportType === "users" ? row.email : row.type}</td><td className="p-3">{reportType === "users" ? row.kyc_status : row.status}</td><td className="p-3 text-right font-mono">{reportType === "users" ? "—" : `$${Number(row.stake || 0).toFixed(2)}`}</td><td className="p-3 text-xs">{row.created_at ? new Date(row.created_at).toLocaleString() : "—"}</td></tr>)}</tbody></table>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}

function filterByDate(rows: any[], from: string, to: string) {
  const start = new Date(`${from}T00:00:00`).getTime();
  const end = new Date(`${to}T23:59:59.999`).getTime();
  return rows.filter((row) => {
    const created = new Date(row.created_at).getTime();
    return Number.isFinite(created) && created >= start && created <= end;
  });
}

function downloadCsv(filename: string, columns: string[], rows: any[]) {
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [columns.map(escape).join(","), ...rows.map((row) => columns.map((column) => escape(row[column])).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
