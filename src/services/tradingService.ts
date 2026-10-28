import { supabase } from "@/integrations/supabase/client";

/**
 * TRADING / ADMIN CONTROL SERVICE
 * 
 * Admin functions for sports trading control:
 * - Enable/disable sports, leagues, events, markets
 * - Suspend/resume events and markets
 * - Manual odds updates
 * - Margin configuration
 * - Exposure monitoring
 */

/**
 * Suspend or resume an event
 */
export async function toggleEventSuspension(
  eventId: string,
  suspend: boolean,
  adminId: string,
  reason: string
) {
  try {
    const { data: event } = await supabase
      .from("events")
      .select("is_suspended")
      .eq("id", eventId)
      .single();

    if (!event) {
      return { success: false, error: "Event not found" };
    }

    const { error: updateError } = await supabase
      .from("events")
      .update({ is_suspended: suspend })
      .eq("id", eventId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Log action
    await logTraderAction(
      adminId,
      suspend ? "event_suspend" : "event_resume",
      "event",
      eventId,
      event.is_suspended.toString(),
      suspend.toString(),
      reason
    );

    return { success: true };
  } catch (error) {
    console.error("Toggle event suspension error:", error);
    return { success: false, error: "Failed to update event" };
  }
}

/**
 * Suspend or resume a market
 */
export async function toggleMarketSuspension(
  marketId: string,
  suspend: boolean,
  adminId: string,
  reason: string
) {
  try {
    const { data: market } = await supabase
      .from("markets")
      .select("status")
      .eq("id", marketId)
      .single();

    if (!market) {
      return { success: false, error: "Market not found" };
    }

    const newStatus = suspend ? "suspended" : "active";

    const { error: updateError } = await supabase
      .from("markets")
      .update({ status: newStatus })
      .eq("id", marketId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    await logTraderAction(
      adminId,
      suspend ? "market_suspend" : "market_resume",
      "market",
      marketId,
      market.status,
      newStatus,
      reason
    );

    return { success: true };
  } catch (error) {
    console.error("Toggle market suspension error:", error);
    return { success: false, error: "Failed to update market" };
  }
}

/**
 * Lock or unlock individual odds
 */
export async function toggleOddsLock(
  oddsId: string,
  lock: boolean,
  adminId: string,
  reason: string
) {
  try {
    const { data: odds } = await supabase
      .from("odds")
      .select("is_locked")
      .eq("id", oddsId)
      .single();

    if (!odds) {
      return { success: false, error: "Odds not found" };
    }

    const { error: updateError } = await supabase
      .from("odds")
      .update({ is_locked: lock })
      .eq("id", oddsId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    await logTraderAction(
      adminId,
      "odds_change",
      "odds",
      oddsId,
      odds.is_locked.toString(),
      lock.toString(),
      reason
    );

    return { success: true };
  } catch (error) {
    console.error("Toggle odds lock error:", error);
    return { success: false, error: "Failed to update odds" };
  }
}

/**
 * Manually update odds value
 */
export async function manuallyUpdateOdds(
  oddsId: string,
  newValue: number,
  adminId: string,
  reason: string
) {
  try {
    const { data: odds } = await supabase
      .from("odds")
      .select("value, market_id, selection")
      .eq("id", oddsId)
      .single();

    if (!odds) {
      return { success: false, error: "Odds not found" };
    }

    if (newValue <= 1.01) {
      return { success: false, error: "Odds must be greater than 1.01" };
    }

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
    await supabase.from("odds_history").insert({
      odds_id: oddsId,
      market_id: odds.market_id,
      selection: odds.selection,
      previous_value: odds.value,
      new_value: newValue,
      provider_odds: newValue,
      margin_applied: 0,
      changed_by: adminId,
      change_type: "manual",
    });

    await logTraderAction(
      adminId,
      "odds_change",
      "odds",
      oddsId,
      odds.value.toString(),
      newValue.toString(),
      reason
    );

    return { success: true };
  } catch (error) {
    console.error("Manual odds update error:", error);
    return { success: false, error: "Failed to update odds" };
  }
}

/**
 * Configure sport-specific margin
 */
export async function configureSportMargin(
  sportId: string,
  marginPercentage: number,
  adminId: string
) {
  try {
    if (marginPercentage < 0 || marginPercentage > 50) {
      return { success: false, error: "Margin must be between 0% and 50%" };
    }

    const { data: existing } = await supabase
      .from("sport_config")
      .select("default_margin")
      .eq("sport_id", sportId)
      .single();

    if (existing) {
      const { error: updateError } = await supabase
        .from("sport_config")
        .update({ default_margin: marginPercentage })
        .eq("sport_id", sportId);

      if (updateError) {
        return { success: false, error: updateError.message };
      }

      await logTraderAction(
        adminId,
        "margin_change",
        "sport",
        sportId,
        existing.default_margin.toString(),
        marginPercentage.toString(),
        `Updated margin to ${marginPercentage}%`
      );
    } else {
      const { error: insertError } = await supabase
        .from("sport_config")
        .insert({
          sport_id: sportId,
          default_margin: marginPercentage,
        });

      if (insertError) {
        return { success: false, error: insertError.message };
      }
    }

    return { success: true };
  } catch (error) {
    console.error("Configure margin error:", error);
    return { success: false, error: "Failed to configure margin" };
  }
}

/**
 * Configure live bet delay for a sport
 */
export async function configureLiveBetDelay(
  sportId: string,
  delaySeconds: number,
  adminId: string
) {
  try {
    if (delaySeconds < 0 || delaySeconds > 60) {
      return { success: false, error: "Delay must be between 0 and 60 seconds" };
    }

    const { error } = await supabase
      .from("sport_config")
      .upsert({
        sport_id: sportId,
        live_bet_delay_seconds: delaySeconds,
      });

    if (error) {
      return { success: false, error: error.message };
    }

    await logTraderAction(
      adminId,
      "margin_change",
      "sport",
      sportId,
      "0",
      delaySeconds.toString(),
      `Set live bet delay to ${delaySeconds}s`
    );

    return { success: true };
  } catch (error) {
    console.error("Configure delay error:", error);
    return { success: false, error: "Failed to configure delay" };
  }
}

/**
 * Set user-specific limits
 */
export async function setUserLimit(
  userId: string,
  limitType: "stake" | "payout" | "daily_loss",
  limitValue: number,
  adminId: string
) {
  try {
    const { error } = await supabase
      .from("user_limits")
      .upsert({
        user_id: userId,
        limit_type: limitType,
        limit_value: limitValue,
      });

    if (error) {
      return { success: false, error: error.message };
    }

    await logTraderAction(
      adminId,
      "limit_change",
      "bet",
      userId,
      "0",
      limitValue.toString(),
      `Set ${limitType} limit to ${limitValue}`
    );

    return { success: true };
  } catch (error) {
    console.error("Set user limit error:", error);
    return { success: false, error: "Failed to set limit" };
  }
}

/**
 * Get real-time exposure dashboard data
 */
export async function getExposureDashboard() {
  try {
    // Total turnover (sum of all pending bet stakes)
    const { data: turnoverData } = await supabase
      .from("bets")
      .select("stake")
      .eq("status", "pending");

    const totalTurnover = turnoverData?.reduce((sum, bet) => sum + bet.stake, 0) || 0;

    // Total liability (sum of all pending bet potential returns - stakes)
    const { data: liabilityData } = await supabase
      .from("bets")
      .select("stake, potential_return")
      .eq("status", "pending");

    const totalLiability = liabilityData?.reduce(
      (sum, bet) => sum + (bet.potential_return - bet.stake),
      0
    ) || 0;

    // Maximum potential payout
    const { data: maxPayoutData } = await supabase
      .from("bets")
      .select("potential_return")
      .eq("status", "pending")
      .order("potential_return", { ascending: false })
      .limit(1)
      .single();

    const maxPotentialPayout = maxPayoutData?.potential_return || 0;

    // High-risk events
    const { data: exposureRows } = await supabase
      .from("event_exposure")
      .select("*")
      .in("risk_level", ["high", "critical"])
      .order("total_liability", { ascending: false })
      .limit(5);
    const exposureEventIds = (exposureRows || []).map((row) => row.event_id);
    const { data: exposureEvents } = exposureEventIds.length
      ? await supabase.from("events").select("id, home_team, away_team, leagues(name)").in("id", exposureEventIds)
      : { data: [] };
    const exposureEventMap = new Map((exposureEvents || []).map((event) => [event.id, event]));
    const highRiskEvents = (exposureRows || []).map((row) => ({ ...row, events: exposureEventMap.get(row.event_id) }));

    // Suspended markets count
    const { count: suspendedCount } = await supabase
      .from("markets")
      .select("*", { count: "exact", head: true })
      .eq("status", "suspended");

    return {
      success: true,
      dashboard: {
        totalTurnover,
        totalLiability,
        maxPotentialPayout,
        highRiskEvents: highRiskEvents || [],
        suspendedMarketsCount: suspendedCount || 0,
      },
    };
  } catch (error) {
    console.error("Get dashboard error:", error);
    return { success: false, error: "Failed to get dashboard data" };
  }
}

/**
 * Log trader action to audit log
 */
async function logTraderAction(
  adminId: string,
  actionType: string,
  targetType: string,
  targetId: string,
  previousValue: string,
  newValue: string,
  reason?: string
) {
  try {
    await supabase.from("trader_actions").insert({
      admin_id: adminId,
      action_type: actionType,
      entity_type: targetType,
      entity_id: targetId,
      previous_value: previousValue,
      new_value: newValue,
      reason: reason || null,
    });
    await supabase.from("audit_logs").insert({
      admin_id: adminId,
      action: actionType,
      entity_type: targetType,
      entity_id: targetId,
      changes: { previous_value: previousValue, new_value: newValue, reason: reason || null },
    });
  } catch (error) {
    console.error("Failed to log trader action:", error);
  }
}
