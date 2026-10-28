import { supabase } from "@/integrations/supabase/client";

export interface UserNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface NotificationPreferences {
  bet_results: boolean;
  promotions: boolean;
  account_updates: boolean;
  live_events: boolean;
}

export const defaultNotificationPreferences: NotificationPreferences = {
  bet_results: true,
  promotions: true,
  account_updates: true,
  live_events: false,
};

export async function getNotifications(limit = 10) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { notifications: [] as UserNotification[], error: "Authentication required" };
  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, title, message, is_read, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  return { notifications: (data || []) as UserNotification[], error: error?.message };
}

export async function markNotificationRead(notificationId: string) {
  const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", notificationId);
  return { success: !error, error: error?.message };
}

export async function markAllNotificationsRead() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Authentication required" };
  const { error } = await supabase.from("notifications").update({ is_read: true }).eq("user_id", user.id).eq("is_read", false);
  return { success: !error, error: error?.message };
}

export async function getNotificationPreferences() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { preferences: defaultNotificationPreferences, error: "Authentication required" };
  const { data, error } = await supabase
    .from("notification_preferences")
    .select("bet_results, promotions, account_updates, live_events")
    .eq("user_id", user.id)
    .maybeSingle();
  return { preferences: data ? { ...defaultNotificationPreferences, ...data } : defaultNotificationPreferences, error: error?.message };
}

export async function saveNotificationPreferences(preferences: NotificationPreferences) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Authentication required" };
  const { error } = await supabase.from("notification_preferences").upsert({ user_id: user.id, ...preferences, updated_at: new Date().toISOString() });
  return { success: !error, error: error?.message };
}
