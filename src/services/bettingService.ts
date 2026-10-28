import { supabase } from "@/integrations/supabase/client";
import { generateIdempotencyKey } from "./idempotencyService";
import { checkSelfExclusion, checkStakeLimits } from "./responsibleGamingService";
import { checkBetBuilderCompatibility } from "./betBuilderService";

/**
 * ENHANCED BETTING SERVICE WITH ADVANCED VALIDATION
 * 
 * Integrates:
 * - Idempotency (prevent duplicates)
 * - Fraud detection
 * - Responsible gaming checks
 * - Bet builder validation
 * - Comprehensive bet validation
 * - Exposure tracking
 */

interface BetSelection {
  eventId: string;
  marketId: string;
  oddsId: string;
  selection: string;
  oddsValue: number;
  marketType?: string;
  isLive?: boolean;
}

interface BetPlacementResult {
  success: boolean;
  error?: string;
  result: "accepted" | "rejected" | "requote" | "suspended";
  bet?: {
    id: string;
    type: "single" | "multiple" | "system";
    stake: number;
    totalOdds: number;
    potentialReturn: number;
    status: "pending";
    lineCount?: number;
    combinationSize?: number;
  };
  limitInfo?: {
    limitType?: string;
    currentUsage?: number;
    limitValue?: number;
    remaining?: number;
  };
  conflictingSelections?: string[];
}

export type OddsAcceptance = "none" | "higher" | "any";

/**
 * Place bet with full validation pipeline
 */
export async function placeBet(
  userId: string,
  betType: "single" | "multiple" | "system",
  stake: number,
  selections: BetSelection[],
  idempotencyKey?: string,
  oddsAcceptance: OddsAcceptance = "none",
  systemSize: number = 2
): Promise<BetPlacementResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== userId) {
      return { success: false, error: "Authentication required", result: "rejected" as const };
    }

    if (!Number.isFinite(stake) || stake <= 0 || selections.length === 0) {
      return { success: false, error: "Invalid bet details", result: "rejected" as const };
    }

    if (betType === "system" && (selections.length < 3 || systemSize < 2 || systemSize >= selections.length)) {
      return { success: false, error: "Choose 3 or more events and a valid system size", result: "rejected" as const };
    }

    const exclusionCheck = await checkSelfExclusion(userId);
    if (!exclusionCheck.allowed) {
      return {
        success: false,
        error: exclusionCheck.reason || "Account is self-excluded",
        result: "rejected" as const,
      };
    }

    const limitsCheck = await checkStakeLimits(userId, stake);
    if (!limitsCheck.allowed) {
      return {
        success: false,
        error: limitsCheck.reason || "Stake limit exceeded",
        result: "rejected" as const,
        limitInfo: {
          limitType: limitsCheck.limitType,
          currentUsage: limitsCheck.currentUsage,
          limitValue: limitsCheck.limitValue,
          remaining: limitsCheck.remainingAmount,
        },
      };
    }

    let acceptedSelections = selections;
    if (oddsAcceptance !== "none") {
      const { data: currentPrices, error: priceError } = await supabase
        .from("odds")
        .select("id,value,is_active,is_locked")
        .in("id", selections.map((selection) => selection.oddsId));
      if (priceError || !currentPrices || currentPrices.length !== selections.length) {
        return { success: false, error: "Current prices could not be verified", result: "rejected" as const };
      }
      const byId = new Map(currentPrices.map((price: any) => [price.id, price]));
      acceptedSelections = selections.map((selection) => {
        const price = byId.get(selection.oddsId) as any;
        if (!price || !price.is_active || price.is_locked) throw new Error("A selection is suspended");
        const currentValue = Number(price.value);
        if (oddsAcceptance === "higher" && currentValue + 0.01 < selection.oddsValue) {
          throw new Error(`Odds moved down for ${selection.selection}. Review the new price.`);
        }
        return { ...selection, oddsValue: currentValue };
      });
    }

    const eventIds = [...new Set(acceptedSelections.map(s => s.eventId))];
    if (betType !== "system" && eventIds.length === 1 && acceptedSelections.length > 1) {
      const builderCheck = await checkBetBuilderCompatibility(acceptedSelections);
      if (!builderCheck.allowed) {
        return {
          success: false,
          error: builderCheck.reason || "Incompatible selections",
          result: "rejected" as const,
          conflictingSelections: builderCheck.conflictingSelections,
        };
      }
    }

    const rpcSelections = acceptedSelections.map((selection) => ({
      event_id: selection.eventId,
      market_id: selection.marketId,
      odds_id: selection.oddsId,
      selection: selection.selection,
      odds_value: selection.oddsValue,
    }));

    const key = idempotencyKey || generateIdempotencyKey(userId);
    const { data, error } = betType === "system"
      ? await (supabase as any).rpc("place_system_bet_atomic", {
          p_stake: stake,
          p_selections: rpcSelections,
          p_combination_size: systemSize,
          p_idempotency_key: key,
        })
      : await supabase.rpc("place_bet_atomic", {
          p_bet_type: betType,
          p_stake: stake,
          p_selections: rpcSelections,
          p_idempotency_key: key,
        });

    if (error) {
      return {
        success: false,
        error: error.message || "Bet was rejected",
        result: "rejected" as const,
      };
    }

    const result = data as unknown as BetPlacementResult;
    if (!result || result.success !== true || !result.bet) {
      return {
        success: false,
        error: "Invalid response from betting service",
        result: "rejected" as const,
      };
    }

    return result;
  } catch (error) {
    console.error("Place bet error:", error);
    return {
      success: false,
      error: "Failed to place bet. Please try again.",
      result: "rejected" as const,
    };
  }
}

/**
 * Get user bets with filters
 */
export async function getUserBets(
  userId: string,
  status?: string,
  limit: number = 50
) {
  try {
    let query = supabase
      .from("bets")
      .select(`
        *,
        bet_selections(*)
      `)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) throw error;

    return { success: true, bets: data || [] };
  } catch (error) {
    console.error("Get user bets error:", error);
    return { success: false, error: "Failed to get bets" };
  }
}

/**
 * Cancel bet (within 5 minutes if event not started)
 */
export async function cancelBet(
  userId: string,
  betId: string
): Promise<{ success: boolean; error?: string; betId?: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== userId) {
      return { success: false, error: "Authentication required" };
    }

    const { data, error } = await supabase.rpc("cancel_bet_atomic", {
      p_bet_id: betId,
    });

    if (error) {
      return { success: false, error: error.message || "Failed to cancel bet" };
    }

    return data as unknown as { success: boolean; betId?: string };
  } catch (error) {
    console.error("Cancel bet error:", error);
    return { success: false, error: "Failed to cancel bet" };
  }
}
