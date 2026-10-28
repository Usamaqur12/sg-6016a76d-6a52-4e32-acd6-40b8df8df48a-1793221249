export interface SportsbookOutcome {
  id: string;
  marketId: string;
  selection: string;
  value: number;
}

export interface SportsbookMarket {
  id: string;
  name: string;
  type: string;
  outcomes: SportsbookOutcome[];
}

export interface SportsbookEvent {
  id: string;
  sport: string;
  sportSlug: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  startTime: string;
  startTimeIso: string;
  isLive: boolean;
  liveScore?: { home: number; away: number };
  liveMinute?: number;
  homeOdds: number;
  drawOdds?: number;
  awayOdds: number;
  marketCount: number;
  outcomes: Partial<Record<"Home" | "Draw" | "Away", SportsbookOutcome>>;
  markets: SportsbookMarket[];
}

export interface BetSlipItem {
  eventId: string;
  marketId: string;
  oddsId: string;
  selection: string;
  odds: number;
  eventName?: string;
  marketName?: string;
}

export interface Event {
  id: string;
  home_team: string;
  away_team: string;
  start_time: string;
  status: string;
}

export interface Market {
  id: string;
  name: string;
  type: string;
  status: string;
}

export interface Selection {
  id: string;
  selection: string;
  value: number;
}
