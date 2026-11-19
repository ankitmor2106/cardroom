import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  createTeenPattiCompanion,
  teenPattiCompanionNextRound,
  type TeenPattiCompanionState,
  type TeenPattiCompanionStats,
} from "@cardroom/shared/games/teen-patti-companion";

export interface TeenPattiRosterPlayer {
  id: string;
  name: string;
  wallet: number;
  stats: TeenPattiCompanionStats;
}
interface TeenPattiCompanionStore {
  state: TeenPattiCompanionState | null;
  roster: TeenPattiRosterPlayer[];
  settings: { bootAmount: number; maxPot: number };
  undoStack: TeenPattiCompanionState[];
  setRoster: (roster: TeenPattiRosterPlayer[]) => void;
  setSettings: (settings: { bootAmount: number; maxPot: number }) => void;
  start: (roster: TeenPattiRosterPlayer[], options: { bootAmount: number; maxPot: number }) => void;
  update: (state: TeenPattiCompanionState) => void;
  nextRound: () => void;
  undo: () => void;
  editTable: () => void;
  clear: () => void;
}
const defaultStats = (): TeenPattiCompanionStats => ({ roundsPlayed: 0, wins: 0, losses: 0, netChips: 0 });
const defaultRoster = (): TeenPattiRosterPlayer[] => Array.from({ length: 4 }, (_, index) => ({
  id: `tp-local-${index + 1}`,
  name: `Player ${index + 1}`,
  wallet: 10_000,
  stats: defaultStats(),
}));

export const useTeenPattiCompanionStore = create<TeenPattiCompanionStore>()(persist((set, get) => ({
  state: null,
  roster: defaultRoster(),
  settings: { bootAmount: 10, maxPot: 10_000 },
  undoStack: [],
  setRoster: roster => set({ roster: roster.map(player => ({ ...player, name: player.name.trim(), stats: { ...defaultStats(), ...player.stats } })) }),
  setSettings: settings => set({ settings }),
  start: (roster, options) => {
    const nextRoster = roster.map(player => ({ ...player, stats: { ...defaultStats(), ...player.stats } }));
    const state = createTeenPattiCompanion(nextRoster.map(player => ({ id: player.id, name: player.name, wallet: player.wallet, stats: player.stats })), options);
    set({ state, roster: nextRoster, settings: options, undoStack: [] });
  },
  update: state => set(current => {
    const roster = state.stage === "complete"
      ? state.players.map(player => ({ id: player.id, name: player.name, wallet: player.wallet, stats: player.stats }))
      : current.roster;
    return { state, roster, undoStack: current.state ? [...current.undoStack.slice(-49), current.state] : current.undoStack };
  }),
  nextRound: () => {
    const current = get().state;
    if (!current) return;
    const state = teenPattiCompanionNextRound(current);
    set({ state, roster: state.players.map(player => ({ id: player.id, name: player.name, wallet: player.wallet, stats: player.stats })), undoStack: [] });
  },
  undo: () => set(current => {
    const previous = current.undoStack[current.undoStack.length - 1];
    if (!previous) return current;
    return { state: previous, undoStack: current.undoStack.slice(0, -1) };
  }),
  editTable: () => set(current => ({
    state: null,
    undoStack: [],
    roster: current.state ? current.state.players.map(player => ({
      id: player.id,
      name: player.name,
      wallet: player.wallet + (current.state?.stage !== "complete" && player.betConfirmed ? player.bet : 0),
      stats: player.stats,
    })) : current.roster,
  })),
  clear: () => set({ state: null, undoStack: [] }),
}), {
  name: "cardroom-teen-patti-companion-v3",
  version: 5,
  migrate: persistedState => {
    const previous = persistedState as Partial<Pick<TeenPattiCompanionStore, "roster" | "settings">>;
    // v5 changes the offline flow to repeated betting rounds before private
    // card entry. Discard an unfinished older round rather than interpreting
    // its old deal-before-bet state under the new lifecycle. The roster remains
    // the pre-round wallet snapshot, so unsettled chips are effectively returned.
    return {
      state: null,
      roster: previous.roster ?? defaultRoster(),
      settings: previous.settings ?? { bootAmount: 10, maxPot: 10_000 },
      undoStack: [],
    };
  },
  storage: createJSONStorage(() => localStorage),
  partialize: state => ({ state: state.state, roster: state.roster, settings: state.settings, undoStack: state.undoStack }),
}));
