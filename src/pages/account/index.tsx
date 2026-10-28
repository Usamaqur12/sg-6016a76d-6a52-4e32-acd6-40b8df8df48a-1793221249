import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { SEO } from "@/components/SEO";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { 
  User, 
  Wallet, 
  FileText, 
  Shield, 
  Settings, 
  Bell,
  TrendingUp,
  Activity,
  DollarSign,
  Trophy,
} from "lucide-react";
import Link from "next/link";

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  kyc_status: string;
  balance: number;
  total_bets: number;
  total_wins: number;
  total_losses: number;
}

export default function AccountPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        router.push("/auth/login");
        return;
      }

      const { data: profileData } = await supabase
        .from("profiles")
        .select("id, email, full_name, kyc_status")
        .eq("id", user.id)
        .single();

      const { data: wallet } = await supabase
        .from("wallet_accounts")
        .select("balance")
        .eq("user_id", user.id)
        .single();

      const { data: bets } = await supabase
        .from("bets")
        .select("status")
        .eq("user_id", user.id);

      const totalBets = bets?.length || 0;
      const totalWins = bets?.filter(b => b.status === "won").length || 0;
      const totalLosses = bets?.filter(b => b.status === "lost").length || 0;

      setProfile({
        ...profileData,
        balance: wallet?.balance || 0,
        total_bets: totalBets,
        total_wins: totalWins,
        total_losses: totalLosses,
      } as Profile);
    } catch (error: any) {
      toast({
        title: "Error loading profile",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const getKycBadge = (status: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline", label: string }> = {
      verified: { variant: "default", label: "Verified" },
      pending: { variant: "secondary", label: "Pending" },
      rejected: { variant: "destructive", label: "Rejected" },
      not_submitted: { variant: "outline", label: "Not Submitted" },
    };
    
    const config = variants[status] || variants.not_submitted;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header user={null} onAuthClick={() => {}} />
        <main className="container mx-auto px-4 py-8">
          <div className="text-center py-12">Loading...</div>
        </main>
        <Footer />
        <MobileBottomNav />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-background">
        <Header user={null} onAuthClick={() => {}} />
        <main className="container mx-auto px-4 py-8">
          <div className="text-center py-12">Profile not found</div>
        </main>
        <Footer />
        <MobileBottomNav />
      </div>
    );
  }

  const winRate = profile.total_bets > 0 
    ? ((profile.total_wins / profile.total_bets) * 100).toFixed(1)
    : "0.0";

  return (
    <div className="min-h-screen bg-background">
      <Header user={profile} onAuthClick={() => {}} />
      
      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <SEO 
          title="My Account"
          description="Manage your account, betting history, and preferences"
        />

        {/* Account Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                Balance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${profile.balance.toFixed(2)}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Total Bets
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{profile.total_bets}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Trophy className="h-4 w-4" />
                Win Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{winRate}%</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Shield className="h-4 w-4" />
                KYC Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              {getKycBadge(profile.kyc_status)}
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Link href="/account/wallet">
            <Button variant="outline" className="w-full h-24 flex-col gap-2">
              <Wallet className="h-6 w-6" />
              <span>Wallet</span>
            </Button>
          </Link>

          <Link href="/account/bets">
            <Button variant="outline" className="w-full h-24 flex-col gap-2">
              <FileText className="h-6 w-6" />
              <span>Bet History</span>
            </Button>
          </Link>

          <Link href="/account/kyc">
            <Button variant="outline" className="w-full h-24 flex-col gap-2">
              <Shield className="h-6 w-6" />
              <span>Verification</span>
            </Button>
          </Link>

          <Link href="/account/settings">
            <Button variant="outline" className="w-full h-24 flex-col gap-2">
              <Settings className="h-6 w-6" />
              <span>Settings</span>
            </Button>
          </Link>
        </div>

        {/* Account Details */}
        <Card>
          <CardHeader>
            <CardTitle>Account Information</CardTitle>
            <CardDescription>Your personal details and account status</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-3 border-b">
                <span className="text-muted-foreground">Email</span>
                <span className="font-medium">{profile.email}</span>
              </div>
              
              <div className="flex items-center justify-between py-3 border-b">
                <span className="text-muted-foreground">Full Name</span>
                <span className="font-medium">{profile.full_name || "Not set"}</span>
              </div>
              
              <div className="flex items-center justify-between py-3 border-b">
                <span className="text-muted-foreground">KYC Status</span>
                {getKycBadge(profile.kyc_status)}
              </div>

              <div className="flex items-center justify-between py-3">
                <span className="text-muted-foreground">Account ID</span>
                <span className="font-mono text-xs">{profile.id.substring(0, 8)}...</span>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <Link href="/account/settings" className="flex-1">
                <Button variant="outline" className="w-full">
                  <Settings className="h-4 w-4 mr-2" />
                  Edit Profile
                </Button>
              </Link>
              
              {profile.kyc_status === "not_submitted" && (
                <Link href="/account/kyc" className="flex-1">
                  <Button className="w-full">
                    <Shield className="h-4 w-4 mr-2" />
                    Verify Account
                  </Button>
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      </main>

      <Footer />
      <MobileBottomNav />
    </div>
  );
}