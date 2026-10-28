/**
 * Odds Validation Layer
 * Validates incoming live odds before they reach the bet slip
 */

import { supabase } from "@/integrations/supabase/client";

export interface OddsValidationResult {
  valid: boolean;
  reason?: string;
  originalValue?: number;
  currentValue?: number;
}

export interface ValidatedOdds {
  oddsId: string;
  value: number;
  isValid: boolean;
  validatedAt: Date;
}

/**
 * Validate odds freshness and availability
 */
export async function validateOdds(
  oddsId: string,
  expectedValue: number,
  tolerance: number = 0.05
): Promise<OddsValidationResult> {
  try {
    // Fetch current odds from database
    const { data: odds, error } = await supabase
      .from("odds")
      .select("value, is_active, is_locked, markets(status, events(status, is_suspended))")
      .eq("id", oddsId)
      .single();

    if (error || !odds) {
      return {
        valid: false,
        reason: "Odds not found",
      };
    }

    // Check if odds are active
    if (!odds.is_active) {
      return {
        valid: false,
        reason: "Odds are no longer active",
        originalValue: expectedValue,
        currentValue: odds.value,
      };
    }

    // Check if odds are locked
    if (odds.is_locked) {
      return {
        valid: false,
        reason: "Odds are locked",
        originalValue: expectedValue,
        currentValue: odds.value,
      };
    }

    // Check market status
    const market = (odds as any).markets;
    if (market?.status !== "active") {
      return {
        valid: false,
        reason: "Market is not active",
        originalValue: expectedValue,
        currentValue: odds.value,
      };
    }

    // Check event status
    const event = market?.events;
    if (event?.is_suspended || !["upcoming", "live"].includes(event?.status)) {
      return {
        valid: false,
        reason: "Event is suspended or finished",
        originalValue: expectedValue,
        currentValue: odds.value,
      };
    }

    // Check if value changed significantly
    const currentValue = Number(odds.value);
    const valueDiff = Math.abs(currentValue - expectedValue);
    const percentChange = (valueDiff / expectedValue) * 100;

    if (percentChange > tolerance * 100) {
      return {
        valid: false,
        reason: `Odds changed by ${percentChange.toFixed(1)}%`,
        originalValue: expectedValue,
        currentValue,
      };
    }

    return {
      valid: true,
      originalValue: expectedValue,
      currentValue,
    };
  } catch (error) {
    console.error("Odds validation error:", error);
    return {
      valid: false,
      reason: "Validation failed",
    };
  }
}

/**
 * Validate multiple odds selections at once
 */
export async function validateBetSlipOdds(
  selections: Array<{ oddsId: string; value: number }>
): Promise<{
  valid: boolean;
  invalidSelections: Array<{ oddsId: string; reason: string }>;
  validatedOdds: ValidatedOdds[];
}> {
  const results = await Promise.all(
    selections.map(async (sel) => ({
      oddsId: sel.oddsId,
      result: await validateOdds(sel.oddsId, sel.value),
    }))
  );

  const invalidSelections = results
    .filter((r) => !r.result.valid)
    .map((r) => ({
      oddsId: r.oddsId,
      reason: r.result.reason || "Unknown error",
    }));

  const validatedOdds: ValidatedOdds[] = results
    .filter((r) => r.result.valid)
    .map((r) => ({
      oddsId: r.oddsId,
      value: r.result.currentValue || 0,
      isValid: true,
      validatedAt: new Date(),
    }));

  return {
    valid: invalidSelections.length === 0,
    invalidSelections,
    validatedOdds,
  };
}

/**
 * Check if odds need re-validation (older than 30 seconds)
 */
export function needsRevalidation(lastValidated: Date): boolean {
  const thirtySecondsAgo = new Date(Date.now() - 30_000);
  return lastValidated < thirtySecondsAgo;
}

/**
 * Validate odds value is within acceptable range
 */
export function isValidOddsValue(value: number): boolean {
  return Number.isFinite(value) && value >= 1.01 && value <= 1000;
}

/**
 * Calculate acceptable odds range for tolerance
 */
export function getAcceptableOddsRange(
  value: number,
  tolerance: number = 0.05
): { min: number; max: number } {
  const range = value * tolerance;
  return {
    min: Math.max(1.01, value - range),
    max: value + range,
  };
}