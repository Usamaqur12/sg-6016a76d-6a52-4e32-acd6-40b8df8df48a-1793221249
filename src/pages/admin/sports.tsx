import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar, Plus, RefreshCw, TrendingUp, Trophy } from "lucide-react";
import { canAccessAdminArea } from "@/lib/adminRoles";
import { useToast } from "@/hooks/use-toast";
import SportsCatalogueManager from "@/components/admin/SportsCatalogueManager";

interface SportView { id: string; name: string; icon: string | null; eventCount: number; active: boolean; }
interface LeagueView { id: string; sport: string; name: string; country: string | null; eventCount: number; active: boolean; }
interface EventView { id: string; league: string; homeTeam: string; awayTeam: string; startTime: string; status: string; markets: number; }

function LegacyAdminSports() {
  const router = useRouter();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("events");
  const [sports, setSports] = useState<SportView[]>([]);
  const [leagues, setLeagues] = useState<LeagueView[]>([]);
  const [events, setEvents] = useState<EventView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { void initialize(); }, []);

  async function initialize() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { await router.push("/auth/login"); return; }
    const { data: profile } = await supabase.from("profiles").select("admin_role").eq("id", user.id).single();
    if (!profile || !canAccessAdminArea(profile.admin_role, "sports")) { await router.push("/"); return; }
    await loadSportsData();
  }

  async function loadSportsData() {
    setLoading(true);
    const [sportsResult, leaguesResult, eventsResult, marketsResult] = await Promise.all([
      supabase.from("sports").select("id, name, icon, is_active").order("display_order"),
      supabase.from("leagues").select("id, sport_id, name, country, is_active").order("display_order"),
      supabase.from("events").select("id, sport_id, league_id, home_team, away_team, start_time, status").order("start_time", { ascending: false }).limit(250),
      supabase.from("markets").select("id, event_id"),
    ]);
    const error = sportsResult.error || leaguesResult.error || eventsResult.error || marketsResult.error;
    if (error) {
      toast({ title: "Sports data load failed", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const rawSports = sportsResult.data ?? [];
    const rawLeagues = leaguesResult.data ?? [];
    const rawEvents = eventsResult.data ?? [];
    const rawMarkets = marketsResult.data ?? [];
    const sportNames = new Map(rawSports.map((sport) => [sport.id, sport.name]));
    const leagueNames = new Map(rawLeagues.map((league) => [league.id, league.name]));
    setSports(rawSports.map((sport) => ({ id: sport.id, name: sport.name, icon: sport.icon, active: sport.is_active ?? false, eventCount: rawEvents.filter((event) => event.sport_id === sport.id).length })));
    setLeagues(rawLeagues.map((league) => ({ id: league.id, sport: sportNames.get(league.sport_id) ?? "Unknown sport", name: league.name, country: league.country, active: league.is_active ?? false, eventCount: rawEvents.filter((event) => event.league_id === league.id).length })));
    setEvents(rawEvents.map((event) => ({ id: event.id, league: event.league_id ? leagueNames.get(event.league_id) ?? "Unassigned" : "Unassigned", homeTeam: event.home_team, awayTeam: event.away_team, startTime: event.start_time, status: event.status ?? "upcoming", markets: rawMarkets.filter((market) => market.event_id === event.id).length })));
    setLoading(false);
  }

  const emptyState = loading ? "Loading live database records…" : "No records found.";

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div><h1 className="text-2xl font-bold">Sports Management</h1><p className="text-sm text-muted-foreground">Verified sportsbook records from Supabase</p></div>
          <Button variant="outline" className="gap-2" onClick={() => void loadSportsData()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
        </div>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList><TabsTrigger value="events">Events</TabsTrigger><TabsTrigger value="leagues">Leagues</TabsTrigger><TabsTrigger value="sports">Sports</TabsTrigger><TabsTrigger value="odds">Odds Management</TabsTrigger></TabsList>
          <TabsContent value="events" className="mt-4">
            <Card className="surface"><CardHeader><CardTitle>Latest Events</CardTitle></CardHeader><CardContent>
              {events.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{emptyState}</p> : <div className="space-y-3">{events.map((event) => (
                <div key={event.id} className="flex items-center justify-between p-3 rounded border border-border"><div className="flex-1"><div className="flex items-center gap-2 mb-1"><Badge variant="outline" className="text-xs">{event.league}</Badge><Badge variant={event.status === "live" ? "destructive" : "secondary"} className="text-xs">{event.status}</Badge></div><div className="font-medium text-sm">{event.homeTeam} vs {event.awayTeam}</div><div className="text-xs text-muted-foreground flex flex-wrap items-center gap-3 mt-1"><span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(event.startTime).toLocaleString()}</span><span className="flex items-center gap-1"><TrendingUp className="h-3 w-3" />{event.markets} markets</span></div></div></div>
              ))}</div>}
            </CardContent></Card>
          </TabsContent>
          <TabsContent value="leagues" className="mt-4">
            <Card className="surface"><CardHeader><CardTitle>Leagues & Competitions</CardTitle></CardHeader><CardContent>
              {leagues.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{emptyState}</p> : <div className="space-y-2">{leagues.map((league) => (
                <div key={league.id} className="flex items-center justify-between p-3 rounded border border-border"><div className="flex items-center gap-3"><Trophy className="h-5 w-5 text-gold" /><div><div className="font-medium text-sm">{league.name}</div><div className="text-xs text-muted-foreground">{league.sport} • {league.country || "Global"} • {league.eventCount} events</div></div></div><Badge variant={league.active ? "outline" : "secondary"}>{league.active ? "Active" : "Inactive"}</Badge></div>
              ))}</div>}
            </CardContent></Card>
          </TabsContent>
          <TabsContent value="sports" className="mt-4">
            <Card className="surface"><CardHeader><CardTitle>Available Sports</CardTitle></CardHeader><CardContent>
              {sports.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{emptyState}</p> : <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{sports.map((sport) => (
                <div key={sport.id} className="flex items-center justify-between p-4 rounded border border-border"><div className="flex items-center gap-3"><span className="text-2xl">{sport.icon || "🏆"}</span><div><div className="font-medium">{sport.name}</div><div className="text-xs text-muted-foreground">{sport.eventCount} events</div></div></div><Badge variant={sport.active ? "outline" : "secondary"}>{sport.active ? "Active" : "Inactive"}</Badge></div>
              ))}</div>}
            </CardContent></Card>
          </TabsContent>
          <TabsContent value="odds" className="mt-4"><Card className="surface"><CardHeader><CardTitle>Odds Management</CardTitle></CardHeader><CardContent className="py-8 text-center text-muted-foreground"><p className="text-sm">Odds shown publicly now come from the database.</p><p className="text-xs mt-2">Provider ingestion and automated suspension require provider credentials before production launch.</p></CardContent></Card></TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}

export default function AdminSports() {
  return <SportsCatalogueManager />;
}
