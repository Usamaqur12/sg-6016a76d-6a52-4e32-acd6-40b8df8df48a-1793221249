import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  data?: any;
}

export function NotificationManager() {
  const { toast } = useToast();
  const [permission, setPermission] = useState<NotificationPermission>("default");

  useEffect(() => {
    if ("Notification" in window) {
      setPermission(Notification.permission);
    }

    // Subscribe to real-time notifications
    const channel = supabase
      .channel("user-notifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "user_notifications" }, async (payload) => {
        const notification = payload.new as any;
        
        // Get current user
        const { data: { user } } = await supabase.auth.getUser();
        if (user && notification.user_id === user.id) {
          await showNotification({
            title: notification.title,
            body: notification.message,
            data: notification.metadata,
          });
        }
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  async function requestPermission() {
    if (!("Notification" in window)) {
      toast({
        title: "Not supported",
        description: "Browser notifications are not supported on this device",
        variant: "destructive",
      });
      return false;
    }

    const result = await Notification.requestPermission();
    setPermission(result);

    if (result === "granted") {
      toast({
        title: "Notifications enabled",
        description: "You'll receive updates about bet outcomes and platform announcements",
      });

      // Register push subscription if service worker is available
      if ("serviceWorker" in navigator) {
        try {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
          });

          // Save subscription to database
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            await (supabase as any).from("push_subscriptions").upsert({
              user_id: user.id,
              subscription: subscription.toJSON(),
            });
          }
        } catch (error) {
          console.error("Push subscription failed:", error);
        }
      }

      return true;
    }

    return false;
  }

  async function showNotification(payload: NotificationPayload) {
    if (permission !== "granted") return;

    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(payload.title, {
          body: payload.body,
          icon: payload.icon || "/favicon.png",
          badge: "/favicon.png",
          tag: "primebet-notification",
          data: payload.data,
          requireInteraction: true,
        });
      } else {
        new Notification(payload.title, {
          body: payload.body,
          icon: payload.icon || "/favicon.png",
          data: payload.data,
        });
      }

      // Also show toast for immediate feedback
      toast({
        title: payload.title,
        description: payload.body,
      });
    } catch (error) {
      console.error("Notification display failed:", error);
    }
  }

  return null;
}

export async function sendBetOutcomeNotification(userId: string, betId: string, status: "won" | "lost", amount: number) {
  const title = status === "won" ? "🎉 Bet Won!" : "Bet Settled";
  const message = status === "won" 
    ? `Congratulations! You won $${amount.toFixed(2)}`
    : `Your bet was settled. Better luck next time!`;

  await (supabase as any).from("user_notifications").insert({
    user_id: userId,
    type: "bet_outcome",
    title,
    message,
    metadata: { bet_id: betId, status, amount },
  });
}

export async function sendPlatformAnnouncement(userId: string, title: string, message: string) {
  await (supabase as any).from("user_notifications").insert({
    user_id: userId,
    type: "announcement",
    title,
    message,
    metadata: {},
  });
}