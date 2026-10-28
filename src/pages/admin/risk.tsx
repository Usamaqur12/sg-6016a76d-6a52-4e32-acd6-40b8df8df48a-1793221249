import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, TrendingUp, DollarSign, Users, Clock, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/router";

interface RiskAlert {
  id: string;
  user_id: string;
  user_email: string;
  type: "high_stake" | "suspicious_pattern" | "rapid_betting" | "unusual_odds";
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  bet_id: string | null;
  amount: number | null;
  created_at: string;
  reviewed: boolean;
}

export default function AdminRisk() {
  const { toast } = useToast();
  const router = useRouter();
  const [alerts, setAlerts] = useState<RiskAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unreviewed">("unreviewed");

  useEffect(() => {
    void loadAlerts();
  }, [filter]);

  async function loadAlerts() {
    try {
      // Get high-risk bets
      const { data: bets } = await supabase
        .from("bets")
        .select("id, user_id, stake, total_odds, created_at")
        .gte("stake", 500) // High stake threshold
        .order("created_at", { ascending: false })
        .limit(50);

      if (bets) {
        // Get user emails
        const userIds = [...new Set(bets.map(b => b.user_id))];
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, email")
          .in("id", userIds);

        const emailMap = new Map(profiles?.map(p => [p.id, p.email]) || []);

        // Create risk alerts from high-stake bets
        const riskAlerts: RiskAlert[] = bets.map(bet => {
          const stake = Number(bet.stake);
          const odds = Number(bet.total_odds);
          
          let severity: "low" | "medium" | "high" | "critical" = "low";
          let type: RiskAlert["type"] = "high_stake";
          let description = "";

          if (stake >= 5000) {
            severity = "critical";
            description = `Extremely high stake: $${stake.toFixed(2)}`;
          } else if (stake >= 2000) {
            severity = "high";
            description = `Very high stake: $${stake.toFixed(2)}`;
          } else if (stake >= 1000) {
            severity = "medium";
            description = `High stake: $${stake.toFixed(2)}`;
          } else {
            severity = "low";
            description = `Elevated stake: $${stake.toFixed(2)}`;
          }

          if (odds >= 50) {
            severity = severity === "critical" ? "critical" : "high";
            type = "unusual_odds";
            description += ` with very high odds (${odds.toFixed(2)})`;
          } else if (odds >= 20) {
            description += ` with high odds (${odds.toFixed(2)})`;
          }

          return {
            id: `${bet.id}-risk`,
            user_id: bet.user_id,
            user_email: emailMap.get(bet.user_id) || "Unknown",
            type,
            severity,
            description,
            bet_id: bet.id,
            amount: stake,
            created_at: bet.created_at,
            reviewed: false,
          };
        });

        setAlerts(riskAlerts);
      }
    } catch (error: any) {
      toast({
        title: "Error loading risk alerts",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical":
        return "bg-red-500/10 text-red-500 border-red-500/30";
      case "high":
        return "bg-orange-500/10 text-orange-500 border-orange-500/30";
      case "medium":
        return "bg-yellow-500/10 text-yellow-500 border-yellow-500/30";
      default:
        return "bg-blue-500/10 text-blue-500 border-blue-500/30";
    }
  };

  const getSeverityIcon = (severity: string) => {
    return <AlertTriangle className="h-4 w-4" />;
  };

  const filtered = filter === "unreviewed" 
    ? alerts.filter(a => !a.reviewed)
    : alerts;

  const criticalAlerts = alerts.filter(a => a.severity === "critical");
  const highAlerts = alerts.filter(a => a.severity === "high");
  const unreviewedCount = alerts.filter(a => !a.reviewed).length;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Risk Management</h1>
          <p className="text-sm text-muted-foreground">Monitor high-risk betting activity and suspicious patterns</p>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="surface border-danger/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-danger/10 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-danger" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{criticalAlerts.length}</div>
                  <div className="text-xs text-muted-foreground">Critical</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="surface border-warning/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{highAlerts.length}</div>
                  <div className="text-xs text-muted-foreground">High Risk</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="surface">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{unreviewedCount}</div>
                  <div className="text-xs text-muted-foreground">Unreviewed</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="surface">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
                  <Shield className="h-5 w-5 text-success" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{alerts.length}</div>
                  <div className="text-xs text-muted-foreground">Total Alerts</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filter Buttons */}
        <div className="flex gap-2">
          <Button
            variant={filter === "unreviewed" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("unreviewed")}
          >
            Unreviewed ({unreviewedCount})
          </Button>
          <Button
            variant={filter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("all")}
          >
            All Alerts ({alerts.length})
          </Button>
        </div>

        {/* Alerts List */}
        <Card className="surface">
          <CardHeader>
            <CardTitle>Risk Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-8">
                <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="font-medium">No risk alerts</p>
                <p className="text-sm text-muted-foreground mt-1">All betting activity is within normal parameters</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map((alert) => (
                  <div
                    key={alert.id}
                    className={`flex flex-col md:flex-row md:items-center justify-between p-4 rounded-lg border ${
                      alert.severity === "critical" ? "border-danger/30 bg-danger/5" :
                      alert.severity === "high" ? "border-warning/30 bg-warning/5" :
                      "border-border"
                    } gap-4`}
                  >
                    <div className="flex items-start gap-4 flex-1">
                      <div className={`w-10 h-10 rounded-full ${
                        alert.severity === "critical" ? "bg-danger/10" :
                        alert.severity === "high" ? "bg-warning/10" :
                        "bg-primary/10"
                      } flex items-center justify-center flex-shrink-0`}>
                        {getSeverityIcon(alert.severity)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={getSeverityColor(alert.severity)}>
                            {alert.severity.toUpperCase()}
                          </Badge>
                          <Badge variant="outline" className="capitalize">
                            {alert.type.replace("_", " ")}
                          </Badge>
                        </div>
                        <div className="text-sm font-medium mb-1">{alert.description}</div>
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          <div>User: {alert.user_email}</div>
                          <div>Time: {new Date(alert.created_at).toLocaleString()}</div>
                          {alert.bet_id && <div>Bet ID: {alert.bet_id}</div>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {alert.amount && (
                        <div className="text-right">
                          <div className="text-lg font-bold font-mono">${alert.amount.toFixed(2)}</div>
                          <div className="text-xs text-muted-foreground">Stake</div>
                        </div>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => router.push(alert.bet_id ? `/admin/bets?search=${alert.bet_id}` : `/admin/users?search=${alert.user_id}`)}
                      >
                        Investigate
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
