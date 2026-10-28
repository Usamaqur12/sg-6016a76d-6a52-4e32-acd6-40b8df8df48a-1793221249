import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
} from "lucide-react";
import { canAccessAdminArea } from "@/lib/adminRoles";

export default function AdminMonitoring() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [feedHealth, setFeedHealth] = useState<any[]>([]);
  const [suspendedMarkets, setSuspendedMarkets] = useState<any[]>([]);
  const [failedSettlements, setFailedSettlements] = useState<any[]>([]);
  const [errorEvents, setErrorEvents] = useState<any[]>([]);
  const [systemStats, setSystemStats] = useState<any>(null);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    async function startMonitoring() {
      if (await checkAuth()) {
        await loadMonitoringData();
        interval = setInterval(() => void loadMonitoringData(), 30000);
      }
    }
    void startMonitoring();
    return () => { if (interval) clearInterval(interval); };
  }, []);

  async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      router.push("/admin/login");
      return false;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (!profile || !canAccessAdminArea(profile.admin_role, "monitoring")) {
      router.push("/admin/login");
      return false;
    }
    return true;
  }

  async function loadMonitoringData() {
    setLoading(true);

    try {
      // Feed health
      const { data: feedData } = await supabase
        .from("provider_health")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(5);

      setFeedHealth(feedData || []);

      // Suspended markets
      const { data: marketsData } = await supabase
        .from("markets")
        .select("id, event_id, name, status, created_at")
        .eq("status", "suspended")
        .order("created_at", { ascending: false })
        .limit(10);
      const eventIds = [...new Set((marketsData || []).map((market) => market.event_id))];
      const { data: eventData } = eventIds.length
        ? await supabase.from("events").select("id, league_id, home_team, away_team").in("id", eventIds)
        : { data: [] };
      const eventMap = new Map((eventData || []).map((event) => [event.id, event]));
      setSuspendedMarkets((marketsData || []).map((market) => ({ ...market, event: eventMap.get(market.event_id) })));

      const { data: failedJobs } = await supabase
        .from("background_jobs")
        .select("id, payload, error_message, retry_count, created_at")
        .eq("job_type", "settlement")
        .eq("status", "failed")
        .order("created_at", { ascending: false })
        .limit(10);
      setFailedSettlements(failedJobs || []);

      const { data: errors, error: errorEventsError } = await (supabase as any)
        .from("error_events")
        .select("id,severity,source,message,route,created_at,resolved_at")
        .is("resolved_at", null)
        .order("created_at", { ascending: false })
        .limit(20);

      if (errorEventsError) {
        setErrorEvents([]);
      } else {
        setErrorEvents(errors || []);
      }

      // System stats
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

      const [betsResult, eventsResult, marketsResult] = await Promise.all([
        supabase
          .from("bets")
          .select("*", { count: "exact", head: true })
          .gte("created_at", oneHourAgo),
        supabase
          .from("events")
          .select("*", { count: "exact", head: true })
          .eq("status", "live"),
        supabase
          .from("markets")
          .select("*", { count: "exact", head: true })
          .eq("status", "suspended"),
      ]);

      setSystemStats({
        betsLastHour: betsResult.count || 0,
        liveEvents: eventsResult.count || 0,
        suspendedMarkets: marketsResult.count || 0,
      });
    } catch (error) {
      console.error("Load monitoring data error:", error);
    }

    setLoading(false);
  }

  async function handleRefresh() {
    await loadMonitoringData();
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">System Monitoring</h1>
            <p className="text-muted-foreground mt-1">
              Real-time system health and performance
            </p>
          </div>
          <Button onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* System Stats */}
        {systemStats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Bets (Last Hour)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{systemStats.betsLastHour}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-muted-foreground">Open Errors</CardTitle></CardHeader>
              <CardContent><div className="text-3xl font-bold text-danger">{errorEvents.length}</div></CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Live Events
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{systemStats.liveEvents}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Suspended Markets
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-warning">
                  {systemStats.suspendedMarkets}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Monitoring Tabs */}
        <Tabs defaultValue="feed" className="space-y-4">
          <TabsList>
            <TabsTrigger value="feed">Feed Health</TabsTrigger>
            <TabsTrigger value="markets">Suspended Markets</TabsTrigger>
            <TabsTrigger value="settlements">Failed Settlements</TabsTrigger>
            <TabsTrigger value="errors">Application Errors</TabsTrigger>
          </TabsList>

          {/* Feed Health */}
          <TabsContent value="feed">
            <Card>
              <CardHeader>
                <CardTitle>Sports Feed Provider Health</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Loading...
                  </div>
                ) : feedHealth.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No feed health data
                  </div>
                ) : (
                  <div className="space-y-4">
                    {feedHealth.map((feed) => (
                      <div
                        key={feed.id}
                        className="flex items-center justify-between p-4 border border-border rounded-lg"
                      >
                        <div className="flex items-center gap-4">
                          {feed.status === "active" || feed.status === "healthy" ? (
                            <CheckCircle className="h-5 w-5 text-success" />
                          ) : feed.status === "degraded" ? (
                            <AlertTriangle className="h-5 w-5 text-warning" />
                          ) : (
                            <XCircle className="h-5 w-5 text-danger" />
                          )}
                          <div>
                            <p className="font-semibold">{feed.provider_name}</p>
                            <p className="text-sm text-muted-foreground">
                              Last check: {feed.updated_at ? new Date(feed.updated_at).toLocaleString() : "Never"}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <Badge
                            variant={
                              feed.status === "active" || feed.status === "healthy"
                                ? "default"
                                : feed.status === "degraded"
                                ? "outline"
                                : feed.status === "error"
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {feed.status}
                          </Badge>
                          {feed.avg_latency_ms ? (
                            <p className="text-sm text-muted-foreground mt-1">
                              Latency: {feed.avg_latency_ms}ms
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Suspended Markets */}
          <TabsContent value="markets">
            <Card>
              <CardHeader>
                <CardTitle>Suspended Markets</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Loading...
                  </div>
                ) : suspendedMarkets.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No suspended markets
                  </div>
                ) : (
                  <div className="space-y-3">
                    {suspendedMarkets.map((market) => (
                      <div
                        key={market.id}
                        className="flex items-center justify-between p-4 border border-border rounded-lg"
                      >
                        <div>
                          <p className="font-semibold">
                            {market.event?.home_team || "Unknown"} vs {market.event?.away_team || "Unknown"}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {market.name}
                          </p>
                        </div>
                        <div className="text-right">
                          <Badge variant="outline" className="text-warning">
                            Suspended
                          </Badge>
                          <p className="text-xs text-muted-foreground mt-1">
                            {market.created_at ? new Date(market.created_at).toLocaleString() : "Unknown"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Failed Settlements */}
          <TabsContent value="settlements">
            <Card>
              <CardHeader>
                <CardTitle>Failed Settlements</CardTitle>
              </CardHeader>
              <CardContent>
                {failedSettlements.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No failed settlements</div>
                ) : (
                  <div className="space-y-3">
                    {failedSettlements.map((job) => (
                      <div key={job.id} className="p-4 border border-border rounded-lg">
                        <div className="flex items-center justify-between gap-4">
                          <span className="font-mono text-xs">{job.id}</span>
                          <Badge variant="destructive">Failed</Badge>
                        </div>
                        <p className="text-sm text-danger mt-2">{job.error_message || "No error message recorded"}</p>
                        <p className="text-xs text-muted-foreground mt-2">Retries: {job.retry_count || 0} · {job.created_at ? new Date(job.created_at).toLocaleString() : "Unknown"}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="errors">
            <Card>
              <CardHeader><CardTitle>Application Error Events</CardTitle></CardHeader>
              <CardContent>
                {errorEvents.length === 0 ? <div className="py-8 text-center text-muted-foreground">No unresolved application errors</div> : (
                  <div className="space-y-3">
                    {errorEvents.map((event) => (
                      <div key={event.id} className="rounded-lg border border-border p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2"><Badge variant={event.severity === "fatal" ? "destructive" : "outline"}>{event.severity}</Badge><Badge variant="secondary">{event.source}</Badge></div>
                          <span className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</span>
                        </div>
                        <p className="mt-3 break-words text-sm font-medium">{event.message}</p>
                        {event.route && <p className="mt-1 font-mono text-xs text-muted-foreground">{event.route}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
