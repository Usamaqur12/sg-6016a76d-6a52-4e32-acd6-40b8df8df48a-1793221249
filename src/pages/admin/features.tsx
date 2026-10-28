import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { RefreshCw, Save, SlidersHorizontal } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Flag = { key: string; name: string; description: string | null; is_enabled: boolean; config: Record<string, unknown>; updated_at: string };

export default function FeatureControls() {
  const router = useRouter(); const { toast } = useToast(); const [flags,setFlags] = useState<Flag[]>([]); const [loading,setLoading] = useState(true); const [saving,setSaving] = useState<string | null>(null);
  const load = useCallback(async () => { setLoading(true); const { data,error } = await (supabase as any).from("feature_flags").select("*").order("name"); if (error) toast({ title:"Feature controls could not load",description:error.message,variant:"destructive" }); else setFlags((data || []) as Flag[]); setLoading(false); },[toast]);
  useEffect(() => { void (async () => { const { data:{ user } } = await supabase.auth.getUser(); if (!user) return void router.push("/admin/login"); const { data:profile } = await supabase.from("profiles").select("admin_role").eq("id",user.id).single(); if (!profile || !["super_admin","admin"].includes(String(profile.admin_role))) return void router.push("/admin"); await load(); })(); },[load,router]);
  function updateConfig(key:string, field:string, value:unknown) { setFlags((current) => current.map((flag) => flag.key===key ? { ...flag, config:{ ...flag.config,[field]:value } } : flag)); }
  async function save(flag:Flag, enabled=flag.is_enabled) { setSaving(flag.key); const { error } = await (supabase as any).rpc("save_feature_flag",{ p_key:flag.key,p_enabled:enabled,p_config:flag.config }); if (error) toast({ title:"Feature update failed",description:error.message,variant:"destructive" }); else { toast({ title:`${flag.name} ${enabled ? "enabled" : "disabled"}` }); await load(); } setSaving(null); }
  return <AdminLayout><div className="space-y-6 p-4 md:p-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="flex items-center gap-2 text-2xl font-bold"><SlidersHorizontal className="h-6 w-6 text-primary" />Feature Controls</h1><p className="text-sm text-muted-foreground">Safely enable, disable and configure platform modules.</p></div><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button></div><div className="grid gap-4 lg:grid-cols-2">{flags.map((flag) => <Card key={flag.key} className={flag.is_enabled ? "border-primary/25" : ""}><CardHeader><CardTitle className="flex items-center justify-between gap-3 text-base"><span>{flag.name}</span><Badge variant={flag.is_enabled ? "default" : "outline"}>{flag.is_enabled ? "Enabled" : "Disabled"}</Badge></CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">{flag.description}</p>{flag.key==="maintenance_mode" && <label className="space-y-2"><Label>Customer message</Label><Input value={String(flag.config.message || "")} onChange={(event) => updateConfig(flag.key,"message",event.target.value)} /></label>}{flag.key==="withdrawal_address_whitelist" && <label className="space-y-2"><Label>New-address cooling period (hours)</Label><Input type="number" min="0" max="168" value={Number(flag.config.cooldown_hours ?? 24)} onChange={(event) => updateConfig(flag.key,"cooldown_hours",Number(event.target.value))} /></label>}<div className="flex flex-wrap gap-2"><Button onClick={() => void save(flag,!flag.is_enabled)} disabled={saving===flag.key}>{flag.is_enabled ? "Disable" : "Enable"}</Button><Button variant="outline" onClick={() => void save(flag)} disabled={saving===flag.key}><Save className="mr-2 h-4 w-4" />Save configuration</Button></div></CardContent></Card>)}</div></div></AdminLayout>;
}

