import { supabase } from "@/integrations/supabase/client";

/**
 * BET VALIDATION ENGINE
 * 
 * Validates bets before acceptance:
 * - Balance check
 * - Market/event status
 * - Odds validation
 * - Stake limits
 * - User limits
 * - Duplicate detection
 * - Live bet delay
 */

interface ValidationResult {
  valid: boolean;
  result: "accepted" | "rejected" | "requote" | "suspended";
  reason?: string;
  currentOdds?: number;
  requiredDelay?: number;
}

interface BetValidationRequest {
  userId: string;
  eventId: string;
  marketId: string;
  oddsId: string;
  selection: string;
  requestedOdds: number;
  stake: number;
  betType: "single" | "multiple" | "system";
  isLive: boolean;
}

/**
 * Main bet validation function
 */
export async function validateBet(
  request: BetValidationRequest
): Promise<ValidationResult> {
  try {
    // 1. Check user authentication
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== request.userId) {
      return createRejection("Not authenticated");
    }

    // 2. Check user balance
    const balanceCheck = await checkBalance(request.userId, request.stake);
    if (!balanceCheck.valid) {
      return createRejection(balanceCheck.reason || "Insufficient balance");
    }

    // 3. Check event status
    const eventCheck = await checkEventStatus(request.eventId);
    if (!eventCheck.valid) {
      return createSuspension(eventCheck.reason || "Event unavailable");
    }

    // 4. Check market status
    const marketCheck = await checkMarketStatus(request.marketId);
    if (!marketCheck.valid) {
      return createSuspension(marketCheck.reason || "Market suspended");
    }

    // 5. Validate odds (check if changed)
    const oddsCheck = await validateOdds(
      request.oddsId,
      request.requestedOdds
    );
    if (!oddsCheck.valid) {
      return createRequote(
        oddsCheck.reason || "Odds changed",
        oddsCheck.currentOdds || request.requestedOdds
      );
    }

    // 6. Check stake limits
    const stakeCheck = await checkStakeLimits(
      request.userId,
      request.eventId,
      request.marketId,
      request.stake
    );
    if (!stakeCheck.valid) {
      return createRejection(stakeCheck.reason || "Stake limit exceeded");
    }

    // 7. Check payout limits
    const potentialPayout = request.stake * request.requestedOdds;
    const payoutCheck = await checkPayoutLimits(
      request.userId,
      potentialPayout
    );
    if (!payoutCheck.valid) {
      return createRejection(payoutCheck.reason || "Payout limit exceeded");
    }

    // 8. Live bet delay check
    if (request.isLive) {
      const delayCheck = await checkLiveBetDelay(request.eventId);
      if (delayCheck.requiresDelay) {
        return {
          valid: false,
          result: "accepted",
          requiredDelay: delayCheck.delaySeconds,
        };
      }
    }

    // 9. Check for duplicate submission
    const duplicateCheck = await checkDuplicateBet(
      request.userId,
      request.eventId,
      request.selection,
      request.stake
    );
    if (duplicateCheck.isDuplicate) {
      return createRejection("Duplicate bet detected");
    }

    // All checks passed - log validation
    await logValidation(request, "accepted");

    return {
      valid: true,
      result: "accepted",
    };
  } catch (error) {
    console.error("Bet validation error:", error);
    return createRejection("Validation failed");
  }
}

/**
 * Check user balance
 */
async function checkBalance(
  userId: string,
  stake: number
): Promise<{ valid: boolean; reason?: string }> {
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("demo_balance")
      .eq("id", userId)
      .single();

    if (!profile) {
      return { valid: false, reason: "Profile not found" };
    }

    if (profile.demo_balance < stake) {
      return {
        valid: false,
        reason: `Insufficient balance. Available: ${profile.demo_balance.toFixed(2)}`,
      };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, reason: "Failed to check balance" };
  }
}

/**
 * Check event status
 */
async function checkEventStatus(
  eventId: string
): Promise<{ valid: boolean; reason?: string }> {
  try {
    const { data: event } = await supabase
      .from("events")
      .select("status, is_suspended")
      .eq("id", eventId)
      .single();

    if (!event) {
      return { valid: false, reason: "Event not found" };
    }

    if (event.is_suspended) {
      return { valid: false, reason: "Event suspended" };
    }

    if (event.status === "cancelled" || event.status === "postponed") {
      return { valid: false, reason: `Event ${event.status}` };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, reason: "Failed to check event status" };
  }
}

/**
 * Check market status
 */
async function checkMarketStatus(
  marketId: string
): Promise<{ valid: boolean; reason?: string }> {
  try {
    const { data: market } = await supabase
      .from("markets")
      .select("status")
      .eq("id", marketId)
      .single();

    if (!market) {
      return { valid: false, reason: "Market not found" };
    }

    if (market.status !== "active") {
      return { valid: false, reason: `Market ${market.status}` };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, reason: "Failed to check market status" };
  }
}

/**
 * Validate odds haven't changed
 */
async function validateOdds(
  oddsId: string,
  requestedOdds: number
): Promise<{ valid: boolean; reason?: string; currentOdds?: number }> {
  try {
    const { data: odds } = await supabase
      .from("odds")
      .select("value, is_locked")
      .eq("id", oddsId)
      .single();

    if (!odds) {
      return { valid: false, reason: "Odds not found" };
    }

    if (odds.is_locked) {
      return { valid: false, reason: "Odds locked" };
    }

    // Allow 1% tolerance for floating point differences
    const tolerance = 0.01;
    const difference = Math.abs(odds.value - requestedOdds);

    if (difference > tolerance) {
      return {
        valid: false,
        reason: "Odds changed",
        currentOdds: odds.value,
      };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, reason: "Failed to validate odds" };
  }
}

/**
 * Check stake limits
 */
async function checkStakeLimits(
  userId: string,
  eventId: string,
  marketId: string,
  stake: number
): Promise<{ valid: boolean; reason?: string }> {
  try {
    if (stake <= 0) {
      return { valid: false, reason: "Stake must be greater than 0" };
    }

    // Check market-specific max stake
    const { data: marketConfig } = await supabase
      .from("market_config")
      .select("max_stake_override")
      .eq("market_id", marketId)
      .single();

    if (marketConfig?.max_stake_override && stake > marketConfig.max_stake_override) {
      return {
        valid: false,
        reason: `Max stake: ${marketConfig.max_stake_override}`,
      };
    }

    // Check user-specific limits
    const { data: userLimit } = await supabase
      .from("user_limits")
      .select("limit_value")
      .eq("user_id", userId)
      .eq("limit_type", "stake")
      .single();

    if (userLimit && stake > userLimit.limit_value) {
      return {
        valid: false,
        reason: `Your max stake: ${userLimit.limit_value}`,
      };
    }

    return { valid: true };
  } catch (error) {
    return { valid: true }; // Don't block on limit check failure
  }
}

/**
 * Check payout limits
 */
async function checkPayoutLimits(
  userId: string,
  potentialPayout: number
): Promise<{ valid: boolean; reason?: string }> {
  try {
    // Check user-specific max payout
    const { data: userLimit } = await supabase
      .from("user_limits")
      .select("limit_value")
      .eq("user_id", userId)
      .eq("limit_type", "payout")
      .single();

    if (userLimit && potentialPayout > userLimit.limit_value) {
      return {
        valid: false,
        reason: `Max payout: ${userLimit.limit_value}`,
      };
    }

    return { valid: true };
  } catch (error) {
    return { valid: true };
  }
}

/**
 * Check live bet delay requirement
 */
async function checkLiveBetDelay(
  eventId: string
): Promise<{ requiresDelay: boolean; delaySeconds?: number }> {
  try {
    const { data: event } = await supabase
      .from("events")
      .select(`
        sport_id,
        sports!inner(id)
      `)
      .eq("id", eventId)
      .single();

    if (!event) {
      return { requiresDelay: false };
    }

    const { data: sportConfig } = await supabase
      .from("sport_config")
      .select("live_bet_delay_seconds")
      .eq("sport_id", event.sport_id)
      .single();

    if (sportConfig?.live_bet_delay_seconds && sportConfig.live_bet_delay_seconds > 0) {
      return {
        requiresDelay: true,
        delaySeconds: sportConfig.live_bet_delay_seconds,
      };
    }

    return { requiresDelay: false };
  } catch (error) {
    return { requiresDelay: false };
  }
}

/**
 * Check for duplicate bets (within last 5 seconds)
 */
async function checkDuplicateBet(
  userId: string,
  eventId: string,
  selection: string,
  stake: number
): Promise<{ isDuplicate: boolean }> {
  try {
    const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString();

    const { data: recentBets } = await supabase
      .from("bets")
      .select("id")
      .eq("user_id", userId)
      .eq("stake", stake)
      .gte("placed_at", fiveSecondsAgo)
      .limit(1);

    return { isDuplicate: (recentBets?.length || 0) > 0 };
  } catch (error) {
    return { isDuplicate: false };
  }
}

/**
 * Log validation result
 */
async function logValidation(
  request: BetValidationRequest,
  result: "accepted" | "rejected" | "requote" | "suspended",
  rejectionReason?: string
) {
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("demo_balance")
      .eq("id", request.userId)
      .single();

    await supabase.from("bet_validations").insert({
      user_id: request.userId,
      validation_result: result,
      rejection_reason: rejectionReason,
      stake_requested: request.stake,
      odds_requested: request.requestedOdds,
      balance_at_validation: profile?.demo_balance || 0,
    });
  } catch (error) {
    console.error("Failed to log validation:", error);
  }
}

// Helper functions to create validation results
function createRejection(reason: string): ValidationResult {
  return {
    valid: false,
    result: "rejected",
    reason,
  };
}

function createSuspension(reason: string): ValidationResult {
  return {
    valid: false,
    result: "suspended",
    reason,
  };
}

function createRequote(reason: string, currentOdds: number): ValidationResult {
  return {
    valid: false,
    result: "requote",
    reason,
    currentOdds,
  };
}