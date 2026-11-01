import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Plane, ShieldCheck, Timer } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { getMyWalletBalances } from "@/services/walletService";
import { useToast } from "@/hooks/use-toast";

type GameState = {
  phase: "betting" | "running" | "crashed" | "paused";
  current_multiplier: number;
  settings: { min_stake:number; max_stake:number; max_payout:number; is_paused:boolean };
  round: null | { id:string; round_number:number; server_seed_hash:string; server_seed_reveal:string|null; crash_multiplier:number|null; betting_closes_at:string; next_round_at:string };
  my_bet: null | { id:string; stake:number; status:string; cashout_multiplier:number|null; payout:number };
  history: Array<{ round_number:number; crash_multiplier:number; server_seed_hash:string; server_seed_reveal:string }>;
};

export default function AviatorPage() {
  const router=useRouter();
  const { toast }=useToast();
  const [game,setGame]=useState<GameState|null>(null);
  const [user,setUser]=useState<{id:string;email?:string}|null>(null);
  const [balance,setBalance]=useState(0);
  const [stake,setStake]=useState("10");
  const [busy,setBusy]=useState(false);
  const [now,setNow]=useState(Date.now());

  const loadBalance=useCallback(async()=>{
    const result=await getMyWalletBalances();
    setBalance(Number(result.balances?.available ?? result.balances?.cash ?? 0));
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
    const gameTimer=window.setInterval(()=>void loadGame(),500);
    const clockTimer=window.setInterval(()=>setNow(Date.now()),100);
    void loadGame();
    return()=>{window.clearInterval(gameTimer);window.clearInterval(clockTimer);};
  },[loadBalance,loadGame]);

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
    const {data,error}=await (supabase as any).rpc("aviator_place_bet",{p_stake:amount});
    if(error)toast({title:"Bet not placed",description:error.message,variant:"destructive"});
    else{setGame(data as GameState);toast({title:"Aviator bet placed"});await loadBalance();}
    setBusy(false);
  }

  async function cashout(){
    setBusy(true);
    const {data,error}=await (supabase as any).rpc("aviator_cashout");
    if(error)toast({title:"Cash-out failed",description:error.message,variant:"destructive"});
    else{setGame(data as GameState);toast({title:"Cash-out completed"});await loadBalance();}
    setBusy(false);
  }

  const multiplier=Number(game?.current_multiplier||1);
  const activeBet=game?.my_bet?.status==="placed";
  const canBet=game?.phase==="betting"&&!game.my_bet;
  const canCashout=game?.phase==="running"&&activeBet;
  const phaseLabel=game?.phase==="betting"?"BETTING OPEN":game?.phase==="running"?"FLYING":game?.phase==="crashed"?"FLEW AWAY":"PAUSED";

  return <div className="min-h-screen bg-background pb-14 lg:pb-0">
    <Header user={user?{email:user.email||"",balance}:null} onAuthClick={()=>router.push("/auth/login")}/>
    <main className="container py-6"><div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div><h1 className="text-3xl font-black">Aviator</h1><p className="text-sm text-muted-foreground">Provably-fair live crash game</p></div>
        <Badge variant="outline">Round #{game?.round?.round_number||"—"}</Badge>
      </div>

      <Card className="overflow-hidden border-primary/20"><CardContent className="relative min-h-[420px] bg-gradient-to-b from-sky-950 via-slate-950 to-background p-0">
        <div className="flex min-h-[420px] flex-col items-center justify-center p-4 text-center">
          <div className="text-xs font-bold tracking-[.3em] text-primary">{phaseLabel}</div>
          <div className={"mt-3 font-mono text-7xl font-black sm:text-8xl "+(game?.phase==="crashed"?"text-danger":"text-white")}>{multiplier.toFixed(2)}x</div>
          {game?.phase==="betting"&&<div className="mt-4 flex items-center gap-2 text-muted-foreground"><Timer className="h-5 w-5"/>Starts in {countdown.toFixed(1)}s</div>}
          <Plane className={"mt-8 h-16 w-16 text-primary transition-transform duration-500 "+(game?.phase==="running"?"translate-x-24 -translate-y-12 rotate-[-12deg]":"")}/>
          {game?.round&&<div className="mt-6 max-w-xl break-all text-[10px] text-slate-400">Commitment: {game.round.server_seed_hash}</div>}
        </div>
      </CardContent></Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card><CardHeader><CardTitle>Place bet</CardTitle></CardHeader><CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Input type="number" value={stake} onChange={event=>setStake(event.target.value)} disabled={!canBet||busy}/>
            {canCashout?<Button size="lg" className="bg-success" onClick={()=>void cashout()} disabled={busy}>Cash out @ {multiplier.toFixed(2)}x</Button>:<Button size="lg" onClick={()=>void placeBet()} disabled={!canBet||busy}>{user?"Place Bet":"Login to Bet"}</Button>}
          </div>
          <div className="grid grid-cols-4 gap-2">{[5,10,25,50].map(amount=><Button key={amount} variant="outline" size="sm" onClick={()=>setStake(String(amount))} disabled={!canBet}>\${amount}</Button>)}</div>
          <p className="text-xs text-muted-foreground">Limits: \${Number(game?.settings.min_stake||0).toFixed(2)} – \${Number(game?.settings.max_stake||0).toFixed(2)}</p>
          {game?.my_bet&&<div className="rounded border p-3">My bet: \${Number(game.my_bet.stake).toFixed(2)} · <b>{game.my_bet.status}</b>{game.my_bet.status==="cashed_out"&&<div className="text-success">Won \${Number(game.my_bet.payout).toFixed(2)}</div>}</div>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Live wallet</CardTitle></CardHeader><CardContent><div className="font-mono text-3xl font-black">\${balance.toFixed(2)}</div></CardContent></Card>
      </div>

      <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary"/>Provably-fair history</CardTitle></CardHeader><CardContent>
        <div className="grid gap-2 md:grid-cols-2">{(game?.history||[]).map(round=><div key={round.round_number} className="rounded border p-3 text-xs">
          <div className="flex justify-between"><b>Round #{round.round_number}</b><Badge>{Number(round.crash_multiplier).toFixed(2)}x</Badge></div>
          <div className="mt-2 break-all text-muted-foreground">Seed: {round.server_seed_reveal}</div>
          <div className="mt-1 break-all text-muted-foreground">Hash: {round.server_seed_hash}</div>
        </div>)}</div>
      </CardContent></Card>
    </div></main>
    <Footer/><MobileBottomNav/>
  </div>;
}
