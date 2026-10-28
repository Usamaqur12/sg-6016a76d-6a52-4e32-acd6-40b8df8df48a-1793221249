import { supabase } from "@/integrations/supabase/client";

/**
 * IDEMPOTENCY SERVICE
 * 
 * Prevents duplicate bet placement from double-clicks or network retries
 * Uses idempotency keys and request hashing
 */

interface IdempotencyCheck {
  isDuplicate: boolean;
  existingBetId?: string;
  canProceed: boolean;
}

/**
 * Generate idempotency key from user ID and timestamp
 */
export function generateIdempotencyKey(userId: string): string {
  const randomPart = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)))
        .map((value) => value.toString(16).padStart(8, "0"))
        .join("");

  return `${userId}-${Date.now()}-${randomPart}`;
}

/**
 * Check if idempotency key exists and return cached result
 */
export async function checkBetIdempotency(
  key: string
): Promise<{ exists: boolean; result?: any }> {
  try {
    const { data, error } = await supabase
      .from("idempotency_keys")
      .select("*")
      .eq("key", key)
      .single();

    if (error || !data) {
      return { exists: false };
    }

    // Check if expired
    if (new Date(data.expires_at) < new Date()) {
      // Expired, delete it
      await supabase.from("idempotency_keys").delete().eq("id", data.id);
      return { exists: false };
    }

    return {
      exists: true,
      result: data.response_data,
    };
  } catch (error) {
    console.error("Check idempotency error:", error);
    return { exists: false };
  }
}

/**
 * Store idempotency record after successful bet placement
 */
export async function storeBetIdempotency(
  userId: string,
  betId: string,
  betType: string,
  stake: number,
  selections: any[],
  idempotencyKey?: string
) {
  try {
    const key = idempotencyKey || generateIdempotencyKey(userId);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes

    await supabase.from("idempotency_keys").insert({
      user_id: userId,
      key,
      request_data: { betType, stake, selections },
      response_data: { betId, status: "completed" },
      expires_at: expiresAt,
    });

    return { success: true };
  } catch (error) {
    console.error("Store bet idempotency error:", error);
    return { success: false, error: "Failed to store idempotency record" };
  }
}

/**
 * Clean up expired idempotency records (background job)
 */
export async function cleanupExpiredIdempotency() {
  try {
    const { error } = await supabase
      .from("idempotency_keys")
      .delete()
      .lt("expires_at", new Date().toISOString());

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error("Cleanup idempotency error:", error);
    return { success: false, error: "Failed to cleanup" };
  }
}
