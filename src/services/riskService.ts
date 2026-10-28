import { supabase } from "@/integrations/supabase/client";

/**
 * RISK ENGINE
 * 
 * Calculates and tracks exposure, liability, and user risk scores
 * Provides risk-based limits and alerts
 */

interface ExposureData {
  eventId: string;
  totalStake: number;
  totalLiability: number;
  maxPotentialPayout: number;
  homeLiability: number;
  drawLiability: number;
  awayLiability: number;
  betCount: number;
  uniqueUsers: number;
  riskLevel: "low" | "medium" | "high" | "critical";
}

interface UserRiskProfile {
  userId: string;
  riskLevel: "low" | "medium" | "high" | "restricted";
  riskScore: number;
  totalBets: number;
  totalWagered: number;
  totalWon: number;
  winRate: number;
  avgStake: number;
  maxStake: number;
  maxPayout: number;
}

/**
 * Update event exposure after bet placement
 */
export async function updateEventExposure(
  eventId: string,
  stake: number,
  potentialPayout: number,
  selection: string,
  userId: string
) {
  try {
    // Get or create event exposure record
    let { data: exposure } = await supabase
      .from("event_exposure")
      .select("*")
      .eq("event_id", eventId)
      .single();

    if (!exposure) {
      const { data: newExposure, error: createError } = await supabase
        .from("event_exposure")
        .insert({
          event_id: eventId,
          total_stake: 0,
          total_liability: 0,
          max_potential_payout: 0,
          home_liability: 0,
          draw_liability: 0,
          away_liability: 0,
          bet_count: 0,
          unique_users: 0,
        })
        .select()
        .single();

      if (createError) {
        return { success: false, error: createError.message };
      }
      exposure = newExposure;
    }

    // Calculate new values
    const newTotalStake = exposure.total_stake + stake;
    const newTotalLiability = exposure.total_liability + (potentialPayout - stake);
    const newMaxPayout = Math.max(exposure.max_potential_payout, potentialPayout);
    const newBetCount = exposure.bet_count + 1;

    // Update selection-specific liability
    let homeLiability = exposure.home_liability;
    let drawLiability = exposure.draw_liability;
    let awayLiability = exposure.away_liability;

    if (selection.toLowerCase().includes("home") || selection === "1") {
      homeLiability += potentialPayout - stake;
    } else if (selection.toLowerCase().includes("draw") || selection === "X") {
      drawLiability += potentialPayout - stake;
    } else if (selection.toLowerCase().includes("away") || selection === "2") {
      awayLiability += potentialPayout - stake;
    }

    // Calculate risk level
    const riskLevel = calculateRiskLevel(newTotalLiability, 50000); // Default threshold

    // Update exposure
    const { error: updateError } = await supabase
      .from("event_exposure")
      .update({
        total_stake: newTotalStake,
        total_liability: newTotalLiability,
        max_potential_payout: newMaxPayout,
        home_liability: homeLiability,
        draw_liability: drawLiability,
        away_liability: awayLiability,
        bet_count: newBetCount,
        last_bet_at: new Date().toISOString(),
        risk_level: riskLevel,
      })
      .eq("event_id", eventId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    return {
      success: true,
      exposure: {
        totalLiability: newTotalLiability,
        riskLevel,
      },
    };
  } catch (error) {
    console.error("Update event exposure error:", error);
    return { success: false, error: "Failed to update exposure" };
  }
}

/**
 * Update market exposure after bet placement
 */
export async function updateMarketExposure(
  marketId: string,
  stake: number,
  potentialPayout: number,
  selection: string,
  userId: string
) {
  try {
    let { data: exposure } = await supabase
      .from("market_exposure")
      .select("*")
      .eq("market_id", marketId)
      .single();

    if (!exposure) {
      const { data: newExposure, error: createError } = await supabase
        .from("market_exposure")
        .insert({
          market_id: marketId,
          total_stake: 0,
          total_liability: 0,
          max_potential_payout: 0,
          bet_count: 0,
          unique_users: 0,
          selection_exposure: {},
        })
        .select()
        .single();

      if (createError) {
        return { success: false, error: createError.message };
      }
      exposure = newExposure;
    }

    const newTotalStake = exposure.total_stake + stake;
    const newTotalLiability = exposure.total_liability + (potentialPayout - stake);
    const newMaxPayout = Math.max(exposure.max_potential_payout, potentialPayout);
    const newBetCount = exposure.bet_count + 1;

    // Update selection-specific exposure
    const selectionExposure = exposure.selection_exposure as Record<string, number> || {};
    selectionExposure[selection] = (selectionExposure[selection] || 0) + (potentialPayout - stake);

    const riskLevel = calculateRiskLevel(newTotalLiability, 30000);

    const { error: updateError } = await supabase
      .from("market_exposure")
      .update({
        total_stake: newTotalStake,
        total_liability: newTotalLiability,
        max_potential_payout: newMaxPayout,
        bet_count: newBetCount,
        selection_exposure: selectionExposure,
        last_bet_at: new Date().toISOString(),
        risk_level: riskLevel,
      })
      .eq("market_id", marketId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    return { success: true };
  } catch (error) {
    console.error("Update market exposure error:", error);
    return { success: false, error: "Failed to update market exposure" };
  }
}

/**
 * Calculate risk level based on liability vs threshold
 */
function calculateRiskLevel(
  liability: number,
  threshold: number
): "low" | "medium" | "high" | "critical" {
  const percentage = (liability / threshold) * 100;

  if (percentage >= 100) return "critical";
  if (percentage >= 75) return "high";
  if (percentage >= 50) return "medium";
  return "low";
}

/**
 * Calculate user risk score based on betting patterns
 */
export async function calculateUserRiskScore(userId: string): Promise<number> {
  try {
    const { data: profile } = await supabase
      .from("risk_profiles")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (!profile) return 0;

    let score = 0;

    // High win rate (> 70%) = +20 points
    if (profile.win_rate > 70) score += 20;

    // High average stake = +15 points
    if (profile.avg_stake > 5000) score += 15;

    // Unusual bet frequency = +25 points
    if (profile.unusual_bet_count > 5) score += 25;

    // Very large single bets = +20 points
    if (profile.avg_stake > 10000) score += 20;

    // Low bet count but high winnings = +30 points (possible multi-accounting)
    if (profile.total_bets < 10 && profile.total_won > 50000) score += 30;

    return Math.min(score, 100); // Cap at 100
  } catch (error) {
    console.error("Calculate risk score error:", error);
    return 0;
  }
}

/**
 * Update user risk profile after bet placement
 */
export async function updateUserRiskProfile(
  userId: string,
  stake: number,
  potentialPayout: number
) {
  try {
    let { data: profile } = await supabase
      .from("risk_profiles")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (!profile) {
      const { data: newProfile, error: createError } = await supabase
        .from("risk_profiles")
        .insert({
          user_id: userId,
          risk_level: "low",
          risk_score: 0,
          total_bets: 0,
          total_wagered: 0,
          total_won: 0,
          win_rate: 0,
          avg_stake: 0,
        })
        .select()
        .single();

      if (createError) {
        return { success: false, error: createError.message };
      }
      profile = newProfile;
    }

    const newTotalBets = profile.total_bets + 1;
    const newTotalWagered = profile.total_wagered + stake;
    const newAvgStake = newTotalWagered / newTotalBets;

    // Check for unusual betting patterns
    let unusualCount = profile.unusual_bet_count;
    if (stake > profile.avg_stake * 3 && profile.total_bets > 5) {
      unusualCount += 1; // Stake 3x higher than average
    }

    const riskScore = await calculateUserRiskScore(userId);
    let riskLevel: "low" | "medium" | "high" | "restricted" = "low";
    if (riskScore >= 80) riskLevel = "restricted";
    else if (riskScore >= 60) riskLevel = "high";
    else if (riskScore >= 40) riskLevel = "medium";

    const { error: updateError } = await supabase
      .from("risk_profiles")
      .update({
        total_bets: newTotalBets,
        total_wagered: newTotalWagered,
        avg_stake: newAvgStake,
        unusual_bet_count: unusualCount,
        risk_score: riskScore,
        risk_level: riskLevel,
        last_bet_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    return { success: true, riskLevel, riskScore };
  } catch (error) {
    console.error("Update user risk profile error:", error);
    return { success: false, error: "Failed to update risk profile" };
  }
}

/**
 * Get event exposure for risk dashboard
 */
export async function getEventExposure(eventId: string) {
  try {
    const { data, error } = await supabase
      .from("event_exposure")
      .select("*")
      .eq("event_id", eventId)
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, exposure: data };
  } catch (error) {
    console.error("Get event exposure error:", error);
    return { success: false, error: "Failed to get exposure" };
  }
}

/**
 * Get high-risk events for admin dashboard
 */
export async function getHighRiskEvents(limit: number = 10) {
  try {
    const { data, error } = await supabase
      .from("event_exposure")
      .select(`
        *,
        events!inner(id, home_team, away_team, league, start_time)
      `)
      .in("risk_level", ["high", "critical"])
      .order("total_liability", { ascending: false })
      .limit(limit);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, events: data };
  } catch (error) {
    console.error("Get high-risk events error:", error);
    return { success: false, error: "Failed to get high-risk events" };
  }
}

/**
 * Get high-risk users for admin review
 */
export async function getHighRiskUsers() {
  try {
    const { data: users, error } = await supabase
      .from("risk_profiles")
      .select(`
        *,
        profiles!inner(email)
      `)
      .in("risk_level", ["high", "critical"])
      .order("total_won", { ascending: false })
      .limit(10);

    if (error) throw error;

    return { success: true, users: users || [] };
  } catch (error) {
    console.error("Get high-risk users error:", error);
    return { success: false, error: "Failed to get high-risk users" };
  }
}