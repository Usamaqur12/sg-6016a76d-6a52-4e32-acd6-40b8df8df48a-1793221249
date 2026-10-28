import { supabase } from "@/integrations/supabase/client";

/**
 * BET BUILDER / MARKET CORRELATION ENGINE
 * 
 * Detects incompatible selections from the same event
 * Prevents impossible combinations
 */

interface CorrelationCheck {
  allowed: boolean;
  reason?: string;
  conflictingSelections?: string[];
}

/**
 * Check if selections are from the same event
 */
function selectionsFromSameEvent(selections: any[]): boolean {
  if (selections.length < 2) return false;

  const eventIds = new Set(selections.map((s) => s.eventId));
  return eventIds.size === 1;
}

/**
 * Get market correlation rules
 */
async function getCorrelationRules() {
  try {
    const { data, error } = await supabase
      .from("market_correlations")
      .select("*")
      .eq("is_active", true);

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error("Get correlation rules error:", error);
    return [];
  }
}

/**
 * Check if bet builder selections are compatible
 */
export async function checkBetBuilderCompatibility(
  selections: Array<{
    eventId: string;
    marketId: string;
    selection: string;
    marketType?: string;
  }>
): Promise<{
  allowed: boolean;
  reason?: string;
  conflictingSelections?: string[];
}> {
  try {
    // All selections must be from same event
    const eventIds = [...new Set(selections.map((s) => s.eventId))];
    if (eventIds.length !== 1) {
      return {
        allowed: false,
        reason: "All selections must be from the same event",
      };
    }

    const eventId = eventIds[0];

    // Check correlation rules
    const { data: rules } = await supabase
      .from("market_correlation_rules")
      .select("*")
      .eq("event_id", eventId)
      .eq("is_allowed", false);

    if (!rules || rules.length === 0) {
      return { allowed: true };
    }

    // Check each pair of selections
    const conflicts: string[] = [];

    for (let i = 0; i < selections.length; i++) {
      for (let j = i + 1; j < selections.length; j++) {
        const sel1 = selections[i];
        const sel2 = selections[j];

        // Check if this combination is blocked
        const blocked = rules.some((rule) => {
          const markets = [sel1.marketId, sel2.marketId].sort();
          const ruleMarkets = [rule.market_id_1, rule.market_id_2].sort();
          return markets[0] === ruleMarkets[0] && markets[1] === ruleMarkets[1];
        });

        if (blocked) {
          conflicts.push(`${sel1.selection} + ${sel2.selection}`);
        }
      }
    }

    if (conflicts.length > 0) {
      return {
        allowed: false,
        reason: "Incompatible selections detected",
        conflictingSelections: conflicts,
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error("Check bet builder compatibility error:", error);
    return {
      allowed: false,
      reason: "Failed to validate bet builder",
    };
  }
}

/**
 * Validate bet builder combination
 */
export async function validateBetBuilder(
  eventId: string,
  selections: any[]
): Promise<{
  valid: boolean;
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if all selections are from the same event
  const allSameEvent = selections.every((s) => s.eventId === eventId);
  if (!allSameEvent) {
    errors.push("All selections must be from the same event for Bet Builder");
  }

  // Check minimum selections
  if (selections.length < 2) {
    errors.push("Bet Builder requires at least 2 selections");
  }

  // Check maximum selections
  if (selections.length > 12) {
    errors.push("Bet Builder allows maximum 12 selections");
  }

  // Check compatibility
  const compatCheck = await checkBetBuilderCompatibility(selections);
  if (!compatCheck.allowed) {
    errors.push(compatCheck.reason || "Incompatible selections");
  }

  // Check for highly correlated markets (warning only)
  const rules = await getCorrelationRules();
  for (let i = 0; i < selections.length; i++) {
    for (let j = i + 1; j < selections.length; j++) {
      const sel1 = selections[i];
      const sel2 = selections[j];

      const rule = rules.find(
        (r) =>
          ((r.market_type_1 === sel1.marketType &&
            r.market_type_2 === sel2.marketType) ||
            (r.market_type_1 === sel2.marketType &&
              r.market_type_2 === sel1.marketType)) &&
          r.correlation_type === "dependent"
      );

      if (rule) {
        warnings.push(
          `${sel1.marketType} and ${sel2.marketType} are correlated - odds may be adjusted`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Calculate adjusted odds for correlated selections
 */
export function calculateBetBuilderOdds(
  selections: any[],
  correlationFactor: number = 0.85
): number {
  if (selections.length === 0) return 0;

  // For correlated same-event selections, apply correlation factor
  if (selectionsFromSameEvent(selections) && selections.length >= 2) {
    // Calculate base combined odds
    const baseOdds = selections.reduce((acc, sel) => acc * sel.oddsValue, 1);
    
    // Apply correlation factor (typically 0.8-0.9 for same-event multiples)
    return baseOdds * Math.pow(correlationFactor, selections.length - 1);
  }

  // For independent selections, multiply normally
  return selections.reduce((acc, sel) => acc * sel.oddsValue, 1);
}