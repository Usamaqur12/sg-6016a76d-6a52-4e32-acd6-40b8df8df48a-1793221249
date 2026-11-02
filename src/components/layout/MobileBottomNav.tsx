import React from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { Home, TrendingUp, Receipt, Dices, Plane, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBetSlip } from "@/hooks/useBetSlip";

type MobileNavItem = {
  icon: LucideIcon;
  label: string;
  href?: string;
  action?: "betslip";
  badge?: number;
};

export function MobileBottomNav() {
  const router = useRouter();
  const betSlip = useBetSlip();

  const navItems: MobileNavItem[] = [
    { icon: Home, label: "Home", href: "/" },
    { icon: TrendingUp, label: "Sports", href: "/sports" },
    { icon: Dices, label: "Casino", href: "/casino" },
    { icon: Plane, label: "Aviator", href: "/aviator" },
    { icon: Receipt, label: "Bet Slip", action: "betslip", badge: betSlip.bets.length },
  ];

  const openBetSlip = () => {
    window.dispatchEvent(new CustomEvent("open-mobile-betslip"));
  };

  return (
    <nav className="mobile-nav" aria-label="Mobile primary navigation">
      <div className="h-full flex items-center justify-around px-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.href === "/"
            ? router.pathname === "/"
            : Boolean(item.href && router.pathname.startsWith(item.href));
          const content = (
            <>
              <div className="relative">
                <Icon className="h-5 w-5" />
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 h-4 min-w-[16px] px-1 flex items-center justify-center rounded-full bg-primary text-background text-[9px] font-black">
                    {item.badge > 9 ? "9+" : item.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-bold">{item.label}</span>
            </>
          );
          const className = cn(
            "relative min-w-0 flex-1 min-h-12 flex flex-col items-center justify-center gap-0.5 px-0.5 py-1.5 transition-colors",
            isActive ? "text-primary" : "text-muted-foreground"
          );

          if (item.action === "betslip") {
            return (
              <button key={item.label} type="button" onClick={openBetSlip} className={className} aria-label="Open bet slip">
                {content}
              </button>
            );
          }

          return (
            <Link key={item.label} href={item.href || "/"} className={className} aria-label={`Open ${item.label}`}>
              {content}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
