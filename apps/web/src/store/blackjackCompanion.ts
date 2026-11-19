import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  createBlackjackCompanion,
  type BlackjackCompanionState,
} from "@cardroom/shared/games/blackjack-companion";

interface BlackjackCompanionStore {
  state: BlackjackCompanionState | null;
  undoStack: BlackjackCompanionState[];
  start: (players: Array<{ name: string; balance: number }>) => void;
  update: (state: BlackjackCompanionState) => void;
  undo: () => void;
  clear: () => void;
}

export const useBlackjackCompanionStore = create<BlackjackCompanionStore>()(persist((set) => ({
  state: null,
  undoStack: [],
  start: players => set({ state: createBlackjackCompanion(players), undoStack: [] }),
  update: state => set(current => ({
    state,
    undoStack: current.state ? [...current.undoStack.slice(-49), current.state] : current.undoStack,
  })),
  undo: () => set(current => {
    const previous = current.undoStack[current.undoStack.length - 1];
    return previous ? { state: previous, undoStack: current.undoStack.slice(0, -1) } : current;
  }),
  clear: () => set({ state: null, undoStack: [] }),
}), {
  // Keep the original key so users retain an in-progress session from the previous release.
  // Zustand merges the new empty undoStack default when older persisted data is rehydrated.
  name: "cardroom-blackjack-companion-v1",
  storage: createJSONStorage(() => localStorage),
  partialize: state => ({ state: state.state, undoStack: state.undoStack }),
}));
