import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Bomb, CheckCircle2, Gem, LockKeyhole, RotateCcw, ShieldCheck, Sparkles, Wallet } from "lucide-react";
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

type MinesGame = {
  id:string; stake:number; mine_count:number; revealed_cells:number[]; mine_positions:number[];
  current_multiplier:number; potential_payout:number; payout:number;
  status:"active"|"lost"|"cashed_out"; server_seed_hash:string; server_seed:string|null;
  client_seed:string; created_at:string; completed_at:string|null;
};
type MinesState = {
  game:MinesGame|null;
  settings:{min_stake:number;max_stake:number;min_mines:number;max_mines:number;max_payout:number};
};

const money=(value:number)=>new Intl.NumberFormat("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}).format(value);

export default function MinesPage(){
  const router=useRouter();
  const {toast}=useToast();
  const [user,setUser]=useState<{id:string;email?:string}|null>(null);
  const [state,setState]=useState<MinesState|null>(null);
  const [balance,setBalance]=useState(0);
  const [stake,setStake]=useState("10");
  const [mineCount,setMineCount]=useState(3);
  const [clientSeed,setClientSeed]=useState("");
  const [busy,setBusy]=useState(false);
  const [verification,setVerification]=useState<"valid"|"invalid"|null>(null);

  const loadBalance=useCallback(async()=>{
    const result=await getMyWalletBalances();
    setBalance(Number(result.balances?.available||0));
  },[]);

  const loadState=useCallback(async()=>{
    const {data,error}=await (supabase as any).rpc("mines_get_state",{});
    if(!error&&data)setState(data as MinesState);
  },[]);

  useEffect(()=>{
    setClientSeed(globalThis.crypto?.randomUUID?.()||`mindbet-${Date.now()}`);
    void supabase.auth.getUser().then(({data})=>{
      const current=data.user?{id:data.user.id,email:data.user.email}:null;
      setUser(current);
      if(current){void loadBalance();void loadState();}
    });
  },[loadBalance,loadState]);

  const game=state?.game;
  const active=game?.status==="active";
  const revealed=useMemo(()=>new Set(game?.revealed_cells||[]),[game?.revealed_cells]);
  const mines=useMemo(()=>new Set(game?.mine_positions||[]),[game?.mine_positions]);

  async function startGame(){
    if(!user){await router.push("/auth/login?returnTo=/casino/mines");return;}
    const amount=Number(stake);
    if(!Number.isFinite(amount)||amount<1||amount>500){
      toast({title:"Invalid stake",description:"Stake must be between $1 and $500.",variant:"destructive"});return;
    }
    setBusy(true);setVerification(null);
    const {data,error}=await (supabase as any).rpc("mines_start",{
      p_stake:amount,p_mine_count:mineCount,p_client_seed:clientSeed,p_idempotency_key:globalThis.crypto.randomUUID(),
    });
    if(error)toast({title:"Round not started",description:error.message,variant:"destructive"});
    else{setState(data as MinesState);toast({title:"Mines round started",description:"The mine layout is hash-committed and locked."});await loadBalance();}
    setBusy(false);
  }

  async function pickCell(cell:number){
    if(!active||busy||revealed.has(cell))return;
    setBusy(true);
    const {data,error}=await (supabase as any).rpc("mines_pick",{p_cell:cell});
    if(error)toast({title:"Tile not opened",description:error.message,variant:"destructive"});
    else{
      const next=data as MinesState;setState(next);
      if(next.game?.status==="lost")toast({title:"Mine hit",description:"The server seed is now available for verification.",variant:"destructive"});
      if(next.game?.status==="cashed_out")toast({title:"Board cleared",description:`$${money(next.game.payout)} credited.`});
      await loadBalance();
    }
    setBusy(false);
  }

  async function cashOut(){
    if(!active||busy||!game?.revealed_cells.length)return;
    setBusy(true);
    const {data,error}=await (supabase as any).rpc("mines_cashout",{});
    if(error)toast({title:"Cash-out failed",description:error.message,variant:"destructive"});
    else{
      const next=data as MinesState;setState(next);
      toast({title:"Cash-out complete",description:`$${money(next.game?.payout||0)} credited to your wallet.`});
      await loadBalance();
    }
    setBusy(false);
  }

  async function verifyRound(){
    if(!game?.server_seed)return;
    const encoder=new TextEncoder();
    const seedDigest=await crypto.subtle.digest("SHA-256",encoder.encode(game.server_seed));
    const seedHash=Array.from(new Uint8Array(seedDigest)).map((byte)=>byte.toString(16).padStart(2,"0")).join("");
    const derived:number[]=[];let counter=0;
    while(derived.length<game.mine_count){
      const digest=await crypto.subtle.digest("SHA-256",encoder.encode(`${game.server_seed}:${game.client_seed}:${counter}`));
      const candidate=new DataView(digest).getUint32(0,false)%25;
      if(!derived.includes(candidate))derived.push(candidate);
      counter+=1;
    }
    const same=[...derived].sort((a,b)=>a-b).join(",")===[...game.mine_positions].sort((a,b)=>a-b).join(",");
    setVerification(seedHash===game.server_seed_hash&&same?"valid":"invalid");
  }

  function newRound(){
    setState((current)=>current?{...current,game:null}:current);
    setClientSeed(globalThis.crypto?.randomUUID?.()||`mindbet-${Date.now()}`);
    setVerification(null);
  }

  return <div className="min-h-screen bg-[#050b12] pb-14 text-slate-100 lg:pb-0">
    <Header user={user?{email:user.email||"",balance}:null} onAuthClick={()=>void router.push("/auth/login?returnTo=/casino/mines")}/>
    <main className="container py-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <section className="relative overflow-hidden rounded-3xl border border-cyan-400/20 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,.17),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,.15),transparent_38%),#07111d] p-5 shadow-[0_25px_80px_rgba(0,0,0,.35)] sm:p-7">
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-300 to-emerald-400 shadow-[0_0_35px_rgba(34,211,238,.3)]"><Bomb className="h-8 w-8 text-slate-950"/></div>
              <div><div className="flex flex-wrap items-center gap-2"><h1 className="text-3xl font-black tracking-tight">MindBet Mines</h1><Badge className="bg-emerald-400/15 text-emerald-300">Provably Fair</Badge></div><p className="mt-1 text-sm text-slate-400">Reveal gems, avoid mines and cash out whenever you choose.</p></div>
            </div>
            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-5 py-3 text-right"><div className="text-xs font-bold uppercase tracking-[.18em] text-slate-400">Funded balance</div><div className="mt-1 flex items-center justify-end gap-2 font-mono text-2xl font-black text-emerald-300"><Wallet className="h-5 w-5"/>$${money(balance)}</div></div>
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <Card className="border-slate-700/70 bg-[#0a1624] text-slate-100"><CardContent className="space-y-5 p-5">
            <div><label className="text-xs font-bold uppercase tracking-[.16em] text-slate-400">Stake (USD)</label><Input className="mt-2 border-slate-700 bg-[#07111d] font-mono text-lg" type="number" min="1" max="500" step="0.01" value={stake} disabled={active} onChange={(event)=>setStake(event.target.value)}/><div className="mt-2 grid grid-cols-4 gap-2">{[5,10,25,50].map((amount)=><button key={amount} disabled={active} onClick={()=>setStake(String(amount))} className="rounded-lg border border-slate-700 bg-slate-800/60 py-2 text-xs font-bold hover:border-cyan-400/50 disabled:opacity-50">$${amount}</button>)}</div></div>
            <div><label className="text-xs font-bold uppercase tracking-[.16em] text-slate-400">Mines</label><div className="mt-2 grid grid-cols-4 gap-2">{[3,5,7,10].map((count)=><button key={count} disabled={active} onClick={()=>setMineCount(count)} className={`rounded-xl border py-3 font-mono font-black transition ${mineCount===count?"border-cyan-300 bg-cyan-300/15 text-cyan-200":"border-slate-700 bg-slate-800/60 hover:border-cyan-400/40"} disabled:opacity-50`}>{count}</button>)}</div></div>
            <div className="grid grid-cols-2 gap-3"><div className="rounded-xl border border-slate-700 bg-[#07111d] p-3"><div className="text-[10px] font-bold uppercase tracking-[.15em] text-slate-500">Multiplier</div><div className="mt-1 font-mono text-xl font-black text-cyan-300">{Number(game?.current_multiplier||1).toFixed(2)}x</div></div><div className="rounded-xl border border-slate-700 bg-[#07111d] p-3"><div className="text-[10px] font-bold uppercase tracking-[.15em] text-slate-500">Cash-out</div><div className="mt-1 font-mono text-xl font-black text-emerald-300">$${money(game?.potential_payout||Number(stake||0))}</div></div></div>
            {!active?<Button className="h-12 w-full bg-gradient-to-r from-cyan-400 to-emerald-400 text-base font-black text-slate-950" disabled={busy} onClick={()=>void startGame()}><Sparkles className="mr-2 h-5 w-5"/>{busy?"Starting...":game?"Start New Round":"Start Game"}</Button>:<Button className="h-12 w-full bg-emerald-400 text-base font-black text-slate-950" disabled={busy||!game.revealed_cells.length} onClick={()=>void cashOut()}>{busy?"Processing...":`Cash Out $${money(game.potential_payout)}`}</Button>}
            {game&&!active&&<Button variant="outline" className="w-full border-slate-700 bg-transparent" onClick={newRound}><RotateCcw className="mr-2 h-4 w-4"/>Reset Board</Button>}
            <p className="text-xs leading-relaxed text-slate-500"><LockKeyhole className="mr-1 inline h-3.5 w-3.5"/>KYC/account controls and wallet limits apply before every funded round.</p>
          </CardContent></Card>

          <Card className="overflow-hidden border-slate-700/70 bg-[#081421] text-slate-100"><CardContent className="p-4 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3"><div><div className="text-sm font-bold">{active?"Round active":game?.status==="lost"?"Mine revealed":game?.status==="cashed_out"?"Cashed out":"Choose your setup"}</div><div className="text-xs text-slate-500">{active?`${game.revealed_cells.length} safe tiles opened`:"The layout is generated and committed on the server."}</div></div>{game&&<Badge variant="outline" className={game.status==="lost"?"border-rose-400/40 text-rose-300":game.status==="cashed_out"?"border-emerald-400/40 text-emerald-300":"border-cyan-400/40 text-cyan-300"}>{game.status.replace("_"," ")}</Badge>}</div>
            <div className="mx-auto grid max-w-2xl grid-cols-5 gap-2 sm:gap-3">{Array.from({length:25},(_,cell)=>{
              const isRevealed=revealed.has(cell);const isMine=!active&&mines.has(cell);
              return <button key={cell} disabled={!active||busy||isRevealed} onClick={()=>void pickCell(cell)} className={`group aspect-square rounded-xl border transition-all sm:rounded-2xl ${isMine?"border-rose-400/50 bg-rose-500/15":isRevealed?"border-emerald-300/50 bg-emerald-400/15":"border-slate-700 bg-gradient-to-br from-slate-800 to-slate-900 hover:border-cyan-300/60"} disabled:cursor-default`}>{isMine?<Bomb className="mx-auto h-7 w-7 text-rose-300 sm:h-9 sm:w-9"/>:isRevealed?<Gem className="mx-auto h-7 w-7 text-emerald-300 sm:h-9 sm:w-9"/>:<span className="font-mono text-xs text-slate-600">{cell+1}</span>}</button>;
            })}</div>
            {game&&<div className="mt-5 rounded-2xl border border-slate-700 bg-[#050d17] p-4"><div className="mb-2 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-cyan-300"/><span className="text-sm font-bold">Provably-fair verification</span></div><div className="space-y-2 font-mono text-[10px] text-slate-500"><div><span className="text-slate-400">Commitment:</span> <span className="break-all">{game.server_seed_hash}</span></div><div><span className="text-slate-400">Client seed:</span> <span className="break-all">{game.client_seed}</span></div>{game.server_seed&&<div><span className="text-slate-400">Server seed:</span> <span className="break-all">{game.server_seed}</span></div>}</div>{game.server_seed&&<div className="mt-3 flex flex-wrap items-center gap-3"><Button size="sm" variant="outline" className="border-slate-700" onClick={()=>void verifyRound()}>Verify round</Button>{verification==="valid"&&<span className="flex items-center gap-1 text-xs font-bold text-emerald-300"><CheckCircle2 className="h-4 w-4"/>Hash and mine layout verified</span>}{verification==="invalid"&&<span className="text-xs font-bold text-rose-300">Verification failed</span>}</div>}</div>}
          </CardContent></Card>
        </div>
      </div>
    </main>
    <Footer/><MobileBottomNav/>
  </div>;
}
