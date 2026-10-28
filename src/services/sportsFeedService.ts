import { supabase } from "@/integrations/supabase/client";

const db = supabase;

/**
 * SPORTS FEED / PROVIDER ABSTRACTION LAYER
 * 
 * Provides abstraction over multiple sports data providers
 * Handles failover, health monitoring, and feed reconciliation
 */

export interface SportsProvider {
  name: string;
  type: "odds" | "scores" | "results";
  getSports(): Promise<any[]>;
  getEvents(sportId: string): Promise<any[]>;
  getMarkets(eventId: string): Promise<any[]>;
  getOdds(marketId: string): Promise<any[]>;
  getLiveScores(eventId: string): Promise<any>;
  getResults(eventId: string): Promise<any>;
}

interface ProviderHealth {
  name: string;
  status: "active" | "degraded" | "down";
  lastSuccessfulFetch?: Date;
  avgLatency: number;
  successRate: number;
}

/**
 * Mock Sports Provider (for demo)
 * In production, replace with real provider integration
 */
class MockSportsProvider implements SportsProvider {
  name = "MockProvider";
  type: "odds" | "scores" | "results" = "odds";

  async getSports() {
    await this.simulateLatency();
    return [
      { id: "football", name: "Football", isActive: true },
      { id: "cricket", name: "Cricket", isActive: true },
      { id: "tennis", name: "Tennis", isActive: true },
      { id: "basketball", name: "Basketball", isActive: true },
      { id: "esports", name: "Esports", isActive: true },
    ];
  }

  async getEvents(sportId: string) {
    await this.simulateLatency();
    
    // Return mock events based on sport
    const mockEvents = [
      {
        id: `${sportId}-event-1`,
        sport: sportId,
        homeTeam: "Team A",
        awayTeam: "Team B",
        league: "Premier League",
        startTime: new Date(Date.now() + 3600000).toISOString(),
        isLive: false,
        status: "upcoming",
      },
      {
        id: `${sportId}-event-2`,
        sport: sportId,
        homeTeam: "Team C",
        awayTeam: "Team D",
        league: "Premier League",
        startTime: new Date(Date.now() + 7200000).toISOString(),
        isLive: false,
        status: "upcoming",
      },
    ];

    return mockEvents;
  }

  async getMarkets(eventId: string) {
    await this.simulateLatency();
    
    return [
      {
        id: `${eventId}-market-1`,
        eventId,
        name: "Match Result",
        type: "match_result",
        status: "active",
      },
      {
        id: `${eventId}-market-2`,
        eventId,
        name: "Over/Under 2.5",
        type: "over_under",
        status: "active",
      },
    ];
  }

  async getOdds(marketId: string) {
    await this.simulateLatency();
    
    // Generate realistic odds with some randomness
    const baseOdds = [
      { selection: "Home", probability: 0.45 },
      { selection: "Draw", probability: 0.27 },
      { selection: "Away", probability: 0.28 },
    ];

    return baseOdds.map((odds) => ({
      id: `${marketId}-${odds.selection}`,
      marketId,
      selection: odds.selection,
      providerOdds: this.probabilityToDecimalOdds(odds.probability),
      probability: odds.probability,
      status: "active",
    }));
  }

  async getLiveScores(eventId: string) {
    await this.simulateLatency();
    
    return {
      eventId,
      homeScore: Math.floor(Math.random() * 3),
      awayScore: Math.floor(Math.random() * 3),
      period: "1st Half",
      minute: 23,
      timestamp: new Date().toISOString(),
    };
  }

  async getResults(eventId: string) {
    await this.simulateLatency();
    
    return {
      eventId,
      homeScore: 2,
      awayScore: 1,
      status: "finished",
      timestamp: new Date().toISOString(),
    };
  }

  private probabilityToDecimalOdds(probability: number): number {
    return 1 / probability;
  }

  private simulateLatency() {
    return new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 100));
  }
}

/**
 * Sports Feed Manager
 * Manages multiple providers with failover
 */
class SportsFeedManager {
  private providers: Map<string, SportsProvider> = new Map();
  private primaryProvider?: SportsProvider;
  private backupProvider?: SportsProvider;

  constructor() {
    // Initialize with mock provider
    const mockProvider = new MockSportsProvider();
    this.providers.set("mock", mockProvider);
    this.primaryProvider = mockProvider;
  }

  /**
   * Add a provider to the manager
   */
  addProvider(name: string, provider: SportsProvider, isPrimary = false) {
    this.providers.set(name, provider);
    
    if (isPrimary) {
      this.primaryProvider = provider;
    } else if (!this.backupProvider) {
      this.backupProvider = provider;
    }
  }

  /**
   * Fetch data with automatic failover
   */
  private async fetchWithFailover<T>(
    operation: (provider: SportsProvider) => Promise<T>,
    providerType: string
  ): Promise<{ success: boolean; data?: T; error?: string; provider?: string }> {
    const startTime = Date.now();

    try {
      if (!this.primaryProvider) {
        return { success: false, error: "No primary provider configured" };
      }

      // Try primary provider
      const data = await operation(this.primaryProvider);
      const latency = Date.now() - startTime;

      await this.updateProviderHealth(
        this.primaryProvider.name,
        providerType,
        true,
        latency
      );

      return { success: true, data, provider: this.primaryProvider.name };
    } catch (primaryError) {
      console.error("Primary provider failed:", primaryError);

      await this.updateProviderHealth(
        this.primaryProvider?.name || "unknown",
        providerType,
        false,
        Date.now() - startTime,
        String(primaryError)
      );

      // Try backup provider if available
      if (this.backupProvider) {
        try {
          const data = await operation(this.backupProvider);
          const latency = Date.now() - startTime;

          await this.updateProviderHealth(
            this.backupProvider.name,
            providerType,
            true,
            latency
          );

          return { success: true, data, provider: this.backupProvider.name };
        } catch (backupError) {
          console.error("Backup provider failed:", backupError);

          await this.updateProviderHealth(
            this.backupProvider.name,
            providerType,
            false,
            Date.now() - startTime,
            String(backupError)
          );

          return { success: false, error: "All providers failed" };
        }
      }

      return { success: false, error: String(primaryError) };
    }
  }

  /**
   * Update provider health metrics
   */
  private async updateProviderHealth(
    providerName: string,
    providerType: string,
    success: boolean,
    latency: number,
    errorMessage?: string
  ) {
    try {
      // Get existing health record
      const { data: existing } = await db
        .from("provider_health")
        .select("*")
        .eq("provider_name", providerName)
        .eq("provider_type", providerType)
        .single();

      if (existing) {
        const newTotalRequests = existing.total_requests + 1;
        const newFailedRequests = success
          ? existing.failed_requests
          : existing.failed_requests + 1;
        const newSuccessRate = ((newTotalRequests - newFailedRequests) / newTotalRequests) * 100;
        const newAvgLatency = Math.round(
          (existing.avg_latency_ms * existing.total_requests + latency) / newTotalRequests
        );
        const newConsecutiveFailures = success ? 0 : existing.consecutive_failures + 1;

        let newStatus = existing.status;
        if (newConsecutiveFailures >= 5) {
          newStatus = "down";
        } else if (newConsecutiveFailures >= 3 || newSuccessRate < 95) {
          newStatus = "degraded";
        } else {
          newStatus = "active";
        }

        await db
          .from("provider_health")
          .update({
            status: newStatus,
            last_successful_fetch: success ? new Date().toISOString() : existing.last_successful_fetch,
            last_failed_fetch: success ? existing.last_failed_fetch : new Date().toISOString(),
            success_rate: newSuccessRate,
            avg_latency_ms: newAvgLatency,
            total_requests: newTotalRequests,
            failed_requests: newFailedRequests,
            consecutive_failures: newConsecutiveFailures,
            error_message: success ? null : errorMessage,
            updated_at: new Date().toISOString(),
          })
          .eq("provider_name", providerName)
          .eq("provider_type", providerType);
      } else {
        // Create new health record
        await db.from("provider_health").insert({
          provider_name: providerName,
          provider_type: providerType,
          status: success ? "active" : "degraded",
          last_successful_fetch: success ? new Date().toISOString() : null,
          last_failed_fetch: success ? null : new Date().toISOString(),
          success_rate: success ? 100 : 0,
          avg_latency_ms: latency,
          total_requests: 1,
          failed_requests: success ? 0 : 1,
          consecutive_failures: success ? 0 : 1,
          is_primary: providerName === this.primaryProvider?.name,
          error_message: success ? null : errorMessage,
        });
      }
    } catch (error) {
      console.error("Failed to update provider health:", error);
    }
  }

  /**
   * Public API methods
   */
  async getSports() {
    return this.fetchWithFailover(
      (provider) => provider.getSports(),
      "odds"
    );
  }

  async getEvents(sportId: string) {
    return this.fetchWithFailover(
      (provider) => provider.getEvents(sportId),
      "odds"
    );
  }

  async getMarkets(eventId: string) {
    return this.fetchWithFailover(
      (provider) => provider.getMarkets(eventId),
      "odds"
    );
  }

  async getOdds(marketId: string) {
    return this.fetchWithFailover(
      (provider) => provider.getOdds(marketId),
      "odds"
    );
  }

  async getLiveScores(eventId: string) {
    return this.fetchWithFailover(
      (provider) => provider.getLiveScores(eventId),
      "scores"
    );
  }

  async getResults(eventId: string) {
    return this.fetchWithFailover(
      (provider) => provider.getResults(eventId),
      "results"
    );
  }

  /**
   * Get provider health status
   */
  async getProviderHealth(): Promise<ProviderHealth[]> {
    try {
      const { data, error } = await db
        .from("provider_health")
        .select("*")
        .order("is_primary", { ascending: false });

      if (error) throw error;

      return (data || []).map((record) => ({
        name: record.provider_name,
        status: record.status as "active" | "degraded" | "down",
        lastSuccessfulFetch: record.last_successful_fetch
          ? new Date(record.last_successful_fetch)
          : undefined,
        avgLatency: record.avg_latency_ms,
        successRate: record.success_rate,
      }));
    } catch (error) {
      console.error("Get provider health error:", error);
      return [];
    }
  }
}

// Export singleton instance
export const sportsFeedManager = new SportsFeedManager();