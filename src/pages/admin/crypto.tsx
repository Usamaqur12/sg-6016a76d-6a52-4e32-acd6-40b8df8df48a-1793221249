import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bitcoin, CheckCircle2, Download, RefreshCw } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

interface CryptoInvoice {
  id: string;
  user_id: string;
  provider: string;
  provider_payment_id: string | null;
  fiat_amount: number;
  fiat_currency: string;
  pay_currency: string;
  pay_amount: number | null;
  actually_paid: number;
  tx_hash: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface WebhookEvent {
  id: string;
  provider_payment_id: string;
  payment_status: string;
  signature_verified: boolean;
  processed_at: string;
}

function escapeCsv(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export default function CryptoReconciliation() {
  const [invoices, setInvoices] = useState<CryptoInvoice[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [invoiceResult, webhookResult] = await Promise.all([
      (supabase as any).from("crypto_deposit_invoices").select("*").order("created_at", { ascending: false }).limit(250),
      (supabase as any).from("crypto_webhook_events").select("id,provider_payment_id,payment_status,signature_verified,processed_at").order("processed_at", { ascending: false }).limit(250),
    ]);
    setInvoices((invoiceResult.data || []) as CryptoInvoice[]);
    setWebhooks((webhookResult.data || []) as WebhookEvent[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return invoices;
    return invoices.filter((invoice) => [invoice.id, invoice.user_id, invoice.provider_payment_id, invoice.tx_hash, invoice.pay_currency, invoice.status].some((value) => String(value || "").toLowerCase().includes(needle)));
  }, [invoices, query]);

  const completed = invoices.filter((invoice) => invoice.status === "completed");
  const pending = invoices.filter((invoice) => ["creating", "waiting", "confirming", "partially_paid"].includes(invoice.status));
  const exceptions = invoices.filter((invoice) => ["failed", "expired", "refunded", "partially_paid"].includes(invoice.status));
  const totalCompleted = completed.reduce((sum, invoice) => sum + Number(invoice.fiat_amount || 0), 0);
  const verifiedWebhookIds = new Set(webhooks.filter((event) => event.signature_verified).map((event) => event.provider_payment_id));

  function exportCsv() {
    const headers = ["invoice_id", "user_id", "provider_payment_id", "fiat_amount", "fiat_currency", "pay_currency", "pay_amount", "actually_paid", "status", "tx_hash", "created_at", "updated_at"];
    const rows = filtered.map((invoice) => headers.map((key) => escapeCsv(invoice[key as keyof CryptoInvoice])).join(","));
    const blob = new Blob([[headers.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `crypto-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AdminLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h1 className="flex items-center gap-2 text-2xl font-bold"><Bitcoin className="h-6 w-6 text-primary" />Crypto Reconciliation</h1><p className="text-sm text-muted-foreground">Signed provider events, payment exceptions and ledger-ready deposits.</p></div>
          <div className="flex gap-2"><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button><Button onClick={exportCsv} disabled={!filtered.length}><Download className="mr-2 h-4 w-4" />Export CSV</Button></div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Completed volume" value={`$${totalCompleted.toFixed(2)}`} tone="success" />
          <Metric label="Pending" value={String(pending.length)} />
          <Metric label="Exceptions" value={String(exceptions.length)} tone={exceptions.length ? "warning" : "success"} />
          <Metric label="Verified webhooks" value={String(webhooks.filter((event) => event.signature_verified).length)} tone="success" />
        </div>

        <Card>
          <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between"><CardTitle>Deposit invoices</CardTitle><Input className="sm:max-w-sm" placeholder="Search invoice, user, payment or tx hash" value={query} onChange={(event) => setQuery(event.target.value)} /></CardHeader>
          <CardContent className="space-y-3">
            {loading ? <div className="py-10 text-center text-sm text-muted-foreground">Loading provider records…</div> : filtered.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">No crypto invoices found.</div> : filtered.map((invoice) => {
              const hasVerifiedWebhook = invoice.provider_payment_id ? verifiedWebhookIds.has(invoice.provider_payment_id) : false;
              const mismatch = invoice.status === "completed" && Number(invoice.actually_paid || 0) + 1e-12 < Number(invoice.pay_amount || 0);
              return <div key={invoice.id} className="rounded-lg border border-border p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{invoice.provider_payment_id || invoice.id}</span><Status status={invoice.status} />{hasVerifiedWebhook ? <Badge variant="outline" className="border-success/30 text-success"><CheckCircle2 className="mr-1 h-3 w-3" />Signed webhook</Badge> : invoice.provider_payment_id && <Badge variant="outline" className="border-warning/30 text-warning"><AlertTriangle className="mr-1 h-3 w-3" />No signed event loaded</Badge>}</div><p className="mt-2 break-all text-xs text-muted-foreground">User {invoice.user_id}{invoice.tx_hash ? ` · Tx ${invoice.tx_hash}` : ""}</p></div><div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm lg:text-right"><div><span className="text-muted-foreground">Invoice</span><div className="font-mono font-bold">{Number(invoice.fiat_amount).toFixed(2)} {invoice.fiat_currency}</div></div><div><span className="text-muted-foreground">Crypto paid</span><div className={mismatch ? "font-mono font-bold text-danger" : "font-mono font-bold"}>{Number(invoice.actually_paid || 0).toFixed(8)} {invoice.pay_currency.toUpperCase()}</div></div></div></div>{mismatch && <p className="mt-3 rounded bg-danger/10 px-3 py-2 text-xs text-danger">Completed invoice is underpaid. Hold reconciliation and investigate provider data.</p>}</div>;
            })}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" }) {
  return <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-1 text-2xl font-black ${tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : ""}`}>{value}</p></CardContent></Card>;
}

function Status({ status }: { status: string }) {
  const variant = status === "completed" ? "default" : ["failed", "refunded"].includes(status) ? "destructive" : "secondary";
  return <Badge variant={variant}>{status.replaceAll("_", " ")}</Badge>;
}
