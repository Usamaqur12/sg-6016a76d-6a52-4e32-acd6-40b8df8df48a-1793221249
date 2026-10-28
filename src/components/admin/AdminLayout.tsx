import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { hasAdminAccess, type AdminArea } from "@/lib/adminRoles";
import { 
  LayoutDashboard, Users, Receipt, CreditCard, Gift, 
  MessageSquare, AlertTriangle, BarChart3, Shield,
  FileText, TrendingUp, Megaphone, Building2, Gamepad2,
  Settings, LogOut, Bitcoin, LineChart, Activity, Trophy, Coins, Bell, Dices, CheckCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";

type RouteRequirement = AdminArea | "super_admin";

const ADMIN_ROUTE_ACCESS: Record<string, RouteRequirement> = {
  "/admin": "dashboard",
  "/admin/admin-users": "super_admin",
  "/admin/users": "users",
  "/admin/kyc": "kyc",
  "/admin/bets": "bets",
  "/admin/sports": "sports",
  "/admin/transactions": "transactions",
  "/admin/payments": "payments",
  "/admin/crypto": "crypto",
  "/admin/promotions": "promotions",
  "/admin/support": "support",
  "/admin/risk": "risk",
  "/admin/reports": "reports",
  "/admin/audit": "audit",
  "/admin/monitoring": "monitoring",
  "/admin/trading": "trading",
  "/admin/announcements": "announcements",
  "/admin/brokers": "brokers",
  "/admin/casino": "casino",
  "/admin/providers": "sports_management",
  "/admin/readiness": "super_admin",
  "/admin/settings": "super_admin",
  "/admin/features": "super_admin",
};

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [adminRole, setAdminRole] = useState<string>("admin");
  const { toast } = useToast();

  useEffect(() => {
    async function checkAuth() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
          router.push("/admin/login");
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("is_admin, admin_role, is_suspended")
          .eq("id", user.id)
          .maybeSingle();

        if (!profile?.is_admin || profile.is_suspended) {
          toast({ title: "Access denied", description: "Admin privileges required", variant: "destructive" });
          router.push("/admin/login");
          return;
        }

        // 2FA requirement removed per user request
        const role = profile.admin_role || "admin";
        const requiredAccess = ADMIN_ROUTE_ACCESS[router.pathname];

        const denied =
          requiredAccess === "super_admin"
            ? role !== "super_admin"
            : requiredAccess
              ? !hasAdminAccess(role, requiredAccess)
              : router.pathname.startsWith("/admin/") && router.pathname !== "/admin/login" && role !== "super_admin";

        if (denied) {
          toast({
            title: "Access denied",
            description: "Your admin role does not allow this section",
            variant: "destructive",
          });
          await router.replace("/admin");
          return;
        }

        setAdminRole(role);
        setLoading(false);
      } catch (error) {
        console.error("Auth check failed:", error);
        router.push("/admin/login");
      }
    }

    checkAuth();
  }, [router]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/admin/login");
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Role-based navigation - only show allowed sections
  const allNavItems = [
    { href: "/admin", label: "Dashboard", icon: LayoutDashboard, areas: ["dashboard"] },
    { href: "/admin/admin-users", label: "Admin Users", icon: Shield, areas: [], superAdminOnly: true },
    { href: "/admin/users", label: "Users", icon: Users, areas: ["users"] },
    { href: "/admin/kyc", label: "KYC", icon: Shield, areas: ["kyc"] },
    { href: "/admin/bets", label: "Bets", icon: Activity, areas: ["bets"] },
    { href: "/admin/sports", label: "Sports", icon: Trophy, areas: ["sports"] },
    { href: "/admin/transactions", label: "Transactions", icon: Receipt, areas: ["transactions"] },
    { href: "/admin/payments", label: "Payments", icon: CreditCard, areas: ["payments"] },
    { href: "/admin/crypto", label: "Crypto", icon: Coins, areas: ["crypto"] },
    { href: "/admin/promotions", label: "Promotions", icon: Gift, areas: ["promotions"] },
    { href: "/admin/support", label: "Support", icon: MessageSquare, areas: ["support"] },
    { href: "/admin/risk", label: "Risk", icon: AlertTriangle, areas: ["risk"] },
    { href: "/admin/reports", label: "Reports", icon: FileText, areas: ["reports"] },
    { href: "/admin/audit", label: "Audit", icon: FileText, areas: ["audit"] },
    { href: "/admin/monitoring", label: "Monitoring", icon: Activity, areas: ["monitoring"] },
    { href: "/admin/trading", label: "Trading", icon: TrendingUp, areas: ["trading"] },
    { href: "/admin/announcements", label: "Announcements", icon: Bell, areas: ["announcements"] },
    { href: "/admin/brokers", label: "Brokers", icon: Users, areas: ["brokers"] },
    { href: "/admin/casino", label: "Casino", icon: Dices, areas: ["casino"] },
    { href: "/admin/providers", label: "Providers", icon: Settings, areas: ["sports_management"] },
    { href: "/admin/readiness", label: "Readiness", icon: CheckCircle, areas: [], superAdminOnly: true },
  ];

  // Filter navigation based on role
  const navItems = allNavItems.filter(item => {
    // Super admin only items
    if (item.superAdminOnly) return adminRole === "super_admin";

    if (adminRole === "super_admin") return true;

    // Every non-super-admin entry must be explicitly allowed for the active role.
    if (item.areas.length === 0) return false;

    return item.areas.some((area) => hasAdminAccess(adminRole, area as AdminArea));
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar */}
      <div className="fixed inset-y-0 left-0 w-64 bg-card border-r border-border">
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="p-6 border-b border-border">
            <Link href="/admin" className="text-2xl font-bold text-primary">
              PrimeBet Admin
            </Link>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto p-4 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = router.pathname === item.href;
              
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="font-medium">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* User info & logout */}
          <div className="p-4 border-t border-border">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm">
                <div className="font-medium text-foreground">Admin</div>
                <div className="text-xs text-muted-foreground capitalize">{adminRole}</div>
              </div>
            </div>
            <Button
              onClick={handleLogout}
              variant="outline"
              size="sm"
              className="w-full"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="ml-64 p-8">
        {children}
      </div>
    </div>
  );
}
