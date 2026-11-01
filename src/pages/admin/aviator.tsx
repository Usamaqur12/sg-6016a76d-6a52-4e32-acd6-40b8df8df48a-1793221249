import { useEffect, useState } from "react";
import { Activity, Gauge, Plane, Save, ShieldCheck, Timer, WalletCards, Zap } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Settings={is_enabled:boolean;is_paused:boolean;betting_seconds:number;cooldown_seconds:number;growth_rate:number;min_stake:number;max_stake:number;max_multiplier:number;max_payout:number;house_edge_percent:number};
type State={phase:string;current_multiplier:number;settings:Settings;round:null|{round_number:number;server_seed_hash:string;crash_multiplier:number|null};history:Array<{round_number:number;crash_multiplier:number}>};
const defaults:Settings={is_enabled:true,is_paused:false,betting_seconds:8,cooldown_seconds:3,growth_rate:.115,min_stake:1,max_stake:1000,max_multiplier:1000,max_payout:100000,house_edge_percent:1};

export default function AviatorAdminPage(){
  const {toast}=useToast();
  const [game,setGame]=useState<State|null>(null);
  const [form,setForm]=useState<Settings>(defaults);
  const [saving,setSaving]=useState(false);

  async function load(){
    const {data,error}=await (supabase as any).rpc("aviator_get_state");
    if(error){toast({title:"Aviator not ready",description:error.message,variant:"destructive"});return;}
    setGame(data as State);setForm(current=>game?current:(data as State).settings);
  }
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),1200);return()=>window.clearInterval(timer);},[]);

  function numeric<K extends keyof Settings>(key:K,value:string){setForm(current=>({...current,[key]:Number(value)}));}
  function preset(name:"steady"|"standard"|"turbo"){
    if(name==="steady")setForm(current=>({...current,betting_seconds:10,cooldown_seconds:4,growth_rate:.08}));
    if(name==="standard")setForm(current=>({...current,betting_seconds:8,cooldown_seconds:3,growth_rate:.115}));
    if(name==="turbo")setForm(current=>({...current,betting_seconds:5,cooldown_seconds:2,growth_rate:.18}));
  }
  async function save(){
    setSaving(true);
    const {data,error}=await (supabase as any).rpc("aviator_admin_update_settings",{
      p_is_enabled:form.is_enabled,p_is_paused:form.is_paused,p_betting_seconds:form.betting_seconds,p_cooldown_seconds:form.cooldown_seconds,
      p_growth_rate:form.growth_rate,p_min_stake:form.min_stake,p_max_stake:form.max_stake,p_max_multiplier:form.max_multiplier,
      p_max_payout:form.max_payout,p_house_edge_percent:form.house_edge_percent
    });
    if(error)toast({title:"Settings not saved",description:error.message,variant:"destructive"});
    else{setGame(data as State);toast({title:"Aviator settings saved",description:form.is_paused?"Active bets were refunded safely.":"New settings apply to future rounds."});}
    setSaving(false);
  }

  return <AdminLayout><div className="space-y-5">
    <section className="relative overflow-hidden rounded-[28px] border border-cyan-400/15 bg-[#07111f] p-6 text-white shadow-[0_25px_70px_rgba(0,0,0,.35)]">
      <div className="absolute inset-0" style={{background:"radial-gradient(circle at 78% 30%,rgba(34,211,238,.18),transparent 27%),radial-gradient(circle at 15% 100%,rgba(16,185,129,.13),transparent 30%)"}}/>
      <div className="relative z-10 grid gap-6 xl:grid-cols-[1fr_auto] xl:items-center">
        <div><div className="mb-3 flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-300 to-emerald-400"><Plane className="h-7 w-7 text-slate-950"/></div><div><h1 className="text-3xl font-black">Aviator Control Center</h1><p className="text-sm text-slate-400">Live operations, exposure limits and fairness-safe configuration</p></div></div>
          <div className="flex flex-wrap gap-2">{(game?.history||[]).slice(0,8).map(round=><span key={round.round_number} className={"rounded-full border px-3 py-1 font-mono text-xs font-black "+(Number(round.crash_multiplier)>=2?"border-cyan-400/30 bg-cyan-400/10 text-cyan-300":"border-rose-400/30 bg-rose-400/10 text-rose-300")}>{Number(round.crash_multiplier).toFixed(2)}x</span>)}</div>
        </div>
        <div className="grid min-w-[320px] grid-cols-3 gap-2">
          <HeroStat label="Round" value={"#"+(game?.round?.round_number||"—")} icon={<Activity className="h-4 w-4"/>}/>
          <HeroStat label="Phase" value={game?.phase||"loading"} icon={<Zap className="h-4 w-4"/>}/>
          <HeroStat label="Live" value={Number(game?.current_multiplier||1).toFixed(2)+"x"} icon={<Gauge className="h-4 w-4"/>}/>
        </div>
      </div>
    </section>

    <div className="grid gap-5 xl:grid-cols-[1fr_330px]">
      <div className="space-y-5">
        <Card className="border-border/70">
          <CardHeader><div className="flex items-center justify-between"><CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5 text-primary"/>Game operations</CardTitle><Badge variant={form.is_paused?"destructive":"outline"}>{form.is_paused?"Paused":"Running"}</Badge></div></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Toggle title="Game enabled" description="Allow new provably-fair rounds" checked={form.is_enabled} onChange={value=>setForm(current=>({...current,is_enabled:value}))}/>
            <Toggle title="Pause safely" description="Refund active bets before pausing" checked={form.is_paused} onChange={value=>setForm(current=>({...current,is_paused:value}))}/>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><CardTitle className="flex items-center gap-2"><Timer className="h-5 w-5 text-primary"/>Round experience</CardTitle><div className="flex gap-2"><Button size="sm" variant="outline" onClick={()=>preset("steady")}>Steady</Button><Button size="sm" variant="outline" onClick={()=>preset("standard")}>Standard</Button><Button size="sm" variant="outline" onClick={()=>preset("turbo")}>Turbo</Button></div></div></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <Field label="Betting window" hint="3–30 seconds" value={form.betting_seconds} min={3} max={30} step={1} suffix="sec" onChange={value=>numeric("betting_seconds",value)}/>
            <Field label="Cooldown" hint="Pause between rounds" value={form.cooldown_seconds} min={2} max={15} step={1} suffix="sec" onChange={value=>numeric("cooldown_seconds",value)}/>
            <Field label="Flight speed" hint="Animation growth curve" value={form.growth_rate} min={.03} max={.5} step={.005} suffix="rate" onChange={value=>numeric("growth_rate",value)}/>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><WalletCards className="h-5 w-5 text-primary"/>Stake and payout limits</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Minimum stake" hint="Smallest accepted bet" value={form.min_stake} min={.01} max={100000} step={.01} suffix="USD" onChange={value=>numeric("min_stake",value)}/>
            <Field label="Maximum stake" hint="Per user, per round" value={form.max_stake} min={.01} max={100000} step={.01} suffix="USD" onChange={value=>numeric("max_stake",value)}/>
            <Field label="Maximum multiplier" hint="Global mathematical cap" value={form.max_multiplier} min={2} max={100000} step={1} suffix="x" onChange={value=>numeric("max_multiplier",value)}/>
            <Field label="Maximum payout" hint="Per winning cash-out" value={form.max_payout} min={1} max={10000000} step={1} suffix="USD" onChange={value=>numeric("max_payout",value)}/>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary"/>Fairness and distribution</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-[1fr_2fr]">
            <Field label="Statistical house edge" hint="Affects future distribution only" value={form.house_edge_percent} min={0} max={10} step={.1} suffix="%" onChange={value=>numeric("house_edge_percent",value)}/>
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4"><div className="font-semibold">Outcome protection is enforced</div><p className="mt-1 text-sm leading-6 text-muted-foreground">Crash points are generated and SHA-256 committed before betting opens. No admin setting can target a player, stake, active bet or active round.</p></div>
          </CardContent>
        </Card>
      </div>

      <aside className="space-y-4">
        <Card className="sticky top-6 overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-emerald-400 via-cyan-400 to-fuchsia-500"/>
          <CardHeader><CardTitle>Publish configuration</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Summary label="Round timing" value={form.betting_seconds+"s + "+form.cooldown_seconds+"s"}/>
            <Summary label="Speed" value={form.growth_rate.toFixed(3)}/>
            <Summary label="Stake range" value={"$"+form.min_stake+" – $"+form.max_stake}/>
            <Summary label="Max payout" value={"$"+form.max_payout}/>
            <Summary label="House edge" value={form.house_edge_percent+"%"}/>
            <Button className="h-12 w-full bg-gradient-to-r from-emerald-400 to-cyan-400 font-black text-slate-950" onClick={()=>void save()} disabled={saving}><Save className="mr-2 h-4 w-4"/>{saving?"Saving…":"Save Aviator Settings"}</Button>
            <p className="text-center text-[10px] text-muted-foreground">Changes are audit logged and apply to future rounds.</p>
          </CardContent>
        </Card>
      </aside>
    </div>
  </div></AdminLayout>;
}

function HeroStat({label,value,icon}:{label:string;value:string;icon:React.ReactNode}){return <div className="rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur"><div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-slate-400">{icon}{label}</div><div className="mt-2 truncate text-sm font-black capitalize">{value}</div></div>;}
function Toggle({title,description,checked,onChange}:{title:string;description:string;checked:boolean;onChange:(value:boolean)=>void}){return <div className="flex items-center justify-between rounded-2xl border p-4"><div><div className="font-semibold">{title}</div><div className="text-xs text-muted-foreground">{description}</div></div><Switch checked={checked} onCheckedChange={onChange}/></div>;}
function Field({label,hint,value,min,max,step,suffix,onChange}:{label:string;hint:string;value:number;min:number;max:number;step:number;suffix:string;onChange:(value:string)=>void}){return <div className="space-y-2"><div><Label>{label}</Label><p className="mt-1 text-[10px] text-muted-foreground">{hint}</p></div><div className="relative"><Input type="number" value={value} min={min} max={max} step={step} onChange={event=>onChange(event.target.value)} className="pr-14 font-mono font-bold"/><span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted-foreground">{suffix}</span></div></div>;}
function Summary({label,value}:{label:string;value:string}){return <div className="flex items-center justify-between border-b border-border/70 pb-3 text-sm"><span className="text-muted-foreground">{label}</span><span className="font-mono font-bold">{value}</span></div>;}
