import { supabase } from "@/integrations/supabase/client";

/**
 * CASH OUT ENGINE
 * 
 * Calculates cash-out offers for pending bets
 * Supports full and partial cash-out
 */

interface CashoutOffer {
  betId: string;
  originalStake: number;
  currentOdds: number;
  originalOdds: number;
  cashoutAmount: number;
  profitIfCashout: number;
  available: boolean;
  reason?: string;
}

/**
 * Calculate cash-out offer for a bet
 * 
 * Formula:
 * Cash-out = (Stake × Current Odds × Cash-out Factor) / Original Odds
 * 
 * Cash-out Factor = 0.85 (platform takes 15% margin on cash-out)
 */
export async function calculateCashoutOffer(
  betId: string
): Promise<{ success: boolean; offer?: CashoutOffer; error?: string }> {
  try {
    // Get bet details
    const { data: bet, error: betError } = await supabase
      .from("bets")
      .select(`
        *,
        bet_selections(
          event_id,
          market_id,
          odds_id,
          odds_value
        )
      `)
      .eq("id", betId)
      .single();

    if (betError || !bet) {
      return { success: false, error: "Bet not found" };
    }

    // Check bet status
    if (bet.status !== "pending") {
      return {
        success: false,
        error: `Cash-out not available for ${bet.status} bets`,
      };
    }

    // Check if all markets are active
    const selections = bet.bet_selections as any[];
    for (const selection of selections) {
      const { data: market } = await supabase
        .from("markets")
        .select("status")
        .eq("id", selection.market_id)
        .single();

      if (!market || market.status !== "active") {
        return {
          success: false,
          error: "Cash-out unavailable - market suspended",
        };
      }
    }

    // Get current odds for all selections
    let currentTotalOdds = 1;
    for (const selection of selections) {
      const { data: odds } = await supabase
        .from("odds")
        .select("value")
        .eq("id", selection.odds_id)
        .single();

      if (!odds) {
        return {
          success: false,
          error: "Current odds unavailable",
        };
      }

      currentTotalOdds *= odds.value;
    }

    // Calculate cash-out amount
    const cashoutFactor = 0.85; // 15% platform margin
    const cashoutAmount = 
      (bet.stake * currentTotalOdds * cashoutFactor) / bet.total_odds;

    const roundedCashout = Math.round(cashoutAmount * 100) / 100;
    const profit = roundedCashout - bet.stake;

    return {
      success: true,
      offer: {
        betId,
        originalStake: bet.stake,
        currentOdds: currentTotalOdds,
        originalOdds: bet.total_odds,
        cashoutAmount: roundedCashout,
        profitIfCashout: profit,
        available: true,
      },
    };
  } catch (error) {
    console.error("Calculate cashout error:", error);
    return { success: false, error: "Failed to calculate cash-out" };
  }
}

/**
 * Process cash-out request
 */
export async function processCashout(
  betId: string,
  userId: string,
  cashoutType: "full" | "partial" = "full",
  partialAmount?: number
): Promise<{ success: boolean; cashoutAmount?: number; error?: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== userId) {
      return { success: false, error: "Authentication required" };
    }

    const { data, error } = await (supabase as any).rpc("accept_cashout", {
      p_bet_id: betId,
      p_cashout_type: cashoutType,
      p_partial_amount: cashoutType === "partial" ? partialAmount ?? null : null,
    });

    if (error) {
      return { success: false, error: error.message || "Cash-out could not be processed" };
    }

    const result = data as { success?: boolean; cashoutAmount?: number } | null;
    if (!result?.success) {
      return { success: false, error: "Cash-out could not be processed" };
    }

    return { success: true, cashoutAmount: Number(result.cashoutAmount || 0) };
  } catch (error) {
    console.error("Process cashout error:", error);
    return { success: false, error: "Cash-out could not be processed" };
  }
}

/**
 * Get cash-out history for a user
 */
export async function getCashoutHistory(
  userId: string,
  limit: number = 10
) {
  try {
    const { data, error } = await supabase
      .from("cashout_offers")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, history: data };
  } catch (error) {
    return { success: false, error: "Failed to get history" };
  }
}
