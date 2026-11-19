import { createDeck, shuffle, type Card, type RandomSource } from "../cards.js";
import type { PlayerId } from "../contracts.js";

export type PokerCategory = "high-card" | "pair" | "two-pair" | "three-kind" | "straight" | "flush" | "full-house" | "four-kind" | "straight-flush";
export type PokerRank = readonly number[];
export interface EvaluatedHand { category: PokerCategory; rank: PokerRank }
export interface HoldemPlayer {
  id: PlayerId; chips: number; hole: Card[]; folded: boolean; allIn: boolean;
  streetContribution: number; totalContribution: number; acted: boolean; lastAction?: string;
}
export interface HoldemState {
  gameId: "holdem"; status: "betting" | "showdown" | "complete"; street: "preflop" | "flop" | "turn" | "river";
  players: HoldemPlayer[]; community: Card[]; deck: Card[]; dealerIndex: number; smallBlind: number; bigBlind: number;
  currentBet: number; minRaise: number; actingIndex: number; pots: Array<{ amount: number; eligible: PlayerId[] }>;
  winners: Array<{ playerId: PlayerId; amount: number; hand: EvaluatedHand }>; history: Array<{ action: string; playerId?: PlayerId; amount?: number }>;
}
export type HoldemAction = { type: "fold" | "check" | "call" | "all-in" } | { type: "bet" | "raise"; amount: number };

function straightHigh(ranks: number[]): number | null {
  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  if (uniq.includes(14)) uniq.push(1);
  for (let i = 0; i <= uniq.length - 5; i += 1) {
    if (uniq[i]! - uniq[i + 4]! === 4) return uniq[i]!;
  }
  return null;
}
function compareTuple(a: PokerRank, b: PokerRank): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0); if (diff !== 0) return diff;
  }
  return 0;
}
export function evaluateFive(cards: readonly Card[]): EvaluatedHand {
  if (cards.length !== 5) throw new RangeError("Exactly five cards are required");
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const flush = cards.every(c => c.suit === cards[0]!.suit);
  const straight = straightHigh(ranks);
  if (flush && straight !== null) return { category: "straight-flush", rank: [8, straight] };
  if (groups[0]![1] === 4) return { category: "four-kind", rank: [7, groups[0]![0], groups[1]![0]] };
  if (groups[0]![1] === 3 && groups[1]![1] === 2) return { category: "full-house", rank: [6, groups[0]![0], groups[1]![0]] };
  if (flush) return { category: "flush", rank: [5, ...ranks] };
  if (straight !== null) return { category: "straight", rank: [4, straight] };
  if (groups[0]![1] === 3) return { category: "three-kind", rank: [3, groups[0]![0], ...groups.slice(1).map(g => g[0]).sort((a, b) => b - a)] };
  if (groups[0]![1] === 2 && groups[1]![1] === 2) return { category: "two-pair", rank: [2, Math.max(groups[0]![0], groups[1]![0]), Math.min(groups[0]![0], groups[1]![0]), groups[2]![0]] };
  if (groups[0]![1] === 2) return { category: "pair", rank: [1, groups[0]![0], ...groups.slice(1).map(g => g[0]).sort((a, b) => b - a)] };
  return { category: "high-card", rank: [0, ...ranks] };
}
export function evaluateBestHand(cards: readonly Card[]): EvaluatedHand {
  if (cards.length < 5 || cards.length > 7) throw new RangeError("Best hand evaluation requires 5–7 cards");
  let best: EvaluatedHand | undefined;
  for (let a = 0; a < cards.length - 4; a += 1) for (let b = a + 1; b < cards.length - 3; b += 1)
    for (let c = b + 1; c < cards.length - 2; c += 1) for (let d = c + 1; d < cards.length - 1; d += 1)
      for (let e = d + 1; e < cards.length; e += 1) {
        const result = evaluateFive([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!]);
        if (!best || compareTuple(result.rank, best.rank) > 0) best = result;
      }
  return best!;
}
export function comparePokerHands(a: EvaluatedHand, b: EvaluatedHand): number { return compareTuple(a.rank, b.rank); }

function alive(state: HoldemState): HoldemPlayer[] { return state.players.filter(p => !p.folded); }
function pay(player: HoldemPlayer, amount: number): number {
  const paid = Math.min(player.chips, amount); player.chips -= paid; player.streetContribution += paid; player.totalContribution += paid;
  if (player.chips === 0) player.allIn = true;
  return paid;
}
function nextActor(state: HoldemState, from = state.actingIndex): number {
  for (let step = 1; step <= state.players.length; step += 1) {
    const i = (from + step) % state.players.length; const p = state.players[i]!;
    if (!p.folded && !p.allIn && (!p.acted || p.streetContribution < state.currentBet)) return i;
  }
  return -1;
}
function bettingComplete(state: HoldemState): boolean {
  const actionPlayers = state.players.filter(p => !p.folded && !p.allIn);
  return actionPlayers.length === 0 || actionPlayers.every(p => p.acted && p.streetContribution === state.currentBet);
}
function buildPots(state: HoldemState): Array<{ amount: number; eligible: PlayerId[] }> {
  const levels = [...new Set(state.players.map(p => p.totalContribution).filter(v => v > 0))].sort((a, b) => a - b);
  const pots: Array<{ amount: number; eligible: PlayerId[] }> = []; let previous = 0;
  for (const level of levels) {
    const contributors = state.players.filter(p => p.totalContribution >= level);
    const amount = (level - previous) * contributors.length;
    const eligible = contributors.filter(p => !p.folded).map(p => p.id);
    if (amount > 0 && eligible.length) pots.push({ amount, eligible });
    else if (amount > 0 && pots.length) pots[pots.length - 1]!.amount += amount;
    previous = level;
  }
  return pots;
}
function settle(state: HoldemState): void {
  state.status = "showdown"; state.pots = buildPots(state);
  const hands = new Map<string, EvaluatedHand>();
  for (const p of state.players) if (!p.folded) hands.set(p.id, evaluateBestHand([...p.hole, ...state.community]));
  const payouts: HoldemState["winners"] = [];
  const oddChipOrder = Array.from({ length: state.players.length }, (_, n) => (state.dealerIndex + 1 + n) % state.players.length);
  for (const pot of state.pots) {
    const eligible = pot.eligible.map(id => ({ id, hand: hands.get(id)! })).filter(x => x.hand);
    eligible.sort((a, b) => comparePokerHands(b.hand, a.hand));
    const best = eligible[0]!; const tied = eligible.filter(p => comparePokerHands(p.hand, best.hand) === 0);
    const share = Math.floor(pot.amount / tied.length); let remainder = pot.amount - share * tied.length;
    const winnersInOddChipOrder = oddChipOrder.map(i => state.players[i]!).filter(p => tied.some(t => t.id === p.id));
    for (const w of tied) {
      const player = state.players.find(p => p.id === w.id)!; player.chips += share;
      payouts.push({ playerId: w.id, amount: share, hand: w.hand });
    }
    // Each side pot distributes its odd chips clockwise from the seat left of the dealer.
    for (let i = 0; i < remainder; i += 1) {
      const recipient = winnersInOddChipOrder[i % winnersInOddChipOrder.length]!;
      recipient.chips += 1;
      const existing = payouts.find(x => x.playerId === recipient.id);
      if (existing) existing.amount += 1;
      else payouts.push({ playerId: recipient.id, amount: 1, hand: hands.get(recipient.id)! });
    }
  }
  state.winners = payouts; state.status = "complete";
}
function runout(state: HoldemState): void {
  if (state.community.length === 0) {
    state.deck.shift(); // burn before flop
    state.community.push(state.deck.shift()!, state.deck.shift()!, state.deck.shift()!);
  }
  while (state.community.length < 5) {
    state.deck.shift(); // burn before turn and river
    const card = state.deck.shift(); if (!card) throw new Error("Deck exhausted"); state.community.push(card);
  }
  settle(state);
}
function advanceStreet(state: HoldemState): void {
  const nextStreet = state.street === "preflop" ? "flop" : state.street === "flop" ? "turn" : state.street === "turn" ? "river" : "showdown";
  if (nextStreet === "showdown") { settle(state); return; }
  if (nextStreet === "flop") { state.deck.shift(); state.community.push(state.deck.shift()!, state.deck.shift()!, state.deck.shift()!); }
  else { state.deck.shift(); state.community.push(state.deck.shift()!); }
  state.street = nextStreet;
  state.currentBet = 0;
  for (const p of state.players) { p.streetContribution = 0; p.acted = p.folded || p.allIn; }
  let first = -1;
  for (let step = 1; step <= state.players.length; step += 1) {
    const index = (state.dealerIndex + step) % state.players.length;
    const candidate = state.players[index]!;
    if (!candidate.folded && !candidate.allIn) { first = index; break; }
  }
  state.actingIndex = first >= 0 ? first : state.dealerIndex;
  if (state.players.filter(p => !p.folded && !p.allIn).length < 2) runout(state);
}
function progress(state: HoldemState): void {
  const stillIn = alive(state);
  if (stillIn.length === 1) {
    const winner = stillIn[0]!; const amount = state.players.reduce((s, p) => s + p.totalContribution, 0); winner.chips += amount;
    state.winners = [{ playerId: winner.id, amount, hand: { category: "high-card", rank: [0] } }]; state.status = "complete"; return;
  }
  if (bettingComplete(state)) { advanceStreet(state); return; }
  const next = nextActor(state); if (next >= 0) state.actingIndex = next;
}

export function createHoldemGame(players: Array<{ id: PlayerId; chips: number }>, options: { smallBlind?: number; bigBlind?: number; dealerIndex?: number } = {}, random: RandomSource = Math.random): HoldemState {
  if (players.length < 2 || players.length > 9) throw new RangeError("Hold'em supports 2–9 players");
  const smallBlind = options.smallBlind ?? 10, bigBlind = options.bigBlind ?? 20;
  if (!Number.isSafeInteger(smallBlind) || !Number.isSafeInteger(bigBlind) || smallBlind < 1 || bigBlind < smallBlind) throw new RangeError("Invalid blinds");
  if (players.some(p => !Number.isSafeInteger(p.chips) || p.chips < 0)) throw new RangeError("Invalid chip balance");
  const dealerIndex = ((options.dealerIndex ?? 0) % players.length + players.length) % players.length;
  const state: HoldemState = { gameId: "holdem", status: "betting", street: "preflop", players: players.map(p => ({ ...p, hole: [], folded: p.chips === 0, allIn: false, streetContribution: 0, totalContribution: 0, acted: false })), community: [], deck: shuffle(createDeck(), random).filter((card): card is Card => !card.joker), dealerIndex, smallBlind, bigBlind, currentBet: bigBlind, minRaise: bigBlind, actingIndex: (dealerIndex + 3) % players.length, pots: [], winners: [], history: [] };
  const sbIndex = players.length === 2 ? dealerIndex : (dealerIndex + 1) % players.length;
  const bbIndex = players.length === 2 ? (dealerIndex + 1) % players.length : (dealerIndex + 2) % players.length;
  pay(state.players[sbIndex]!, smallBlind); pay(state.players[bbIndex]!, bigBlind);
  state.currentBet = Math.max(...state.players.map(p => p.streetContribution));
  for (let pass = 0; pass < 2; pass += 1) for (const p of state.players) if (!p.folded) p.hole.push(state.deck.shift()!);
  state.actingIndex = players.length === 2 ? dealerIndex : (bbIndex + 1) % players.length;
  if (state.players.filter(p => !p.folded && !p.allIn).length < 2) runout(state);
  return state;
}

export function holdemAction(state: HoldemState, playerId: PlayerId, action: HoldemAction): HoldemState {
  if (state.status !== "betting") throw new Error("Hand is not accepting actions");
  const current = state.players[state.actingIndex]; if (!current || current.id !== playerId) throw new Error("Not this player's turn");
  const next = structuredClone(state); const player = next.players[next.actingIndex]!;
  const toCall = Math.max(0, next.currentBet - player.streetContribution);
  if (action.type === "fold") { player.folded = true; player.acted = true; player.lastAction = "fold"; }
  else if (action.type === "check") { if (toCall > 0) throw new Error("Cannot check while facing a bet"); player.acted = true; player.lastAction = "check"; }
  else if (action.type === "call") { if (toCall === 0) throw new Error("Nothing to call; check instead"); pay(player, toCall); player.acted = true; player.lastAction = "call"; }
  else if (action.type === "all-in") {
    if (player.chips <= 0) throw new Error("No chips available");
    const oldBet = next.currentBet; const paid = pay(player, player.chips); player.acted = true; player.lastAction = "all-in";
    if (player.streetContribution > oldBet) {
      const raise = player.streetContribution - oldBet;
      next.currentBet = player.streetContribution;
      if (raise >= next.minRaise) {
        next.minRaise = raise;
        for (const p of next.players) if (p.id !== player.id && !p.folded && !p.allIn) p.acted = false;
      }
    }
    if (paid === 0) throw new Error("Invalid all-in");
  } else if (action.type === "bet" || action.type === "raise") {
    if (player.acted) throw new Error("Betting was not reopened after your previous action");
    if (!Number.isSafeInteger(action.amount) || action.amount <= 0) throw new Error("Bet amount must be a positive integer");
    const target = action.amount;
    if (target > player.streetContribution + player.chips) throw new Error("Bet exceeds available chips");
    if (target <= next.currentBet) throw new Error("A bet or raise must exceed the current bet");
    const raiseSize = target - next.currentBet;
    if (action.type === "bet" && next.currentBet !== 0) throw new Error("Cannot open a bet after a bet exists");
    if (action.type === "raise" && next.currentBet === 0) throw new Error("Use bet to open the street");
    if (raiseSize < next.minRaise && target !== player.streetContribution + player.chips) throw new Error("Raise is below the minimum raise");
    const amountToPay = target - player.streetContribution; pay(player, amountToPay);
    if (player.streetContribution !== target) throw new Error("Unable to cover target bet");
    if (raiseSize >= next.minRaise) next.minRaise = raiseSize;
    next.currentBet = target; player.acted = true; player.lastAction = action.type;
    for (const p of next.players) if (p.id !== player.id && !p.folded && !p.allIn) p.acted = false;
  }
  next.history.push({ action: action.type, playerId, ...( "amount" in action ? { amount: action.amount } : {}) });
  progress(next);
  return next;
}
