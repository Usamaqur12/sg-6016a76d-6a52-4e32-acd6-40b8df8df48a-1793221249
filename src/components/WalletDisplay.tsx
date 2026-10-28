import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Wallet, TrendingUp, TrendingDown, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface WalletDisplayProps {
  userId?: string;
  showDetails?: boolean;
  compact?: boolean;
}

interface WalletBalance {
  balance: number;
  currency: string;
}

interface Transaction {
  id: string;
  type: string;
  amount: number;
  status: string;
  description: string | null;
  created_at: string;
}

export function WalletDisplay({ userId, showDetails = false, compact = false }: WalletDisplayProps) {
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const { toast } = useToast();

  useEffect(() => {
    loadWallet();
  }, [userId]);

  async function loadWallet() {
    try {
      // Get current user if no userId provided
      const targetUserId = userId || (await supabase.auth.getUser()).data.user?.id;
      if (!targetUserId) {
        setLoading(false);
        return;
      }

      // Get wallet account
      const { data: wallet, error } = await supabase
        .from("wallet_accounts")
        .select("balance, currency")
        .eq("user_id", targetUserId)
        .single();

      if (error) throw error;

      setBalance(wallet);

      // Load transactions if showing details
      if (showDetails) {
        const { data: txs } = await supabase
          .from("wallet_transactions")
          .select("id, type, amount, status, description, created_at")
          .eq("user_id", targetUserId)
          .order("created_at", { ascending: false })
          .limit(10);

        setTransactions(txs || []);
      }
    } catch (error: any) {
      console.error("Failed to load wallet:", error);
      toast({
        title: "Error loading wallet",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <Card className={compact ? "border-0 shadow-none" : ""}>
        <CardContent className={compact ? "p-2" : "p-4"}>
          <Skeleton className="h-8 w-32" />
        </CardContent>
      </Card>
    );
  }

  if (!balance) {
    return null;
  }

  const availableBalance = balance.balance;
  const totalBalance = balance.balance;

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4 text-muted-foreground" />
        <div className="flex flex-col">
          <span className="text-sm font-semibold">
            ${availableBalance.toFixed(2)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          Wallet Balance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Balance Display */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Available Balance:</span>
            <span className="text-2xl font-bold">${availableBalance.toFixed(2)}</span>
          </div>
        </div>

        {/* Withdrawal History */}
        {showDetails && transactions.length > 0 && (
          <div className="space-y-2 pt-4 border-t">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Recent Transactions
            </h4>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {transactions.map((tx) => (
                <TransactionItem key={tx.id} transaction={tx} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TransactionItem({ transaction }: { transaction: Transaction }) {
  const isCredit = transaction.amount > 0;
  const isWithdrawal = transaction.type === "withdrawal";

  return (
    <div className="flex items-center justify-between p-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {isWithdrawal ? (
          <TrendingDown className="h-4 w-4 text-destructive flex-shrink-0" />
        ) : (
          <TrendingUp className={`h-4 w-4 ${isCredit ? "text-green-600" : "text-muted-foreground"} flex-shrink-0`} />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">
            {formatTransactionType(transaction.type)}
          </div>
          {transaction.description && (
            <div className="text-xs text-muted-foreground truncate">
              {transaction.description}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            {new Date(transaction.created_at).toLocaleDateString()}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`text-sm font-semibold ${isCredit ? "text-green-600" : "text-muted-foreground"}`}>
          {isCredit ? "+" : ""}${Math.abs(transaction.amount).toFixed(2)}
        </span>
        <TransactionStatusBadge status={transaction.status} />
      </div>
    </div>
  );
}

function TransactionStatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    completed: { variant: "default", label: "Completed" },
    pending: { variant: "secondary", label: "Pending" },
    failed: { variant: "destructive", label: "Failed" },
  };

  const config = variants[status] || { variant: "outline", label: status };

  return (
    <Badge variant={config.variant} className="text-xs">
      {config.label}
    </Badge>
  );
}

function formatTransactionType(type: string): string {
  const labels: Record<string, string> = {
    deposit: "Deposit",
    withdrawal: "Withdrawal",
    bet_placed: "Bet Placed",
    bet_won: "Bet Won",
    adjustment: "Adjustment",
    bonus_awarded: "Bonus",
  };
  return labels[type] || type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}