import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Trash2 } from "lucide-react";

export default function AdminCasino() {
  const { toast } = useToast();
  const [providers, setProviders] = useState<any[]>([]);
  const [games, setGames] = useState<any[]>([]);
  const [providerForm, setProviderForm] = useState({ code: "", name: "" });
  const [gameForm, setGameForm] = useState({ provider_id: "", external_game_id: "", name: "", category: "slots" });

  async function adminFetch(url: string, init?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Admin session expired");
    const response = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}`, ...(init?.headers || {}) },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Casino catalogue request failed");
    return body;
  }

  async function load() {
    try {
      const body = await adminFetch("/api/admin/casino-catalogue");
      setProviders(body.providers || []); setGames(body.games || []);
    } catch (error) {
      toast({ title: "Catalogue could not be loaded", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
  }
  useEffect(() => { void load(); }, []);

  async function addProvider() {
    const code = providerForm.code.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    if (!code || !providerForm.name.trim()) return;
    try {
      await adminFetch("/api/admin/casino-catalogue", { method: "POST", body: JSON.stringify({ resource: "provider", code, name: providerForm.name.trim() }) });
      setProviderForm({ code: "", name: "" }); await load();
    } catch (error) { toast({ title: "Provider was not added", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" }); }
  }

  async function addGame() {
    if (!gameForm.provider_id || !gameForm.external_game_id.trim() || !gameForm.name.trim()) return;
    try {
      await adminFetch("/api/admin/casino-catalogue", { method: "POST", body: JSON.stringify({ resource: "game", ...gameForm, external_game_id: gameForm.external_game_id.trim(), name: gameForm.name.trim() }) });
      setGameForm((value) => ({ ...value, external_game_id: "", name: "" })); await load();
    } catch (error) { toast({ title: "Game was not added", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" }); }
  }

  async function toggle(table: "casino_providers" | "casino_games", id: string, value: boolean) {
    try {
      await adminFetch("/api/admin/casino-catalogue", { method: "PATCH", body: JSON.stringify({ resource: table === "casino_providers" ? "provider" : "game", id, enabled: value }) });
    } catch (error) { toast({ title: "Update failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" }); }
    await load();
  }

  async function removeGame(id: string) {
    try {
      await adminFetch(`/api/admin/casino-catalogue?resource=game&id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (error) { toast({ title: "Game cannot be deleted", description: error instanceof Error ? error.message : "Disable it if transaction history already exists.", variant: "destructive" }); }
    await load();
  }

  return <AdminLayout><div className="space-y-6 p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-3xl font-bold">Casino Catalogue</h1><p className="mt-1 text-muted-foreground">Configure licensed providers and their game catalogue. API secrets stay in server environment variables.</p></div><Button variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4"/>Refresh</Button></div>
    <div className="grid gap-6 xl:grid-cols-2">
      <Card><CardHeader><CardTitle>Add provider</CardTitle></CardHeader><CardContent className="space-y-4">
        <div><Label>Provider code</Label><Input value={providerForm.code} onChange={(event) => setProviderForm({ ...providerForm, code: event.target.value })} placeholder="licensed-aggregator" /></div>
        <div><Label>Display name</Label><Input value={providerForm.name} onChange={(event) => setProviderForm({ ...providerForm, name: event.target.value })} placeholder="Provider name" /></div>
        <Button onClick={() => void addProvider()}>Add disabled provider</Button>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Add game</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
        <div><Label>Provider</Label><Select value={gameForm.provider_id} onValueChange={(provider_id) => setGameForm({ ...gameForm, provider_id })}><SelectTrigger><SelectValue placeholder="Select provider"/></SelectTrigger><SelectContent>{providers.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Category</Label><Select value={gameForm.category} onValueChange={(category) => setGameForm({ ...gameForm, category })}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{["slots","live","table","jackpot","instant","other"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>External game ID</Label><Input value={gameForm.external_game_id} onChange={(event) => setGameForm({ ...gameForm, external_game_id: event.target.value })}/></div>
        <div><Label>Game name</Label><Input value={gameForm.name} onChange={(event) => setGameForm({ ...gameForm, name: event.target.value })}/></div>
        <Button className="md:col-span-2" onClick={() => void addGame()}>Add disabled game</Button>
      </CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle>Providers</CardTitle></CardHeader><CardContent className="space-y-3">{providers.map((provider) => <div key={provider.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"><div><div className="flex items-center gap-2"><span className="font-semibold">{provider.name}</span><Badge variant="outline">{provider.code}</Badge>{provider.is_demo && <Badge variant="secondary">demo</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">Status: {provider.status}</p></div><div className="flex items-center gap-2"><span className="text-sm">Enabled</span><Switch checked={Boolean(provider.is_enabled)} onCheckedChange={(value) => void toggle("casino_providers", provider.id, value)}/></div></div>)}{providers.length === 0 && <p className="text-sm text-muted-foreground">No providers configured.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Games</CardTitle></CardHeader><CardContent className="space-y-3">{games.map((game) => <div key={game.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"><div><span className="font-semibold">{game.name}</span><p className="mt-1 text-xs text-muted-foreground">{game.external_game_id} · {game.category}</p></div><div className="flex items-center gap-3"><Switch checked={Boolean(game.is_active)} onCheckedChange={(value) => void toggle("casino_games", game.id, value)}/><Button size="icon" variant="ghost" onClick={() => void removeGame(game.id)} aria-label="Delete game"><Trash2 className="h-4 w-4 text-danger"/></Button></div></div>)}{games.length === 0 && <p className="text-sm text-muted-foreground">No games configured.</p>}</CardContent></Card>
  </div></AdminLayout>;
}
