import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { GameId } from "@cardroom/shared/contracts";
import {
  createBlackjackGame, blackjackAction, createHoldemGame, holdemAction, createTeenPattiGame,
  teenPattiAction, createCallbreakRound, callbreakBid, callbreakPlay,
  chooseBlackjackBotAction, chooseHoldemBotAction, chooseTeenPattiBotAction,
  chooseCallbreakBid, chooseCallbreakCard,
} from "@cardroom/game-engines";
import type { BlackjackState } from "@cardroom/shared/games/blackjack";
import type { HoldemState } from "@cardroom/shared/games/holdem";
import type { TeenPattiState } from "@cardroom/shared/games/teenPatti";
import type { CallbreakState } from "@cardroom/shared/games/callbreak";

export type OfflineGameId = Exclude<GameId, "rummy-13" | "rummy-10">;
export function isOfflineGameSupported(gameId: string): gameId is OfflineGameId {
  return gameId === "blackjack" || gameId === "holdem" || gameId === "teen-patti" || gameId === "callbreak";
}
type AnyState = BlackjackState | HoldemState | TeenPattiState | CallbreakState;
export interface OfflineMatch { id: string; gameId: OfflineGameId; humanId: string; state: AnyState; difficulty: "easy" | "medium" | "hard"; updatedAt: string }
interface OfflineStore { match: OfflineMatch | null; start: (gameId: OfflineGameId, difficulty?: OfflineMatch["difficulty"]) => string; update: (state: AnyState) => void; clear: () => void }
const HUMAN = "you";
const botNames = ["Mira", "Theo", "Ishaan", "Nora", "Arjun", "Zoe"];

function makePlayers(count: number) { return Array.from({ length: count }, (_, i) => ({ id: i === 0 ? HUMAN : `bot-${i}`, chips: 1000 })); }
function createState(gameId: OfflineGameId): AnyState {
  switch (gameId) {
    case "blackjack": return createBlackjackGame([{ id: HUMAN, chips: 1000, bet: 10 }]);
    case "holdem": return createHoldemGame(makePlayers(4), { smallBlind: 5, bigBlind: 10 });
    case "teen-patti": return createTeenPattiGame(makePlayers(4), 10);
    case "callbreak": return createCallbreakRound(makePlayers(4).map(p => ({ id: p.id })));
  }
}
function botName(id: string): string { const index = Number(id.split("-")[1] ?? 1) - 1; return botNames[index % botNames.length] ?? "Bot"; }
export function getOfflineDisplayName(id: string): string { return id === HUMAN ? "You" : botName(id); }

export function applyOfflineAction(match: OfflineMatch, action: string, payload: Record<string, unknown> = {}): OfflineMatch {
  if (!isOfflineGameSupported(match.gameId)) throw new Error("Rummy is available in online rooms only.");
  const state = match.state;
  let next: AnyState;
  switch (match.gameId) {
    case "blackjack": next = blackjackAction(state as BlackjackState, HUMAN, action as "hit" | "stand" | "double" | "split"); break;
    case "holdem":
      if (["fold", "check", "call", "all-in"].includes(action)) next = holdemAction(state as HoldemState, HUMAN, { type: action as "fold" | "check" | "call" | "all-in" });
      else if (["bet", "raise"].includes(action)) next = holdemAction(state as HoldemState, HUMAN, { type: action as "bet" | "raise", amount: Number(payload.amount) });
      else throw new Error("Unknown Hold'em action");
      break;
    case "teen-patti": next = teenPattiAction(state as TeenPattiState, HUMAN, action as "blind" | "chaal" | "fold" | "show" | "sideshow"); break;
    case "callbreak":
      if (action === "bid") next = callbreakBid(state as CallbreakState, HUMAN, Number(payload.bid));
      else if (action === "play") next = callbreakPlay(state as CallbreakState, HUMAN, String(payload.cardId));
      else if (action === "next-round") next = createCallbreakRound((state as CallbreakState).players.map(p => ({ id: p.id, scoreTenths: p.scoreTenths })), (state as CallbreakState).round + 1);
      else throw new Error("Unknown Callbreak action");
      break;
  }
  const updated = { ...match, state: next, updatedAt: new Date().toISOString() };
  return runBots(updated);
}

function runBots(match: OfflineMatch): OfflineMatch {
  let state = match.state;
  for (let step = 0; step < 80; step += 1) {
    if (state.status === "complete") break;
    let actor: string | undefined;
    if (match.gameId === "blackjack") {
      const s = state as BlackjackState; actor = s.players[s.activePlayerIndex]?.id;
      if (actor === HUMAN || !actor) break;
      state = blackjackAction(s, actor, chooseBlackjackBotAction(s, actor, match.difficulty));
    } else if (match.gameId === "holdem") {
      const s = state as HoldemState; actor = s.players[s.actingIndex]?.id;
      if (actor === HUMAN || !actor) break;
      state = holdemAction(s, actor, chooseHoldemBotAction(s, actor, match.difficulty));
    } else if (match.gameId === "teen-patti") {
      const s = state as TeenPattiState; actor = s.players[s.turnIndex]?.id;
      if (actor === HUMAN || !actor) break;
      state = teenPattiAction(s, actor, chooseTeenPattiBotAction(s, actor, match.difficulty));
    } else if (match.gameId === "callbreak") {
      const s = state as CallbreakState; actor = s.players[s.currentIndex]?.id;
      if (actor === HUMAN || !actor) break;
      if (s.status === "bidding") state = callbreakBid(s, actor, chooseCallbreakBid(s.players[s.currentIndex]!.hand, match.difficulty));
      else if (s.status === "playing") state = callbreakPlay(s, actor, chooseCallbreakCard(s, actor, match.difficulty));
      else break;
    } else {
      // Rummy is online-only; no local Rummy bot loop is exposed.
      break;
    }
  }
  return { ...match, state, updatedAt: new Date().toISOString() };
}

export const useOfflineStore = create<OfflineStore>()(persist((set, get) => ({
  match: null,
  start: (gameId, difficulty = "medium") => {
    if (!isOfflineGameSupported(gameId)) throw new Error("Rummy is available in online rooms only.");
    const match: OfflineMatch = { id: crypto.randomUUID(), gameId, humanId: HUMAN, state: runBots({ id: "", gameId, humanId: HUMAN, state: createState(gameId), difficulty, updatedAt: new Date().toISOString() }).state, difficulty, updatedAt: new Date().toISOString() };
    set({ match }); return match.id;
  },
  update: state => { const match = get().match; if (match) set({ match: runBots({ ...match, state, updatedAt: new Date().toISOString() }) }); },
  clear: () => set({ match: null }),
}), { name: "cardroom-offline-match", storage: createJSONStorage(() => localStorage) }));

