import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import type { User } from "@supabase/supabase-js";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Gift, LockKeyhole, Star, Trophy, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";

type Promotion = Tables<"promotions">;
type UserBonus = Tables<"user_bonuses">;
type LoyaltyAccount = Tables<"loyalty_accounts">;

export default function PromotionsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [balance, setBalance] = useState(0);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [bonuses, setBonuses] = useState<UserBonus[]>([]);
  const [loyalty, setLoyalty] = useState<LoyaltyAccount | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPage = useCallback(async () => {
    setLoading(true);
    const now = new Date().toISOString();
    const [{ data: authData }, promotionResult] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("promotions").select("*").eq("is_active", true)
        .lte("valid_from", now).gte("valid_until", now).order("valid_until", { ascending: true }),
    ]);
    setPromotions(promotionResult.data ?? []);
    const currentUser = authData.user;
    setUser(currentUser);
    if (currentUser) {
      const [profileResult, bonusResult, loyaltyResult] = await Promise.all([
        supabase.from("profiles").select("demo_balance").eq("id", currentUser.id).single(),
        supabase.from("user_bonuses").select("*").eq("user_id", currentUser.id).order("awarded_at", { ascending: false }),
        supabase.from("loyalty_accounts").select("*").eq("user_id", currentUser.id).maybeSingle(),
      ]);
      setBalance(profileResult.data?.demo_balance ?? 0);
      setBonuses(bonusResult.data ?? []);
      setLoyalty(loyaltyResult.data);
    } else {
      setBalance(0); setBonuses([]); setLoyalty(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadPage(); }, [loadPage]);

  const claimCounts = useMemo(() => bonuses.reduce<Record<string, number>>((counts, bonus) => {
    if (bonus.promotion_id) counts[bonus.promotion_id] = (counts[bonus.promotion_id] ?? 0) + 1;
    return counts;
  }, {}), [bonuses]);

  async function claimPromotion(promotion: Promotion) {
    if (!user) { await router.push("/auth/login?returnTo=/promotions"); return; }
    setClaimingId(promotion.id);
    const { data, error } = await supabase.rpc("claim_promotion", {
      p_promotion_id: promotion.id,
      p_promo_code: codes[promotion.id]?.trim() || null,
    });
    if (error) {
      toast({ title: "Promotion not claimed", description: error.message, variant: "destructive" });
    } else {
      const result = data as { amount?: number } | null;
      toast({ title: "Bonus claimed", description: `$${Number(result?.amount ?? 0).toFixed(2)} demo bonus added.` });
      await loadPage();
    }
    setClaimingId(null);
  }

  return (
    <div className="min-h-screen flex flex-col bg-background pb-14 lg:pb-0">
      <Header user={user ? { email: user.email ?? "", balance } : null} onAuthClick={() => void router.push("/auth/login")} />
      <main className="flex-1 container py-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div><div className="flex items-center gap-3"><Gift className="h-6 w-6 text-primary" /><h1 className="text-2xl font-bold">Promotions & VIP</h1></div><p className="mt-1 text-sm text-muted-foreground">Claim demo offers and track wagering progress.</p></div>
            {user && <Card className="surface min-w-64"><CardContent className="flex items-center justify-between p-4"><div><p className="text-xs text-muted-foreground">VIP tier</p><p className="font-bold capitalize">{loyalty?.tier ?? "bronze"}</p></div><div className="text-right"><p className="text-xs text-muted-foreground">Points</p><p className="font-mono font-bold">{(loyalty?.points ?? 0).toLocaleString()}</p></div></CardContent></Card>}
          </div>

          {bonuses.some((bonus) => bonus.status === "active") && <Card className="surface"><CardHeader><CardTitle className="text-lg flex items-center gap-2"><Trophy className="h-5 w-5 text-gold" />Active bonuses</CardTitle></CardHeader><CardContent className="space-y-4">
            {bonuses.filter((bonus) => bonus.status === "active").map((bonus) => {
              const required = Number(bonus.wagering_requirement || 0); const completed = Number(bonus.wagering_completed || 0); const percent = required > 0 ? Math.min(100, completed / required * 100) : 100;
              return <div key={bonus.id} className="space-y-2 rounded border border-border p-3"><div className="flex justify-between gap-3 text-sm"><span className="font-medium">${Number(bonus.remaining_amount).toFixed(2)} bonus remaining</span><span className="text-muted-foreground">{percent.toFixed(0)}%</span></div><Progress value={percent} /><div className="flex justify-between text-xs text-muted-foreground"><span>Wagered ${completed.toFixed(2)} / ${required.toFixed(2)}</span><span>Expires {bonus.expires_at ? new Date(bonus.expires_at).toLocaleDateString() : "Never"}</span></div></div>;
            })}
          </CardContent></Card>}

          <div className="grid gap-4 md:grid-cols-2">
            {loading ? <Card className="surface md:col-span-2"><CardContent className="py-12 text-center text-sm text-muted-foreground">Loading promotions...</CardContent></Card> : promotions.length === 0 ? <Card className="surface md:col-span-2"><CardContent className="py-12 text-center text-sm text-muted-foreground">No active promotions are available.</CardContent></Card> : promotions.map((promotion) => {
              const claimed = claimCounts[promotion.id] ?? 0; const claimLimitReached = claimed >= promotion.per_user_claim_limit; const depositOnly = promotion.requires_qualifying_deposit || ["deposit_bonus", "cashback"].includes(promotion.type);
              return <Card key={promotion.id} className="surface flex flex-col"><CardHeader><div className="flex items-start justify-between gap-3"><CardTitle className="text-lg">{promotion.title}</CardTitle><Badge className="badge-featured">{promotion.type.replaceAll("_", " ")}</Badge></div></CardHeader><CardContent className="flex flex-1 flex-col gap-4">
                <p className="text-sm text-muted-foreground">{promotion.description || "Demo promotion"}</p>
                <div className="grid grid-cols-2 gap-2 text-xs"><div className="rounded bg-muted/40 p-2"><span className="block text-muted-foreground">Bonus</span><strong>${Number(promotion.bonus_amount || 0).toFixed(2)}</strong></div><div className="rounded bg-muted/40 p-2"><span className="block text-muted-foreground">Wagering</span><strong>{Number(promotion.wagering_requirement || 0)}x</strong></div><div className="rounded bg-muted/40 p-2"><span className="block text-muted-foreground">Minimum odds</span><strong>{Number(promotion.min_odds).toFixed(2)}</strong></div><div className="rounded bg-muted/40 p-2"><span className="block text-muted-foreground">Expires after</span><strong>{promotion.expires_after_days} days</strong></div></div>
                {promotion.promo_code && !claimLimitReached && !depositOnly && <Input value={codes[promotion.id] ?? ""} onChange={(event) => setCodes((current) => ({ ...current, [promotion.id]: event.target.value }))} placeholder="Enter promo code" autoComplete="off" />}
                <div className="mt-auto">{depositOnly ? <Button className="w-full gap-2" variant="outline" disabled><LockKeyhole className="h-4 w-4" />Unavailable until payments launch</Button> : claimLimitReached ? <Button className="w-full gap-2" variant="outline" disabled><Star className="h-4 w-4" />Claim limit reached</Button> : <Button className="w-full gap-2" disabled={claimingId === promotion.id} onClick={() => void claimPromotion(promotion)}><Zap className="h-4 w-4" />{claimingId === promotion.id ? "Claiming..." : user ? "Claim bonus" : "Sign in to claim"}</Button>}</div>
              </CardContent></Card>;
            })}
          </div>
          <p className="text-xs text-center text-muted-foreground">All balances and rewards are play-money demo credits. No cash value.</p>
        </div>
      </main>
      <Footer /><MobileBottomNav />
    </div>
  );
}
