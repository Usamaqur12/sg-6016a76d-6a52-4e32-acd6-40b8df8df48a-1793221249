import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar, CircleDollarSign, Pencil, Plus, RefreshCw, Trash2, Trophy, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { canAccessAdminArea } from "@/lib/adminRoles";
import { useToast } from "@/hooks/use-toast";

interface SportRecord { id: string; name: string; icon: string | null; is_active: boolean | null; }
interface LeagueRecord { id: string; sport_id: string; name: string; country: string | null; is_active: boolean | null; }
interface EventRecord { id: string; sport_id: string; league_id: string | null; home_team: string; away_team: string; start_time: string; status: string | null; }
interface MarketRecord { id: string; event_id: string; name: string; type: string; line: number | null; status: string | null; }
interface OddsRecord { id: string; market_id: string; selection: string; value: number; is_active: boolean | null; }

const marketTypes = [
  ["match_result", "Match Result (1X2)"],
  ["over_under", "Over / Under"],
  ["handicap", "Handicap"],
  ["both_teams_score", "Both Teams To Score"],
  ["correct_score", "Correct Score"],
  ["double_chance", "Double Chance"],
  ["draw_no_bet", "Draw No Bet"],
  ["first_half", "First Half"],
  ["total_goals", "Total Goals"],
] as const;

function defaultStartTime() {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function SportsCatalogueManager() {
  const router = useRouter();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("sports");
  const [sports, setSports] = useState<SportRecord[]>([]);
  const [leagues, setLeagues] = useState<LeagueRecord[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [markets, setMarkets] = useState<MarketRecord[]>([]);
  const [odds, setOdds] = useState<OddsRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [sportName, setSportName] = useState("");
  const [sportIcon, setSportIcon] = useState("🏆");
  const [leagueSportId, setLeagueSportId] = useState("");
  const [leagueName, setLeagueName] = useState("");
  const [leagueCountry, setLeagueCountry] = useState("");
  const [eventSportId, setEventSportId] = useState("");
  const [eventLeagueId, setEventLeagueId] = useState("");
  const [homeTeam, setHomeTeam] = useState("");
  const [awayTeam, setAwayTeam] = useState("");
  const [startTime, setStartTime] = useState(defaultStartTime);
  const [marketEventId, setMarketEventId] = useState("");
  const [marketName, setMarketName] = useState("Match Result");
  const [marketType, setMarketType] = useState("match_result");
  const [marketLine, setMarketLine] = useState("");
  const [oddsMarketId, setOddsMarketId] = useState("");
  const [oddsSelection, setOddsSelection] = useState("");
  const [oddsValue, setOddsValue] = useState("1.90");
  const [bulkCsv, setBulkCsv] = useState("sport,league,country,home_team,away_team,start_time,market,home_odds,draw_odds,away_odds\nFootball,Premier League,England,Arsenal,Chelsea,2026-11-01T18:00,Match Result,2.10,3.30,3.15");

  useEffect(() => { void initialize(); }, []);

  const sportNames = useMemo(() => new Map(sports.map((sport) => [sport.id, sport.name])), [sports]);
  const leagueNames = useMemo(() => new Map(leagues.map((league) => [league.id, league.name])), [leagues]);
  const eventNames = useMemo(() => new Map(events.map((event) => [event.id, `${event.home_team} vs ${event.away_team}`])), [events]);
  const marketNames = useMemo(() => new Map(markets.map((market) => [market.id, `${eventNames.get(market.event_id) || "Event"} · ${market.name}`])), [markets, eventNames]);
  const filteredLeagues = useMemo(() => leagues.filter((league) => league.sport_id === eventSportId), [leagues, eventSportId]);

  async function initialize() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { await router.push("/admin/login"); return; }
    const { data: profile } = await supabase.from("profiles").select("admin_role").eq("id", user.id).single();
    if (!profile || !canAccessAdminArea(profile.admin_role, "sports")) { await router.push("/"); return; }
    await loadData();
  }

  async function adminFetch(url: string, init?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Admin session expired");
    const response = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}`, ...(init?.headers || {}) },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Sports catalogue request failed");
    return body;
  }

  async function loadData() {
    setLoading(true);
    const [sportResult, leagueResult, eventResult, marketResult, oddsResult] = await Promise.all([
      supabase.from("sports").select("id, name, icon, is_active").order("display_order"),
      supabase.from("leagues").select("id, sport_id, name, country, is_active").order("display_order"),
      supabase.from("events").select("id, sport_id, league_id, home_team, away_team, start_time, status").order("start_time", { ascending: false }).limit(250),
      supabase.from("markets").select("id, event_id, name, type, line, status").order("created_at", { ascending: false }),
      supabase.from("odds").select("id, market_id, selection, value, is_active").order("created_at", { ascending: false }),
    ]);
    const error = sportResult.error || leagueResult.error || eventResult.error || marketResult.error || oddsResult.error;
    if (error) toast({ title: "Sports data load failed", description: error.message, variant: "destructive" });
    setSports((sportResult.data || []) as SportRecord[]);
    setLeagues((leagueResult.data || []) as LeagueRecord[]);
    setEvents((eventResult.data || []) as EventRecord[]);
    setMarkets((marketResult.data || []) as MarketRecord[]);
    setOdds((oddsResult.data || []) as OddsRecord[]);
    setLoading(false);
  }

  async function completeCreate(label: string, error: unknown, nextTab?: string) {
    setSaving(false);
    if (error) {
      toast({ title: `${label} could not be added`, description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
      return;
    }
    toast({ title: `${label} added`, description: "Saved in the sportsbook catalogue." });
    await loadData();
    if (nextTab) setActiveTab(nextTab);
  }

  async function createSport() {
    const name = sportName.trim();
    if (!name) { toast({ title: "Sport name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await adminFetch("/api/admin/sports-catalogue", { method: "POST", body: JSON.stringify({ resource: "sports", values: { name, icon: sportIcon.trim() || "🏆" } }) });
      setSportName(""); setSportIcon("🏆");
      await completeCreate("Sport", null, "leagues");
    } catch (error) { await completeCreate("Sport", error); }
  }

  async function createLeague() {
    const name = leagueName.trim();
    if (!leagueSportId || !name) { toast({ title: "Select a sport and enter the league name", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await adminFetch("/api/admin/sports-catalogue", { method: "POST", body: JSON.stringify({ resource: "leagues", values: { sport_id: leagueSportId, name, country: leagueCountry.trim() || null } }) });
      setLeagueName(""); setLeagueCountry("");
      await completeCreate("League", null, "events");
    } catch (error) { await completeCreate("League", error); }
  }

  async function createEvent() {
    if (!eventSportId || !eventLeagueId || !homeTeam.trim() || !awayTeam.trim() || !startTime) {
      toast({ title: "Complete all event fields", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await adminFetch("/api/admin/sports-catalogue", { method: "POST", body: JSON.stringify({ resource: "events", values: { sport_id: eventSportId, league_id: eventLeagueId, home_team: homeTeam.trim(), away_team: awayTeam.trim(), start_time: new Date(startTime).toISOString() } }) });
      setHomeTeam(""); setAwayTeam(""); setStartTime(defaultStartTime());
      await completeCreate("Event", null, "markets");
    } catch (error) { await completeCreate("Event", error); }
  }

  async function createMarket() {
    if (!marketEventId || !marketName.trim()) { toast({ title: "Select an event and enter the market name", variant: "destructive" }); return; }
    const line = marketLine.trim() ? Number(marketLine) : null;
    if (line !== null && !Number.isFinite(line)) { toast({ title: "Enter a valid market line", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await adminFetch("/api/admin/sports-catalogue", { method: "POST", body: JSON.stringify({ resource: "markets", values: { event_id: marketEventId, name: marketName.trim(), type: marketType, line } }) });
      setMarketName("Match Result"); setMarketType("match_result"); setMarketLine("");
      await completeCreate("Market", null);
    } catch (error) { await completeCreate("Market", error); }
  }

  async function createOdds() {
    const value = Number(oddsValue);
    if (!oddsMarketId || !oddsSelection.trim() || !Number.isFinite(value) || value < 1.01) {
      toast({ title: "Select a market and enter a valid selection and odds", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await adminFetch("/api/admin/sports-catalogue", { method: "POST", body: JSON.stringify({ resource: "odds", values: { market_id: oddsMarketId, selection: oddsSelection.trim(), value } }) });
      setOddsSelection(""); setOddsValue("1.90");
      await completeCreate("Odds", null);
    } catch (error) { await completeCreate("Odds", error); }
  }

  async function updateRecord(table: string, id: string, changes: Record<string, unknown>, label: string) {
    setSaving(true);
    try {
      await adminFetch("/api/admin/sports-catalogue", { method: "PATCH", body: JSON.stringify({ resource: table, id, changes }) });
      toast({ title: `${label} updated` });
      await loadData();
    } catch (error) {
      toast({ title: `${label} could not be updated`, description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecord(table: string, id: string, label: string) {
    if (!window.confirm(`Delete this ${label.toLowerCase()}? Related child records may also be deleted.`)) return;
    setSaving(true);
    try {
      await adminFetch(`/api/admin/sports-catalogue?resource=${encodeURIComponent(table)}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      toast({ title: `${label} deleted` });
      await loadData();
    } catch (error) {
      toast({ title: `${label} could not be deleted`, description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function renameRecord(table: string, id: string, currentName: string, label: string) {
    const name = window.prompt(`Enter the new ${label.toLowerCase()} name`, currentName)?.trim();
    if (!name || name === currentName) return;
    await updateRecord(table, id, { name }, label);
  }

  async function editEvent(event: EventRecord) {
    const home = window.prompt("Home team", event.home_team)?.trim();
    if (!home) return;
    const away = window.prompt("Away team", event.away_team)?.trim();
    if (!away) return;
    await updateRecord("events", event.id, { home_team: home, away_team: away }, "Event");
  }

  async function editOdds(item: OddsRecord) {
    const selection = window.prompt("Selection name", item.selection)?.trim();
    if (!selection) return;
    const rawValue = window.prompt("Decimal odds", String(item.value));
    const value = Number(rawValue);
    if (!rawValue || !Number.isFinite(value) || value < 1.01) {
      toast({ title: "Enter decimal odds of 1.01 or higher", variant: "destructive" });
      return;
    }
    await updateRecord("odds", item.id, { selection, value }, "Odds");
  }

  async function importEventsCsv() {
    const rows = bulkCsv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (rows[0]?.toLowerCase().startsWith("sport,")) rows.shift();
    if (!rows.length) {
      toast({ title: "Paste at least one CSV data row", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const parsedRows = rows.map((row, index) => {
        const columns = row.split(",").map((value) => value.trim());
        if (columns.length !== 10) throw new Error(`Row ${index + 1} must contain exactly 10 comma-separated values`);
        const [sportNameValue, leagueNameValue, country, home, away, start, market, homePrice, drawPrice, awayPrice] = columns;
        const startDate = new Date(start);
        const prices: [number, number, number] = [Number(homePrice), Number(drawPrice), Number(awayPrice)];
        if (!sportNameValue || !leagueNameValue || !home || !away || !market || Number.isNaN(startDate.getTime()) || prices.some((price) => !Number.isFinite(price) || price < 1.01)) {
          throw new Error(`Row ${index + 1} contains invalid data`);
        }
        return { sport: sportNameValue, league: leagueNameValue, country: country || null, home, away, start: startDate.toISOString(), market, prices };
      });
      const body = await adminFetch("/api/admin/sports-catalogue", { method: "POST", body: JSON.stringify({ resource: "bulk_import", rows: parsedRows }) });
      const imported = Number(body.imported || 0);
      toast({ title: `${imported} event${imported === 1 ? "" : "s"} imported`, description: "Sports, leagues, markets and odds are now available." });
      await loadData();
    } catch (error) {
      toast({ title: "Bulk import stopped", description: error instanceof Error ? error.message : "Invalid CSV data", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function chooseEventSport(value: string) {
    setEventSportId(value);
    setEventLeagueId(leagues.find((league) => league.sport_id === value)?.id || "");
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h1 className="text-2xl font-bold">Sports & Betting Setup</h1><p className="text-sm text-muted-foreground">Create everything a player needs before placing a bet</p></div>
          <Button variant="outline" className="gap-2" onClick={() => void loadData()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
        </div>

        <Card className="border-primary/30 bg-primary/5"><CardContent className="py-4 text-sm"><span className="font-semibold">Required order:</span> 1. Sport → 2. League → 3. Event → 4. Market → 5. Odds. When all five exist and are active, the event becomes bettable on the customer site.</CardContent></Card>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-auto flex-wrap"><TabsTrigger value="sports">1. Sports</TabsTrigger><TabsTrigger value="leagues">2. Leagues</TabsTrigger><TabsTrigger value="events">3. Events</TabsTrigger><TabsTrigger value="markets">4–5. Markets & Odds</TabsTrigger></TabsList>

          <TabsContent value="sports" className="mt-4 grid gap-4 xl:grid-cols-[420px_1fr]">
            <Card><CardHeader><CardTitle>Add Sport</CardTitle><CardDescription>Example: Football, Cricket or Tennis.</CardDescription></CardHeader><CardContent className="grid gap-4"><div className="grid gap-2"><Label htmlFor="sport-name">Sport name</Label><Input id="sport-name" placeholder="Football" value={sportName} onChange={(event) => setSportName(event.target.value)} /></div><div className="grid gap-2"><Label htmlFor="sport-icon">Icon / emoji</Label><Input id="sport-icon" value={sportIcon} onChange={(event) => setSportIcon(event.target.value)} /></div><Button onClick={() => void createSport()} disabled={saving}><Plus className="mr-2 h-4 w-4" />{saving ? "Adding…" : "Add Sport"}</Button></CardContent></Card>
            <Card><CardHeader><CardTitle>Available Sports</CardTitle></CardHeader><CardContent>{sports.length === 0 ? <Empty loading={loading} /> : <div className="grid gap-3 md:grid-cols-2">{sports.map((sport) => <div key={sport.id} className="flex items-center justify-between gap-2 rounded border border-border p-4"><div className="flex min-w-0 items-center gap-3"><span className="text-2xl">{sport.icon || "🏆"}</span><div className="min-w-0"><div className="truncate font-medium">{sport.name}</div><button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => void updateRecord("sports", sport.id, { is_active: !sport.is_active }, "Sport")}>{sport.is_active ? "Active" : "Inactive"}</button></div></div><RecordActions onEdit={() => void renameRecord("sports", sport.id, sport.name, "Sport")} onDelete={() => void deleteRecord("sports", sport.id, "Sport")} /></div>)}</div>}</CardContent></Card>
          </TabsContent>

          <TabsContent value="leagues" className="mt-4 grid gap-4 xl:grid-cols-[420px_1fr]">
            <Card><CardHeader><CardTitle>Add League</CardTitle><CardDescription>Choose the sport first, then create its competition.</CardDescription></CardHeader><CardContent className="grid gap-4"><div className="grid gap-2"><Label>Sport</Label><Select value={leagueSportId} onValueChange={setLeagueSportId}><SelectTrigger><SelectValue placeholder="Select sport" /></SelectTrigger><SelectContent>{sports.map((sport) => <SelectItem key={sport.id} value={sport.id}>{sport.name}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label htmlFor="league-name">League name</Label><Input id="league-name" placeholder="Premier League" value={leagueName} onChange={(event) => setLeagueName(event.target.value)} /></div><div className="grid gap-2"><Label htmlFor="league-country">Country</Label><Input id="league-country" placeholder="England" value={leagueCountry} onChange={(event) => setLeagueCountry(event.target.value)} /></div><Button onClick={() => void createLeague()} disabled={saving || !sports.length}><Plus className="mr-2 h-4 w-4" />{saving ? "Adding…" : "Add League"}</Button></CardContent></Card>
            <Card><CardHeader><CardTitle>Leagues</CardTitle></CardHeader><CardContent>{leagues.length === 0 ? <Empty loading={loading} /> : <div className="space-y-2">{leagues.map((league) => <div key={league.id} className="flex items-center justify-between gap-2 rounded border border-border p-3"><div className="flex min-w-0 items-center gap-3"><Trophy className="h-5 w-5 shrink-0 text-gold" /><div className="min-w-0"><div className="truncate font-medium">{league.name}</div><button className="text-left text-xs text-muted-foreground hover:text-foreground" onClick={() => void updateRecord("leagues", league.id, { is_active: !league.is_active }, "League")}>{sportNames.get(league.sport_id)} · {league.country || "Global"} · {league.is_active ? "Active" : "Inactive"}</button></div></div><RecordActions onEdit={() => void renameRecord("leagues", league.id, league.name, "League")} onDelete={() => void deleteRecord("leagues", league.id, "League")} /></div>)}</div>}</CardContent></Card>
          </TabsContent>

          <TabsContent value="events" className="mt-4 grid gap-4 xl:grid-cols-[420px_1fr]">
            <Card className="xl:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5" />Bulk Event Import</CardTitle><CardDescription>Paste CSV with exactly 10 columns. Existing sport and league names are reused; missing ones are created.</CardDescription></CardHeader><CardContent className="grid gap-3"><Textarea className="min-h-32 font-mono text-xs" value={bulkCsv} onChange={(event) => setBulkCsv(event.target.value)} /><div className="text-xs text-muted-foreground">sport, league, country, home_team, away_team, start_time, market, home_odds, draw_odds, away_odds</div><Button className="w-fit" onClick={() => void importEventsCsv()} disabled={saving}><Upload className="mr-2 h-4 w-4" />{saving ? "Importing…" : "Import CSV"}</Button></CardContent></Card>
            <Card><CardHeader><CardTitle>Add Event</CardTitle><CardDescription>Create the match visible to players.</CardDescription></CardHeader><CardContent className="grid gap-4"><div className="grid gap-2"><Label>Sport</Label><Select value={eventSportId} onValueChange={chooseEventSport}><SelectTrigger><SelectValue placeholder="Select sport" /></SelectTrigger><SelectContent>{sports.map((sport) => <SelectItem key={sport.id} value={sport.id}>{sport.name}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label>League</Label><Select value={eventLeagueId} onValueChange={setEventLeagueId}><SelectTrigger><SelectValue placeholder="Select league" /></SelectTrigger><SelectContent>{filteredLeagues.map((league) => <SelectItem key={league.id} value={league.id}>{league.name}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor="home-team">Home team</Label><Input id="home-team" value={homeTeam} onChange={(event) => setHomeTeam(event.target.value)} /></div><div className="grid gap-2"><Label htmlFor="away-team">Away team</Label><Input id="away-team" value={awayTeam} onChange={(event) => setAwayTeam(event.target.value)} /></div></div><div className="grid gap-2"><Label htmlFor="start-time">Start date and time</Label><Input id="start-time" type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></div><Button onClick={() => void createEvent()} disabled={saving || !leagues.length}><Plus className="mr-2 h-4 w-4" />{saving ? "Adding…" : "Add Event"}</Button></CardContent></Card>
            <Card><CardHeader><CardTitle>Events</CardTitle></CardHeader><CardContent>{events.length === 0 ? <Empty loading={loading} /> : <div className="space-y-2">{events.map((event) => <div key={event.id} className="rounded border border-border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-medium">{event.home_team} vs {event.away_team}</div><div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><Calendar className="h-3 w-3" />{new Date(event.start_time).toLocaleString()} · {leagueNames.get(event.league_id || "") || "Unassigned"}</div></div><div className="flex items-center gap-2"><Badge variant={event.status === "live" ? "destructive" : "secondary"}>{event.status}</Badge><RecordActions onEdit={() => void editEvent(event)} onDelete={() => void deleteRecord("events", event.id, "Event")} /></div></div></div>)}</div>}</CardContent></Card>
          </TabsContent>

          <TabsContent value="markets" className="mt-4 space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <Card><CardHeader><CardTitle>Add Betting Market</CardTitle><CardDescription>Example: Match Result, Over/Under 2.5.</CardDescription></CardHeader><CardContent className="grid gap-4"><div className="grid gap-2"><Label>Event</Label><Select value={marketEventId} onValueChange={setMarketEventId}><SelectTrigger><SelectValue placeholder="Select event" /></SelectTrigger><SelectContent>{events.map((event) => <SelectItem key={event.id} value={event.id}>{event.home_team} vs {event.away_team}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label htmlFor="market-name">Market name</Label><Input id="market-name" value={marketName} onChange={(event) => setMarketName(event.target.value)} /></div><div className="grid gap-2"><Label>Market type</Label><Select value={marketType} onValueChange={setMarketType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{marketTypes.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label htmlFor="market-line">Line (optional)</Label><Input id="market-line" type="number" step="0.25" placeholder="2.5" value={marketLine} onChange={(event) => setMarketLine(event.target.value)} /></div><Button onClick={() => void createMarket()} disabled={saving || !events.length}><Plus className="mr-2 h-4 w-4" />{saving ? "Adding…" : "Add Market"}</Button></CardContent></Card>
              <Card><CardHeader><CardTitle>Add Odds Selection</CardTitle><CardDescription>Add Home, Draw and Away separately with decimal odds.</CardDescription></CardHeader><CardContent className="grid gap-4"><div className="grid gap-2"><Label>Market</Label><Select value={oddsMarketId} onValueChange={setOddsMarketId}><SelectTrigger><SelectValue placeholder="Select market" /></SelectTrigger><SelectContent>{markets.map((market) => <SelectItem key={market.id} value={market.id}>{marketNames.get(market.id)}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label htmlFor="odds-selection">Selection</Label><Input id="odds-selection" placeholder="Home" value={oddsSelection} onChange={(event) => setOddsSelection(event.target.value)} /></div><div className="grid gap-2"><Label htmlFor="odds-value">Decimal odds</Label><Input id="odds-value" type="number" min="1.01" step="0.01" value={oddsValue} onChange={(event) => setOddsValue(event.target.value)} /></div><Button onClick={() => void createOdds()} disabled={saving || !markets.length}><CircleDollarSign className="mr-2 h-4 w-4" />{saving ? "Adding…" : "Add Odds"}</Button></CardContent></Card>
            </div>
            <div className="grid gap-4 xl:grid-cols-2"><CatalogueList title="Markets" empty={markets.length === 0} loading={loading}>{markets.map((market) => <div key={market.id} className="flex items-center justify-between gap-2 rounded border border-border p-3"><div className="min-w-0"><div className="truncate text-sm font-medium">{market.name}</div><button className="truncate text-left text-xs text-muted-foreground hover:text-foreground" onClick={() => void updateRecord("markets", market.id, { status: market.status === "active" ? "suspended" : "active" }, "Market")}>{eventNames.get(market.event_id)} · {market.type} · {market.status}</button></div><RecordActions onEdit={() => void renameRecord("markets", market.id, market.name, "Market")} onDelete={() => void deleteRecord("markets", market.id, "Market")} /></div>)}</CatalogueList><CatalogueList title="Odds" empty={odds.length === 0} loading={loading}>{odds.map((item) => <div key={item.id} className="flex items-center justify-between gap-2 rounded border border-border p-3"><div className="min-w-0"><div className="truncate text-sm font-medium">{item.selection} · {Number(item.value).toFixed(2)}</div><button className="truncate text-left text-xs text-muted-foreground hover:text-foreground" onClick={() => void updateRecord("odds", item.id, { is_active: !item.is_active }, "Odds")}>{marketNames.get(item.market_id)} · {item.is_active ? "Active" : "Inactive"}</button></div><RecordActions onEdit={() => void editOdds(item)} onDelete={() => void deleteRecord("odds", item.id, "Odds")} /></div>)}</CatalogueList></div>
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}

function Empty({ loading }: { loading: boolean }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{loading ? "Loading records…" : "No records found."}</p>;
}

function CatalogueList({ title, empty, loading, children }: { title: string; empty: boolean; loading: boolean; children: React.ReactNode }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent className="space-y-2">{empty ? <Empty loading={loading} /> : children}</CardContent></Card>;
}

function RecordActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return <div className="flex shrink-0 gap-1"><Button type="button" variant="ghost" size="icon" aria-label="Edit" onClick={onEdit}><Pencil className="h-4 w-4" /></Button><Button type="button" variant="ghost" size="icon" aria-label="Delete" className="text-destructive hover:text-destructive" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button></div>;
}
