import { useEffect, useState } from "react";
import { Plane, Save, ShieldCheck } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Settings = {
  is_enabled:boolean; is_paused:boolean; betting_seconds:number; cooldown_seconds:number;
  growth_rate:number; min_stake:number; max_stake:number; max_multiplier:number;
  max_payout:number; house_edge_percent:number;
};
type State = { phase:string; current_multiplier:number; settings:Settings; round:null|{round_number:number;server_seed_hash:string;crash_multiplier:number|null}; history:Array<{round_number:number;crash_multiplier:number}> };

const defaults:Settings={is_enabled:true,is_paused:false,betting_seconds:8,cooldown_seconds:3,growth_rate:0.115,min_stake:1,max_stake:1000,max_multiplier:1000,max_payout:100000,house_edge_percent:1};

export default function AviatorAdminPage(){
  const {toast}=useToast();
  const [game,setGame]=useState<State|null>(null);
  const [form,setForm]=useState<Settings>(defaults);
  const [saving,setSaving]=useState(false);

  async function load(){
    const {data,error}=await (supabase as any).rpc("aviator_get_state");
    if(error){toast({title:"Aviator not ready",description:error.message,variant:"destructive"});return;}
    setGame(data as State);setForm((data as State).settings);
  }
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),1500);return()=>window.clearInterval(timer);},[]);

  function numeric<K extends keyof Settings>(key:K,value:string){setForm(current=>({...current,[key]:Number(value)}));}
  async function save(){
    setSaving(true);
    const {data,error}=await (supabase as any).rpc("aviator_admin_update_settings",{
      p_is_enabled:form.is_enabled,p_is_paused:form.is_paused,p_betting_seconds:form.betting_seconds,
      p_cooldown_seconds:form.cooldown_seconds,p_growth_rate:form.growth_rate,p_min_stake:form.min_stake,
      p_max_stake:form.max_stake,p_max_multiplier:form.max_multiplier,p_max_payout:form.max_payout,
      p_house_edge_percent:form.house_edge_percent
    });
    if(error)toast({title:"Settings not saved",description:error.message,variant:"destructive"});
    else{setGame(data as State);toast({title:"Aviator settings saved",description:form.is_paused?"Active bets were refunded safely.":"New settings apply to future rounds."});}
    setSaving(false);
  }

  return <AdminLayout><div className="space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="flex items-center gap-2 text-3xl font-bold"><Plane className="h-7 w-7 text-primary"/>Aviator Control</h1><p className="text-sm text-muted-foreground">Fairness-safe game operations and limits</p></div>
      <div className="flex gap-2"><Badge variant="outline">Round #{game?.round?.round_number||"—"}</Badge><Badge>{game?.phase||"loading"}</Badge></div>
    </div>

    <Card><CardHeader><CardTitle>Live round</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-3">
      <div className="rounded border p-4"><div className="text-xs text-muted-foreground">Multiplier</div><div className="mt-1 font-mono text-3xl font-black">{Number(game?.current_multiplier||1).toFixed(2)}x</div></div>
      <div className="rounded border p-4"><div className="text-xs text-muted-foreground">Phase</div><div className="mt-1 text-xl font-bold capitalize">{game?.phase||"loading"}</div></div>
      <div className="rounded border p-4"><div className="text-xs text-muted-foreground">Seed commitment</div><div className="mt-1 break-all font-mono text-[10px]">{game?.round?.server_seed_hash||"—"}</div></div>
    </CardContent></Card>

    <Card><CardHeader><CardTitle>Operations</CardTitle></CardHeader><CardContent className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded border p-4"><div><div className="font-medium">Game enabled</div><div className="text-xs text-muted-foreground">Allow new fair rounds</div></div><Switch checked={form.is_enabled} onCheckedChange={value=>setForm(current=>({...current,is_enabled:value}))}/></div>
        <div className="flex items-center justify-between rounded border p-4"><div><div className="font-medium">Pause safely</div><div className="text-xs text-muted-foreground">Refunds active bets before pausing</div></div><Switch checked={form.is_paused} onCheckedChange={value=>setForm(current=>({...current,is_paused:value}))}/></div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Betting window (seconds)" value={form.betting_seconds} min={3} max={30} step={1} onChange={value=>numeric("betting_seconds",value)}/>
        <Field label="Cooldown (seconds)" value={form.cooldown_seconds} min={2} max={15} step={1} onChange={value=>numeric("cooldown_seconds",value)}/>
        <Field label="Flight speed" value={form.growth_rate} min={0.03} max={0.5} step={0.005} onChange={value=>numeric("growth_rate",value)}/>
        <Field label="Statistical house edge %" value={form.house_edge_percent} min={0} max={10} step={0.1} onChange={value=>numeric("house_edge_percent",value)}/>
        <Field label="Minimum stake" value={form.min_stake} min={0.01} max={100000} step={0.01} onChange={value=>numeric("min_stake",value)}/>
        <Field label="Maximum stake" value={form.max_stake} min={0.01} max={100000} step={0.01} onChange={value=>numeric("max_stake",value)}/>
        <Field label="Maximum multiplier" value={form.max_multiplier} min={2} max={100000} step={1} onChange={value=>numeric("max_multiplier",value)}/>
        <Field label="Maximum payout" value={form.max_payout} min={1} max={10000000} step={1} onChange={value=>numeric("max_payout",value)}/>
      </div>
      <Button onClick={()=>void save()} disabled={saving}><Save className="mr-2 h-4 w-4"/>{saving?"Saving…":"Save Aviator Settings"}</Button>
    </CardContent></Card>

    <Card className="border-primary/20"><CardContent className="flex gap-3 p-5"><ShieldCheck className="h-6 w-6 shrink-0 text-primary"/><div><div className="font-semibold">Outcome protection</div><p className="mt-1 text-sm text-muted-foreground">Each crash point is generated and hash-committed before betting opens. Admin settings affect future statistical distribution and speed only; they cannot target a user, stake, or active round.</p></div></CardContent></Card>
  </div></AdminLayout>;
}

function Field({label,value,min,max,step,onChange}:{label:string;value:number;min:number;max:number;step:number;onChange:(value:string)=>void}){
  return <div className="space-y-2"><Label>{label}</Label><Input type="number" value={value} min={min} max={max} step={step} onChange={event=>onChange(event.target.value)}/></div>;
}
