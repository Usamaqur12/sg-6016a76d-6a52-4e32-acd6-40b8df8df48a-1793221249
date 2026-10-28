/**
 * MOCK MARKETS SERVICE
 * Generates realistic betting markets and odds for imported fixtures
 * Used when providers supply match data but not bettable odds
 */

export interface GeneratedMarket {
  name: string;
  slug: string;
  category: string;
  display_order: number;
  outcomes: GeneratedOutcome[];
}

export interface GeneratedOutcome {
  name: string;
  slug: string;
  odds: number;
  probability: number;
  display_order: number;
}

/**
 * Generate realistic odds based on probability with margin
 * @param probability True probability (0-1)
 * @param margin Bookmaker margin percentage (default 5%)
 */
function probabilityToOdds(probability: number, margin = 0.05): number {
  const adjustedProbability = probability * (1 + margin);
  const odds = 1 / adjustedProbability;
  return Math.round(odds * 100) / 100;
}

/**
 * Add controlled randomness to make odds more realistic
 */
function addVariance(value: number, variancePercent: number): number {
  const variance = (Math.random() - 0.5) * 2 * (variancePercent / 100);
  return value * (1 + variance);
}

/**
 * Generate Match Result (1X2) market
 * Uses team names to create realistic probability distribution
 */
export function generateMatchResultMarket(
  homeTeam: string,
  awayTeam: string,
  leagueName?: string
): GeneratedMarket {
  // Base probabilities (home advantage)
  let homeProb = 0.45;
  let drawProb = 0.27;
  let awayProb = 0.28;

  // Adjust based on league characteristics
  if (leagueName?.toLowerCase().includes("premier") || leagueName?.toLowerCase().includes("bundesliga")) {
    // Top leagues: stronger home advantage
    homeProb = 0.48;
    drawProb = 0.25;
    awayProb = 0.27;
  }

  // Add variance to make each match unique
  homeProb = addVariance(homeProb, 15);
  drawProb = addVariance(drawProb, 20);
  awayProb = 1 - homeProb - drawProb;

  // Normalize to ensure probabilities sum to 1
  const total = homeProb + drawProb + awayProb;
  homeProb /= total;
  drawProb /= total;
  awayProb /= total;

  return {
    name: "Match Result",
    slug: "match-result",
    category: "main",
    display_order: 1,
    outcomes: [
      {
        name: "Home Win",
        slug: "home",
        odds: probabilityToOdds(homeProb),
        probability: homeProb,
        display_order: 1,
      },
      {
        name: "Draw",
        slug: "draw",
        odds: probabilityToOdds(drawProb),
        probability: drawProb,
        display_order: 2,
      },
      {
        name: "Away Win",
        slug: "away",
        odds: probabilityToOdds(awayProb),
        probability: awayProb,
        display_order: 3,
      },
    ],
  };
}

/**
 * Generate Over/Under Goals market
 */
export function generateOverUnderMarket(line = 2.5): GeneratedMarket {
  const overProb = addVariance(0.52, 20);
  const underProb = 1 - overProb;

  return {
    name: `Over/Under ${line} Goals`,
    slug: `over-under-${line}`,
    category: "goals",
    display_order: 2,
    outcomes: [
      {
        name: `Over ${line}`,
        slug: "over",
        odds: probabilityToOdds(overProb),
        probability: overProb,
        display_order: 1,
      },
      {
        name: `Under ${line}`,
        slug: "under",
        odds: probabilityToOdds(underProb),
        probability: underProb,
        display_order: 2,
      },
    ],
  };
}

/**
 * Generate Both Teams to Score market
 */
export function generateBothTeamsToScoreMarket(): GeneratedMarket {
  const yesProb = addVariance(0.48, 15);
  const noProb = 1 - yesProb;

  return {
    name: "Both Teams to Score",
    slug: "both-teams-to-score",
    category: "goals",
    display_order: 3,
    outcomes: [
      {
        name: "Yes",
        slug: "yes",
        odds: probabilityToOdds(yesProb),
        probability: yesProb,
        display_order: 1,
      },
      {
        name: "No",
        slug: "no",
        odds: probabilityToOdds(noProb),
        probability: noProb,
        display_order: 2,
      },
    ],
  };
}

/**
 * Generate Double Chance market
 */
export function generateDoubleChanceMarket(
  homeTeam: string,
  awayTeam: string
): GeneratedMarket {
  const homeOrDrawProb = addVariance(0.65, 10);
  const homeOrAwayProb = addVariance(0.72, 10);
  const drawOrAwayProb = 1 - (homeOrDrawProb + homeOrAwayProb - 1);

  return {
    name: "Double Chance",
    slug: "double-chance",
    category: "main",
    display_order: 4,
    outcomes: [
      {
        name: "Home or Draw",
        slug: "home-draw",
        odds: probabilityToOdds(homeOrDrawProb),
        probability: homeOrDrawProb,
        display_order: 1,
      },
      {
        name: "Home or Away",
        slug: "home-away",
        odds: probabilityToOdds(homeOrAwayProb),
        probability: homeOrAwayProb,
        display_order: 2,
      },
      {
        name: "Draw or Away",
        slug: "draw-away",
        odds: probabilityToOdds(drawOrAwayProb),
        probability: drawOrAwayProb,
        display_order: 3,
      },
    ],
  };
}

/**
 * Generate Correct Score market (top likely scorelines)
 */
export function generateCorrectScoreMarket(): GeneratedMarket {
  const scores = [
    { home: 0, away: 0, prob: 0.08 },
    { home: 1, away: 0, prob: 0.09 },
    { home: 1, away: 1, prob: 0.11 },
    { home: 2, away: 0, prob: 0.08 },
    { home: 2, away: 1, prob: 0.10 },
    { home: 0, away: 1, prob: 0.07 },
    { home: 0, away: 2, prob: 0.05 },
    { home: 1, away: 2, prob: 0.06 },
    { home: 2, away: 2, prob: 0.05 },
    { home: 3, away: 0, prob: 0.04 },
    { home: 3, away: 1, prob: 0.05 },
    { home: 0, away: 3, prob: 0.03 },
  ];

  return {
    name: "Correct Score",
    slug: "correct-score",
    category: "goals",
    display_order: 5,
    outcomes: scores.map((score, idx) => ({
      name: `${score.home}-${score.away}`,
      slug: `${score.home}-${score.away}`,
      odds: probabilityToOdds(addVariance(score.prob, 25)),
      probability: score.prob,
      display_order: idx + 1,
    })),
  };
}

/**
 * Generate Total Goals market
 */
export function generateTotalGoalsMarket(): GeneratedMarket {
  const ranges = [
    { name: "0-1 Goals", slug: "0-1", prob: 0.25 },
    { name: "2-3 Goals", slug: "2-3", prob: 0.42 },
    { name: "4-5 Goals", slug: "4-5", prob: 0.22 },
    { name: "6+ Goals", slug: "6-plus", prob: 0.11 },
  ];

  return {
    name: "Total Goals",
    slug: "total-goals",
    category: "goals",
    display_order: 6,
    outcomes: ranges.map((range, idx) => ({
      name: range.name,
      slug: range.slug,
      odds: probabilityToOdds(addVariance(range.prob, 15)),
      probability: range.prob,
      display_order: idx + 1,
    })),
  };
}

/**
 * Generate a full set of markets for a match
 */
export function generateMarketsForMatch(
  homeTeam: string,
  awayTeam: string,
  leagueName?: string,
  includeAdvanced = true
): GeneratedMarket[] {
  const markets = [
    generateMatchResultMarket(homeTeam, awayTeam, leagueName),
    generateOverUnderMarket(2.5),
    generateBothTeamsToScoreMarket(),
  ];

  if (includeAdvanced) {
    markets.push(
      generateDoubleChanceMarket(homeTeam, awayTeam),
      generateCorrectScoreMarket(),
      generateTotalGoalsMarket()
    );
  }

  return markets;
}