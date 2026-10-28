import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowUpRight, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type PaymentMethod = {
  id: string;
  name: string;
  currency: string;
  network: string | null;
  min_amount: number;
  max_amount: number;
};

type WithdrawalAddress = {
  id: string;
  payment_method_id: string;
  label: string;
  destination_reference: string;
  status: "pending" | "cooling" | "active" | "blocked" | "removed";
  activates_at: string;
};

type WithdrawalModalProps = {
  open: boolean;
  onClose: () => void;
  kycStatus: string;
  cashBalance: number;
  onWithdrawalComplete: () => void;
};

export function WithdrawalModal({
  open,
  onClose,
  kycStatus,
  cashBalance,
  onWithdrawalComplete,
}: WithdrawalModalProps) {
  const { toast } = useToast();
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [amount, setAmount] = useState("25");
  const [addresses, setAddresses] = useState<WithdrawalAddress[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [newDestination, setNewDestination] = useState("");
  const [newLabel, setNewLabel] = useState("My wallet");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);

  useEffect(() => {
    if (open) {
      loadPaymentMethods();
      loadAddresses();
    }
  }, [open]);

  async function loadPaymentMethods() {
    const { data } = await (supabase as any)
      .from("payment_methods")
      .select("*")
      .eq("is_enabled", true)
      .neq("method_type", "provider")
      .order("display_order", { ascending: true });

    const methods = (data || []) as PaymentMethod[];
    setPaymentMethods(methods);

    if (methods.length > 0 && !selectedMethod) {
      setSelectedMethod(methods[0].id);
    }
  }

  async function loadAddresses() {
    const { data } = await (supabase as any)
      .from("withdrawal_addresses")
      .select("*")
      .order("created_at", { ascending: false });

    const filtered = ((data || []) as WithdrawalAddress[]).filter(a => a.status !== "removed");
    setAddresses(filtered);

    const activeAddress = filtered.find(
      a => a.status !== "blocked" && new Date(a.activates_at).getTime() <= Date.now()
    );
    if (activeAddress) {
      setSelectedAddress(activeAddress.id);
    }
  }

  async function saveAddress() {
    if (!selectedMethod) {
      toast({ title: "Select a payment method", variant: "destructive" });
      return;
    }

    if (newDestination.trim().length < 6) {
      toast({ title: "Enter a valid destination", variant: "destructive" });
      return;
    }

    setSavingAddress(true);

    try {
      const { data, error } = await (supabase as any).rpc("add_my_withdrawal_address", {
        p_payment_method_id: selectedMethod,
        p_label: newLabel.trim() || "My wallet",
        p_destination: newDestination.trim(),
      });

      if (error) throw error;

      toast({
        title: "Address saved",
        description: "Security cooling period may apply",
      });

      setNewDestination("");
      await loadAddresses();
      setSelectedAddress(String(data));
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSavingAddress(false);
    }
  }

  async function removeAddress(addressId: string) {
    try {
      const { error } = await (supabase as any).rpc("remove_my_withdrawal_address", {
        p_id: addressId,
      });

      if (error) throw error;

      toast({ title: "Address removed" });
      await loadAddresses();
    } catch (error) {
      toast({
        title: "Remove failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  async function submitWithdrawal() {
    const method = paymentMethods.find(m => m.id === selectedMethod);
    const address = addresses.find(a => a.id === selectedAddress);
    const withdrawAmount = Number(amount);

    if (!method) {
      toast({ title: "Select a payment method", variant: "destructive" });
      return;
    }

    if (!Number.isFinite(withdrawAmount) || withdrawAmount < method.min_amount || withdrawAmount > method.max_amount) {
      toast({
        title: `Amount must be between $${method.min_amount.toFixed(2)} and $${method.max_amount.toFixed(2)}`,
        variant: "destructive",
      });
      return;
    }

    if (withdrawAmount > cashBalance) {
      toast({ title: "Insufficient cash balance", variant: "destructive" });
      return;
    }

    if (!address) {
      toast({ title: "Select a saved address", variant: "destructive" });
      return;
    }

    if (address.status === "blocked" || new Date(address.activates_at).getTime() > Date.now()) {
      toast({
        title: "Address cooling down",
        description: `Available ${new Date(address.activates_at).toLocaleString()}`,
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);

    try {
      const { data, error } = await (supabase as any).rpc("submit_manual_withdrawal_request", {
        p_payment_method_id: method.id,
        p_amount: withdrawAmount,
        p_destination_reference: address.destination_reference,
        p_user_note: note.trim() || null,
      });

      if (error) throw error;

      toast({
        title: "Withdrawal submitted",
        description: `Request ${String(data).slice(0, 8)} pending review`,
      });

      setNote("");
      onWithdrawalComplete();
      onClose();
    } catch (error) {
      toast({
        title: "Withdrawal failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const kycApproved = kycStatus === "approved";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Withdraw Funds</DialogTitle>
          <DialogDescription>
            Withdraw funds from your account.
          </DialogDescription>
        </DialogHeader>

        {!kycApproved && (
          <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
            <p className="text-sm font-medium">KYC Verification Required</p>
            <p className="text-sm text-muted-foreground mt-1">
              Complete identity verification to withdraw funds
            </p>
          </div>
        )}

        {kycApproved && (
          <div className="space-y-6">
            <div className="rounded-lg border border-border bg-background/50 p-4">
              <Label className="text-xs uppercase text-muted-foreground">Available Cash</Label>
              <div className="text-2xl font-bold font-mono mt-1">${cashBalance.toFixed(2)}</div>
            </div>

            {paymentMethods.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No withdrawal methods available
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <Label>Payment Method</Label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {paymentMethods.map(method => (
                      <button
                        key={method.id}
                        type="button"
                        onClick={() => {
                          setSelectedMethod(method.id);
                          setSelectedAddress(null);
                        }}
                        className={`rounded-lg border p-4 text-left transition-colors ${
                          selectedMethod === method.id
                            ? "border-warning bg-warning/5"
                            : "border-border hover:border-warning/40"
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
                </div>

                {selectedMethod && (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-border bg-background/70 p-4 space-y-4">
                      <div>
                        <Label className="mb-3 block">Saved Addresses</Label>
                        <div className="space-y-2">
                          {addresses.filter(a => a.payment_method_id === selectedMethod).map(address => {
                            const isActive =
                              address.status !== "blocked" &&
                              new Date(address.activates_at).getTime() <= Date.now();

                            return (
                              <div
                                key={address.id}
                                className={`flex items-center gap-3 rounded border p-3 ${
                                  selectedAddress === address.id
                                    ? "border-warning bg-warning/5"
                                    : "border-border"
                                }`}
                              >
                                <button
                                  type="button"
                                  disabled={!isActive}
                                  onClick={() => setSelectedAddress(address.id)}
                                  className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">{address.label}</span>
                                    <span
                                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                                        isActive
                                          ? "bg-success/10 text-success"
                                          : "bg-warning/10 text-warning"
                                      }`}
                                    >
                                      {isActive ? "active" : "cooling"}
                                    </span>
                                  </div>
                                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                                    {address.destination_reference}
                                  </p>
                                  {!isActive && (
                                    <p className="mt-1 text-[10px] text-muted-foreground">
                                      Available {new Date(address.activates_at).toLocaleString()}
                                    </p>
                                  )}
                                </button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removeAddress(address.id)}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            );
                          })}

                          {addresses.filter(a => a.payment_method_id === selectedMethod).length === 0 && (
                            <p className="text-xs text-muted-foreground">
                              No saved addresses for this method
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="pt-4 border-t border-border">
                        <Label className="mb-3 block">Add New Address</Label>
                        <div className="grid gap-3 md:grid-cols-[0.7fr_1.3fr_auto] md:items-end">
                          <div className="space-y-2">
                            <Label>Label</Label>
                            <Input
                              value={newLabel}
                              onChange={e => setNewLabel(e.target.value)}
                              placeholder="My wallet"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Destination</Label>
                            <Input
                              value={newDestination}
                              onChange={e => setNewDestination(e.target.value)}
                              placeholder="Address or account"
                            />
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={saveAddress}
                            disabled={savingAddress}
                          >
                            {savingAddress ? "Saving..." : "Save"}
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Amount (USD)</Label>
                        <Input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={amount}
                          onChange={e => setAmount(e.target.value)}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Selected Address</Label>
                        <Input
                          readOnly
                          value={
                            addresses.find(a => a.id === selectedAddress)?.destination_reference ||
                            "Select an address"
                          }
                          className="font-mono text-xs"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Note (Optional)</Label>
                      <Input
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="Additional instructions"
                      />
                    </div>

                    <Button
                      onClick={submitWithdrawal}
                      disabled={submitting || !selectedAddress}
                      className="w-full"
                    >
                      {submitting ? "Submitting..." : "Request Withdrawal"}
                    </Button>

                    <p className="text-xs text-muted-foreground">
                      Funds are locked until two administrators review and approve
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}