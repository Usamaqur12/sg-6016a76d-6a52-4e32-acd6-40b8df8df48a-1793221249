import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";
import { settleBet } from "@/services/settlementService";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Search, Trophy, XCircle, Ban, Eye, Calendar, Wallet 
} from "lucide-react";
import { canAccessAdminArea } from "@/lib/adminRoles";

export default function AdminBets() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [bets, setBets] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "won" | "lost" | "void">("all");
  const [loading, setLoading] = useState(true);
  const [expandedBetId, setExpandedBetId] = useState<string | null>(null);

  useEffect(() => {
    checkAdmin();
  }, []);

  async function checkAdmin() {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      router.push("/auth/login");
      return;
    }

    // Check if user is admin
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (!profile || !canAccessAdminArea(profile.admin_role, "bets")) {
      router.push("/");
      return;
    }

    setUser(user);
    loadBets();
  }

  async function loadBets() {
    setLoading(true);

    const { data, error } = await supabase
      .from("bets")
      .select(`
        *,
        profiles (email),
        bet_selections (*)
      `)
      .order("created_at", { ascending: false });

    if (data) {
      setBets(data);
    }

    setLoading(false);
  }

  async function handleSettle(betId: string, result: "won" | "lost" | "void") {
    if (!user?.id) return;
    
    const { success, error } = await settleBet({
      betId,
      settlementType: result === "won" ? "win" : result === "lost" ? "loss" : "void",
      settledBy: user.id,
      reason: `Manual settlement by admin`,
    });

    if (success) {
      alert(`Bet settled as ${result}`);
      loadBets();
    } else {
      alert(`Failed to settle bet: ${error}`);
    }
  }

  const filteredBets = bets.filter(bet => {
    const matchesSearch = 
      bet.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      bet.profiles?.email?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesFilter = filter === "all" || bet.status === filter;
    
    return matchesSearch && matchesFilter;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "won":
        return <Badge className="bg-success/10 text-success border-success/30 text-xs">Won</Badge>;
      case "lost":
        return <Badge className="bg-danger/10 text-danger border-danger/30 text-xs">Lost</Badge>;
      case "void":
        return <Badge variant="outline" className="text-xs">Void</Badge>;
      default:
        return <Badge variant="outline" className="badge-featured text-xs">Pending</Badge>;
    }
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "single":
        return <Badge variant="outline" className="text-xs">Single</Badge>;
      case "multiple":
        return <Badge className="bg-primary/10 text-primary border-primary/30 text-xs">Multiple</Badge>;
      case "system":
        return <Badge className="bg-gold/10 text-gold border-gold/30 text-xs">System</Badge>;
      default:
        return <Badge variant="outline" className="text-xs">{type}</Badge>;
    }
  };

  return (
    <AdminLayout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1">Bet Management</h1>
          <p className="text-sm text-muted-foreground">
            View and settle all bets across the platform
          </p>
        </div>

        {/* Search & Filters */}
        <Card className="surface mb-6">
          <CardContent className="p-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by bet ID or user email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
              <TabsList className="w-full grid grid-cols-5">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="pending">Pending</TabsTrigger>
                <TabsTrigger value="won">Won</TabsTrigger>
                <TabsTrigger value="lost">Lost</TabsTrigger>
                <TabsTrigger value="void">Void</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardContent>
        </Card>

        {/* Bets Table */}
        <Card className="surface">
          <CardHeader>
            <CardTitle className="text-lg">All Bets ({filteredBets.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : filteredBets.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No bets found</div>
              ) : (
                filteredBets.map((bet) => (
                  <div 
                    key={bet.id} 
                    className="p-4 rounded-md border border-border hover:border-primary/30 transition-smooth"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs text-muted-foreground font-mono">
                            {bet.id.substring(0, 8)}
                          </span>
                          {getTypeBadge(bet.bet_type)}
                          {getStatusBadge(bet.status)}
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">User:</span>
                            <span className="font-medium truncate">{bet.profiles?.email || "Unknown"}</span>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-muted-foreground">Stake:</span>
                            <span className="font-mono font-semibold">${bet.stake?.toFixed(2)}</span>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <Trophy className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-muted-foreground">Potential:</span>
                            <span className="font-mono font-semibold">${bet.potential_payout?.toFixed(2)}</span>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-muted-foreground">Placed:</span>
                            <span>{new Date(bet.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>

                        <div className="text-xs text-muted-foreground">
                          <span className="font-semibold">Selections:</span> {bet.selections?.length || 0} events @ {bet.total_odds?.toFixed(2)} odds
                        </div>
                      </div>

                      {bet.status === "pending" && (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1 bg-success/10 hover:bg-success/20 text-success border-success/30"
                            onClick={() => handleSettle(bet.id, "won")}
                          >
                            <Trophy className="h-3.5 w-3.5" />
                            Won
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1 bg-danger/10 hover:bg-danger/20 text-danger border-danger/30"
                            onClick={() => handleSettle(bet.id, "lost")}
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Lost
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => handleSettle(bet.id, "void")}
                          >
                            <Ban className="h-3.5 w-3.5" />
                            Void
                          </Button>
                        </div>
                      )}

                      {bet.status !== "pending" && (
                        <Button variant="outline" size="sm" className="gap-1 flex-shrink-0" onClick={() => setExpandedBetId((current) => current === bet.id ? null : bet.id)}>
                          <Eye className="h-3.5 w-3.5" />
                          {expandedBetId === bet.id ? "Hide" : "View"}
                        </Button>
                      )}
                    </div>
                    {expandedBetId === bet.id && <div className="mt-4 space-y-2 border-t border-border pt-3">{(bet.bet_selections || bet.selections || []).length === 0 ? <p className="text-xs text-muted-foreground">No selection details were returned.</p> : (bet.bet_selections || bet.selections).map((selection: any) => <div key={selection.id} className="grid gap-1 rounded bg-muted/30 p-2 text-xs md:grid-cols-[1fr_1fr_auto]"><span>{selection.event_name || selection.event_id}</span><span>{selection.selection}</span><span className="font-mono">@ {Number(selection.odds_value || selection.odds || 0).toFixed(2)}</span></div>)}</div>}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
