import { supabase } from "@/integrations/supabase/client";

export async function getUserFavoriteEventIds(userId: string): Promise<{
  eventIds: string[];
  error?: string;
}> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== userId) return { eventIds: [], error: "Authentication required" };

    const { data, error } = await supabase
      .from("favorites")
      .select("event_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { eventIds: (data || []).map((favorite) => favorite.event_id) };
  } catch (error) {
    console.error("Get favorite ids error:", error);
    return { eventIds: [], error: error instanceof Error ? error.message : "Unable to load favorites" };
  }
}

export async function toggleFavorite(userId: string, eventId: string) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== userId) {
      return { success: false, error: "Authentication required" };
    }
    // Check if already favorited
    const { data: existing, error: checkError } = await supabase
      .from("favorites")
      .select("id")
      .eq("user_id", userId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (checkError) throw checkError;

    if (existing) {
      // Remove favorite
      const { error: deleteError } = await supabase
        .from("favorites")
        .delete()
        .eq("id", existing.id);

      if (deleteError) throw deleteError;

      return { success: true, isFavorite: false };
    } else {
      // Add favorite
      const { error: insertError } = await supabase
        .from("favorites")
        .insert({
          user_id: userId,
          event_id: eventId,
        });

      if (insertError) throw insertError;

      return { success: true, isFavorite: true };
    }
  } catch (error) {
    console.error("Toggle favorite error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unable to update favourite" };
  }
}

export async function getUserFavorites(userId: string) {
  try {
    const { data, error } = await supabase
      .from("favorites")
      .select(
        `
        *,
        events (
          *,
          leagues (name, country),
          sports (name, icon)
        )
      `
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return { success: true, favorites: data };
  } catch (error) {
    console.error("Get user favorites error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unable to load favourites" };
  }
}

export async function isFavorite(userId: string, eventId: string) {
  try {
    const { data, error } = await supabase
      .from("favorites")
      .select("id")
      .eq("user_id", userId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (error) throw error;

    return { success: true, isFavorite: !!data };
  } catch (error) {
    console.error("Check favorite error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unable to check favourite" };
  }
}
