import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";
import { getMyWalletBalances, getUserTransactions, type WalletBalances } from "@/services/walletService";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  ArrowLeft, Wallet, ArrowDownRight, ArrowUpRight, ShieldCheck, Banknote, Gift, LockKeyhole, Bitcoin, Copy, CreditCard, Trash2, AlertTriangle
} from "lucide-react";
import Link from "next/link";

type PaymentMethod = {
  id: string;
  name: string;
  code: string;
  method_type: "provider" | "manual_crypto" | "bank" | "ewallet";
  provider_code: string | null;
  currency: string;
  network: string | null;
  destination_reference: string | null;
  instructions: string | null;
  min_amount: number;
  max_amount: number;
  is_enabled: boolean;
  display_order: number;
};

type WithdrawalRequest = {
  id: string;
  payment_method_id: string;
  amount: number;
  destination_reference: string;
  status: string;
  review_note: string | null;
  created_at: string;
};

type WithdrawalAddress = {
  id: string;
  payment_method_id: string;
  label: string;
  destination_reference: string;
  status: "pending" | "cooling" | "active" | "blocked" | "removed";
  activates_at: string;
  created_at: string;
};

export default function WalletPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [walletBalances, setWalletBalances] = useState<WalletBalances | null>(null);
  const [loading, setLoading] = useState(true);
  const [depositAmount, setDepositAmount] = useState("25");
  const [depositCurrency, setDepositCurrency] = useState("usdttrc20");
  const [creatingDeposit, setCreatingDeposit] = useState(false);
  const [depositError, setDepositError] = useState("");
  const [cryptoInvoice, setCryptoInvoice] = useState<any>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedManualMethod, setSelectedManualMethod] = useState<string | null>(null);
  const [manualAmount, setManualAmount] = useState("25");
  const [manualReference, setManualReference] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualProof, setManualProof] = useState<File | null>(null);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualMessage, setManualMessage] = useState("");
  const [withdrawalMethod, setWithdrawalMethod] = useState<string | null>(null);
  const [withdrawalAmount, setWithdrawalAmount] = useState("25");
  const [withdrawalDestination, setWithdrawalDestination] = useState("");
  const [withdrawalAddressLabel, setWithdrawalAddressLabel] = useState("My wallet");
  const [selectedWithdrawalAddress, setSelectedWithdrawalAddress] = useState<string | null>(null);
  const [withdrawalAddresses, setWithdrawalAddresses] = useState<WithdrawalAddress[]>([]);
  const [savingWithdrawalAddress, setSavingWithdrawalAddress] = useState(false);
  const [withdrawalNote, setWithdrawalNote] = useState("");
  const [withdrawalSubmitting, setWithdrawalSubmitting] = useState(false);
  const [withdrawalMessage, setWithdrawalMessage] = useState("");
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const providerMethodEnabled = paymentMethods.some((method) => method.method_type === "provider" && method.provider_code === "nowpayments");
  const cryptoEnabled = process.env.NEXT_PUBLIC_CRYPTO_DEPOSITS_ENABLED === "true" && providerMethodEnabled;
  const manualMethods = paymentMethods.filter((method) => method.method_type !== "provider");

  useEffect(() => {
    checkUser();
  }, []);

  async function checkUser() {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      router.push("/auth/login");
      return;
    }

    setUser(user);

    const { data: profileData } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    setProfile(
      profileData ?? {
        id: user.id,
        email: user.email ?? "",
        full_name: user.user_metadata?.full_name ?? "Account",
        kyc_status: "pending",
        demo_balance: 0,
      }
    );

    await Promise.all([loadTransactions(user.id), loadBalances(), loadPaymentMethods(), loadWithdrawals(), loadWithdrawalAddresses()]);
  }

  async function loadWithdrawals() {
    const { data } = await (supabase as any)
      .from("manual_withdrawal_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    setWithdrawals((data || []) as WithdrawalRequest[]);
  }

  async function loadWithdrawalAddresses() {
    const { data } = await (supabase as any)
      .from("withdrawal_addresses")
      .select("*")
      .order("created_at", { ascending: false });
    const addresses = ((data || []) as WithdrawalAddress[]).filter((item) => item.status !== "removed");
    setWithdrawalAddresses(addresses);
    setSelectedWithdrawalAddress((current) => current && addresses.some((item) => item.id === current) ? current : addresses.find((item) => item.status !== "blocked" && new Date(item.activates_at).getTime() <= Date.now())?.id || null);
  }

  async function saveWithdrawalAddress() {
    if (!withdrawalMethod) { setWithdrawalMessage("Select a payout method first."); return; }
    if (withdrawalDestination.trim().length < 6) { setWithdrawalMessage("Enter a valid receiving wallet or account."); return; }
    setSavingWithdrawalAddress(true); setWithdrawalMessage("");
    const { data, error } = await (supabase as any).rpc("add_my_withdrawal_address", {
      p_payment_method_id: withdrawalMethod,
      p_label: withdrawalAddressLabel.trim() || "My wallet",
      p_destination: withdrawalDestination.trim(),
    });
    if (error) setWithdrawalMessage(error.message);
    else {
      setWithdrawalMessage("Withdrawal destination saved. A security cooling period may apply before use.");
      setWithdrawalDestination("");
      await loadWithdrawalAddresses();
      setSelectedWithdrawalAddress(String(data));
    }
    setSavingWithdrawalAddress(false);
  }

  async function removeWithdrawalAddress(addressId: string) {
    const { error } = await (supabase as any).rpc("remove_my_withdrawal_address", { p_id: addressId });
    if (error) setWithdrawalMessage(error.message);
    else { setWithdrawalMessage("Saved destination removed."); await loadWithdrawalAddresses(); }
  }

  async function loadPaymentMethods() {
    const { data } = await (supabase as any)
      .from("payment_methods")
      .select("*")
      .eq("is_enabled", true)
      .order("display_order", { ascending: true });
    const active = ((data || []) as PaymentMethod[]).filter((method) => method.is_enabled);
    setPaymentMethods(active);
    setSelectedManualMethod((current) => current && active.some((method) => method.id === current) ? current : null);
  }

  async function loadBalances() {
    const result = await getMyWalletBalances();
    setWalletBalances(result.balances);
  }

  async function loadTransactions(userId: string) {
    setLoading(true);
    const { success, transactions: userTransactions } = await getUserTransactions(userId);

    if (success && userTransactions) {
      setTransactions(userTransactions);
    }

    setLoading(false);
  }

  async function createCryptoDeposit() {
    const amount = Number(depositAmount);
    if (!Number.isFinite(amount) || amount < 10) { setDepositError("Minimum crypto deposit is $10."); return; }
    setCreatingDeposit(true); setDepositError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Please sign in again.");
      const response = await fetch("/api/payments/crypto/create", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ amount, payCurrency: depositCurrency, idempotencyKey: globalThis.crypto.randomUUID() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Deposit invoice could not be created.");
      setCryptoInvoice(body.invoice);
    } catch (error) {
      setDepositError(error instanceof Error ? error.message : "Deposit invoice could not be created.");
    } finally { setCreatingDeposit(false); }
  }

  async function submitManualDeposit() {
    const method = manualMethods.find((item) => item.id === selectedManualMethod);
    const amount = Number(manualAmount);
    if (!method) { setManualMessage("Select a payment method first."); return; }
    if (!Number.isFinite(amount) || amount < Number(method.min_amount) || amount > Number(method.max_amount)) {
      setManualMessage(`Amount must be between $${Number(method.min_amount).toFixed(2)} and $${Number(method.max_amount).toFixed(2)}.`);
      return;
    }
    if (manualReference.trim().length < 4) { setManualMessage("Enter the transaction hash or payment reference."); return; }
    setManualSubmitting(true); setManualMessage("");
    let proofPath: string | null = null;
    if (manualProof) {
      const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
      if (!allowed.includes(manualProof.type) || manualProof.size > 5 * 1024 * 1024) {
        setManualMessage("Proof must be a JPG, PNG, WebP or PDF up to 5 MB."); setManualSubmitting(false); return;
      }
      const extension = manualProof.name.split(".").pop()?.toLowerCase() || "bin";
      proofPath = `${user.id}/${globalThis.crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("payment-proofs").upload(proofPath, manualProof);
      if (uploadError) { setManualMessage(uploadError.message); setManualSubmitting(false); return; }
    }
    const { data, error } = await (supabase as any).rpc("submit_manual_deposit_request", {
      p_payment_method_id: method.id,
      p_amount: amount,
      p_transaction_reference: manualReference.trim(),
      p_user_note: manualNote.trim() || null,
      p_proof_file_path: proofPath,
    });
    if (error) setManualMessage(error.message);
    else {
      setManualMessage(`Deposit request ${String(data).slice(0, 8)} submitted for finance review.`);
      setManualReference(""); setManualNote(""); setManualProof(null);
    }
    setManualSubmitting(false);
  }

  async function submitWithdrawal() {
    const method = manualMethods.find((item) => item.id === withdrawalMethod);
    const address = withdrawalAddresses.find((item) => item.id === selectedWithdrawalAddress && item.payment_method_id === withdrawalMethod);
    const amount = Number(withdrawalAmount);
    if (!method) { setWithdrawalMessage("Select a payout method first."); return; }
    if (!Number.isFinite(amount) || amount < Number(method.min_amount) || amount > Number(method.max_amount)) {
      setWithdrawalMessage(`Amount must be between $${Number(method.min_amount).toFixed(2)} and $${Number(method.max_amount).toFixed(2)}.`);
      return;
    }
    if (amount > Number(walletBalances?.cash ?? walletBalances?.available ?? 0)) { setWithdrawalMessage("Withdrawable cash balance is insufficient."); return; }
    if (!address) { setWithdrawalMessage("Select an active saved withdrawal destination."); return; }
    if (address.status === "blocked" || new Date(address.activates_at).getTime() > Date.now()) { setWithdrawalMessage(`This destination is cooling down until ${new Date(address.activates_at).toLocaleString()}.`); return; }
    setWithdrawalSubmitting(true); setWithdrawalMessage("");
    const { data, error } = await (supabase as any).rpc("submit_manual_withdrawal_request", {
      p_payment_method_id: method.id,
      p_amount: amount,
      p_destination_reference: address.destination_reference,
      p_user_note: withdrawalNote.trim() || null,
    });
    if (error) setWithdrawalMessage(error.message);
    else {
      setWithdrawalMessage(`Withdrawal request ${String(data).slice(0, 8)} submitted. Funds are locked until finance review.`);
      setWithdrawalNote("");
      await Promise.all([loadBalances(), loadTransactions(user.id), loadWithdrawals()]);
    }
    setWithdrawalSubmitting(false);
  }

  const getTransactionIcon = (type: string) => {
    if (type === "deposit" || type === "bet_won" || type === "adjustment") {
      return <ArrowDownRight className="h-4 w-4 text-success" />;
    }
    return <ArrowUpRight className="h-4 w-4 text-danger" />;
  };

  const getTransactionColor = (amount: number) => {
    return amount > 0 ? "text-success" : "text-danger";
  };

  return (
    <div className="min-h-screen flex flex-col bg-background pb-14 lg:pb-0">
      <Header
        user={
          profile
            ? {
                email: user?.email || "",
                balance: Number(walletBalances?.available ?? walletBalances?.cash ?? 0),
              }
            : null
        }
        onAuthClick={() => router.push("/auth/login")}
      />

      <main className="flex-1 container py-6">
        <div className="max-w-4xl mx-auto">
          {/* Back Button */}
          <Link href="/account">
            <Button variant="ghost" size="sm" className="mb-4 hover:bg-surface">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Account
            </Button>
          </Link>

          {/* Balance Card */}
          <Card className="surface-elevated mb-6">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Available Balance</div>
                  <div className="text-4xl font-bold font-mono tabular-nums">
                    ${(walletBalances?.available ?? walletBalances?.cash ?? 0).toFixed(2)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">
                    Funds available to bet
                  </div>
                </div>
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <Wallet className="h-8 w-8 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <Card className="surface"><CardContent className="p-4 flex items-center justify-between"><div><p className="text-xs text-muted-foreground">Cash funds</p><p className="text-xl font-bold font-mono mt-1">${(walletBalances?.cash || 0).toFixed(2)}</p></div><Banknote className="h-5 w-5 text-primary" /></CardContent></Card>
            <Card className="surface"><CardContent className="p-4 flex items-center justify-between"><div><p className="text-xs text-muted-foreground">Bonus funds</p><p className="text-xl font-bold font-mono mt-1">${(walletBalances?.bonus || 0).toFixed(2)}</p></div><Gift className="h-5 w-5 text-gold" /></CardContent></Card>
            <Card className="surface"><CardContent className="p-4 flex items-center justify-between"><div><p className="text-xs text-muted-foreground">Locked funds</p><p className="text-xl font-bold font-mono mt-1">${(walletBalances?.locked || 0).toFixed(2)}</p></div><LockKeyhole className="h-5 w-5 text-warning" /></CardContent></Card>
          </div>

          {/* Payments stay closed until a licensed provider is connected. */}
          <Card className="surface mb-6">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                Wallet status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground leading-relaxed">
                This page reflects live Supabase wallet balances and transaction history. Deposit and withdrawal options only become operational after finance enables payment method records for this database.
              </p>
            </CardContent>
          </Card>

          <Card className="surface mb-6 border-primary/20">
            <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Bitcoin className="h-5 w-5 text-primary" />Crypto Deposit</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {!cryptoEnabled ? <div className="rounded-lg border border-warning/30 bg-warning/5 p-4"><p className="font-medium">Provider connection prepared but not activated</p><p className="mt-1 text-sm text-muted-foreground">Crypto deposits will open after the licensed merchant account, signed webhook, KYC/AML and reconciliation checks are approved. No wallet address is generated while disabled.</p></div> : profile?.kyc_status !== "approved" ? <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm">Approved KYC is required before creating a crypto deposit invoice.</div> : cryptoInvoice ? <div className="grid gap-4"><div className="rounded-lg border border-success/30 bg-success/5 p-4"><div className="text-xs uppercase text-muted-foreground">Send exactly</div><div className="mt-1 text-2xl font-bold font-mono">{cryptoInvoice.pay_amount} {String(cryptoInvoice.pay_currency).toUpperCase()}</div><div className="mt-3 text-xs uppercase text-muted-foreground">Provider deposit address</div><div className="mt-1 flex gap-2"><Input readOnly value={cryptoInvoice.pay_address || ""} className="font-mono text-xs" /><Button variant="outline" size="icon" onClick={() => void navigator.clipboard.writeText(cryptoInvoice.pay_address || "")}><Copy className="h-4 w-4" /></Button></div><p className="mt-3 text-xs text-muted-foreground">The wallet is credited only after the provider reports a completed blockchain payment. Sending a different asset or network may permanently lose funds.</p></div><Button variant="outline" onClick={() => setCryptoInvoice(null)}>Create another invoice</Button></div> : <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><div className="grid gap-2"><Label htmlFor="deposit-amount">USD amount</Label><Input id="deposit-amount" type="number" min="10" max="100000" step="0.01" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} /></div><div className="grid gap-2"><Label>Cryptocurrency / network</Label><Select value={depositCurrency} onValueChange={setDepositCurrency}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="usdttrc20">USDT · TRON</SelectItem><SelectItem value="usdtbsc">USDT · BSC</SelectItem><SelectItem value="btc">Bitcoin</SelectItem><SelectItem value="eth">Ethereum</SelectItem><SelectItem value="ltc">Litecoin</SelectItem></SelectContent></Select></div><Button disabled={creatingDeposit} onClick={() => void createCryptoDeposit()}>{creatingDeposit ? "Creating…" : "Create invoice"}</Button></div>}
              {depositError && <p className="text-sm text-destructive">{depositError}</p>}
            </CardContent>
          </Card>

          <Card className="surface mb-6">
            <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><CreditCard className="h-5 w-5 text-primary" />Other Payment Methods</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {manualMethods.length === 0 ? (
                <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">No manual payment method is enabled. Finance staff can add one from Admin → Payment Methods.</div>
              ) : profile?.kyc_status !== "approved" ? (
                <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm">Approved KYC is required before submitting a deposit.</div>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {manualMethods.map((method) => (
                      <button key={method.id} type="button" onClick={() => { setSelectedManualMethod(method.id); setManualMessage(""); }} className={`rounded-lg border p-4 text-left transition-colors ${selectedManualMethod === method.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
                        <div className="font-semibold">{method.name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{method.currency}{method.network ? ` · ${method.network}` : ""}</div>
                        <div className="mt-2 text-[10px] text-muted-foreground">Limits: ${Number(method.min_amount).toFixed(2)}–${Number(method.max_amount).toFixed(2)}</div>
                      </button>
                    ))}
                  </div>
                  {selectedManualMethod && (() => {
                    const method = manualMethods.find((item) => item.id === selectedManualMethod);
                    if (!method) return null;
                    return <div className="space-y-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
                      <div><div className="text-xs font-bold uppercase text-muted-foreground">Send payment to</div><div className="mt-1 flex gap-2"><Input readOnly value={method.destination_reference || ""} className="font-mono text-xs" /><Button variant="outline" size="icon" onClick={() => void navigator.clipboard.writeText(method.destination_reference || "")}><Copy className="h-4 w-4" /></Button></div></div>
                      {method.instructions && <p className="text-sm text-muted-foreground">{method.instructions}</p>}
                      <div className="grid gap-3 md:grid-cols-2"><label className="space-y-1.5"><Label>Amount (USD)</Label><Input type="number" min={method.min_amount} max={method.max_amount} step="0.01" value={manualAmount} onChange={(event) => setManualAmount(event.target.value)} /></label><label className="space-y-1.5"><Label>Transaction hash / reference</Label><Input value={manualReference} onChange={(event) => setManualReference(event.target.value)} placeholder="Paste payment reference" /></label></div>
                      <label className="block space-y-1.5"><Label>Note (optional)</Label><Input value={manualNote} onChange={(event) => setManualNote(event.target.value)} placeholder="Sender wallet or transfer note" /></label>
                      <label className="block space-y-1.5"><Label>Payment proof (optional)</Label><Input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setManualProof(event.target.files?.[0] || null)} /><span className="text-xs text-muted-foreground">Private JPG, PNG, WebP or PDF; maximum 5 MB.</span></label>
                      <Button onClick={() => void submitManualDeposit()} disabled={manualSubmitting}>{manualSubmitting ? "Submitting…" : "Submit deposit for review"}</Button>
                      <p className="text-xs text-muted-foreground">Submitting a reference does not credit funds automatically. Finance staff must verify the payment and approve it.</p>
                    </div>;
                  })()}
                </>
              )}
              {manualMessage && <p className="text-sm font-medium">{manualMessage}</p>}
            </CardContent>
          </Card>

          <Card className="surface mb-6 border-warning/20">
            <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><ArrowUpRight className="h-5 w-5 text-warning" />Manual Withdrawal</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {manualMethods.length === 0 ? <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">No manual payout method is enabled.</div> : profile?.kyc_status !== "approved" ? <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm">Approved KYC is required before requesting a withdrawal.</div> : <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{manualMethods.map((method) => <button key={`withdraw-${method.id}`} type="button" onClick={() => { setWithdrawalMethod(method.id); setWithdrawalMessage(""); }} className={`rounded-lg border p-4 text-left transition-colors ${withdrawalMethod === method.id ? "border-warning bg-warning/5" : "border-border hover:border-warning/40"}`}><div className="font-semibold">{method.name}</div><div className="mt-1 text-xs text-muted-foreground">{method.currency}{method.network ? ` · ${method.network}` : ""}</div><div className="mt-2 text-[10px] text-muted-foreground">Limits: ${Number(method.min_amount).toFixed(2)}–${Number(method.max_amount).toFixed(2)}</div></button>)}</div>
                {withdrawalMethod && <div className="space-y-4 rounded-lg border border-warning/20 bg-warning/5 p-4">
                  <div className="rounded-lg border border-border bg-background/70 p-4">
                    <div className="mb-3"><p className="font-semibold">Saved withdrawal destinations</p><p className="text-xs text-muted-foreground">New destinations can have an admin-configured security cooling period.</p></div>
                    <div className="space-y-2">
                      {withdrawalAddresses.filter((item) => item.payment_method_id === withdrawalMethod).map((address) => {
                        const active = address.status !== "blocked" && new Date(address.activates_at).getTime() <= Date.now();
                        return <div key={address.id} className={`flex items-center gap-3 rounded border p-3 ${selectedWithdrawalAddress === address.id ? "border-warning bg-warning/5" : "border-border"}`}>
                          <button type="button" disabled={!active} onClick={() => setSelectedWithdrawalAddress(address.id)} className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-60">
                            <div className="flex items-center gap-2"><span className="font-medium">{address.label}</span><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${active ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>{active ? "active" : "cooling"}</span></div>
                            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{address.destination_reference}</p>
                            {!active && <p className="mt-1 text-[10px] text-muted-foreground">Available {new Date(address.activates_at).toLocaleString()}</p>}
                          </button>
                          <Button type="button" variant="ghost" size="icon" aria-label="Remove saved destination" onClick={() => void removeWithdrawalAddress(address.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </div>;
                      })}
                      {withdrawalAddresses.filter((item) => item.payment_method_id === withdrawalMethod).length === 0 && <p className="text-xs text-muted-foreground">No destination saved for this payout method.</p>}
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-[0.7fr_1.3fr_auto] md:items-end"><label className="space-y-1.5"><Label>Label</Label><Input value={withdrawalAddressLabel} onChange={(event) => setWithdrawalAddressLabel(event.target.value)} placeholder="My wallet" /></label><label className="space-y-1.5"><Label>New wallet / account</Label><Input value={withdrawalDestination} onChange={(event) => setWithdrawalDestination(event.target.value)} placeholder="Destination address or account" /></label><Button type="button" variant="outline" onClick={() => void saveWithdrawalAddress()} disabled={savingWithdrawalAddress}>{savingWithdrawalAddress ? "Saving…" : "Save destination"}</Button></div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2"><label className="space-y-1.5"><Label>Amount (USD)</Label><Input type="number" min="0.01" step="0.01" value={withdrawalAmount} onChange={(event) => setWithdrawalAmount(event.target.value)} /></label><label className="space-y-1.5"><Label>Selected destination</Label><Input readOnly value={withdrawalAddresses.find((item) => item.id === selectedWithdrawalAddress)?.destination_reference || "Select an active saved destination"} className="font-mono text-xs" /></label></div>
                  <label className="block space-y-1.5"><Label>Note (optional)</Label><Input value={withdrawalNote} onChange={(event) => setWithdrawalNote(event.target.value)} placeholder="Network or payout instructions" /></label>
                  <Button onClick={() => void submitWithdrawal()} disabled={withdrawalSubmitting || !selectedWithdrawalAddress}>{withdrawalSubmitting ? "Reserving funds…" : "Request withdrawal"}</Button>
                  <p className="text-xs text-muted-foreground">Only cash funds are withdrawable. The amount moves to locked funds until two finance administrators review it.</p>
                </div>}
              </>}
              {withdrawalMessage && <p className="text-sm font-medium">{withdrawalMessage}</p>}
              {withdrawals.length > 0 && <div className="space-y-2 border-t border-border pt-4"><p className="text-sm font-semibold">Recent requests</p>{withdrawals.slice(0, 5).map((request) => <div key={request.id} className="flex flex-col gap-1 rounded border border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between"><div><span className="font-mono font-bold">${Number(request.amount).toFixed(2)}</span><span className="ml-2 capitalize text-muted-foreground">{request.status.replaceAll("_", " ")}</span>{request.review_note && <p className="text-xs text-muted-foreground">{request.review_note}</p>}</div><span className="text-xs text-muted-foreground">{new Date(request.created_at).toLocaleString()}</span></div>)}</div>}
            </CardContent>
          </Card>

          {/* Transactions */}
          <Card className="surface">
            <CardHeader>
              <CardTitle className="text-lg">Transaction History</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : transactions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No transactions yet
                </div>
              ) : (
                <div className="space-y-2">
                  {transactions.map((transaction) => (
                    <div
                      key={transaction.id}
                      className="flex items-center justify-between p-3 rounded bg-background border border-border hover:border-primary/30 transition-smooth"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-surface flex items-center justify-center">
                          {getTransactionIcon(transaction.type)}
                        </div>
                        <div>
                          <div className="text-sm font-semibold">{transaction.description}</div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(transaction.created_at).toLocaleString()}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-sm font-bold font-mono ${getTransactionColor(transaction.amount)}`}>
                          {transaction.amount > 0 ? "+" : ""}${Math.abs(transaction.amount).toFixed(2)}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">
                          Balance: ${transaction.balance_after.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      <Footer />
      <MobileBottomNav />
    </div>
  );
}
