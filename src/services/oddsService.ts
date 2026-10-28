import { supabase } from "@/integrations/supabase/client";

/**
 * ODDS & MARGIN ENGINE
 * 
 * Calculates customer-facing odds from provider odds + platform margin
 * Tracks odds movements for up/down indicators
 */

interface OddsCalculation {
  providerOdds: number;
  margin: number;
  customerOdds: number;
}

interface OddsMovement {
  previousOdds: number;
  newOdds: number;
  direction: "up" | "down" | "unchanged";
  percentage: number;
}

/**
 * Calculate customer odds from provider odds + margin
 * 
 * Formula: Customer Odds = Provider Odds / (1 + Margin/100)
 * 
 * Example:
 * Provider: 2.00, Margin: 5%
 * Customer: 2.00 / 1.05 = 1.90
 */
export function calculateCustomerOdds(
  providerOdds: number,
  marginPercentage: number
): OddsCalculation {
  const margin = marginPercentage / 100;
  const customerOdds = providerOdds / (1 + margin);

  return {
    providerOdds,
    margin: marginPercentage,
    customerOdds: Math.round(customerOdds * 100) / 100, // Round to 2 decimals
  };
}

/**
 * Calculate margin from provider and customer odds
 * Used to verify existing odds or calculate current margin
 */
export function calculateMargin(
  providerOdds: number,
  customerOdds: number
): number {
  const margin = ((providerOdds - customerOdds) / providerOdds) * 100;
  return Math.round(margin * 100) / 100;
}

/**
 * Track odds movement and determine direction
 */
export function analyzeOddsMovement(
  previousOdds: number,
  newOdds: number
): OddsMovement {
  const difference = newOdds - previousOdds;
  const percentage = (difference / previousOdds) * 100;

  let direction: "up" | "down" | "unchanged" = "unchanged";
  if (difference > 0.01) direction = "up";
  if (difference < -0.01) direction = "down";

  return {
    previousOdds,
    newOdds,
    direction,
    percentage: Math.round(percentage * 100) / 100,
  };
}

/**
 * Update odds and log history
 */
export async function updateOdds(
  oddsId: string,
  marketId: string,
  selection: string,
  newValue: number,
  providerOdds: number,
  marginApplied: number,
  changeType: "manual" | "automatic" | "provider_update",
  changedBy?: string
) {
  try {
    // Get current odds value
    const { data: currentOdds } = await supabase
      .from("odds")
      .select("value")
      .eq("id", oddsId)
      .single();

    if (!currentOdds) {
      return { success: false, error: "Odds not found" };
    }

    const previousValue = currentOdds.value;

    // Update odds
    const { error: updateError } = await supabase
      .from("odds")
      .update({
        value: newValue,
        updated_at: new Date().toISOString(),
      })
      .eq("id", oddsId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Log odds history
    const { error: historyError } = await supabase
      .from("odds_history")
      .insert({
        odds_id: oddsId,
        market_id: marketId,
        selection,
        previous_value: previousValue,
        new_value: newValue,
        provider_odds: providerOdds,
        margin_applied: marginApplied,
        changed_by: changedBy || null,
        change_type: changeType,
      });

    if (historyError) {
      console.error("Failed to log odds history:", historyError);
    }

    return {
      success: true,
      movement: analyzeOddsMovement(previousValue, newValue),
    };
  } catch (error) {
    console.error("Update odds error:", error);
    return { success: false, error: "Failed to update odds" };
  }
}

/**
 * Get recent odds movements for a market
 */
export async function getOddsHistory(
  marketId: string,
  limit: number = 10
) {
  try {
    const { data, error } = await supabase
      .from("odds_history")
      .select("*")
      .eq("market_id", marketId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, history: data };
  } catch (error) {
    console.error("Get odds history error:", error);
    return { success: false, error: "Failed to get odds history" };
  }
}

/**
 * Get margin for a sport/event/market
 * Priority: market_config > sport_config > default (5%)
 */
export async function getApplicableMargin(
  sportId: string,
  marketId?: string
): Promise<number> {
  try {
    // Check market-specific margin override
    if (marketId) {
      const { data: marketConfig } = await supabase
        .from("market_config")
        .select("margin_override")
        .eq("market_id", marketId)
        .single();

      if (marketConfig?.margin_override) {
        return marketConfig.margin_override;
      }
    }

    // Check sport-specific default margin
    const { data: sportConfig } = await supabase
      .from("sport_config")
      .select("default_margin")
      .eq("sport_id", sportId)
      .single();

    if (sportConfig?.default_margin) {
      return sportConfig.default_margin;
    }

    // Default platform margin
    return 5.0;
  } catch (error) {
    console.error("Get margin error:", error);
    return 5.0; // Fallback to 5%
  }
}

/**
 * Batch update odds with margin application
 */
export async function batchUpdateOddsWithMargin(
  sportId: string,
  oddsUpdates: Array<{
    oddsId: string;
    marketId: string;
    selection: string;
    providerOdds: number;
  }>
) {
  try {
    const margin = await getApplicableMargin(sportId);
    const results = [];

    for (const update of oddsUpdates) {
      const calculation = calculateCustomerOdds(update.providerOdds, margin);
      
      const result = await updateOdds(
        update.oddsId,
        update.marketId,
        update.selection,
        calculation.customerOdds,
        update.providerOdds,
        margin,
        "provider_update"
      );

      results.push({
        ...update,
        result,
        customerOdds: calculation.customerOdds,
      });
    }

    return { success: true, results };
  } catch (error) {
    console.error("Batch update odds error:", error);
    return { success: false, error: "Failed to batch update odds" };
  }
}