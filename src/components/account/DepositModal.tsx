import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bitcoin, CreditCard, Copy, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

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
};

type DepositModalProps = {
  open: boolean;
  onClose: () => void;
  kycStatus: string;
  onDepositComplete: () => void;
};

export function DepositModal({ open, onClose, kycStatus, onDepositComplete }: DepositModalProps) {
  const { toast } = useToast();
  const [depositAmount, setDepositAmount] = useState("25");
  const [depositCurrency, setDepositCurrency] = useState("usdttrc20");
  const [selectedProvider, setSelectedProvider] = useState("ccpayment");
  const [activeTab, setActiveTab] = useState("manual");
  const [creatingDeposit, setCreatingDeposit] = useState(false);
  const [cryptoInvoice, setCryptoInvoice] = useState<any>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [manualAmount, setManualAmount] = useState("25");
  const [manualReference, setManualReference] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualProof, setManualProof] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) void loadPaymentMethods();
  }, [open]);

  async function loadPaymentMethods() {
    const { data } = await (supabase as any)
      .from("payment_methods")
      .select("*")
      .eq("is_enabled", true)
      .order("display_order", { ascending: true });
    
    const methods = (data || []) as PaymentMethod[];
    setPaymentMethods(methods);
    
    const manualMethod = methods.find(m => m.method_type !== "provider");
    if (manualMethod) setSelectedMethod(manualMethod.id);

    const provider = methods.find(m => m.method_type === "provider" && m.provider_code === "ccpayment")
      || methods.find(m => m.method_type === "provider" && m.provider_code === "nowpayments");
    if (provider?.provider_code) {
      setSelectedProvider(provider.provider_code);
      setActiveTab("crypto");
    } else if (manualMethod) {
      setActiveTab("manual");
    }
  }

  async function createCryptoDeposit() {
    const amount = Number(depositAmount);
    if (!Number.isFinite(amount) || amount < 10) {
      toast({ title: "Minimum deposit is $10", variant: "destructive" });
      return;
    }

    setCreatingDeposit(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Please sign in again");

      const isCCPayment = selectedProvider === "ccpayment";
      const response = await fetch(
        isCCPayment ? "/api/payments/crypto/ccpayment-create" : "/api/payments/crypto/create",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            amount,
            ...(isCCPayment ? {} : { payCurrency: depositCurrency }),
            idempotencyKey: crypto.randomUUID(),
          }),
        }
      );

      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to create invoice");

      setCryptoInvoice(body.invoice);
      toast({
        title: body.invoice?.checkout_url ? "Secure checkout is ready" : "Crypto invoice created",
      });
    } catch (error) {
      toast({
        title: "Deposit failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCreatingDeposit(false);
    }
  }

  async function submitManualDeposit() {
    const method = paymentMethods.find(m => m.id === selectedMethod);
    const amount = Number(manualAmount);

    if (!method) {
      toast({ title: "Select a payment method", variant: "destructive" });
      return;
    }

    if (!Number.isFinite(amount) || amount < method.min_amount || amount > method.max_amount) {
      toast({
        title: `Amount must be between $${method.min_amount.toFixed(2)} and $${method.max_amount.toFixed(2)}`,
        variant: "destructive",
      });
      return;
    }

    if (manualReference.trim().length < 4) {
      toast({ title: "Enter transaction reference", variant: "destructive" });
      return;
    }

    setSubmitting(true);

    try {
      let proofPath: string | null = null;

      if (manualProof) {
        const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
        if (!allowed.includes(manualProof.type) || manualProof.size > 5 * 1024 * 1024) {
          throw new Error("Proof must be JPG, PNG, WebP or PDF up to 5MB");
        }

        const extension = manualProof.name.split(".").pop()?.toLowerCase() || "bin";
        const { data: { user } } = await supabase.auth.getUser();
        proofPath = `${user?.id}/${crypto.randomUUID()}.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from("payment-proofs")
          .upload(proofPath, manualProof);

        if (uploadError) throw uploadError;
      }

      const { data, error } = await (supabase as any).rpc("submit_manual_deposit_request", {
        p_payment_method_id: method.id,
        p_amount: amount,
        p_transaction_reference: manualReference.trim(),
        p_user_note: manualNote.trim() || null,
        p_proof_file_path: proofPath,
      });

      if (error) throw error;

      toast({
        title: "Deposit submitted",
        description: `Request ${String(data).slice(0, 8)} submitted for review`,
      });

      setManualReference("");
      setManualNote("");
      setManualProof(null);
      onDepositComplete();
    } catch (error) {
      toast({
        title: "Submission failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const providerMethods = paymentMethods.filter(
    m => m.method_type === "provider" && ["ccpayment", "nowpayments"].includes(m.provider_code || "")
  );
  const providerEnabled = providerMethods.length > 0;
  const cryptoEnabled = process.env.NEXT_PUBLIC_CRYPTO_DEPOSITS_ENABLED === "true" && providerEnabled;
  const manualMethods = paymentMethods.filter(m => m.method_type !== "provider");
  const kycApproved = true; // KYC is not required by platform policy.

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Deposit Funds</DialogTitle>
          <DialogDescription>
            Add funds to your account.
          </DialogDescription>
        </DialogHeader>

        {!kycApproved && (
          <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
            <p className="text-sm font-medium">KYC Verification Required</p>
            <p className="text-sm text-muted-foreground mt-1">
              Complete identity verification to deposit funds
            </p>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="crypto" disabled={!cryptoEnabled || !kycApproved}>
              <Bitcoin className="h-4 w-4 mr-2" />
              Crypto
            </TabsTrigger>
            <TabsTrigger value="manual" disabled={!kycApproved}>
              <CreditCard className="h-4 w-4 mr-2" />
              Other Methods
            </TabsTrigger>
          </TabsList>

          <TabsContent value="crypto" className="space-y-4">
            {cryptoInvoice ? (
              <div className="space-y-4">
                {cryptoInvoice.checkout_url ? (
                  <div className="space-y-4 rounded-lg border border-success/30 bg-success/5 p-4">
                    <div>
                      <Label className="text-xs uppercase text-muted-foreground">CCPayment secure checkout</Label>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Choose a supported coin and network on CCPayment. Your wallet is credited only after the payment is confirmed and reconciled.
                      </p>
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => window.location.assign(cryptoInvoice.checkout_url)}
                    >
                      Continue to CCPayment
                      <ExternalLink className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-lg border border-success/30 bg-success/5 p-4">
                    <Label className="text-xs uppercase text-muted-foreground">Send Exactly</Label>
                    <div className="mt-1 font-mono text-2xl font-bold">
                      {cryptoInvoice.pay_amount} {String(cryptoInvoice.pay_currency).toUpperCase()}
                    </div>
                    <Label className="mt-4 block text-xs uppercase text-muted-foreground">Deposit Address</Label>
                    <div className="mt-1 flex gap-2">
                      <Input readOnly value={cryptoInvoice.pay_address || ""} className="font-mono text-xs" />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => navigator.clipboard.writeText(cryptoInvoice.pay_address || "")}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Funds credit after blockchain confirmation. Wrong network may lose funds.
                    </p>
                  </div>
                )}
                <Button variant="outline" onClick={() => setCryptoInvoice(null)} className="w-full">
                  Create New Invoice
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Payment provider</Label>
                  <Select value={selectedProvider} onValueChange={(value) => { setSelectedProvider(value); setCryptoInvoice(null); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {providerMethods.map((method) => (
                        <SelectItem key={method.id} value={method.provider_code!}>{method.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className={`grid gap-4 ${selectedProvider === "ccpayment" ? "" : "sm:grid-cols-2"}`}>
                  <div className="space-y-2">
                    <Label htmlFor="crypto-amount">USD Amount</Label>
                    <Input
                      id="crypto-amount"
                      type="number"
                      min="10"
                      max="100000"
                      step="0.01"
                      value={depositAmount}
                      onChange={e => setDepositAmount(e.target.value)}
                    />
                  </div>

                  {selectedProvider !== "ccpayment" && (
                    <div className="space-y-2">
                      <Label>Cryptocurrency</Label>
                      <Select value={depositCurrency} onValueChange={setDepositCurrency}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="usdttrc20">USDT · TRON</SelectItem>
                          <SelectItem value="usdtbsc">USDT · BSC</SelectItem>
                          <SelectItem value="btc">Bitcoin</SelectItem>
                          <SelectItem value="eth">Ethereum</SelectItem>
                          <SelectItem value="ltc">Litecoin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                {selectedProvider === "ccpayment" && (
                  <p className="text-xs text-muted-foreground">
                    CCPayment opens a secure hosted page where you choose the coin and network.
                  </p>
                )}

                <Button onClick={createCryptoDeposit} disabled={creatingDeposit} className="w-full">
                  {creatingDeposit
                    ? "Creating Invoice..."
                    : selectedProvider === "ccpayment"
                      ? "Continue to Secure Checkout"
                      : "Create Crypto Invoice"}
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="manual" className="space-y-4">
            {manualMethods.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No manual payment methods available
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {manualMethods.map(method => (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => setSelectedMethod(method.id)}
                      className={`rounded-lg border p-4 text-left transition-colors ${
                        selectedMethod === method.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/40"
                      }`}
                    >
                      <div className="font-semibold">{method.name}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {method.currency}
                        {method.network && ` · ${method.network}`}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-2">
                        ${method.min_amount.toFixed(2)}–${method.max_amount.toFixed(2)}
                      </div>
                    </button>
                  ))}
                </div>

                {selectedMethod && (() => {
                  const method = manualMethods.find(m => m.id === selectedMethod);
                  if (!method) return null;

                  return (
                    <div className="space-y-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
                      {method.destination_reference && (
                        <div>
                          <Label className="text-xs uppercase text-muted-foreground">
                            Send Payment To
                          </Label>
                          <div className="flex gap-2 mt-1">
                            <Input
                              readOnly
                              value={method.destination_reference}
                              className="font-mono text-xs"
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() =>
                                navigator.clipboard.writeText(method.destination_reference || "")
                              }
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}

                      {method.instructions && (
                        <p className="text-sm text-muted-foreground">{method.instructions}</p>
                      )}

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Amount (USD)</Label>
                          <Input
                            type="number"
                            min={method.min_amount}
                            max={method.max_amount}
                            step="0.01"
                            value={manualAmount}
                            onChange={e => setManualAmount(e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Transaction Reference</Label>
                          <Input
                            value={manualReference}
                            onChange={e => setManualReference(e.target.value)}
                            placeholder="TX hash or reference"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Note (Optional)</Label>
                        <Input
                          value={manualNote}
                          onChange={e => setManualNote(e.target.value)}
                          placeholder="Sender wallet or note"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Payment Proof (Optional)</Label>
                        <Input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          onChange={e => setManualProof(e.target.files?.[0] || null)}
                        />
                        <p className="text-xs text-muted-foreground">
                          JPG, PNG, WebP or PDF; max 5MB
                        </p>
                      </div>

                      <Button
                        onClick={submitManualDeposit}
                        disabled={submitting}
                        className="w-full"
                      >
                        {submitting ? "Submitting..." : "Submit for Review"}
                      </Button>

                      <p className="text-xs text-muted-foreground">
                        Finance staff will verify and approve your deposit
                      </p>
                    </div>
                  );
                })()}
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}