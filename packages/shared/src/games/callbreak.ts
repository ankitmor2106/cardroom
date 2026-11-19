import { createDeck, shuffle, SUITS, type Card, type RandomSource, type Suit } from "../cards.js";
import type { PlayerId } from "../contracts.js";

export const CALLBREAK_TARGET_SCORE_TENTHS = 310;
export const CALLBREAK_TRICKS_PER_ROUND = 13;
export const CALLBREAK_INITIAL_TRUMP_CARDS = 5;

export interface CallbreakPlayer {
  id: PlayerId;
  hand: Card[];
  bid: number | null;
  tricksWon: number;
  scoreTenths: number;
}
export interface PlayedCard { playerId: PlayerId; card: Card }
export interface CallbreakTrumpSelection {
  playerId: PlayerId;
  suit: Suit;
  minimumTricks: number;
}
export interface CallbreakState {
  gameId: "callbreak";
  status: "trump-selection" | "bidding" | "playing" | "round-complete" | "complete";
  round: number;
  /** Seat which dealt this round. The player immediately after the dealer leads. */
  dealerIndex?: number;
  players: CallbreakPlayer[];
  currentIndex: number;
  leaderIndex: number;
  trick: PlayedCard[];
  trickNumber: number;
  /** Remaining server-only cards while the first five-card trump phase is in progress. */
  deck?: Card[];
  /** Selection order is lowest cumulative score first, with dealer-left clockwise tie-break. */
  trumpOrder?: PlayerId[];
  trumpDecisionIndex?: number;
  trumpSelections?: CallbreakTrumpSelection[];
  /** Defaults to spades if no one selects a suit. Last successful choice wins. */
  trumpSuit?: Suit;
  history: Array<{ type: string; playerId: PlayerId; value?: number; cardId?: string; suit?: Suit }>;
  roundScores?: Record<PlayerId, number>;
  winnerIds?: PlayerId[];
}

function nextIndex(index: number, length: number): number { return (index + 1) % length; }
function highestCard(cards: readonly PlayedCard[]): PlayedCard {
  return cards.reduce((best, item) => item.card.rank > best.card.rank ? item : best);
}
function trickWinner(trick: PlayedCard[], trumpSuit: Suit): number {
  const leadSuit = trick[0]!.card.suit;
  const trumps = trick.filter(play => play.card.suit === trumpSuit);
  const candidates = trumps.length ? trumps : trick.filter(play => play.card.suit === leadSuit);
  const winningPlay = highestCard(candidates);
  return trick.findIndex(play => play.playerId === winningPlay.playerId);
}

/**
 * Callbreak legality for the round's selected trump suit:
 * - Follow the led suit whenever possible.
 * - If no trump has been played, beat the highest led-suit card when possible.
 * - When void in the led suit, play trump if held; overtrump when possible.
 * - If neither led suit nor trump is held, any discard is legal.
 */
function legalCards(player: CallbreakPlayer, trick: PlayedCard[], trumpSuit: Suit): Card[] {
  if (trick.length === 0) return player.hand;
  const leadSuit = trick[0]!.card.suit;
  const following = player.hand.filter(card => card.suit === leadSuit);

  if (following.length > 0) {
    const trumpsOnTable = trick.filter(play => play.card.suit === trumpSuit);
    if (leadSuit === trumpSuit) {
      const highestTrump = Math.max(...trick.filter(play => play.card.suit === trumpSuit).map(play => play.card.rank));
      const higher = following.filter(card => card.rank > highestTrump);
      return higher.length ? higher : following;
    }
    if (trumpsOnTable.length > 0) return following;
    const highestLed = Math.max(...trick.filter(play => play.card.suit === leadSuit).map(play => play.card.rank));
    const higher = following.filter(card => card.rank > highestLed);
    return higher.length ? higher : following;
  }

  const trumps = player.hand.filter(card => card.suit === trumpSuit);
  if (trumps.length === 0) return player.hand;
  const trumpsOnTable = trick.filter(play => play.card.suit === trumpSuit);
  if (trumpsOnTable.length === 0) return trumps;
  const highestTrump = Math.max(...trumpsOnTable.map(play => play.card.rank));
  const overtrumps = trumps.filter(card => card.rank > highestTrump);
  return overtrumps.length ? overtrumps : trumps;
}

export function getCallbreakMinimumBid(state: CallbreakState, playerId: PlayerId): number {
  return state.trumpSelections?.find(selection => selection.playerId === playerId)?.minimumTricks ?? 1;
}

export function getLegalCallbreakCardIds(state: CallbreakState, playerId: PlayerId): string[] {
  const player = state.players[state.currentIndex];
  if (state.status !== "playing" || !player || player.id !== playerId) return [];
  return legalCards(player, state.trick, state.trumpSuit ?? "spades").map(card => card.id);
}

function dealPasses(state: CallbreakState, deck: Card[], startPass: number, endPass: number): Card[] {
  for (let pass = startPass; pass < endPass; pass += 1) {
    for (let offset = 1; offset <= state.players.length; offset += 1) {
      const seatIndex = (state.dealerIndex! + offset) % state.players.length;
      const card = deck.shift();
      if (!card) throw new Error("Callbreak deck ended before the deal was complete");
      state.players[seatIndex]!.hand.push(card);
    }
  }
  return deck;
}

export function createCallbreakRound(
  players: Array<{ id: PlayerId; scoreTenths?: number }>,
  round = 1,
  random: RandomSource = Math.random,
): CallbreakState {
  if (players.length !== 4) throw new RangeError("Online Callbreak requires exactly four players");
  if (new Set(players.map(player => player.id)).size !== players.length) throw new RangeError("Callbreak player IDs must be unique");
  if (!Number.isInteger(round) || round < 1 || round > 10_000) throw new RangeError("Invalid Callbreak round number");
  const deck = shuffle(createDeck(), random).filter((card): card is Card => !card.joker);
  const dealerIndex = (round - 1) % players.length;
  const leaderIndex = nextIndex(dealerIndex, players.length);
  const state: CallbreakState = {
    gameId: "callbreak",
    status: "trump-selection",
    round,
    dealerIndex,
    players: players.map(player => ({ id: player.id, hand: [], bid: null, tricksWon: 0, scoreTenths: player.scoreTenths ?? 0 })),
    currentIndex: leaderIndex,
    leaderIndex,
    trick: [],
    trickNumber: 0,
    deck,
    trumpOrder: [],
    trumpDecisionIndex: 0,
    trumpSelections: [],
    trumpSuit: "spades",
    history: [],
  };

  // The auction starts only after exactly five cards have been dealt to each player.
  state.deck = dealPasses(state, deck, 0, CALLBREAK_INITIAL_TRUMP_CARDS);

  // Lower cumulative scores get first choice. Ties are broken clockwise from left of dealer.
  const tiePriority = new Map<PlayerId, number>();
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    tiePriority.set(state.players[(dealerIndex + offset) % state.players.length]!.id, offset);
  }
  state.trumpOrder = [...state.players]
    .sort((a, b) => a.scoreTenths - b.scoreTenths || (tiePriority.get(a.id) ?? 99) - (tiePriority.get(b.id) ?? 99))
    .map(player => player.id);
  state.currentIndex = state.players.findIndex(player => player.id === state.trumpOrder![0]);
  return state;
}

/** Each player gets one turn in score order to set/change trump or pass. */
export function callbreakChooseTrump(state: CallbreakState, playerId: PlayerId, suit: Suit | null): CallbreakState {
  if (state.status !== "trump-selection") throw new Error("Trump selection is not open");
  const current = state.players[state.currentIndex];
  if (!current || current.id !== playerId) throw new Error("Not this player's trump-selection turn");
  if (suit !== null && !(SUITS as readonly string[]).includes(suit)) throw new RangeError("Choose a valid trump suit or pass");

  const next = structuredClone(state);
  const selections = next.trumpSelections ?? [];
  if (suit !== null) {
    const minimumTricks = 5 + selections.length;
    if (minimumTricks > CALLBREAK_TRICKS_PER_ROUND) throw new RangeError("The required trick target cannot exceed 13");
    selections.push({ playerId, suit, minimumTricks });
    next.trumpSuit = suit;
    next.history.push({ type: "trump-selected", playerId, value: minimumTricks, suit });
  } else {
    next.history.push({ type: "trump-passed", playerId });
  }
  next.trumpSelections = selections;
  next.trumpDecisionIndex = (next.trumpDecisionIndex ?? 0) + 1;

  if (next.trumpDecisionIndex >= (next.trumpOrder?.length ?? next.players.length)) {
    // Nobody selected? Spades remain the default trump. Otherwise the last chosen suit stands.
    if (selections.length === 0) next.trumpSuit = "spades";
    next.deck = dealPasses(next, next.deck ?? [], CALLBREAK_INITIAL_TRUMP_CARDS, CALLBREAK_TRICKS_PER_ROUND);
    if (next.deck.length !== 0 || next.players.some(player => player.hand.length !== CALLBREAK_TRICKS_PER_ROUND)) {
      throw new Error("Callbreak second deal did not distribute exactly 13 cards per player");
    }
    next.status = "bidding";
    next.currentIndex = next.leaderIndex;
    next.history.push({ type: "remaining-cards-dealt", playerId });
  } else {
    const nextPlayerId = next.trumpOrder![next.trumpDecisionIndex]!;
    next.currentIndex = next.players.findIndex(player => player.id === nextPlayerId);
  }
  return next;
}

export function callbreakBid(state: CallbreakState, playerId: PlayerId, bid: number): CallbreakState {
  if (state.status !== "bidding") throw new Error("Bidding is closed");
  const current = state.players[state.currentIndex];
  if (!current || current.id !== playerId) throw new Error("Not this player's bidding turn");
  const minimumBid = getCallbreakMinimumBid(state, playerId);
  if (!Number.isInteger(bid) || bid < minimumBid || bid > CALLBREAK_TRICKS_PER_ROUND) {
    throw new RangeError(`Bid must be between ${minimumBid} and 13${minimumBid > 1 ? ` because you selected trump and committed to at least ${minimumBid} tricks` : ""}`);
  }
  const next = structuredClone(state);
  next.players[next.currentIndex]!.bid = bid;
  next.history.push({ type: "bid", playerId, value: bid });
  next.currentIndex = nextIndex(next.currentIndex, next.players.length);
  if (next.players.every(player => player.bid !== null)) {
    next.status = "playing";
    next.currentIndex = next.leaderIndex;
  }
  return next;
}

export function callbreakPlay(state: CallbreakState, playerId: PlayerId, cardId: string): CallbreakState {
  if (state.status !== "playing") throw new Error("No trick is in progress");
  const current = state.players[state.currentIndex];
  if (!current || current.id !== playerId) throw new Error("Not this player's turn");
  const trumpSuit = state.trumpSuit ?? "spades";
  const allowed = legalCards(current, state.trick, trumpSuit);
  const chosen = current.hand.find(card => card.id === cardId);
  if (!chosen || !allowed.some(card => card.id === cardId)) {
    if (state.trick.length > 0 && current.hand.some(card => card.suit === state.trick[0]!.card.suit)) {
      throw new Error("You must follow the led suit and beat its highest card when possible");
    }
    if (state.trick.length > 0 && current.hand.some(card => card.suit === trumpSuit)) {
      throw new Error(`You must play a card in ${trumpSuit} when void in the led suit and overtrump when possible`);
    }
    throw new Error("That card is not legal for this trick");
  }

  const next = structuredClone(state);
  const player = next.players[next.currentIndex]!;
  player.hand = player.hand.filter(card => card.id !== cardId);
  next.trick.push({ playerId, card: chosen });
  next.history.push({ type: "play", playerId, cardId });

  if (next.trick.length < next.players.length) {
    next.currentIndex = nextIndex(next.currentIndex, next.players.length);
    return next;
  }

  const winnerOffset = trickWinner(next.trick, trumpSuit);
  const winnerId = next.trick[winnerOffset]!.playerId;
  const winnerIndex = next.players.findIndex(player => player.id === winnerId);
  next.players[winnerIndex]!.tricksWon += 1;
  next.history.push({ type: "trick-won", playerId: winnerId, value: next.trickNumber + 1 });
  next.trick = [];
  next.trickNumber += 1;
  next.leaderIndex = winnerIndex;
  next.currentIndex = winnerIndex;

  if (next.trickNumber === CALLBREAK_TRICKS_PER_ROUND) {
    const scores: Record<PlayerId, number> = {};
    for (const roundPlayer of next.players) {
      const bid = roundPlayer.bid;
      if (bid === null) throw new Error("Cannot settle a round with a missing bid");
      const score = roundPlayer.tricksWon >= bid
        ? bid * 10 + (roundPlayer.tricksWon - bid)
        : -bid * 10;
      roundPlayer.scoreTenths += score;
      scores[roundPlayer.id] = score;
    }
    next.roundScores = scores;
    const highestTotal = Math.max(...next.players.map(player => player.scoreTenths));
    if (highestTotal >= CALLBREAK_TARGET_SCORE_TENTHS) {
      next.status = "complete";
      next.winnerIds = next.players.filter(player => player.scoreTenths === highestTotal).map(player => player.id);
    } else {
      next.status = "round-complete";
    }
  }
  return next;
}

export function startNextCallbreakRound(state: CallbreakState, random: RandomSource = Math.random): CallbreakState {
  if (state.status !== "round-complete") throw new Error("Current round is not complete");
  return createCallbreakRound(state.players.map(player => ({ id: player.id, scoreTenths: player.scoreTenths })), state.round + 1, random);
}
