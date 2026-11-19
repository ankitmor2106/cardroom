import { create } from "zustand";
import type { Suit } from "@cardroom/shared/cards";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  createCallbreakScorekeeper,
  nextCallbreakScorekeeperRound,
  submitCallbreakScorekeeperBids,
  submitCallbreakScorekeeperTricks,
  type CallbreakScorekeeperState,
} from "@cardroom/shared/games/callbreak-companion";

interface CallbreakCompanionStore {
  match: CallbreakScorekeeperState | null;
  start: (names: string[], removedSuit?: Suit) => void;
  submitBids: (bids: Record<string, number>) => void;
  submitTricks: (tricks: Record<string, number>) => void;
  nextRound: () => void;
  clear: () => void;
}

export const useCallbreakCompanionStore = create<CallbreakCompanionStore>()(persist((set, get) => ({
  match: null,
  start: (names, removedSuit) => {
    const players = names.map((name, index) => ({ id: `offline-callbreak-${index + 1}`, name }));
    set({ match: createCallbreakScorekeeper(players, 0, removedSuit) });
  },
  submitBids: bids => set(state => ({ match: state.match ? submitCallbreakScorekeeperBids(state.match, bids) : null })),
  submitTricks: tricks => set(state => ({ match: state.match ? submitCallbreakScorekeeperTricks(state.match, tricks) : null })),
  nextRound: () => set(state => ({ match: state.match ? nextCallbreakScorekeeperRound(state.match) : null })),
  clear: () => set({ match: null }),
}), {
  name: "cardroom-callbreak-scorekeeper-v2",
  storage: createJSONStorage(() => localStorage),
  partialize: state => ({ match: state.match }),
}));
