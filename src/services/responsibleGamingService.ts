import { supabase } from "@/integrations/supabase/client";

/**
 * RESPONSIBLE GAMING SERVICE
 * 
 * Enforces betting limits, loss limits, self-exclusion
 * Prevents problem gambling behaviors
 */

interface LimitCheck {
  allowed: boolean;
  reason?: string;
  limitType?: string;
  currentUsage?: number;
  limitValue?: number;
  remainingAmount?: number;
}

/**
 * Check if user is self-excluded
 */
export async function checkSelfExclusion(userId: string): Promise<LimitCheck> {
  try {
    const { data: exclusion } = await supabase
      .from("self_exclusions")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .single();

    if (!exclusion) {
      return { allowed: true };
    }

    // Check if exclusion period has ended
    if (exclusion.end_date) {
      const endDate = new Date(exclusion.end_date);
      if (endDate < new Date()) {
        // Exclusion expired, deactivate it
        await supabase
          .from("self_exclusions")
          .update({ is_active: false })
          .eq("id", exclusion.id);

        return { allowed: true };
      }
    }

    return {
      allowed: false,
      reason: `Account is self-excluded until ${exclusion.end_date || "permanently"}`,
      limitType: exclusion.exclusion_type,
    };
  } catch (error) {
    console.error("Check self-exclusion error:", error);
    return { allowed: false, reason: "Responsible-play status could not be verified" };
  }
}

/**
 * Check stake limits
 */
export async function checkStakeLimits(
  userId: string,
  stake: number
): Promise<LimitCheck> {
  try {
    const now = new Date();

    // Check daily stake limit
    const { data: dailyLimit } = await supabase
      .from("responsible_gaming_limits")
      .select("*")
      .eq("user_id", userId)
      .eq("limit_type", "daily_stake")
      .eq("is_active", true)
      .lte("period_start", now.toISOString())
      .gte("period_end", now.toISOString())
      .single();

    if (dailyLimit) {
      const newUsage = dailyLimit.current_usage + stake;
      if (newUsage > dailyLimit.limit_value) {
        return {
          allowed: false,
          reason: "Daily stake limit exceeded",
          limitType: "daily_stake",
          currentUsage: dailyLimit.current_usage,
          limitValue: dailyLimit.limit_value,
          remainingAmount: dailyLimit.limit_value - dailyLimit.current_usage,
        };
      }
    }

    // Check weekly stake limit
    const { data: weeklyLimit } = await supabase
      .from("responsible_gaming_limits")
      .select("*")
      .eq("user_id", userId)
      .eq("limit_type", "weekly_stake")
      .eq("is_active", true)
      .lte("period_start", now.toISOString())
      .gte("period_end", now.toISOString())
      .single();

    if (weeklyLimit) {
      const newUsage = weeklyLimit.current_usage + stake;
      if (newUsage > weeklyLimit.limit_value) {
        return {
          allowed: false,
          reason: "Weekly stake limit exceeded",
          limitType: "weekly_stake",
          currentUsage: weeklyLimit.current_usage,
          limitValue: weeklyLimit.limit_value,
          remainingAmount: weeklyLimit.limit_value - weeklyLimit.current_usage,
        };
      }
    }

    // Check monthly stake limit
    const { data: monthlyLimit } = await supabase
      .from("responsible_gaming_limits")
      .select("*")
      .eq("user_id", userId)
      .eq("limit_type", "monthly_stake")
      .eq("is_active", true)
      .lte("period_start", now.toISOString())
      .gte("period_end", now.toISOString())
      .single();

    if (monthlyLimit) {
      const newUsage = monthlyLimit.current_usage + stake;
      if (newUsage > monthlyLimit.limit_value) {
        return {
          allowed: false,
          reason: "Monthly stake limit exceeded",
          limitType: "monthly_stake",
          currentUsage: monthlyLimit.current_usage,
          limitValue: monthlyLimit.limit_value,
          remainingAmount: monthlyLimit.limit_value - monthlyLimit.current_usage,
        };
      }
    }

    return { allowed: true };
  } catch (error) {
    console.error("Check stake limits error:", error);
    return { allowed: false, reason: "Responsible-play limits could not be verified" };
  }
}

/**
 * Update stake usage after bet placement
 */
export async function updateStakeUsage(userId: string, stake: number) {
  try {
    const now = new Date();

    // Update all active stake limits
    const { data: limits } = await supabase
      .from("responsible_gaming_limits")
      .select("*")
      .eq("user_id", userId)
      .in("limit_type", ["daily_stake", "weekly_stake", "monthly_stake"])
      .eq("is_active", true)
      .lte("period_start", now.toISOString())
      .gte("period_end", now.toISOString());

    if (!limits || limits.length === 0) return { success: true };

    // Update each limit
    for (const limit of limits) {
      await supabase
        .from("responsible_gaming_limits")
        .update({
          current_usage: limit.current_usage + stake,
          updated_at: now.toISOString(),
        })
        .eq("id", limit.id);
    }

    return { success: true };
  } catch (error) {
    console.error("Update stake usage error:", error);
    return { success: false, error: "Failed to update usage" };
  }
}

/**
 * Set responsible gaming limit
 */
export async function setResponsibleGamingLimit(
  userId: string,
  limitType: string,
  limitValue: number
) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== userId) throw new Error("Authentication required");
    const { error } = await supabase.rpc("set_my_responsible_limit", {
      p_limit_type: limitType,
      p_limit_value: limitValue,
    });

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error("Set RG limit error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to set limit" };
  }
}

/**
 * Set self-exclusion
 */
export async function setSelfExclusion(
  userId: string,
  exclusionType: "timeout" | "self_exclusion" | "permanent",
  durationDays?: number,
  reason?: string
) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== userId) throw new Error("Authentication required");
    const { error } = await supabase.rpc("start_my_self_exclusion", {
      p_exclusion_type: exclusionType,
      p_duration_days: durationDays,
      p_reason: reason,
    });

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error("Set self-exclusion error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to set exclusion" };
  }
}

/**
 * Get user's responsible gaming settings
 */
export async function getUserResponsibleGamingSettings(userId: string) {
  try {
    const [limitsResult, exclusionResult] = await Promise.all([
      supabase
        .from("responsible_gaming_limits")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true),
      supabase
        .from("self_exclusions")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle(),
    ]);

    return {
      success: true,
      limits: limitsResult.data || [],
      exclusion: exclusionResult.data || null,
    };
  } catch (error) {
    console.error("Get RG settings error:", error);
    return { success: false, error: "Failed to get settings" };
  }
}
