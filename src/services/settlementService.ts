import { supabase } from "@/integrations/supabase/client";

/**
 * SETTLEMENT ENGINE
 * 
 * Handles bet settlement with wallet updates and audit logging
 * Supports: Win, Loss, Void, Refund, Half Win, Half Loss
 */

type SettlementType = "win" | "loss" | "void" | "refund" | "half_win" | "half_loss";

interface SettlementRequest {
  betId: string;
  settlementType: SettlementType;
  settledBy: string;
  reason?: string;
}

interface SettlementResult {
  success: boolean;
  error?: string;
  payout?: number;
  newBalance?: number;
}

/**
 * Settle a bet and update wallet
 */
export async function settleBet(
  request: SettlementRequest
): Promise<SettlementResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== request.settledBy) {
      return { success: false, error: "Admin authentication required" };
    }

    if (["half_win", "half_loss"].includes(request.settlementType)) {
      return {
        success: false,
        error: "Partial settlements are temporarily unavailable",
      };
    }

    const { data: bet, error: betError } = await supabase
      .from("bets")
      .select(`
        *,
        bet_selections(*)
      `)
      .eq("id", request.betId)
      .single();

    if (betError || !bet) {
      return { success: false, error: "Bet not found" };
    }

    if (bet.status !== "pending") {
      return { success: false, error: `Bet already ${bet.status}` };
    }

    const payout = calculatePayout(
      bet.stake,
      bet.total_odds,
      bet.potential_return,
      request.settlementType
    );

    const resultMap: Record<"win" | "loss" | "void" | "refund", "won" | "lost" | "void"> = {
      win: "won",
      loss: "lost",
      void: "void",
      refund: "void",
    };
    const settlementResult = resultMap[request.settlementType as keyof typeof resultMap];

    const { error: settlementError } = await supabase.rpc("settle_bet", {
      p_bet_id: request.betId,
      p_result: settlementResult,
      p_payout: payout,
    });

    if (settlementError) {
      return {
        success: false,
        error: settlementError.message || "Settlement failed",
      };
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("demo_balance")
      .eq("id", bet.user_id)
      .single();
    const newBalance = profile?.demo_balance || 0;

    // Log settlement
    await logSettlement(request, bet, payout);

    // Log admin action
    await logTraderAction(
      request.settledBy,
      "settle_bet",
      request.betId,
      `${bet.status} -> ${settlementResult}`,
      settlementResult,
      request.reason
    );

    return {
      success: true,
      payout,
      newBalance,
    };
  } catch (error) {
    console.error("Settlement error:", error);
    return { success: false, error: "Settlement failed" };
  }
}

/**
 * Calculate payout based on settlement type
 */
function calculatePayout(
  stake: number,
  totalOdds: number,
  potentialPayout: number,
  settlementType: SettlementType
): number {
  switch (settlementType) {
    case "win":
      return potentialPayout;
    
    case "loss":
      return 0;
    
    case "void":
    case "refund":
      return stake;
    
    case "half_win":
      // Return stake + half of profit
      const profit = potentialPayout - stake;
      return stake + (profit / 2);
    
    case "half_loss":
      // Return half of stake
      return stake / 2;
    
    default:
      return 0;
  }
}

/**
 * Get bet status from settlement type
 */
function getSettlementStatus(settlementType: SettlementType): string {
  switch (settlementType) {
    case "win":
      return "won";
    case "loss":
      return "lost";
    case "void":
      return "void";
    case "refund":
      return "refunded";
    case "half_win":
      return "half_won";
    case "half_loss":
      return "half_lost";
    default:
      return "settled";
  }
}

/**
 * Update wallet on settlement (atomic transaction)
 */
async function updateWalletOnSettlement(
  userId: string,
  payout: number,
  betId: string
): Promise<{ success: boolean; newBalance?: number }> {
  try {
    // Get current balance
    const { data: profile } = await supabase
      .from("profiles")
      .select("demo_balance")
      .eq("id", userId)
      .single();

    if (!profile) {
      return { success: false };
    }

    const newBalance = profile.demo_balance + payout;

    // Update balance
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ demo_balance: newBalance })
      .eq("id", userId);

    if (updateError) {
      return { success: false };
    }

    // Create wallet transaction
    const { error: txError } = await supabase
      .from("wallet_transactions")
      .insert({
        user_id: userId,
        type: "bet_payout",
        amount: payout,
        balance_after: newBalance,
        reference_id: betId,
        description: `Bet settlement payout`,
      });

    if (txError) {
      console.error("Failed to create transaction:", txError);
    }

    return { success: true, newBalance };
  } catch (error) {
    console.error("Update wallet error:", error);
    return { success: false };
  }
}

/**
 * Log settlement to settlements table
 */
async function logSettlement(
  request: SettlementRequest,
  bet: any,
  payout: number
) {
  try {
    await supabase.from("settlements").insert({
      bet_id: request.betId,
      settlement_type: request.settlementType,
      original_stake: bet.stake,
      settlement_amount: payout,
      settled_by: request.settledBy,
      settlement_reason: request.reason,
    });
  } catch (error) {
    console.error("Failed to log settlement:", error);
  }
}

/**
 * Log trader action to audit log
 */
async function logTraderAction(
  adminId: string,
  action: string,
  targetId: string,
  previousValue: string,
  newValue: string,
  reason?: string
) {
  try {
    await supabase.from("trader_actions").insert({
      admin_id: adminId,
      action_type: action,
      entity_type: "bet",
      entity_id: targetId,
      previous_value: previousValue,
      new_value: newValue,
      reason: reason || null,
    });
  } catch (error) {
    console.error("Failed to log trader action:", error);
  }
}

/**
 * Batch settle multiple bets (for event settlement)
 */
export async function batchSettleBets(
  eventId: string,
  winningSelection: string,
  settledBy: string
): Promise<{ success: boolean; settled: number; failed: number }> {
  try {
    // Get all pending bets for this event
    const { data: bets } = await supabase
      .from("bets")
      .select(`
        id,
        bet_selections!inner(selection)
      `)
      .eq("status", "pending")
      .eq("bet_selections.event_id", eventId);

    if (!bets || bets.length === 0) {
      return { success: true, settled: 0, failed: 0 };
    }

    let settled = 0;
    let failed = 0;

    for (const bet of bets) {
      // Determine settlement type based on selection
      const betSelection = (bet.bet_selections as any)[0]?.selection;
      const settlementType: SettlementType = 
        betSelection === winningSelection ? "win" : "loss";

      const result = await settleBet({
        betId: bet.id,
        settlementType,
        settledBy,
        reason: `Event settled - Winner: ${winningSelection}`,
      });

      if (result.success) {
        settled++;
      } else {
        failed++;
      }
    }

    return { success: true, settled, failed };
  } catch (error) {
    console.error("Batch settlement error:", error);
    return { success: false, settled: 0, failed: 0 };
  }
}

/**
 * Void all bets for an event
 */
export async function voidEventBets(
  eventId: string,
  settledBy: string,
  reason: string
): Promise<{ success: boolean; voided: number }> {
  try {
    const { data: bets } = await supabase
      .from("bets")
      .select("id")
      .eq("status", "pending")
      .eq("bet_selections.event_id", eventId);

    if (!bets || bets.length === 0) {
      return { success: true, voided: 0 };
    }

    let voided = 0;

    for (const bet of bets) {
      const result = await settleBet({
        betId: bet.id,
        settlementType: "void",
        settledBy,
        reason,
      });

      if (result.success) {
        voided++;
      }
    }

    return { success: true, voided };
  } catch (error) {
    console.error("Void event bets error:", error);
    return { success: false, voided: 0 };
  }
}

/**
 * Update user risk profile after settlement
 */
export async function updateRiskProfileAfterSettlement(
  userId: string,
  won: boolean,
  payout: number
) {
  try {
    const { data: profile } = await supabase
      .from("risk_profiles")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (!profile) return;

    const newTotalWon = won ? profile.total_won + payout : profile.total_won;
    const newWinRate = ((profile.total_bets * profile.win_rate / 100) + (won ? 1 : 0)) / profile.total_bets * 100;

    await supabase
      .from("risk_profiles")
      .update({
        total_won: newTotalWon,
        win_rate: newWinRate,
      })
      .eq("user_id", userId);
  } catch (error) {
    console.error("Update risk profile error:", error);
  }
}
