import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Activity, BarChart3, CheckCircle2, Clock3, Radio, RefreshCw } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getSportsbookStatistics, type SportsbookStatistics } from "@/services/discoveryService";

const summaryCards = [
  { key: "totalEvents", label: "All events", icon: Activity },
  { key: "liveEvents", label: "Live now", icon: Radio },
  { key: "upcomingEvents", label: "Upcoming", icon: Clock3 },
  { key: "finishedEvents", label: "Completed", icon: CheckCircle2 },
] as const;

export default function StatisticsPage() {
  const router = useRouter();
  const [statistics, setStatistics] = useState<SportsbookStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStatistics = useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await getSportsbookStatistics();
    setStatistics(response.statistics);
    setError(response.error || null);
    setLoading(false);
  }, []);

  useEffect(() => { void loadStatistics(); }, [loadStatistics]);
  const maximum = Math.max(1, ...(statistics?.sports.map((sport) => sport.total) || [1]));

  return (
    <div className="min-h-screen flex flex-col bg-background pb-14 lg:pb-0">
      <Header user={null} onAuthClick={() => void router.push("/auth/login")} />

      <main className="flex-1 container py-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3"><BarChart3 className="h-6 w-6 text-primary" /><div><h1 className="text-2xl font-bold">Sportsbook Statistics</h1><p className="text-xs text-muted-foreground">Current database coverage, not simulated figures</p></div></div>
            <Button variant="outline" size="sm" onClick={() => void loadStatistics()} disabled={loading}><RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
          </div>

          {error ? (
            <Card className="surface border-danger/30"><CardContent className="py-12 text-center text-sm text-danger">Statistics unavailable: {error}</CardContent></Card>
          ) : loading || !statistics ? (
            <Card className="surface"><CardContent className="py-12 text-center text-sm text-muted-foreground">Calculating verified sportsbook statistics…</CardContent></Card>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {summaryCards.map(({ key, label, icon: Icon }) => (
                  <Card key={key} className="surface"><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-black mt-1">{statistics[key]}</p></div><div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center"><Icon className="h-4 w-4 text-primary" /></div></div></CardContent></Card>
                ))}
              </div>

              <Card className="surface">
                <CardHeader><CardTitle className="flex items-center justify-between gap-3"><span>Coverage by sport</span><span className="text-xs font-normal text-muted-foreground">{statistics.settledMarkets} settled markets</span></CardTitle></CardHeader>
                <CardContent>
                  {statistics.sports.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No event data available.</p> : (
                    <div className="space-y-5">
                      {statistics.sports.map((sport) => (
                        <div key={sport.slug}>
                          <div className="flex items-center justify-between gap-3 mb-2"><div><p className="text-sm font-semibold">{sport.name}</p><p className="text-[11px] text-muted-foreground">{sport.live} live • {sport.finished} completed</p></div><span className="font-mono text-sm font-bold">{sport.total}</span></div>
                          <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-primary to-primary-bright transition-all" style={{ width: `${Math.max(3, (sport.total / maximum) * 100)}%` }} /></div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </main>

      <Footer />
      <MobileBottomNav />
    </div>
  );
}
