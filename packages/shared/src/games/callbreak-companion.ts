import type { PlayerId } from "../contracts.js";
import { SUITS, type Suit } from "../cards.js";

export const CALLBREAK_MATCH_TARGET_TENTHS = 310;
export const CALLBREAK_SCOREKEEPER_MAX_BID = 13;
export type CallbreakScorekeeperStatus = "bidding" | "score-entry" | "round-results" | "complete";
export interface CallbreakScorekeeperPlayer {
  id: PlayerId;
  name: string;
  scoreTenths: number;
  roundsPlayed: number;
  callsMade: number;
  totalTricks: number;
  bestRoundTenths: number | null;
}
export interface CallbreakRoundLedgerRow {
  playerId: PlayerId;
  name: string;
  bid: number;
  tricksWon: number;
  scoreTenths: number;
  totalScoreTenths: number;
  madeCall: boolean;
}
export interface CallbreakScorekeeperState {
  gameId: "callbreak-scorekeeper";
  status: CallbreakScorekeeperStatus;
  round: number;
  tricksPerRound: 13;
  /** For a three-player physical table, all thirteen cards of this suit are removed. */
  removedSuit: Suit | null;
  dealerIndex: number;
  players: CallbreakScorekeeperPlayer[];
  bids: Record<PlayerId, number> | null;
  tricksWon: Record<PlayerId, number> | null;
  roundLedger: CallbreakRoundLedgerRow[] | null;
  history: CallbreakRoundLedgerRow[][];
  winnerIds: PlayerId[];
  targetScoreTenths: number;
}

export function createCallbreakScorekeeper(players: Array<{ id: PlayerId; name: string }>, dealerIndex = 0, removedSuit: Suit = "clubs"): CallbreakScorekeeperState {
  if (players.length !== 3 && players.length !== 4) throw new RangeError("Offline Callbreak supports three or four players");
  if (players.length === 3 && !(SUITS as readonly string[]).includes(removedSuit)) throw new RangeError("Choose one of the four suits to remove");
  if (new Set(players.map(player => player.id)).size !== players.length) throw new RangeError("Player IDs must be unique");
  if (players.some(player => !player.name.trim() || player.name.trim().length > 20)) throw new RangeError("Each player needs a name between 1 and 20 characters");
  return {
    gameId: "callbreak-scorekeeper",
    status: "bidding",
    round: 1,
    tricksPerRound: 13,
    removedSuit: players.length === 3 ? removedSuit : null,
    dealerIndex: ((dealerIndex % players.length) + players.length) % players.length,
    players: players.map(player => ({ id: player.id, name: player.name.trim(), scoreTenths: 0, roundsPlayed: 0, callsMade: 0, totalTricks: 0, bestRoundTenths: null })),
    bids: null,
    tricksWon: null,
    roundLedger: null,
    history: [],
    winnerIds: [],
    targetScoreTenths: CALLBREAK_MATCH_TARGET_TENTHS,
  };
}

export function submitCallbreakScorekeeperBids(state: CallbreakScorekeeperState, bids: Record<PlayerId, number>): CallbreakScorekeeperState {
  if (state.status !== "bidding") throw new Error("The bidding window is closed");
  for (const player of state.players) {
    const bid = bids[player.id];
    if (bid === undefined || !Number.isInteger(bid) || bid < 1 || bid > CALLBREAK_SCOREKEEPER_MAX_BID) throw new RangeError(`${player.name}'s call must be between 1 and ${CALLBREAK_SCOREKEEPER_MAX_BID}`);
  }
  const normalized = Object.fromEntries(state.players.map(player => [player.id, bids[player.id]!])) as Record<PlayerId, number>;
  return { ...state, status: "score-entry", bids: normalized, tricksWon: null, roundLedger: null, winnerIds: [] };
}

export function submitCallbreakScorekeeperTricks(state: CallbreakScorekeeperState, tricksWon: Record<PlayerId, number>): CallbreakScorekeeperState {
  if (state.status !== "score-entry" || !state.bids) throw new Error("Enter all bids before entering completed tricks");
  const values = state.players.map(player => tricksWon[player.id]);
  if (values.some(value => value === undefined || !Number.isInteger(value) || value < 0 || value > state.tricksPerRound)) {
    throw new RangeError(`Each player's trick count must be between 0 and ${state.tricksPerRound}`);
  }
  const totalTricks = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  if (totalTricks !== state.tricksPerRound) throw new RangeError(`Tricks won must add up to exactly ${state.tricksPerRound}; currently ${totalTricks}`);

  const ledger = state.players.map(player => {
    const bid = state.bids![player.id]!;
    const won = tricksWon[player.id]!;
    const madeCall = won >= bid;
    const scoreTenths = madeCall ? bid * 10 + (won - bid) : -bid * 10;
    const totalScoreTenths = player.scoreTenths + scoreTenths;
    return { playerId: player.id, name: player.name, bid, tricksWon: won, scoreTenths, totalScoreTenths, madeCall };
  });
  const players = state.players.map(player => {
    const row = ledger.find(item => item.playerId === player.id)!;
    return {
      ...player,
      scoreTenths: row.totalScoreTenths,
      roundsPlayed: player.roundsPlayed + 1,
      callsMade: player.callsMade + (row.madeCall ? 1 : 0),
      totalTricks: player.totalTricks + row.tricksWon,
      bestRoundTenths: player.bestRoundTenths === null ? row.scoreTenths : Math.max(player.bestRoundTenths, row.scoreTenths),
    };
  });
  const high = Math.max(...players.map(player => player.scoreTenths));
  const winnerIds = high >= state.targetScoreTenths ? players.filter(player => player.scoreTenths === high).map(player => player.id) : [];
  return {
    ...state,
    status: winnerIds.length ? "complete" : "round-results",
    players,
    tricksWon: Object.fromEntries(state.players.map(player => [player.id, tricksWon[player.id]!])) as Record<PlayerId, number>,
    roundLedger: ledger,
    history: [...state.history, ledger],
    winnerIds,
  };
}

export function nextCallbreakScorekeeperRound(state: CallbreakScorekeeperState): CallbreakScorekeeperState {
  if (state.status !== "round-results") throw new Error("The match is not ready for another round");
  return {
    ...state,
    status: "bidding",
    round: state.round + 1,
    dealerIndex: (state.dealerIndex + 1) % state.players.length,
    bids: null,
    tricksWon: null,
    roundLedger: null,
    winnerIds: [],
  };
}

export function formatCallbreakScore(tenths: number): string {
  const abs = Math.abs(tenths);
  return `${tenths < 0 ? "−" : tenths > 0 ? "+" : ""}${Math.floor(abs / 10)}.${abs % 10}`;
}
