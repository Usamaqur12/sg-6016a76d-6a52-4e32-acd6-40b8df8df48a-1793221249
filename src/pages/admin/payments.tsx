import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { CheckCircle2, CreditCard, ExternalLink, Eye, PauseCircle, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { canAccessAdminArea } from "@/lib/adminRoles";
import { useToast } from "@/hooks/use-toast";

type MethodType = "provider" | "manual_crypto" | "bank" | "ewallet";
type PaymentMethod = {
  id: string;
  name: string;
  code: string;
  method_type: MethodType;
  provider_code: string | null;
  currency: string;
  network: string | null;
  destination_reference: string | null;
  instructions: string | null;
  min_amount: number;
  max_amount: number;
  is_enabled: boolean;
  display_order: number;
  archived_at: string | null;
};

type DepositRequest = {
  id: string;
  user_id: string;
  payment_method_id: string;
  amount: number;
  transaction_reference: string;
  status: "pending" | "on_hold" | "awaiting_approval" | "approved" | "rejected";
  user_note: string | null;
  review_note: string | null;
  created_at: string;
  proof_file_path?: string | null;
  risk_score?: number;
};

type WithdrawalRequest = {
  id: string; user_id: string; payment_method_id: string; amount: number; destination_reference: string;
  status: "pending" | "on_hold" | "awaiting_approval" | "approved" | "rejected" | "cancelled";
  user_note: string | null; review_note: string | null; risk_score: number; payment_reference: string | null; created_at: string;
};

type ApprovalRequest = { id: string; action_type: "manual_deposit" | "large_withdrawal"; entity_id: string; requested_by: string; request_note: string | null; payload: { amount?: number; user_id?: string; destination?: string }; status: string; created_at: string };

function normalizePaymentIdentifier(value: string | null | undefined) {
  return (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isCcPaymentMethod(method: PaymentMethod) {
  return [method.code, method.provider_code, method.name]
    .map(normalizePaymentIdentifier)
    .some((value) => value === "ccpayment" || value === "ccpayments");
}

function isFaucetPayMethod(method: PaymentMethod) {
  return [method.code, method.provider_code]
    .map(normalizePaymentIdentifier)
    .some((value) => value === "faucetpay");
}

type FaucetPayConfig = {
  providerCode: "faucetpay";
  enabled: boolean;
  merchantUsername: string;
  priceCurrency: string;
  payCurrency: string;
  siteUrl: string;
  configured: boolean;
  source: "database" | "environment" | "none";
  callbackUrl?: string;
};

const emptyFaucetPayConfig: FaucetPayConfig = {
  providerCode: "faucetpay",
  enabled: false,
  merchantUsername: "",
  priceCurrency: "USDT",
  payCurrency: "",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "",
  configured: false,
  source: "none",
};

async function adminPaymentFetch(url: string, init?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Admin session expired. Sign in again.");
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + session.access_token,
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "FaucetPay configuration request failed");
  return body as FaucetPayConfig;
}

const emptyForm = {
  name: "",
  code: "",
  methodType: "manual_crypto" as MethodType,
  providerCode: "",
  currency: "USDT",
  network: "TRC20",
  destination: "",
  instructions: "",
  minAmount: "10",
  maxAmount: "10000",
  displayOrder: "100",
  enabled: false,
};

export default function AdminPayments() {
  const router = useRouter();
  const { toast } = useToast();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [requests, setRequests] = useState<DepositRequest[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [profiles, setProfiles] = useState<Record<string, { full_name?: string; email?: string }>>({});
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [adminId, setAdminId] = useState<string | null>(null);
  const [adminRole, setAdminRole] = useState<string | null>(null);
  const [faucetPayConfig, setFaucetPayConfig] = useState<FaucetPayConfig>(emptyFaucetPayConfig);
  const [faucetPayConfigLoading, setFaucetPayConfigLoading] = useState(false);
  const [faucetPayConfigSaving, setFaucetPayConfigSaving] = useState(false);
  const [faucetPayConfigLoadError, setFaucetPayConfigLoadError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [methodResult, requestResult, withdrawalResult, profileResult, approvalResult] = await Promise.all([
      (supabase as any).from("payment_methods").select("*").order("display_order", { ascending: true }),
      (supabase as any).from("manual_deposit_requests").select("*").order("created_at", { ascending: false }).limit(200),
      (supabase as any).from("manual_withdrawal_requests").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("profiles").select("id,full_name,email"),
      (supabase as any).from("admin_approval_requests").select("*").in("action_type", ["manual_deposit", "large_withdrawal"]).order("created_at", { ascending: false }).limit(100),
    ]);
    const error = methodResult.error || requestResult.error || withdrawalResult.error || profileResult.error || approvalResult.error;
    if (error) {
      toast({ title: "Payment data could not load", description: error.message, variant: "destructive" });
    } else {
      setMethods(((methodResult.data || []) as PaymentMethod[]).filter((item) => !item.archived_at && !isCcPaymentMethod(item)));
      setRequests((requestResult.data || []) as DepositRequest[]);
      setWithdrawals((withdrawalResult.data || []) as WithdrawalRequest[]);
      setProfiles(Object.fromEntries((profileResult.data || []).map((profile) => [profile.id, profile])));
      setApprovals((approvalResult.data || []) as ApprovalRequest[]);
    }
    setLoading(false);
  }, [toast]);

  const loadFaucetPayConfig = useCallback(async (role: string | null) => {
    if (role !== "super_admin") {
      setFaucetPayConfigLoadError(null);
      return;
    }
    setFaucetPayConfigLoading(true);
    setFaucetPayConfigLoadError(null);
    try {
      setFaucetPayConfig(await adminPaymentFetch("/api/admin/payment-providers/faucetpay"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setFaucetPayConfigLoadError(message);
      toast({ title: "FaucetPay configuration could not load", description: message, variant: "destructive" });
    } finally {
      setFaucetPayConfigLoading(false);
    }
  }, [toast]);

  const initialize = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { await router.push("/admin/login"); return; }
    setAdminId(user.id);
    const { data: profile } = await supabase.from("profiles").select("admin_role").eq("id", user.id).single();
    if (!profile || !canAccessAdminArea(profile.admin_role, "payments")) { await router.push("/"); return; }
    setAdminRole(profile.admin_role);
    await Promise.all([loadData(), loadFaucetPayConfig(profile.admin_role)]);
  }, [loadData, loadFaucetPayConfig, router]);

  useEffect(() => { void initialize(); }, [initialize]);

  const pendingCount = useMemo(() => requests.filter((item) => item.status === "pending").length + withdrawals.filter((item) => item.status === "pending").length, [requests, withdrawals]);
  const faucetPayMethod = useMemo(() => methods.find(isFaucetPayMethod), [methods]);
  const adminVisibleMethods = useMemo(() => methods.filter((item) => !isFaucetPayMethod(item)), [methods]);
  const faucetPayCallbackUrl = faucetPayConfig.callbackUrl || (faucetPayConfig.siteUrl
    ? faucetPayConfig.siteUrl.replace(/\/$/, "") + "/api/payments/faucetpay/callback"
    : "Save your public HTTPS site URL to generate the callback URL.");

  async function refreshPayments() {
    await Promise.all([loadData(), loadFaucetPayConfig(adminRole)]);
  }

  async function saveFaucetPayConfig() {
    if (adminRole !== "super_admin") return;
    if (faucetPayConfigLoadError) {
      toast({ title: "Refresh FaucetPay before saving", description: faucetPayConfigLoadError, variant: "destructive" });
      return;
    }
    if (!faucetPayConfig.merchantUsername.trim() || !faucetPayConfig.priceCurrency.trim() || !faucetPayConfig.siteUrl.trim()) {
      toast({ title: "Merchant username, price currency and site URL are required", variant: "destructive" });
      return;
    }
    setFaucetPayConfigSaving(true);
    try {
      const config = await adminPaymentFetch("/api/admin/payment-providers/faucetpay", {
        method: "PATCH",
        body: JSON.stringify({
          enabled: faucetPayConfig.enabled,
          merchantUsername: faucetPayConfig.merchantUsername.trim(),
          priceCurrency: faucetPayConfig.priceCurrency.trim().toUpperCase(),
          payCurrency: faucetPayConfig.payCurrency.trim().toUpperCase(),
          siteUrl: faucetPayConfig.siteUrl.trim(),
        }),
      });
      setFaucetPayConfig(config);
      toast({ title: "FaucetPay configuration saved", description: config.enabled ? "FaucetPay is now available in customer wallets." : "Configuration saved; customer deposits remain disabled." });
      await loadData();
    } catch (error) {
      toast({ title: "FaucetPay configuration save failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    } finally {
      setFaucetPayConfigSaving(false);
    }
  }

  function startEdit(method: PaymentMethod) {
    setEditingId(method.id);
    setForm({
      name: method.name,
      code: method.code,
      methodType: method.method_type,
      providerCode: method.provider_code || "",
      currency: method.currency,
      network: method.network || "",
      destination: method.destination_reference || "",
      instructions: method.instructions || "",
      minAmount: String(method.min_amount),
      maxAmount: String(method.max_amount),
      displayOrder: String(method.display_order),
      enabled: method.is_enabled,
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function saveMethod(overrides?: Partial<typeof form>, idOverride?: string | null) {
    const values = { ...form, ...overrides };
    if (!values.name.trim() || !values.code.trim() || !values.currency.trim()) {
      toast({ title: "Name, code and currency are required", variant: "destructive" });
      return;
    }
    if ([values.code, values.providerCode].map(normalizePaymentIdentifier).includes("faucetpay")) {
      toast({ title: "Use the Super Admin FaucetPay panel for this provider", variant: "destructive" });
      return;
    }
    if (values.methodType !== "provider" && !values.destination.trim()) {
      toast({ title: "Destination wallet/account is required", variant: "destructive" });
      return;
    }
    const targetId = idOverride === undefined ? editingId : idOverride;
    setProcessing(targetId || "new");
    const { error } = await (supabase as any).rpc("save_payment_method", {
      p_id: targetId,
      p_name: values.name,
      p_code: values.code.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      p_method_type: values.methodType,
      p_provider_code: values.providerCode || null,
      p_currency: values.currency.toUpperCase(),
      p_network: values.network || null,
      p_destination_reference: values.destination || null,
      p_instructions: values.instructions || null,
      p_min_amount: Number(values.minAmount),
      p_max_amount: Number(values.maxAmount),
      p_is_enabled: values.enabled,
      p_display_order: Number(values.displayOrder),
    });
    if (error) toast({ title: "Payment method save failed", description: error.message, variant: "destructive" });
    else { toast({ title: targetId ? "Payment method updated" : "Payment method added" }); resetForm(); await loadData(); }
    setProcessing(null);
  }

  async function toggleMethod(method: PaymentMethod) {
    await saveMethod({
      name: method.name,
      code: method.code,
      methodType: method.method_type,
      providerCode: method.provider_code || "",
      currency: method.currency,
      network: method.network || "",
      destination: method.destination_reference || "",
      instructions: method.instructions || "",
      minAmount: String(method.min_amount),
      maxAmount: String(method.max_amount),
      displayOrder: String(method.display_order),
      enabled: !method.is_enabled,
    }, method.id);
  }

  async function archiveMethod(method: PaymentMethod) {
    if (!window.confirm(`Remove ${method.name}? Existing deposit history will be preserved.`)) return;
    setProcessing(method.id);
    const { error } = await (supabase as any).rpc("archive_payment_method", { p_id: method.id });
    if (error) toast({ title: "Payment method could not be removed", description: error.message, variant: "destructive" });
    else { toast({ title: "Payment method removed" }); await loadData(); }
    setProcessing(null);
  }

  async function reviewRequest(request: DepositRequest, status: "approved" | "rejected" | "on_hold") {
    const note = window.prompt(status === "approved" ? "Approval note (optional)" : "Reason for rejection") || "";
    if (["rejected", "on_hold"].includes(status) && !note.trim()) {
      toast({ title: "A rejection reason is required", variant: "destructive" });
      return;
    }
    setProcessing(request.id);
    const { error } = await (supabase as any).rpc("review_manual_deposit_request", { p_request_id: request.id, p_status: status, p_review_note: note || null });
    if (error) toast({ title: "Deposit review failed", description: error.message, variant: "destructive" });
    else { toast({ title: status === "approved" ? "Sent for checker approval" : status === "on_hold" ? "Deposit placed on hold" : "Deposit rejected" }); await loadData(); }
    setProcessing(null);
  }

  async function decideApproval(approval: ApprovalRequest, decision: "approved" | "rejected") {
    const note = window.prompt(decision === "approved" ? "Checker note (optional)" : "Rejection reason") || "";
    if (decision === "rejected" && !note.trim()) return;
    setProcessing(approval.id);
    const { error } = await (supabase as any).rpc("decide_admin_approval", { p_approval_id: approval.id, p_decision: decision, p_note: note || null });
    if (error) toast({ title: "Approval decision failed", description: error.message, variant: "destructive" });
    else { toast({ title: decision === "approved" ? approval.action_type === "large_withdrawal" ? "Withdrawal approved" : "Deposit approved and credited" : "Approval rejected" }); await loadData(); }
    setProcessing(null);
  }

  async function reviewWithdrawal(request: WithdrawalRequest, status: "approved" | "rejected" | "on_hold") {
    const note = window.prompt(status === "approved" ? "Maker note (optional)" : status === "on_hold" ? "Hold reason" : "Rejection reason") || "";
    if (["rejected", "on_hold"].includes(status) && note.trim().length < 3) { toast({ title: "A review reason is required", variant: "destructive" }); return; }
    setProcessing(request.id);
    const { error } = await (supabase as any).rpc("review_manual_withdrawal_request", { p_request_id: request.id, p_status: status, p_review_note: note || null });
    if (error) toast({ title: "Withdrawal review failed", description: error.message, variant: "destructive" });
    else { toast({ title: status === "approved" ? "Sent to a second administrator" : status === "on_hold" ? "Withdrawal placed on hold" : "Withdrawal rejected and funds returned" }); await loadData(); }
    setProcessing(null);
  }

  async function viewPaymentProof(path: string) {
    const { data, error } = await supabase.storage.from("payment-proofs").createSignedUrl(path, 300);
    if (error || !data?.signedUrl) { toast({ title: "Payment proof unavailable", description: error?.message, variant: "destructive" }); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <AdminLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h1 className="flex items-center gap-2 text-2xl font-bold"><CreditCard className="h-6 w-6 text-primary" />Payment Methods</h1><p className="text-sm text-muted-foreground">Add, edit, enable, disable or remove customer payment options.</p></div>
          <Button variant="outline" onClick={() => void refreshPayments()} disabled={loading || faucetPayConfigLoading}><RefreshCw className={`mr-2 h-4 w-4 ${loading || faucetPayConfigLoading ? "animate-spin" : ""}`} />Refresh</Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Card><CardContent className="p-4"><div className="text-2xl font-bold">{adminVisibleMethods.length + (adminRole === "super_admin" && faucetPayMethod ? 1 : 0)}</div><div className="text-xs text-muted-foreground">Configured methods</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-2xl font-bold text-success">{adminVisibleMethods.filter((item) => item.is_enabled).length + (adminRole === "super_admin" && faucetPayMethod?.is_enabled ? 1 : 0)}</div><div className="text-xs text-muted-foreground">Enabled for customers</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-2xl font-bold text-warning">{pendingCount}</div><div className="text-xs text-muted-foreground">Finance requests awaiting review</div></CardContent></Card>
        </div>

        {adminRole === "super_admin" && (
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
                FaucetPay hosted merchant checkout
                <Badge variant={faucetPayConfig.configured ? "default" : "outline"}>{faucetPayConfig.configured ? "Configured" : "Setup required"}</Badge>
                <Badge variant={faucetPayConfig.enabled && faucetPayMethod?.is_enabled ? "default" : "secondary"}>{faucetPayConfig.enabled && faucetPayMethod?.is_enabled ? "Customer enabled" : "Customer disabled"}</Badge>
                <Badge variant="outline">Super Admin only</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">FaucetPay Merchant deposits use your approved merchant username and hosted checkout. A permanent Faucet API key is not used for receiving payments.</p>
              {faucetPayConfigLoadError && <div className="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{faucetPayConfigLoadError}</div>}
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1.5"><Label>FaucetPay merchant username</Label><Input value={faucetPayConfig.merchantUsername} onChange={(event) => setFaucetPayConfig((current) => ({ ...current, merchantUsername: event.target.value }))} placeholder="Your approved FaucetPay username" disabled={faucetPayConfigLoading || faucetPayConfigSaving} /></label>
                <label className="space-y-1.5"><Label>Public site URL</Label><Input value={faucetPayConfig.siteUrl} onChange={(event) => setFaucetPayConfig((current) => ({ ...current, siteUrl: event.target.value }))} placeholder="https://mindbetpro.com" disabled={faucetPayConfigLoading || faucetPayConfigSaving} /></label>
                <label className="space-y-1.5"><Label>Price currency (USD or USDT)</Label><Input value={faucetPayConfig.priceCurrency} onChange={(event) => setFaucetPayConfig((current) => ({ ...current, priceCurrency: event.target.value.toUpperCase() }))} placeholder="USDT" disabled={faucetPayConfigLoading || faucetPayConfigSaving} /></label>
                <label className="space-y-1.5"><Label>Required payment coin (optional)</Label><Input value={faucetPayConfig.payCurrency} onChange={(event) => setFaucetPayConfig((current) => ({ ...current, payCurrency: event.target.value.toUpperCase() }))} placeholder="Leave blank so customer can choose" disabled={faucetPayConfigLoading || faucetPayConfigSaving} /></label>
              </div>
              <div className="rounded border border-border bg-muted/30 p-3"><Label>FaucetPay callback URL</Label><code className="mt-1 block break-all text-xs text-muted-foreground">{faucetPayCallbackUrl}</code></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={faucetPayConfig.enabled} onChange={(event) => setFaucetPayConfig((current) => ({ ...current, enabled: event.target.checked }))} disabled={faucetPayConfigLoading || faucetPayConfigSaving} />Enable FaucetPay for customers after saving</label>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void saveFaucetPayConfig()} disabled={faucetPayConfigLoading || faucetPayConfigSaving || Boolean(faucetPayConfigLoadError)}>{faucetPayConfigSaving ? "Saving…" : "Save FaucetPay"}</Button>
                <Button variant="outline" asChild><a href="https://faucetpay.io/merchant" target="_blank" rel="noreferrer">Open FaucetPay Merchant <ExternalLink className="ml-2 h-4 w-4" /></a></Button>
                <Button variant="ghost" onClick={() => void loadFaucetPayConfig(adminRole)} disabled={faucetPayConfigLoading}>Refresh status</Button>
              </div>
              <p className="text-xs text-muted-foreground">Merchant approval must be active in FaucetPay. Wallet credit occurs only after FaucetPay verifies the one-time callback token and the server reconciles amount, currency and merchant identity.</p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Plus className="h-5 w-5" />{editingId ? "Edit payment method" : "Add payment method"}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <label className="space-y-1.5"><Label>Name</Label><Input placeholder="USDT TRC20" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
              <label className="space-y-1.5"><Label>Code</Label><Input placeholder="usdt_trc20" value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} /></label>
              <label className="space-y-1.5"><Label>Method type</Label><select className="h-10 w-full rounded border border-input bg-background px-3 text-sm" value={form.methodType} onChange={(event) => setForm((current) => ({ ...current, methodType: event.target.value as MethodType }))}><option value="manual_crypto">Manual crypto</option><option value="bank">Bank transfer</option><option value="ewallet">E-wallet</option><option value="provider">Automatic provider</option></select></label>
              <label className="space-y-1.5"><Label>Provider code</Label><Input placeholder="nowpayments or manual" value={form.providerCode} onChange={(event) => setForm((current) => ({ ...current, providerCode: event.target.value }))} /></label>
              <label className="space-y-1.5"><Label>Currency</Label><Input placeholder="USDT" value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))} /></label>
              <label className="space-y-1.5"><Label>Network</Label><Input placeholder="TRC20" value={form.network} onChange={(event) => setForm((current) => ({ ...current, network: event.target.value }))} /></label>
              <label className="space-y-1.5 md:col-span-2 lg:col-span-3"><Label>Receiving wallet / account</Label><Input placeholder={form.methodType === "provider" ? "Generated automatically by provider" : "Wallet address, IBAN or account ID"} value={form.destination} onChange={(event) => setForm((current) => ({ ...current, destination: event.target.value }))} disabled={form.methodType === "provider"} /></label>
              <label className="space-y-1.5 md:col-span-2 lg:col-span-3"><Label>Customer instructions</Label><Input placeholder="Send on the selected network and submit the transaction hash" value={form.instructions} onChange={(event) => setForm((current) => ({ ...current, instructions: event.target.value }))} /></label>
              <label className="space-y-1.5"><Label>Minimum amount</Label><Input type="number" min="0" step="0.01" value={form.minAmount} onChange={(event) => setForm((current) => ({ ...current, minAmount: event.target.value }))} /></label>
              <label className="space-y-1.5"><Label>Maximum amount</Label><Input type="number" min="0" step="0.01" value={form.maxAmount} onChange={(event) => setForm((current) => ({ ...current, maxAmount: event.target.value }))} /></label>
              <label className="space-y-1.5"><Label>Display order</Label><Input type="number" min="0" value={form.displayOrder} onChange={(event) => setForm((current) => ({ ...current, displayOrder: event.target.value }))} /></label>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} />Enable for customers immediately</label>
            <div className="flex gap-2"><Button onClick={() => void saveMethod()} disabled={processing === (editingId || "new")}>{processing === (editingId || "new") ? "Saving…" : editingId ? "Save changes" : "Add method"}</Button>{editingId && <Button variant="outline" onClick={resetForm}>Cancel</Button>}</div>
            <p className="text-xs text-muted-foreground">Use this generic form only for manual or separately configured providers. FaucetPay is controlled from the Super Admin panel above.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Configured methods</CardTitle></CardHeader>
          <CardContent>{adminVisibleMethods.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{loading ? "Loading…" : "No payment methods configured."}</p> : <div className="space-y-3">{adminVisibleMethods.map((method) => (
            <div key={method.id} className="flex flex-col gap-3 rounded border border-border p-4 lg:flex-row lg:items-center">
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{method.name}</h3><Badge variant={method.is_enabled ? "default" : "outline"}>{method.is_enabled ? "Enabled" : "Disabled"}</Badge><Badge variant="secondary">{method.method_type.replaceAll("_", " ")}</Badge></div><p className="mt-1 break-all text-xs text-muted-foreground">{method.currency}{method.network ? ` · ${method.network}` : ""} · ${method.min_amount.toFixed(2)}–${method.max_amount.toFixed(2)}{method.destination_reference ? ` · ${method.destination_reference}` : ""}</p></div>
              <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => startEdit(method)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button><Button size="sm" variant={method.is_enabled ? "outline" : "default"} disabled={processing === method.id} onClick={() => void toggleMethod(method)}>{method.is_enabled ? "Disable" : "Enable"}</Button><Button size="sm" variant="destructive" disabled={processing === method.id} onClick={() => void archiveMethod(method)}><Trash2 className="mr-1 h-3.5 w-3.5" />Remove</Button></div>
            </div>
          ))}</div>}</CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Maker-checker approval queue</CardTitle></CardHeader>
          <CardContent>{approvals.filter((item) => item.status === "pending").length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No sensitive action is awaiting a second administrator.</p> : <div className="space-y-3">{approvals.filter((item) => item.status === "pending").map((approval) => {
            const profile = profiles[String(approval.payload?.user_id || "")];
            const isMaker = approval.requested_by === adminId;
            return <div key={approval.id} className="flex flex-col gap-3 rounded border border-warning/30 bg-warning/5 p-4 lg:flex-row lg:items-center"><div className="flex-1"><div className="font-semibold">${Number(approval.payload?.amount || 0).toFixed(2)} {approval.action_type === "large_withdrawal" ? "manual withdrawal" : "manual deposit"}</div><div className="text-xs text-muted-foreground">{profile?.full_name || profile?.email || approval.entity_id} · requested {new Date(approval.created_at).toLocaleString()}{approval.payload?.destination ? ` · destination …${approval.payload.destination}` : ""}</div>{approval.request_note && <p className="mt-1 text-xs">Maker note: {approval.request_note}</p>}{isMaker && <p className="mt-1 text-xs text-warning">A different finance administrator must decide this request.</p>}</div><div className="flex gap-2"><Button size="sm" disabled={isMaker || processing === approval.id} onClick={() => void decideApproval(approval,"approved")}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Checker approve</Button><Button size="sm" variant="destructive" disabled={isMaker || processing === approval.id} onClick={() => void decideApproval(approval,"rejected")}><XCircle className="mr-1 h-3.5 w-3.5" />Reject</Button></div></div>;
          })}</div>}</CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Manual withdrawal review queue</CardTitle></CardHeader>
          <CardContent>{withdrawals.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No manual withdrawal requests.</p> : <div className="space-y-3">{withdrawals.map((request) => {
            const method = methods.find((item) => item.id === request.payment_method_id); const profile = profiles[request.user_id];
            return <div key={request.id} className="flex flex-col gap-3 rounded border border-border p-4 lg:flex-row lg:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">${Number(request.amount).toFixed(2)}</span><Badge variant={request.status === "approved" ? "default" : request.status === "rejected" ? "destructive" : "outline"}>{request.status.replaceAll("_", " ")}</Badge><Badge variant={request.risk_score >= 70 ? "destructive" : "secondary"}>Risk {request.risk_score}</Badge><span className="text-sm">{method?.name || "Archived method"}</span></div><p className="mt-1 break-all text-xs text-muted-foreground">{profile?.full_name || profile?.email || request.user_id} · Destination: {request.destination_reference} · {new Date(request.created_at).toLocaleString()}</p>{request.user_note && <p className="mt-1 text-xs">Customer note: {request.user_note}</p>}{request.review_note && <p className="mt-1 text-xs">Review note: {request.review_note}</p>}</div>{["pending","on_hold"].includes(request.status) && <div className="flex flex-wrap gap-2"><Button size="sm" disabled={processing === request.id} onClick={() => void reviewWithdrawal(request,"approved")}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Send to checker</Button>{request.status === "pending" && <Button size="sm" variant="outline" disabled={processing === request.id} onClick={() => void reviewWithdrawal(request,"on_hold")}><PauseCircle className="mr-1 h-3.5 w-3.5" />Hold</Button>}<Button size="sm" variant="destructive" disabled={processing === request.id} onClick={() => void reviewWithdrawal(request,"rejected")}><XCircle className="mr-1 h-3.5 w-3.5" />Reject &amp; refund</Button></div>}</div>;
          })}</div>}</CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Manual deposit review queue</CardTitle></CardHeader>
          <CardContent>{requests.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No manual deposit requests.</p> : <div className="space-y-3">{requests.map((request) => {
            const method = methods.find((item) => item.id === request.payment_method_id);
            const profile = profiles[request.user_id];
            return <div key={request.id} className="flex flex-col gap-3 rounded border border-border p-4 lg:flex-row lg:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">${Number(request.amount).toFixed(2)}</span><Badge variant={request.status === "approved" ? "default" : request.status === "rejected" ? "destructive" : "outline"}>{request.status.replaceAll("_", " ")}</Badge><Badge variant={Number(request.risk_score || 0) >= 70 ? "destructive" : "secondary"}>Risk {request.risk_score || 0}</Badge><span className="text-sm">{method?.name || "Archived method"}</span></div><p className="mt-1 text-xs text-muted-foreground">{profile?.full_name || profile?.email || request.user_id} · Ref: <span className="break-all font-mono">{request.transaction_reference}</span> · {new Date(request.created_at).toLocaleString()}</p>{request.user_note && <p className="mt-1 text-xs">Customer note: {request.user_note}</p>}{request.review_note && <p className="mt-1 text-xs">Review note: {request.review_note}</p>}{request.proof_file_path && <Button className="mt-2" size="sm" variant="outline" onClick={() => void viewPaymentProof(request.proof_file_path!)}><Eye className="mr-1 h-3.5 w-3.5" />View payment proof</Button>}</div>{["pending","on_hold"].includes(request.status) && <div className="flex flex-wrap gap-2"><Button size="sm" disabled={processing === request.id} onClick={() => void reviewRequest(request, "approved")}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Send to checker</Button>{request.status === "pending" && <Button size="sm" variant="outline" disabled={processing === request.id} onClick={() => void reviewRequest(request, "on_hold")}><PauseCircle className="mr-1 h-3.5 w-3.5" />Hold</Button>}<Button size="sm" variant="destructive" disabled={processing === request.id} onClick={() => void reviewRequest(request, "rejected")}><XCircle className="mr-1 h-3.5 w-3.5" />Reject</Button></div>}</div>;
          })}</div>}</CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
