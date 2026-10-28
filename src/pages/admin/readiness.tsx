import { useCallback, useEffect, useState } from "react";
import { CheckCircle, CircleDashed, RefreshCw, Rocket, ShieldCheck, TriangleAlert } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

type Item = { id: string; label: string; ready: boolean; detail: string; owner: "development" | "external" };
type Report = { generatedAt: string; score: number; ready: number; total: number; items: Item[] };

export default function ReadinessPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setError("Admin session expired. Sign in again.");
      setLoading(false);
      return;
    }
    const result = await fetch("/api/admin/readiness", {
      headers: { authorization: `Bearer ${session.access_token}` },
    });
    const body = await result.json();
    if (!result.ok) setError(body.error || "Readiness report could not load"); else setReport(body as Report);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const internal = report?.items.filter((item) => item.owner === "development") || [];
  const external = report?.items.filter((item) => item.owner === "external") || [];
  return <AdminLayout><div className="space-y-6 p-2 sm:p-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="flex items-center gap-2 text-3xl font-bold"><Rocket className="h-7 w-7 text-primary" />Launch Readiness</h1><p className="mt-1 text-sm text-muted-foreground">Live environment checks without exposing secret values.</p></div><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button></div>{error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}{report && <><Card className="overflow-hidden border-primary/20"><CardContent className="grid gap-5 p-6 sm:grid-cols-[160px_1fr] sm:items-center"><div className="flex h-36 w-36 items-center justify-center rounded-full border-[10px] border-primary/20 bg-primary/5"><span className="text-4xl font-black text-primary">{report.score}%</span></div><div><h2 className="text-2xl font-bold">{report.ready} of {report.total} checks ready</h2><p className="mt-2 text-sm text-muted-foreground">Development-ready does not mean legally approved. External provider, licensing and independent audit items stay separate.</p><div className="mt-4 h-3 overflow-hidden rounded-full bg-muted"><div className="h-full bg-gradient-to-r from-primary to-primary-bright" style={{ width: `${report.score}%` }} /></div></div></CardContent></Card><ReadinessGroup title="Development and configuration" icon={<ShieldCheck className="h-5 w-5 text-primary" />} items={internal} /><ReadinessGroup title="External accounts and approvals" icon={<TriangleAlert className="h-5 w-5 text-warning" />} items={external} /><p className="text-xs text-muted-foreground">Generated {new Date(report.generatedAt).toLocaleString()}</p></>}</div></AdminLayout>;
}

function ReadinessGroup({ title, icon, items }: { title: string; icon: React.ReactNode; items: Item[] }) {
  return <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg">{icon}{title}</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">{items.map((item) => <div key={item.id} className={`rounded-xl border p-4 ${item.ready ? "border-success/25 bg-success/5" : "border-warning/25 bg-warning/5"}`}><div className="flex items-start gap-3">{item.ready ? <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-success" /> : <CircleDashed className="mt-0.5 h-5 w-5 shrink-0 text-warning" />}<div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{item.label}</p><Badge variant={item.ready ? "default" : "outline"}>{item.ready ? "Ready" : "Action required"}</Badge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p></div></div></div>)}</CardContent></Card>;
}

