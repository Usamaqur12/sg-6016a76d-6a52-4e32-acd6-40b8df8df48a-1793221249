import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Clock, CheckCircle, XCircle, DollarSign, ArrowUpCircle, ArrowDownCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";

interface Transaction {
  id: string;
  user_id: string;
  user_email: string;
  type: string;
  amount: number;
  status: string;
  created_at: string;
}

export default function AdminTransactions() {
  const { toast } = useToast();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadTransactions();
  }, []);

  async function loadTransactions() {
    try {
      const { data: txs } = await supabase
        .from("wallet_transactions")
        .select("id, user_id, type, amount, status, created_at")
        .order("created_at", { ascending: false })
        .limit(100);

      if (txs) {
        // Get user emails
        const userIds = [...new Set(txs.map(t => t.user_id))];
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, email")
          .in("id", userIds);

        const emailMap = new Map(profiles?.map(p => [p.id, p.email]) || []);

        setTransactions(
          txs.map(tx => ({
            ...tx,
            user_email: emailMap.get(tx.user_id) || "Unknown",
          }))
        );
      }
    } catch (error: any) {
      toast({
        title: "Error loading transactions",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const pending = transactions.filter(t => t.status === "pending");
  const completed = transactions.filter(t => t.status === "completed");
  const failed = transactions.filter(t => t.status === "failed");

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Transaction Ledger</h1>
            <p className="text-sm text-muted-foreground">Immutable wallet transaction history</p>
          </div>
          <Button asChild>
            <Link href="/admin/payments"><ShieldCheck className="mr-2 h-4 w-4" />Open payment review queues</Link>
          </Button>
        </div>

        <div className="rounded-lg border border-primary/25 bg-primary/5 p-4 text-sm text-muted-foreground">
          Deposits and withdrawals cannot be approved by editing this ledger. Use the Payments review queues, where validation, maker-checker approval, wallet posting, notifications, and audit records run atomically.
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="surface">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{pending.length}</div>
                  <div className="text-xs text-muted-foreground">Pending</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="surface">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
                  <CheckCircle className="h-5 w-5 text-success" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{completed.length}</div>
                  <div className="text-xs text-muted-foreground">Completed</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="surface">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-danger/10 flex items-center justify-center">
                  <XCircle className="h-5 w-5 text-danger" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{failed.length}</div>
                  <div className="text-xs text-muted-foreground">Failed</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="surface">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <DollarSign className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-2xl font-bold font-mono">
                    ${pending.reduce((sum, t) => sum + t.amount, 0).toFixed(0)}
                  </div>
                  <div className="text-xs text-muted-foreground">Pending Value</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Transactions */}
        <Card className="surface">
          <CardHeader>
            <CardTitle>Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="pending">
              <TabsList className="mb-4">
                <TabsTrigger value="pending">
                  Pending ({pending.length})
                </TabsTrigger>
                <TabsTrigger value="completed">
                  Completed ({completed.length})
                </TabsTrigger>
                <TabsTrigger value="failed">
                  Failed ({failed.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="pending" className="space-y-3">
                {loading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
                    ))}
                  </div>
                ) : pending.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-8">
                    No pending transactions
                  </p>
                ) : (
                  pending.map((tx) => <TransactionCard key={tx.id} transaction={tx} />)
                )}
              </TabsContent>

              <TabsContent value="completed" className="space-y-3">
                {completed.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-8">
                    No completed transactions
                  </p>
                ) : (
                  completed.slice(0, 20).map((tx) => (
                    <TransactionCard key={tx.id} transaction={tx} />
                  ))
                )}
              </TabsContent>

              <TabsContent value="failed" className="space-y-3">
                {failed.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-8">
                    No failed transactions
                  </p>
                ) : (
                  failed.slice(0, 20).map((tx) => (
                    <TransactionCard key={tx.id} transaction={tx} />
                  ))
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

    </AdminLayout>
  );
}

function TransactionCard({
  transaction,
}: {
  transaction: Transaction;
}) {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="outline" className="border-warning text-warning">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case "completed":
        return (
          <Badge className="bg-success/10 text-success border-success/30">
            <CheckCircle className="h-3 w-3 mr-1" />
            Completed
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getTypeIcon = (type: string) => {
    return type === "deposit" ? (
      <ArrowDownCircle className="h-4 w-4 text-success" />
    ) : (
      <ArrowUpCircle className="h-4 w-4 text-warning" />
    );
  };

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between p-4 rounded-lg border border-border gap-4">
      <div className="flex items-center gap-4 flex-1">
        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
          {getTypeIcon(transaction.type)}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <span className="font-medium capitalize">{transaction.type}</span>
            {getStatusBadge(transaction.status)}
          </div>
          <div className="text-sm text-muted-foreground space-y-0.5">
            <div>{transaction.user_email}</div>
            <div>
              {new Date(transaction.created_at).toLocaleString()}
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="text-lg font-bold font-mono">
            ${transaction.amount.toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
}
