import { create } from "zustand";
import { persist } from "zustand/middleware";

interface Bet {
  id: string;
  eventId?: string;
  marketId?: string;
  oddsId?: string;
  event: string;
  league: string;
  market?: string;
  selection: string;
  odds: number;
}

interface BetSlipStore {
  bets: Bet[];
  addBet: (bet: Omit<Bet, "id"> & { id?: string }) => void;
  removeBet: (index: number) => void;
  clearBets: () => void;
  getTotalOdds: () => number;
}

export const useBetSlip = create<BetSlipStore>()(
  persist(
    (set, get) => ({
      bets: [],
      addBet: (bet) => set((state) => {
        const normalizedBet: Bet = {
          ...bet,
          id: bet.id || bet.oddsId || `${bet.event}-${bet.selection}`,
        };
        const existing = state.bets.find((item) => item.id === normalizedBet.id);
        if (existing) {
          return { bets: state.bets.filter((item) => item.id !== normalizedBet.id) };
        }

        const withoutSameMarket = normalizedBet.marketId
          ? state.bets.filter((item) => item.marketId !== normalizedBet.marketId)
          : state.bets;

        return { bets: [...withoutSameMarket, normalizedBet] };
      }),
      removeBet: (index) => set((state) => ({ 
        bets: state.bets.filter((_, i) => i !== index) 
      })),
      clearBets: () => set({ bets: [] }),
      getTotalOdds: () => {
        const bets = get().bets;
        if (bets.length === 0) return 0;
        return bets.reduce((acc, bet) => acc * bet.odds, 1);
      },
    }),
    {
      name: "primebet-betslip-storage",
      version: 1,
    }
  )
);
