import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Search, User, Bell, ChevronDown, Wallet, LogOut, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { SearchModal } from "./SearchModal";
import { getNotifications, markAllNotificationsRead, markNotificationRead, type UserNotification } from "@/services/notificationsService";
import { useI18n } from "@/lib/i18n";

interface HeaderProps {
  user: { email: string; balance: number } | null;
  onAuthClick: () => void;
}

export function Header({ user, onAuthClick }: HeaderProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const userEmail = user?.email;

  useEffect(() => {
    if (!user) { setNotifications([]); return; }
    void getNotifications().then((result) => setNotifications(result.notifications));
  }, [userEmail]);

  const unreadCount = notifications.filter((notification) => !notification.is_read).length;

  async function readNotification(notificationId: string) {
    setNotifications((current) => current.map((item) => item.id === notificationId ? { ...item, is_read: true } : item));
    await markNotificationRead(notificationId);
  }

  async function readAllNotifications() {
    setNotifications((current) => current.map((item) => ({ ...item, is_read: true })));
    await markAllNotificationsRead();
  }

  const navItems = [
    { label: t("sports"), href: "/sports" },
    { label: t("live"), href: "/live" },
    { label: t("casino"), href: "/casino" },
    { label: t("esports"), href: "/esports" },
    { label: t("promotions"), href: "/promotions" },
    { label: t("rewards"), href: "/rewards" },
    { label: "Support", href: "/support" },
  ];

  const isActive = (path: string) => router.pathname === path;

  async function handleLogout() {
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.signOut();
    router.push("/");
  }

  return (
    <>
      <header className="header-compact">
        <div className="container h-full flex items-center justify-between gap-3 px-3">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 flex-shrink-0">
            <div className="w-7 h-7 rounded bg-gradient-to-br from-primary via-primary to-primary-bright flex items-center justify-center glow-green-sm">
              <span className="text-xs font-black text-background">PB</span>
            </div>
            <div className="hidden sm:block">
              <span className="text-base font-black tracking-tight">Prime<span className="text-primary">Bet</span></span>
              <div className="text-[9px] text-subtle-foreground font-medium -mt-0.5 tracking-wide">PREMIUM SPORTSBOOK</div>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center gap-0.5 flex-1 max-w-xl">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}>
                <button
                  className={`px-3 py-1.5 rounded text-xs font-bold tracking-wide transition-all duration-150 ${
                    isActive(item.href)
                      ? "bg-primary/10 text-primary border-b-2 border-primary"
                      : "text-subtle-foreground hover:text-foreground hover:bg-surface-elevated"
                  }`}
                >
                  {item.label}
                </button>
              </Link>
            ))}
          </nav>

          {/* Search */}
          <button
            onClick={() => setSearchOpen(true)}
            className="hidden md:flex items-center gap-2 px-2.5 py-1.5 rounded bg-surface-elevated border border-border hover:border-primary/40 transition-all flex-1 max-w-xs h-8"
          >
            <Search className="h-3.5 w-3.5 text-subtle-foreground" />
            <span className="text-xs text-subtle-foreground font-medium">{t("search")}</span>
            <kbd className="ml-auto px-1.5 py-0.5 text-[10px] rounded bg-raised text-subtle-foreground border border-border font-mono">
              ⌘K
            </kbd>
          </button>

          {/* Mobile Search Icon */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden h-8 w-8"
            onClick={() => setSearchOpen(true)}
          >
            <Search className="h-4 w-4" />
          </Button>

          {/* Right Section */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {user ? (
              <>
                {/* Balance - Green text */}
                <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-surface-elevated border border-primary/20 h-8">
                  <Wallet className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-mono font-bold text-primary">${user.balance.toFixed(2)}</span>
                </div>

                <Button
                  size="sm"
                  onClick={() => router.push("/account/wallet")}
                  className="hidden sm:flex h-7 px-3 text-xs font-bold bg-primary-bright hover:bg-primary-hover text-background glow-green-bright"
                >
                  {t("wallet")}
                </Button>

                {/* Notifications */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="relative h-8 w-8">
                      <Bell className="h-4 w-4" />
                      {unreadCount > 0 && <Badge className="absolute -top-0.5 -right-0.5 min-w-3.5 h-3.5 px-1 flex items-center justify-center text-[9px] bg-danger border-background">{unreadCount > 9 ? "9+" : unreadCount}</Badge>}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72">
                    <div className="p-2.5 border-b border-border">
                      <p className="text-sm font-bold">{t("notifications")}</p>
                      <div className="flex items-center justify-between gap-3"><p className="text-[11px] text-muted-foreground">{unreadCount} {t("unread")}</p>{unreadCount > 0 && <button className="text-[11px] text-primary hover:underline" onClick={() => void readAllNotifications()}>{t("markAllRead")}</button>}</div>
                    </div>
                    <div className="p-1.5 space-y-0.5">
                      {notifications.length === 0 ? <div className="p-4 text-center text-xs text-muted-foreground">{t("noNotifications")}</div> : notifications.map((notification) => <button key={notification.id} className={`w-full text-left p-2 rounded hover:bg-surface-elevated ${notification.is_read ? "opacity-70" : "bg-primary/5"}`} onClick={() => void readNotification(notification.id)}><p className="text-xs font-semibold">{notification.title}</p><p className="text-[11px] text-muted-foreground line-clamp-2">{notification.message}</p><p className="text-[10px] text-muted-foreground mt-1">{new Date(notification.created_at).toLocaleString()}</p></button>)}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* User Menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-2">
                      <User className="h-4 w-4" />
                      <span className="hidden md:inline">{user?.email?.split("@")[0] || "Account"}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <div className="p-2 border-b border-border">
                      <p className="text-xs font-semibold truncate">{user.email}</p>
                      <p className="text-[10px] text-muted-foreground">{t("account")}</p>
                    </div>
                    <DropdownMenuItem onClick={() => router.push("/account")} className="text-xs">
                      <User className="mr-2 h-3.5 w-3.5" />
                      {t("myAccount")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => router.push("/account/wallet")} className="text-xs">
                      <Wallet className="mr-2 h-3.5 w-3.5" />
                      {t("wallet")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => router.push("/account/bets")} className="text-xs">
                      <span className="mr-2 text-sm">📋</span>
                      {t("myBets")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => router.push("/account/settings")} className="text-xs">
                      <Settings className="mr-2 h-3.5 w-3.5" />
                      {t("settings")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout} className="text-danger text-xs">
                      <LogOut className="mr-2 h-3.5 w-3.5" />
                      {t("logout")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={onAuthClick} className="h-7 px-3 text-xs font-semibold">
                  {t("login")}
                </Button>
                <Button asChild size="sm">
                  <Link href="/register">Register</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Search Modal */}
      <SearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
