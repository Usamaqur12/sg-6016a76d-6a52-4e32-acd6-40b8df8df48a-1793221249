import React from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { Home, TrendingUp, Receipt, BarChart3, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBetSlip } from "@/hooks/useBetSlip";

export function MobileBottomNav() {
  const router = useRouter();
  const betSlip = useBetSlip();

  const navItems = [
    { icon: Home, label: "Home", href: "/" },
    { icon: TrendingUp, label: "Sports", href: "/sports" },
    { icon: BarChart3, label: "Dashboard", href: "/account/dashboard" },
    { icon: Trophy, label: "Results", href: "/results" },
    { icon: Receipt, label: "Bet Slip", href: "#betslip", badge: betSlip.bets.length },
  ];

  const handleBetSlipClick = (e: React.MouseEvent) => {
    e.preventDefault();
    // Trigger mobile bet slip drawer open via custom event
    window.dispatchEvent(new CustomEvent("open-mobile-betslip"));
  };

  return (
    <nav className="mobile-nav">
      <div className="h-full flex items-center justify-around px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = router.pathname === item.href;
          
          return (
            <Link 
              key={item.href} 
              href={item.href}
              onClick={item.href === "#betslip" ? handleBetSlipClick : undefined}
              className="flex-1"
            >
              <button
                className={cn(
                  "relative w-full flex flex-col items-center justify-center gap-0.5 py-1.5 transition-all",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
              >
                <div className="relative">
                  <Icon className="h-5 w-5" />
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 h-4 min-w-[16px] px-1 flex items-center justify-center rounded-full bg-primary text-background text-[9px] font-black">
                      {item.badge > 9 ? "9+" : item.badge}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-bold">{item.label}</span>
              </button>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
