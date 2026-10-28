import { supabase } from "@/integrations/supabase/client";

/**
 * FRAUD DETECTION SERVICE
 * 
 * Detects suspicious betting patterns and flags for admin review
 * Does NOT automatically block - creates flags only
 */

interface FraudCheck {
  isSuspicious: boolean;
  flags: string[];
  severity: "low" | "medium" | "high" | "critical";
}

// Export the function type explicitly
export type CheckForFraudFunction = (
  userId: string,
  betType: string,
  stake: number,
  selections: any[],
  eventIds: string[]
) => Promise<FraudCheck>;

/**
 * Check for duplicate bet patterns
 */
async function checkDuplicateBetPattern(
  userId: string,
  selections: any[]
): Promise<string[]> {
  const flags: string[] = [];

  try {
    // Check for identical bets in last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: recentBets } = await supabase
      .from("bets")
      .select(`
        *,
        bet_selections(*)
      `)
      .eq("user_id", userId)
      .gte("created_at", oneDayAgo);

    if (!recentBets) return flags;

    // Check for repeated exact selections
    const currentSelectionKey = selections
      .map((s) => `${s.eventId}-${s.marketId}-${s.selection}`)
      .sort()
      .join("|");

    let duplicateCount = 0;
    for (const bet of recentBets) {
      const betSelectionKey = bet.bet_selections
        .map((s: any) => `${s.event_id}-${s.market_id}-${s.selection}`)
        .sort()
        .join("|");

      if (betSelectionKey === currentSelectionKey) {
        duplicateCount++;
      }
    }

    if (duplicateCount >= 3) {
      flags.push("repeated_duplicate_bets");
    }
  } catch (error) {
    console.error("Check duplicate bet pattern error:", error);
  }

  return flags;
}

/**
 * Check betting velocity
 */
async function checkBettingVelocity(userId: string): Promise<string[]> {
  const flags: string[] = [];

  try {
    // Check bets in last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    
    const { count } = await supabase
      .from("bets")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", oneHourAgo);

    if (count && count >= 20) {
      flags.push("unusual_bet_velocity");
    }

    // Check bets in last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    
    const { count: recentCount } = await supabase
      .from("bets")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", fiveMinutesAgo);

    if (recentCount && recentCount >= 5) {
      flags.push("rapid_bet_velocity");
    }
  } catch (error) {
    console.error("Check betting velocity error:", error);
  }

  return flags;
}

/**
 * Check for unusually large bets
 */
async function checkUnusualStake(userId: string, stake: number): Promise<string[]> {
  const flags: string[] = [];

  try {
    // Get user's bet history
    const { data: bets } = await supabase
      .from("bets")
      .select("stake")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (!bets || bets.length < 5) return flags; // Not enough history

    // Calculate average stake
    const avgStake = bets.reduce((sum, bet) => sum + bet.stake, 0) / bets.length;

    // Flag if current stake is 5x average
    if (stake > avgStake * 5) {
      flags.push("unusually_large_bet");
    }

    // Flag if stake > $10,000 (demo credits)
    if (stake > 10000) {
      flags.push("very_large_bet");
    }
  } catch (error) {
    console.error("Check unusual stake error:", error);
  }

  return flags;
}

/**
 * Check for last-second live betting
 */
async function checkLastSecondBetting(
  userId: string,
  eventId: string,
  isLive: boolean
): Promise<string[]> {
  const flags: string[] = [];

  if (!isLive) return flags;

  try {
    // First get user's bet IDs
    const { data: userBets } = await supabase
      .from("bets")
      .select("id")
      .eq("user_id", userId);

    if (!userBets || userBets.length === 0) return flags;

    const betIds = userBets.map((b) => b.id);

    // Check if user has placed multiple bets on this live event
    const { count } = await supabase
      .from("bet_selections")
      .select("*", { count: "exact", head: true })
      .eq("event_id", eventId)
      .in("bet_id", betIds);

    if (count && count >= 5) {
      flags.push("repeated_live_event_betting");
    }
  } catch (error) {
    console.error("Check last-second betting error:", error);
  }

  return flags;
}

/**
 * Check wallet behavior
 */
async function checkWalletBehavior(userId: string): Promise<string[]> {
  const flags: string[] = [];

  try {
    // Check for unusual deposit/withdrawal patterns
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: transactions } = await supabase
      .from("wallet_transactions")
      .select("*")
      .eq("user_id", userId)
      .gte("created_at", oneDayAgo);

    if (!transactions) return flags;

    // Count rapid deposits/withdrawals
    const deposits = transactions.filter((t) => t.type === "deposit");
    const withdrawals = transactions.filter((t) => t.type === "withdrawal");

    if (deposits.length >= 10) {
      flags.push("unusual_deposit_pattern");
    }

    if (withdrawals.length >= 5 && deposits.length === 0) {
      flags.push("suspicious_withdrawal_pattern");
    }
  } catch (error) {
    console.error("Check wallet behavior error:", error);
  }

  return flags;
}

/**
 * Main fraud detection check
 */
export async function checkForFraud(
  userId: string,
  betType: string,
  stake: number,
  selections: any[],
  eventIds: string[]
): Promise<FraudCheck> {
  const allFlags: string[] = [];

  // Run all checks in parallel
  const [duplicateFlags, velocityFlags, stakeFlags, liveFlags, walletFlags] = await Promise.all([
    checkDuplicateBetPattern(userId, selections),
    checkBettingVelocity(userId),
    checkUnusualStake(userId, stake),
    checkLastSecondBetting(userId, eventIds[0] || "", selections[0]?.isLive || false),
    checkWalletBehavior(userId),
  ]);

  allFlags.push(...duplicateFlags, ...velocityFlags, ...stakeFlags, ...liveFlags, ...walletFlags);

  // Determine severity
  let severity: "low" | "medium" | "high" | "critical" = "low";
  
  if (allFlags.length === 0) {
    return { isSuspicious: false, flags: [], severity: "low" };
  }

  if (allFlags.length >= 4 || allFlags.includes("rapid_bet_velocity")) {
    severity = "critical";
  } else if (allFlags.length >= 2) {
    severity = "high";
  } else if (allFlags.length === 1) {
    severity = "medium";
  }

  return {
    isSuspicious: true,
    flags: allFlags,
    severity,
  };
}

/**
 * Create fraud flag record
 */
export async function createFraudFlag(
  userId: string,
  flagType: string,
  severity: string,
  description: string,
  metadata?: any
) {
  try {
    await supabase.from("fraud_flags").insert({
      user_id: userId,
      flag_type: flagType,
      severity,
      description,
      metadata: metadata || {},
      is_reviewed: false,
    });

    return { success: true };
  } catch (error) {
    console.error("Create fraud flag error:", error);
    return { success: false, error: "Failed to create flag" };
  }
}

/**
 * Get user's fraud flags
 */
export async function getUserFraudFlags(userId: string) {
  try {
    const { data, error } = await supabase
      .from("fraud_flags")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return { success: true, flags: data || [] };
  } catch (error) {
    console.error("Get fraud flags error:", error);
    return { success: false, error: "Failed to get flags" };
  }
}

/**
 * Review fraud flag (admin only)
 */
export async function reviewFraudFlag(
  flagId: string,
  reviewerId: string,
  resolution: string
) {
  try {
    const { error } = await supabase
      .from("fraud_flags")
      .update({
        is_reviewed: true,
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
        resolution,
      })
      .eq("id", flagId);

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error("Review fraud flag error:", error);
    return { success: false, error: "Failed to review flag" };
  }
}