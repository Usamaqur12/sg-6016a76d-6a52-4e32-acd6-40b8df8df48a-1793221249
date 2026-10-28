import { AdminLayout } from "@/components/admin/AdminLayout";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Activity, CheckCircle2, Eye, EyeOff, Plus, RefreshCw, Save, Trash2, XCircle } from "lucide-react";

type ProviderType = "openligadb" | "thesportsdb_demo" | "thesportsdb_live" | "sportmonks";

interface ProviderRecord {
  id: string;
  name: string;
  provider_type: ProviderType;
  settings: { leagueId?: string; leagueShortcut?: string; sport?: string; latestOnly?: boolean };
  is_enabled: boolean;
  is_demo: boolean;
  priority: number;
  sync_interval_seconds: number;
  status: string;
  last_sync_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_event_count: number;
  has_api_key?: boolean;
}

interface ProviderActionResult {
  ok: boolean;
  eventCount: number;
  latencyMs?: number;
  sample: Array<{ providerEventId: string; event: string; league: string; status: string; score: string | null; startTime: string }>;
}

const providerLabels: Record<ProviderType, string> = {
  openligadb: "OpenLigaDB Live Scores (no key)",
  thesportsdb_demo: "TheSportsDB Demo Schedule (free)",
  thesportsdb_live: "TheSportsDB V2 Live Scores",
  sportmonks: "Sportmonks Football Live Scores",
};

export default function SportsProvidersPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [providers, setProviders] = useState<ProviderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [result, setResult] = useState<ProviderActionResult | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [name, setName] = useState("TheSportsDB Live Scores");
  const [providerType, setProviderType] = useState<ProviderType>("thesportsdb_live");
  const [apiKey, setApiKey] = useState("");
  const [leagueId, setLeagueId] = useState("4328");
  const [leagueShortcut, setLeagueShortcut] = useState("bl1");
  const [sport, setSport] = useState("soccer");
  const [syncInterval, setSyncInterval] = useState("10");
  const [enabled, setEnabled] = useState(false);

  useEffect(() => { void loadProviders(); }, []);

  async function adminFetch(url: string, init?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Admin session expired");
    const response = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}`, ...(init?.headers || {}) },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Provider request failed");
    return body;
  }

  async function loadProviders() {
    setLoading(true);
    try {
      const body = await adminFetch("/api/admin/sports-providers");
      setProviders(body.providers || []);
    } catch (error) {
      toast({ title: "Providers could not be loaded", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function createProvider() {
    if (!name.trim()) return;
    setWorkingId("create");
    try {
      const payload = {
        name: name.trim(), providerType, apiKey: apiKey.trim() || undefined,
        settings: { leagueId: leagueId.trim() || undefined, leagueShortcut: leagueShortcut.trim() || undefined, sport: sport.trim() || undefined },
        isEnabled: enabled, priority: providerType === "openligadb" ? 50 : 100, syncIntervalSeconds: providerType === "openligadb" ? Math.max(Number(syncInterval), 60) : Number(syncInterval),
      };
      await adminFetch("/api/admin/sports-providers", { method: "POST", body: JSON.stringify(payload) });
      setApiKey("");
      toast({ title: "Provider added", description: "Use Test first, then Sync now." });
      await loadProviders();
    } catch (error) {
      toast({ title: "Provider could not be added", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    } finally {
      setWorkingId(null);
    }
  }

  async function updateProvider(provider: ProviderRecord, changes: Record<string, unknown>) {
    setWorkingId(provider.id);
    try {
      await adminFetch("/api/admin/sports-providers", {
        method: "PUT",
        body: JSON.stringify({ id: provider.id, ...changes }),
      });
      await loadProviders();
    } catch (error) {
      toast({ title: "Provider update failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    } finally {
      setWorkingId(null);
    }
  }

  async function deleteProvider(id: string) {
    if (!window.confirm(`Delete ${id}? Existing imported events will remain in the catalogue.`)) return;
    setWorkingId(id);
    try {
      await adminFetch(`/api/admin/sports-providers?id=${id}`, { method: "DELETE" });
      toast({ title: "Provider removed" });
      await loadProviders();
    } catch (error) {
      toast({ title: "Provider could not be removed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    } finally {
      setWorkingId(null);
    }
  }

  async function runAction(provider: ProviderRecord, action: "test" | "sync") {
    setWorkingId(provider.id);
    setResult(null);
    try {
      const body: ProviderActionResult = await adminFetch(`/api/admin/sports-providers/${provider.id}/action`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      setResult(body);
      toast({ title: action === "sync" ? "Provider synced" : "Connection successful", description: `${body.eventCount} event update(s) received.` });
      await loadProviders();
    } catch (error) {
      toast({ title: action === "sync" ? "Sync failed" : "Connection failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-black">Sports Feed Providers</h1>
            <p className="text-sm text-muted-foreground">Configure and monitor sports data providers</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => router.push("/admin")} variant="outline" size="sm">
              Back to Dashboard
            </Button>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[390px_1fr]">
          <Card>
            <CardHeader><CardTitle>Add provider</CardTitle><CardDescription>Add the connection here; secrets are never returned after saving.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label htmlFor="provider-name">Display name</Label><Input id="provider-name" value={name} onChange={(event) => setName(event.target.value)} /></div>
              <div className="space-y-2"><Label>Provider</Label><Select value={providerType} onValueChange={(value) => setProviderType(value as ProviderType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(providerLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
              {!['thesportsdb_demo', 'openligadb'].includes(providerType) && <div className="space-y-2"><Label htmlFor="provider-key">API key/token</Label><div className="flex gap-2"><Input id="provider-key" type={showKey ? "text" : "password"} autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /><Button type="button" size="icon" variant="outline" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? "Hide API key" : "Show API key"}>{showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button></div></div>}
              <div className="grid grid-cols-2 gap-3">{providerType === "openligadb" ? <div className="space-y-2"><Label htmlFor="league-shortcut">League shortcut</Label><Input id="league-shortcut" value={leagueShortcut} onChange={(event) => setLeagueShortcut(event.target.value)} placeholder="bl1" /></div> : <div className="space-y-2"><Label htmlFor="league-id">League ID</Label><Input id="league-id" value={leagueId} onChange={(event) => setLeagueId(event.target.value)} placeholder="4328" /></div>}<div className="space-y-2"><Label htmlFor="sport-code">Sport</Label><Input id="sport-code" value={sport} onChange={(event) => setSport(event.target.value)} placeholder="soccer" /></div></div>
              <div className="space-y-2"><Label htmlFor="sync-interval">Sync interval (seconds)</Label><Input id="sync-interval" type="number" min="5" max="3600" value={syncInterval} onChange={(event) => setSyncInterval(event.target.value)} /></div>
              <div className="flex items-center justify-between rounded border border-border p-3"><div><div className="text-sm font-medium">Enable after saving</div><div className="text-xs text-muted-foreground">Test before using scheduled sync.</div></div><Switch checked={enabled} onCheckedChange={setEnabled} /></div>
              <Button className="w-full" onClick={() => void createProvider()} disabled={workingId === "create"}><Plus className="mr-2 h-4 w-4" />{workingId === "create" ? "Saving…" : "Add provider"}</Button>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader className="flex-row items-center justify-between"><div><CardTitle>Configured providers</CardTitle><CardDescription>Enabled providers are processed in priority order.</CardDescription></div><Button size="sm" variant="outline" onClick={() => void loadProviders()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button></CardHeader>
              <CardContent className="space-y-3">
                {providers.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">{loading ? "Loading providers…" : "No provider configured."}</p> : providers.map((provider) => (
                  <div key={provider.id} className="rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{provider.name}</h3><Badge variant={provider.status === "healthy" ? "outline" : provider.status === "error" ? "destructive" : "secondary"}>{provider.status.replace(/_/g, " ")}</Badge>{provider.is_demo && <Badge variant="secondary">Preview</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">{providerLabels[provider.provider_type]} · every {provider.sync_interval_seconds}s · {provider.last_event_count || 0} last events</p>{provider.last_success_at && <p className="mt-1 text-xs text-muted-foreground">Last success: {new Date(provider.last_success_at).toLocaleString()}</p>}{provider.last_error && <p className="mt-1 text-xs text-destructive">{provider.last_error}</p>}</div>
                      <div className="flex items-center gap-2"><Switch checked={provider.is_enabled} onCheckedChange={(checked) => void updateProvider(provider, { isEnabled: checked })} disabled={workingId === provider.id} /><Button size="icon" variant="ghost" className="text-destructive" onClick={() => void deleteProvider(provider.id)} disabled={workingId === provider.id} aria-label="Delete provider"><Trash2 className="h-4 w-4" /></Button></div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void runAction(provider, "test")} disabled={workingId === provider.id}><Activity className="mr-2 h-4 w-4" />Test connection</Button><Button size="sm" onClick={() => void runAction(provider, "sync")} disabled={!provider.is_enabled || workingId === provider.id}><Save className="mr-2 h-4 w-4" />Sync now</Button></div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {result && <Card><CardHeader><CardTitle className="flex items-center gap-2">{result.ok ? <CheckCircle2 className="h-5 w-5 text-success" /> : <XCircle className="h-5 w-5 text-destructive" />}Latest provider response</CardTitle><CardDescription>{result.eventCount} update(s){result.latencyMs ? ` in ${result.latencyMs}ms` : ""}</CardDescription></CardHeader><CardContent className="space-y-2">{result.sample.length === 0 ? <p className="text-sm text-muted-foreground">Connection worked, but no matches are live/available for this filter right now.</p> : result.sample.map((item) => <div key={item.providerEventId} className="rounded border border-border p-3"><div className="font-medium">{item.event}</div><div className="text-xs text-muted-foreground">{item.league} · {item.status} · {item.score || new Date(item.startTime).toLocaleString()}</div></div>)}</CardContent></Card>}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

