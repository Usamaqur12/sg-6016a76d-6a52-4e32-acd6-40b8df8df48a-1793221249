import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Gauge, History, LockKeyhole, Plane, ShieldCheck, Timer, Volume2, VolumeX, Wallet, WifiOff, Zap } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { getMyWalletBalances } from "@/services/walletService";
import { useToast } from "@/hooks/use-toast";

type GameState = {
  phase: "betting" | "running" | "crashed" | "paused";
  current_multiplier: number;
  settings: {
    min_stake:number; max_stake:number; max_payout:number; max_multiplier:number;
    house_edge_percent:number; is_paused:boolean; maintenance_message?:string;
    auto_cashout_enabled?:boolean; min_auto_cashout?:number; max_auto_cashout?:number;
    reminder_minutes?:number; low_data_mode_default?:boolean;
    sound_enabled_default?:boolean; vibration_enabled_default?:boolean;
  };
  round: null | { id:string; round_number:number; server_seed_hash:string; server_seed_reveal:string|null; crash_multiplier:number|null; betting_closes_at:string; next_round_at:string };
  my_bet: null | {
    id:string; stake:number; status:string; auto_cashout_multiplier:number|null;
    cashout_multiplier:number|null; payout:number; result_reason?:string|null;
  };
  history: Array<{ round_number:number; crash_multiplier:number; server_seed_hash:string; server_seed_reveal:string }>;
};

const money=(value:number)=>new Intl.NumberFormat("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}).format(value);

export default function AviatorPage(){
  const router=useRouter();
  const {toast}=useToast();
  const [game,setGame]=useState<GameState|null>(null);
  const [user,setUser]=useState<{id:string;email?:string}|null>(null);
  const [balance,setBalance]=useState(0);
  const [stake,setStake]=useState("10");
  const [autoCashout,setAutoCashout]=useState("");
  const [busy,setBusy]=useState(false);
  const [now,setNow]=useState(Date.now());
  const [lowData,setLowData]=useState(false);
  const [soundEnabled,setSoundEnabled]=useState(true);
  const [vibrationEnabled,setVibrationEnabled]=useState(true);

  const loadBalance=useCallback(async()=>{
    const result=await getMyWalletBalances();
    setBalance(Number(result.balances?.available??result.balances?.cash??0));
  },[]);
  const loadGame=useCallback(async()=>{
    const {data,error}=await (supabase as any).rpc("aviator_get_state");
    if(!error&&data)setGame(data as GameState);
  },[]);

  useEffect(()=>{
    void supabase.auth.getUser().then(({data})=>{
      const current=data.user?{id:data.user.id,email:data.user.email}:null;
      setUser(current);
      if(current)void loadBalance();
    });
    const gameTimer=window.setInterval(()=>void loadGame(),lowData?1200:400);
    const clockTimer=window.setInterval(()=>setNow(Date.now()),lowData?500:100);
    void loadGame();
    return()=>{window.clearInterval(gameTimer);window.clearInterval(clockTimer);};
  },[loadBalance,loadGame,lowData]);

  const countdown=useMemo(()=>{
    if(!game?.round)return 0;
    const target=game.phase==="betting"?game.round.betting_closes_at:game.round.next_round_at;
    return Math.max(0,(new Date(target).getTime()-now)/1000);
  },[game,now]);

  async function placeBet(){
    if(!user){await router.push("/auth/login");return;}
    const amount=Number(stake);
    if(!game||!Number.isFinite(amount)||amount<game.settings.min_stake||amount>game.settings.max_stake){
      toast({title:"Invalid stake",description:"Use an amount inside the displayed limits.",variant:"destructive"});return;
    }
    setBusy(true);
    const automatic=autoCashout.trim()===""?null:Number(autoCashout);
    if(automatic!==null&&(
      !game.settings.auto_cashout_enabled||
      !Number.isFinite(automatic)||
      automatic<Number(game.settings.min_auto_cashout||1.1)||
      automatic>Number(game.settings.max_auto_cashout||game.settings.max_multiplier)
    )){
      toast({title:"Invalid auto cash-out",description:"Choose a multiplier inside the displayed range.",variant:"destructive"});
      return;
    }
    const {data,error}=await (supabase as any).rpc("aviator_place_bet",{
      p_stake:amount,p_auto_cashout:automatic
    });
    if(error)toast({title:"Bet not placed",description:error.message,variant:"destructive"});
    else{setGame(data as GameState);toast({title:"Bet accepted",description:"Cash out before the plane flies away."});await loadBalance();}
    setBusy(false);
  }

  async function cashout(){
    setBusy(true);
    const {data,error}=await (supabase as any).rpc("aviator_cashout");
    if(error)toast({title:"Cash-out failed",description:error.message,variant:"destructive"});
    else{setGame(data as GameState);toast({title:"Cash-out completed",description:"Your live wallet was credited."});await loadBalance();}
    setBusy(false);
  }

  const multiplier=Number(game?.current_multiplier||1);
  const activeBet=game?.my_bet?.status==="placed";
  const canBet=game?.phase==="betting"&&!game.my_bet;
  const canCashout=game?.phase==="running"&&activeBet;
  const phaseLabel=game?.phase==="betting"?"PLACE YOUR BETS":game?.phase==="running"?"FLYING NOW":game?.phase==="crashed"?"FLEW AWAY":"GAME PAUSED";
  const phaseColor=game?.phase==="crashed"?"text-rose-400":game?.phase==="running"?"text-emerald-300":"text-cyan-300";
  const planePosition=game?.phase==="running"?"translate-x-24 -translate-y-16 rotate-[-10deg] sm:translate-x-40 sm:-translate-y-24":game?.phase==="crashed"?"translate-x-48 -translate-y-32 opacity-0":"";

  useEffect(()=>{
    if(!game)return;
    const savedLow=window.localStorage.getItem("aviator:low-data");
    const savedSound=window.localStorage.getItem("aviator:sound");
    const savedVibration=window.localStorage.getItem("aviator:vibration");
    if(savedLow===null)setLowData(Boolean(game.settings.low_data_mode_default));
    if(savedSound===null)setSoundEnabled(game.settings.sound_enabled_default!==false);
    if(savedVibration===null)setVibrationEnabled(game.settings.vibration_enabled_default!==false);
  },[game?.settings.low_data_mode_default,game?.settings.sound_enabled_default,game?.settings.vibration_enabled_default]);

  useEffect(()=>{
    window.localStorage.setItem("aviator:low-data",String(lowData));
    window.localStorage.setItem("aviator:sound",String(soundEnabled));
    window.localStorage.setItem("aviator:vibration",String(vibrationEnabled));
  },[lowData,soundEnabled,vibrationEnabled]);

  useEffect(()=>{
    const minutes=Number(game?.settings.reminder_minutes||30);
    const timer=window.setInterval(()=>{
      toast({title:"Responsible-play reminder",description:"Take a break, review your activity and only play within your limits."});
    },Math.max(5,minutes)*60*1000);
    return()=>window.clearInterval(timer);
  },[game?.settings.reminder_minutes,toast]);

  useEffect(()=>{
    if(game?.phase==="crashed"&&vibrationEnabled&&typeof navigator!=="undefined"&&"vibrate" in navigator){
      navigator.vibrate(80);
    }
  },[game?.phase,vibrationEnabled]);

  function changeStake(mode:"half"|"double"|"clear"|"max"){
    const current=Number(stake)||0;
    if(mode==="half")setStake(String(Math.max(Number(game?.settings.min_stake||1),current/2)));
    if(mode==="double")setStake(String(Math.min(Number(game?.settings.max_stake||1000),current*2)));
    if(mode==="clear")setStake("");
    if(mode==="max")setStake(String(Math.min(balance,Number(game?.settings.max_stake||1000))));
  }

  return <div className="min-h-screen bg-[#05080f] pb-14 text-white lg:pb-0">
    <Header user={user?{email:user.email||"",balance}:null} onAuthClick={()=>router.push("/auth/login")}/>
    <main className="container py-5">
      <div className="mx-auto max-w-[1380px] space-y-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-emerald-400 shadow-[0_0_35px_rgba(34,211,238,.28)]"><Plane className="h-6 w-6 text-slate-950"/></div>
            <div><h1 className="text-2xl font-black tracking-tight">MindBet Pro <span className="text-cyan-300">Aviator</span></h1><p className="text-xs text-slate-400">Live · provably fair · instant cash-out</p></div>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {(game?.history||[]).slice(0,10).map(round=><div key={round.round_number} className={"shrink-0 rounded-full border px-3 py-1.5 font-mono text-xs font-black "+(Number(round.crash_multiplier)>=10?"border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-300":Number(round.crash_multiplier)>=2?"border-cyan-400/40 bg-cyan-400/10 text-cyan-300":"border-rose-400/40 bg-rose-400/10 text-rose-300")}>{Number(round.crash_multiplier).toFixed(2)}x</div>)}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
          <section className="relative min-h-[540px] overflow-hidden rounded-[28px] border border-cyan-400/15 bg-[#07111f] shadow-[0_25px_80px_rgba(0,0,0,.45)]">
            <div className="absolute inset-0" style={{background:"radial-gradient(circle at 65% 35%, rgba(34,211,238,.15), transparent 30%), radial-gradient(circle at 25% 75%, rgba(16,185,129,.12), transparent 32%), linear-gradient(180deg,#09182b 0%,#060a12 75%)"}}/>
            <div className="absolute inset-0 opacity-25" style={{backgroundImage:"linear-gradient(rgba(56,189,248,.15) 1px,transparent 1px),linear-gradient(90deg,rgba(56,189,248,.15) 1px,transparent 1px)",backgroundSize:"42px 42px",transform:"perspective(500px) rotateX(62deg) scale(1.5)",transformOrigin:"bottom"}}/>
            <svg className="absolute bottom-6 left-4 h-[58%] w-[88%] overflow-visible opacity-80" viewBox="0 0 900 320" preserveAspectRatio="none">
              <defs><linearGradient id="flightLine" x1="0" x2="1"><stop offset="0%" stopColor="#10b981"/><stop offset="55%" stopColor="#22d3ee"/><stop offset="100%" stopColor="#a855f7"/></linearGradient></defs>
              <path d="M10 300 C 220 295, 360 250, 500 180 S 720 40, 890 18" fill="none" stroke="rgba(34,211,238,.08)" strokeWidth="24"/>
              <path d="M10 300 C 220 295, 360 250, 500 180 S 720 40, 890 18" fill="none" stroke="url(#flightLine)" strokeWidth="4" strokeDasharray="12 12">
                {game?.phase==="running"&&<animate attributeName="stroke-dashoffset" from="120" to="0" dur="1.2s" repeatCount="indefinite"/>}
              </path>
            </svg>

            <div className="relative z-10 flex min-h-[540px] flex-col">
              <div className="flex items-center justify-between p-5">
                <div className="flex items-center gap-2"><Badge className="border-0 bg-white/10 text-white backdrop-blur">Round #{game?.round?.round_number||"—"}</Badge><span className={"h-2 w-2 rounded-full "+(game?.phase==="running"?"animate-pulse bg-emerald-400":"bg-cyan-400")}/></div>
                <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-slate-300 backdrop-blur"><LockKeyhole className="h-3.5 w-3.5 text-emerald-300"/>Fairness locked</div>
              </div>

              <div className="flex flex-1 flex-col items-center justify-center px-5 text-center">
                <div className={"text-xs font-black tracking-[.38em] "+phaseColor}>{phaseLabel}</div>
                <div className={"mt-4 font-mono text-7xl font-black leading-none tracking-[-.06em] drop-shadow-[0_0_30px_rgba(34,211,238,.25)] sm:text-9xl "+(game?.phase==="crashed"?"text-rose-400":"text-white")}>{multiplier.toFixed(2)}<span className="ml-1 text-4xl sm:text-6xl">x</span></div>
                {game?.phase==="betting"&&<div className="mt-5 flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm text-cyan-100"><Timer className="h-4 w-4"/>Taking off in <b>{countdown.toFixed(1)}s</b></div>}
                {game?.phase==="crashed"&&<div className="mt-5 rounded-full border border-rose-400/20 bg-rose-400/10 px-4 py-2 text-sm font-bold text-rose-200">Next round in {countdown.toFixed(1)}s</div>}
                <div className={"mt-10 transition-all duration-700 "+planePosition}>
                  <div className="relative"><div className="absolute -inset-6 rounded-full bg-cyan-400/20 blur-2xl"/><Plane className="relative h-20 w-20 text-cyan-200 drop-shadow-[0_0_18px_rgba(34,211,238,.7)] sm:h-28 sm:w-28"/></div>
                </div>
              </div>

              <div className="m-4 flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/25 p-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                <div className="truncate font-mono text-[10px] text-slate-400">SHA-256: {game?.round?.server_seed_hash||"Waiting for round commitment…"}</div>
                <div className="shrink-0 text-[10px] text-emerald-300">Seed revealed after crash</div>
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <Card className="overflow-hidden border-white/10 bg-[#0b1220] text-white shadow-2xl">
              <div className="h-1 bg-gradient-to-r from-emerald-400 via-cyan-400 to-fuchsia-500"/>
              <CardContent className="space-y-5 p-5">
                <div className="flex items-center justify-between"><div><div className="text-xs text-slate-400">Available balance</div><div className="mt-1 font-mono text-2xl font-black">{"$"}{money(balance)}</div></div><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-400/10"><Wallet className="h-5 w-5 text-emerald-300"/></div></div>
                <div className="space-y-2"><div className="flex items-center justify-between"><label className="text-xs font-bold text-slate-300">Bet amount</label><span className="text-[10px] text-slate-500">USD</span></div><div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-500">$</span><Input type="number" value={stake} onChange={event=>setStake(event.target.value)} disabled={!canBet||busy} className="h-14 border-white/10 bg-black/25 pl-8 font-mono text-xl font-black text-white"/></div></div>
                {game?.settings.auto_cashout_enabled&&<div className="space-y-2"><div className="flex items-center justify-between"><label className="text-xs font-bold text-slate-300">Auto cash-out (optional)</label><span className="text-[10px] text-slate-500">{Number(game.settings.min_auto_cashout||1.1).toFixed(2)}x–{Number(game.settings.max_auto_cashout||game.settings.max_multiplier).toFixed(2)}x</span></div><div className="relative"><Input type="number" value={autoCashout} onChange={event=>setAutoCashout(event.target.value)} disabled={!canBet||busy} placeholder="e.g. 2.00" min={game.settings.min_auto_cashout||1.1} max={game.settings.max_auto_cashout||game.settings.max_multiplier} step=".01" className="h-12 border-white/10 bg-black/25 pr-9 font-mono text-lg font-black text-white"/><span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-cyan-300">x</span></div></div>}
                <div className="grid grid-cols-4 gap-2">{[5,10,25,50].map(amount=><button key={amount} onClick={()=>setStake(String(amount))} disabled={!canBet} className="rounded-xl border border-white/10 bg-white/5 py-2 text-xs font-bold text-slate-300 transition hover:border-cyan-300/40 hover:bg-cyan-300/10 disabled:opacity-40">{"$"}{amount}</button>)}</div>
                <div className="grid grid-cols-4 gap-2">{[["½","half"],["2×","double"],["MAX","max"],["CLR","clear"]].map(([label,mode])=><button key={mode} onClick={()=>changeStake(mode as "half"|"double"|"clear"|"max")} disabled={!canBet} className="rounded-xl bg-slate-800 py-2 text-[10px] font-black text-slate-300 hover:bg-slate-700 disabled:opacity-40">{label}</button>)}</div>

                {canCashout?<Button className="h-16 w-full bg-gradient-to-r from-emerald-400 to-cyan-400 text-lg font-black text-slate-950 shadow-[0_0_35px_rgba(16,185,129,.25)] hover:from-emerald-300 hover:to-cyan-300" onClick={()=>void cashout()} disabled={busy}>CASH OUT · {multiplier.toFixed(2)}x</Button>:<Button className="h-16 w-full bg-gradient-to-r from-cyan-400 to-blue-500 text-lg font-black text-slate-950 shadow-[0_0_35px_rgba(34,211,238,.2)] hover:from-cyan-300 hover:to-blue-400" onClick={()=>void placeBet()} disabled={!canBet||busy}>{user?"PLACE BET":"LOGIN TO BET"}</Button>}

                <div className="grid grid-cols-2 gap-2 text-[10px]"><div className="rounded-xl bg-white/5 p-3 text-slate-400">Min stake<div className="mt-1 font-mono font-bold text-white">{"$"}{money(Number(game?.settings.min_stake||0))}</div></div><div className="rounded-xl bg-white/5 p-3 text-slate-400">Max stake<div className="mt-1 font-mono font-bold text-white">{"$"}{money(Number(game?.settings.max_stake||0))}</div></div></div>

                {game?.my_bet&&<div className={"rounded-2xl border p-4 "+(game.my_bet.status==="cashed_out"?"border-emerald-400/30 bg-emerald-400/10":"border-cyan-400/20 bg-cyan-400/5")}><div className="flex items-center justify-between"><span className="text-sm font-bold">Your bet · {"$"}{money(Number(game.my_bet.stake))}</span><Badge variant="outline" className="border-white/20 text-white">{game.my_bet.status.replace("_"," ")}</Badge></div>{game.my_bet.auto_cashout_multiplier&&<div className="mt-2 text-xs text-cyan-200">Auto cash-out · {Number(game.my_bet.auto_cashout_multiplier).toFixed(2)}x</div>}{game.my_bet.status==="cashed_out"&&<div className="mt-2 font-mono text-lg font-black text-emerald-300">Won {"$"}{money(Number(game.my_bet.payout))}{game.my_bet.result_reason==="auto_cashout"&&<span className="ml-2 text-xs text-emerald-200">automatic</span>}</div>}</div>}
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-[#0b1220] text-white"><CardContent className="grid grid-cols-3 gap-2 p-4 text-center"><Stat icon={<Gauge className="h-4 w-4"/>} label="Max win" value={money(Number(game?.settings.max_payout||0))}/><Stat icon={<Zap className="h-4 w-4"/>} label="Live" value="400ms"/><Stat icon={<ShieldCheck className="h-4 w-4"/>} label="Edge" value={Number(game?.settings.house_edge_percent||0).toFixed(1)+"%"}/></CardContent></Card>
            <Card className="border-white/10 bg-[#0b1220] text-white"><CardContent className="space-y-3 p-4"><div className="text-xs font-bold text-slate-300">Player experience</div><div className="grid grid-cols-3 gap-2"><button onClick={()=>setLowData(value=>!value)} className={"rounded-xl border p-3 text-[10px] font-bold "+(lowData?"border-cyan-400/40 bg-cyan-400/10 text-cyan-200":"border-white/10 bg-white/5 text-slate-400")}><WifiOff className="mx-auto mb-1 h-4 w-4"/>Low data</button><button onClick={()=>setSoundEnabled(value=>!value)} className={"rounded-xl border p-3 text-[10px] font-bold "+(soundEnabled?"border-cyan-400/40 bg-cyan-400/10 text-cyan-200":"border-white/10 bg-white/5 text-slate-400")}>{soundEnabled?<Volume2 className="mx-auto mb-1 h-4 w-4"/>:<VolumeX className="mx-auto mb-1 h-4 w-4"/>}Sound</button><button onClick={()=>setVibrationEnabled(value=>!value)} className={"rounded-xl border p-3 text-[10px] font-bold "+(vibrationEnabled?"border-cyan-400/40 bg-cyan-400/10 text-cyan-200":"border-white/10 bg-white/5 text-slate-400")}><Zap className="mx-auto mb-1 h-4 w-4"/>Vibration</button></div></CardContent></Card>
          </aside>
        </div>

        <Card className="border-white/10 bg-[#0b1220] text-white">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center gap-2"><History className="h-5 w-5 text-cyan-300"/><h2 className="font-bold">Provably-fair round history</h2></div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{(game?.history||[]).map(round=><div key={round.round_number} className="rounded-2xl border border-white/10 bg-white/[.025] p-4"><div className="flex items-center justify-between"><span className="text-xs text-slate-400">Round #{round.round_number}</span><span className={"font-mono text-lg font-black "+(Number(round.crash_multiplier)>=2?"text-cyan-300":"text-rose-300")}>{Number(round.crash_multiplier).toFixed(2)}x</span></div><div className="mt-3 truncate font-mono text-[10px] text-slate-500">Seed: {round.server_seed_reveal}</div><div className="mt-1 truncate font-mono text-[10px] text-slate-600">Hash: {round.server_seed_hash}</div></div>)}</div>
          </CardContent>
        </Card>
      </div>
    </main>
    <Footer/><MobileBottomNav/>
  </div>;
}

function Stat({icon,label,value}:{icon:React.ReactNode;label:string;value:string}){
  return <div className="rounded-xl bg-white/5 p-3"><div className="mx-auto flex w-fit text-cyan-300">{icon}</div><div className="mt-2 text-[9px] uppercase tracking-wider text-slate-500">{label}</div><div className="mt-1 text-xs font-black">{value}</div></div>;
}
