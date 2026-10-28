import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Calendar, Gift, Pencil, Percent, Plus, RefreshCw } from "lucide-react";
import { canAccessAdminArea } from "@/lib/adminRoles";
import { useToast } from "@/hooks/use-toast";

interface PromotionView { id: string; title: string; description: string | null; type: string; active: boolean; startDate: string; endDate: string; claimed: number; bonusAmount: number; wagering: number; promoCode: string | null; minOdds: number; expiryDays: number; }
const emptyForm = { title: "", description: "", type: "welcome_bonus", bonusAmount: "100", wagering: "5", promoCode: "", minOdds: "1.50", expiryDays: "30" };

export default function AdminPromotions() {
  const router = useRouter();
  const { toast } = useToast();
  const [promotions, setPromotions] = useState<PromotionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const loadPromotions = useCallback(async () => {
    setLoading(true);
    const [promotionResult, claimsResult] = await Promise.all([
      supabase.from("promotions").select("id, title, description, type, is_active, valid_from, valid_until, bonus_amount, wagering_requirement, promo_code, min_odds, expires_after_days").order("valid_from", { ascending: false }),
      supabase.from("user_bonuses").select("id, promotion_id"),
    ]);
    const error = promotionResult.error || claimsResult.error;
    if (error) { toast({ title: "Promotions load failed", description: error.message, variant: "destructive" }); setLoading(false); return; }
    const claims = claimsResult.data ?? [];
    setPromotions((promotionResult.data ?? []).map((promo) => ({ id: promo.id, title: promo.title, description: promo.description, type: promo.type, active: promo.is_active ?? false, startDate: promo.valid_from, endDate: promo.valid_until, claimed: claims.filter((claim) => claim.promotion_id === promo.id).length, bonusAmount: promo.bonus_amount ?? 0, wagering: promo.wagering_requirement ?? 0, promoCode: promo.promo_code, minOdds: promo.min_odds, expiryDays: promo.expires_after_days })));
    setLoading(false);
  }, [toast]);

  const initialize = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { await router.push("/auth/login"); return; }
    const { data: profile } = await supabase.from("profiles").select("admin_role").eq("id", user.id).single();
    if (!profile || !canAccessAdminArea(profile.admin_role, "promotions")) { await router.push("/"); return; }
    await loadPromotions();
  }, [loadPromotions, router]);

  useEffect(() => { void initialize(); }, [initialize]);

  async function adminFetch(url: string, init?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Admin session expired");
    const response = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}`, ...(init?.headers || {}) },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Promotion request failed");
    return body;
  }

  async function togglePromotion(promo: PromotionView) {
    setProcessingId(promo.id);
    try {
      await adminFetch("/api/admin/promotions", { method: "PATCH", body: JSON.stringify({ id: promo.id, is_active: !promo.active }) });
      setPromotions((current) => current.map((item) => item.id === promo.id ? { ...item, active: !item.active } : item));
      toast({ title: promo.active ? "Promotion disabled" : "Promotion activated" });
    } catch (error) {
      toast({ title: "Update failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
    setProcessingId(null);
  }

  function editPromotion(promo: PromotionView) {
    setEditingId(promo.id);
    setForm({ title: promo.title, description: promo.description ?? "", type: promo.type, bonusAmount: String(promo.bonusAmount), wagering: String(promo.wagering), promoCode: promo.promoCode ?? "", minOdds: String(promo.minOdds), expiryDays: String(promo.expiryDays) });
  }

  async function savePromotion() {
    if (!form.title.trim() || Number(form.bonusAmount) <= 0) { toast({ title: "Title and positive bonus amount are required", variant: "destructive" }); return; }
    setProcessingId(editingId ?? "new");
    const values = { title: form.title.trim(), description: form.description.trim() || null, type: form.type, bonus_amount: Number(form.bonusAmount), wagering_requirement: Number(form.wagering), promo_code: form.promoCode.trim() || null, min_odds: Number(form.minOdds), expires_after_days: Number(form.expiryDays), is_active: true };
    try {
      await adminFetch("/api/admin/promotions", { method: editingId ? "PATCH" : "POST", body: JSON.stringify(editingId ? { id: editingId, ...values } : values) });
      toast({ title: editingId ? "Promotion updated" : "Promotion created" });
      setEditingId(null);
      setForm(emptyForm);
      await loadPromotions();
    } catch (error) {
      toast({ title: "Promotion save failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
    setProcessingId(null);
  }

  return (
    <AdminLayout><div className="space-y-6">
      <div className="flex items-center justify-between gap-4"><div><h1 className="text-2xl font-bold">Promotions & Bonuses</h1><p className="text-sm text-muted-foreground">Manage database-backed offers and claim totals</p></div><Button variant="outline" className="gap-2" onClick={() => void loadPromotions()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button></div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="surface"><CardContent className="p-4 flex items-center gap-3"><Gift className="h-8 w-8 text-primary" /><div><div className="text-2xl font-bold">{promotions.length}</div><div className="text-xs text-muted-foreground">Total Promotions</div></div></CardContent></Card>
        <Card className="surface"><CardContent className="p-4 flex items-center gap-3"><Percent className="h-8 w-8 text-success" /><div><div className="text-2xl font-bold">{promotions.filter((p) => p.active).length}</div><div className="text-xs text-muted-foreground">Active Promos</div></div></CardContent></Card>
        <Card className="surface"><CardContent className="p-4 flex items-center gap-3"><Gift className="h-8 w-8 text-gold" /><div><div className="text-2xl font-bold">{promotions.reduce((sum, p) => sum + p.claimed, 0).toLocaleString()}</div><div className="text-xs text-muted-foreground">Total Claims</div></div></CardContent></Card>
      </div>
      <Card className="surface"><CardHeader><CardTitle className="flex items-center gap-2 text-lg">{editingId ? <Pencil className="h-5 w-5" /> : <Plus className="h-5 w-5" />}{editingId ? "Edit promotion" : "Create promotion"}</CardTitle></CardHeader><CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2"><Input placeholder="Promotion title" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /><Input placeholder="Description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
          <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}><option value="welcome_bonus">Welcome bonus</option><option value="free_bet">Free bet</option><option value="referral">Referral</option><option value="deposit_bonus">Deposit bonus</option><option value="cashback">Cashback</option></select>
          <Input placeholder="Promo code (optional)" value={form.promoCode} onChange={(event) => setForm((current) => ({ ...current, promoCode: event.target.value.toUpperCase() }))} />
          <Input type="number" min="0.01" step="0.01" placeholder="Bonus amount" value={form.bonusAmount} onChange={(event) => setForm((current) => ({ ...current, bonusAmount: event.target.value }))} /><Input type="number" min="0" step="1" placeholder="Wagering multiplier" value={form.wagering} onChange={(event) => setForm((current) => ({ ...current, wagering: event.target.value }))} />
          <Input type="number" min="1" step="0.01" placeholder="Minimum odds" value={form.minOdds} onChange={(event) => setForm((current) => ({ ...current, minOdds: event.target.value }))} /><Input type="number" min="1" max="365" step="1" placeholder="Expiry days" value={form.expiryDays} onChange={(event) => setForm((current) => ({ ...current, expiryDays: event.target.value }))} /></div>
        <div className="flex gap-2"><Button onClick={() => void savePromotion()} disabled={processingId === (editingId ?? "new")}>{processingId === (editingId ?? "new") ? "Saving…" : editingId ? "Save changes" : "Create promotion"}</Button>{editingId && <Button variant="outline" onClick={() => { setEditingId(null); setForm(emptyForm); }}>Cancel</Button>}</div>
      </CardContent></Card>
      <Card className="surface"><CardHeader><CardTitle>All Promotions</CardTitle></CardHeader><CardContent>
        {promotions.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{loading ? "Loading promotions…" : "No promotions found."}</p> : <div className="space-y-3">{promotions.map((promo) => (
          <div key={promo.id} className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 p-4 rounded border border-border"><div className="flex-1"><div className="flex flex-wrap items-center gap-2 mb-2"><h3 className="font-semibold">{promo.title}</h3><Badge variant={promo.active ? "default" : "outline"}>{promo.active ? "Active" : "Inactive"}</Badge><Badge variant="secondary">{promo.type.replaceAll("_", " ")}</Badge></div><p className="text-sm text-muted-foreground mb-3">{promo.description || "No description"}</p><div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(promo.startDate).toLocaleDateString()} to {new Date(promo.endDate).toLocaleDateString()}</span><span className="flex items-center gap-1"><Gift className="h-3 w-3" />{promo.claimed.toLocaleString()} claims</span><span>${promo.bonusAmount.toFixed(2)} · {promo.wagering}x</span></div></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => editPromotion(promo)}><Pencil className="h-3.5 w-3.5" /></Button><Button size="sm" variant={promo.active ? "outline" : "default"} disabled={processingId === promo.id} onClick={() => void togglePromotion(promo)}>{processingId === promo.id ? "Saving…" : promo.active ? "Disable" : "Activate"}</Button></div></div>
        ))}</div>}
      </CardContent></Card>
    </div></AdminLayout>
  );
}
