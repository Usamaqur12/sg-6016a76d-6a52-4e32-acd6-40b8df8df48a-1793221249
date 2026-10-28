import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { ArrowLeft, Bell, CheckCheck, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type UserNotification,
} from "@/services/notificationsService";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

export default function NotificationsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { void initialize(); }, []);

  async function initialize() {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) { await router.push("/auth/login"); return; }
    setUser(authUser);
    const { data } = await supabase.from("profiles").select("*").eq("id", authUser.id).single();
    setProfile(data);
    await loadNotifications();
  }

  async function loadNotifications() {
    setLoading(true);
    const result = await getNotifications(100);
    if (result.error) toast({ title: "Notifications could not be loaded", description: result.error, variant: "destructive" });
    setNotifications(result.notifications);
    setLoading(false);
  }

  async function markOne(notification: UserNotification) {
    if (notification.is_read) return;
    const result = await markNotificationRead(notification.id);
    if (!result.success) { toast({ title: "Update failed", description: result.error, variant: "destructive" }); return; }
    setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, is_read: true } : item));
  }

  async function markAll() {
    const result = await markAllNotificationsRead();
    if (!result.success) { toast({ title: "Update failed", description: result.error, variant: "destructive" }); return; }
    setNotifications((current) => current.map((item) => ({ ...item, is_read: true })));
    toast({ title: "All notifications marked as read" });
  }

  const unreadCount = notifications.filter((item) => !item.is_read).length;

  return (
    <div className="min-h-screen flex flex-col bg-background pb-14 lg:pb-0">
      <Header user={profile ? { email: user?.email || "", balance: Number(profile.demo_balance || 0) } : null} onAuthClick={() => router.push("/auth/login")} />
      <main className="flex-1"><div className="container max-w-4xl py-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon"><Link href="/account"><ArrowLeft className="h-5 w-5" /></Link></Button>
            <div><h1 className="text-2xl font-bold">Notifications</h1><p className="text-sm text-muted-foreground">{unreadCount} unread notification{unreadCount === 1 ? "" : "s"}</p></div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => void loadNotifications()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
            <Button className="gap-2" onClick={() => void markAll()} disabled={unreadCount === 0}><CheckCheck className="h-4 w-4" />Mark all read</Button>
          </div>
        </div>

        {loading ? <Card className="surface"><CardContent className="py-12 text-center text-muted-foreground">Loading notifications…</CardContent></Card>
          : notifications.length === 0 ? <Card className="surface"><CardContent className="py-12 text-center"><Bell className="h-10 w-10 mx-auto mb-3 text-muted-foreground" /><p className="font-semibold">No notifications yet</p><p className="text-sm text-muted-foreground">Bet, wallet and account updates will appear here.</p></CardContent></Card>
          : <div className="space-y-3">{notifications.map((notification) => (
            <button key={notification.id} type="button" onClick={() => void markOne(notification)} className="w-full text-left">
              <Card className={`surface transition-colors ${notification.is_read ? "opacity-75" : "border-primary/40 bg-primary/[0.03]"}`}>
                <CardContent className="p-4 flex gap-3">
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><Bell className="h-4 w-4 text-primary" /></div>
                  <div className="flex-1 min-w-0"><div className="flex items-start justify-between gap-3"><p className="font-semibold">{notification.title}</p>{!notification.is_read && <Badge>New</Badge>}</div><p className="text-sm text-muted-foreground mt-1">{notification.message}</p><p className="text-xs text-muted-foreground mt-2">{new Date(notification.created_at).toLocaleString()}</p></div>
                </CardContent>
              </Card>
            </button>
          ))}</div>}
      </div></main>
      <Footer /><MobileBottomNav />
    </div>
  );
}
