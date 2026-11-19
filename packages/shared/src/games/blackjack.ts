import { createDeck, shuffle, type Card, type RandomSource } from "../cards.js";
import type { PlayerId } from "../contracts.js";

export type BlackjackHandStatus = "playing" | "stood" | "busted" | "blackjack" | "surrendered";
export type BlackjackOutcome = "win" | "blackjack" | "push" | "loss" | "bust" | "surrender";
export interface BlackjackHand {
  cards: Card[];
  bet: number;
  status: BlackjackHandStatus;
  doubled: boolean;
  splitAces: boolean;
  /** Authoritative round result, populated by dealer settlement. */
  outcome?: BlackjackOutcome;
  /** Total chips returned for this hand, including returned stake. */
  payout?: number;
  /** Net chip change for this hand after its wager was posted. */
  net?: number;
}
export interface BlackjackPlayer { id: PlayerId; chips: number; hands: BlackjackHand[]; bet?: number; betConfirmed?: boolean; sittingOut?: boolean; insuranceBet?: number }
export interface BlackjackRules { dealerHitsSoft17: boolean; blackjackNumerator: number; blackjackDenominator: number; allowDouble: boolean; allowSplit: boolean; maxHands: number }
export interface BlackjackState {
  gameId: "blackjack";
  status: "betting" | "insurance" | "player-turn" | "dealer-turn" | "complete";
  players: BlackjackPlayer[];
  dealer: Card[];
  deck: Card[];
  activePlayerIndex: number;
  activeHandIndex: number;
  insuranceIndex?: number;
  rules: BlackjackRules;
  results: Record<PlayerId, number>;
  history: Array<{ type: string; playerId?: PlayerId; detail: string }>;
}
export type BlackjackAction = "hit" | "stand" | "double" | "split" | "surrender";

const DEFAULT_RULES: BlackjackRules = { dealerHitsSoft17: false, blackjackNumerator: 3, blackjackDenominator: 2, allowDouble: true, allowSplit: true, maxHands: 4 };
const handValue = (cards: readonly Card[]) => {
  let total = 0;
  let aces = 0;
  for (const card of cards) { total += card.rank === 14 ? 11 : Math.min(card.rank, 10); if (card.rank === 14) aces += 1; }
  while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
  return { total, soft: aces > 0 };
};
export { handValue as blackjackValue };

function activeHand(state: BlackjackState): BlackjackHand {
  const player = state.players[state.activePlayerIndex];
  const hand = player?.hands[state.activeHandIndex];
  if (!player || !hand) throw new Error("No active hand");
  return hand;
}
function findNext(state: BlackjackState): boolean {
  for (let p = state.activePlayerIndex; p < state.players.length; p += 1) {
    const player = state.players[p]!;
    const start = p === state.activePlayerIndex ? state.activeHandIndex + 1 : 0;
    for (let h = start; h < player.hands.length; h += 1) {
      if (player.hands[h]!.status === "playing") { state.activePlayerIndex = p; state.activeHandIndex = h; return true; }
    }
  }
  return false;
}
function dealerTurn(state: BlackjackState): void {
  state.status = "dealer-turn";
  let value = handValue(state.dealer);
  while (value.total < 17 || (value.total === 17 && value.soft && state.rules.dealerHitsSoft17)) {
    const card = state.deck.shift();
    if (!card) throw new Error("Deck exhausted during dealer turn");
    state.dealer.push(card);
    value = handValue(state.dealer);
  }

  const dealerNatural = state.dealer.length === 2 && value.total === 21;
  for (const player of state.players) {
    let playerNet = 0;
    const insuranceBet = player.insuranceBet ?? 0;
    if (insuranceBet > 0) {
      if (dealerNatural) {
        player.chips += insuranceBet * 3;
        playerNet += insuranceBet * 2;
      } else {
        playerNet -= insuranceBet;
      }
    }

    for (const hand of player.hands) {
      const playerValue = handValue(hand.cards).total;
      let payout = 0;
      let outcome: BlackjackOutcome = "loss";
      if (hand.status === "busted" || playerValue > 21) {
        outcome = "bust";
      } else if (hand.status === "surrendered") {
        payout = Math.floor(hand.bet / 2);
        outcome = "surrender";
      } else if (dealerNatural) {
        if (hand.status === "blackjack") {
          payout = hand.bet;
          outcome = "push";
        }
      } else if (hand.status === "blackjack") {
        payout = hand.bet + Math.floor(hand.bet * state.rules.blackjackNumerator / state.rules.blackjackDenominator);
        outcome = "blackjack";
      } else if (value.total > 21 || playerValue > value.total) {
        payout = hand.bet * 2;
        outcome = "win";
      } else if (playerValue === value.total) {
        payout = hand.bet;
        outcome = "push";
      }
      player.chips += payout;
      hand.payout = payout;
      hand.net = payout - hand.bet;
      hand.outcome = outcome;
      playerNet += hand.net;
    }
    state.results[player.id] = playerNet;
  }
  state.status = "complete";
  state.history.push({ type: "settlement", detail: "Dealer hand settled and individual player outcomes recorded" });
}
function advance(state: BlackjackState): void {
  if (findNext(state)) return;
  dealerTurn(state);
}

function beginOnlinePlayerTurns(state: BlackjackState): void {
  state.status = "player-turn";
  for (let p = 0; p < state.players.length; p += 1) {
    for (let h = 0; h < state.players[p]!.hands.length; h += 1) {
      if (state.players[p]!.hands[h]!.status === "playing") {
        state.activePlayerIndex = p; state.activeHandIndex = h; return;
      }
    }
  }
  dealerTurn(state);
}

export function createBlackjackBettingGame(
  players: Array<{ id: PlayerId; chips: number }>,
  options: Partial<BlackjackRules> = {},
  random: RandomSource = Math.random,
): BlackjackState {
  if (players.length < 1 || players.length > 9) throw new RangeError("Online Blackjack supports 1–9 players");
  const ids = players.map(player => player.id);
  if (new Set(ids).size !== ids.length) throw new RangeError("Every seat must have a unique player identity");
  for (const player of players) {
    if (!Number.isSafeInteger(player.chips) || player.chips < 100) throw new RangeError("Each player needs at least 100 integer chips");
  }
  return {
    gameId: "blackjack", status: "betting",
    players: players.map(player => ({ id: player.id, chips: player.chips, hands: [], bet: 0, betConfirmed: false, sittingOut: false })),
    dealer: [], deck: shuffle(createDeck(), random).filter((card): card is Card => !card.joker),
    activePlayerIndex: 0, activeHandIndex: 0, rules: { ...DEFAULT_RULES, ...options }, results: {}, history: [],
  };
}

export function blackjackSetBet(state: BlackjackState, playerId: PlayerId, amount: number): BlackjackState {
  if (state.status !== "betting") throw new Error("Bets are closed");
  const next = structuredClone(state);
  const player = next.players.find(item => item.id === playerId);
  if (!player) throw new Error("Player is not seated at this table");
  if (player.betConfirmed) throw new Error("Your wager is already confirmed");
  if (!Number.isSafeInteger(amount) || amount < 0 || (amount !== 0 && amount % 100 !== 0)) throw new RangeError("Bets must be 100-chip increments or zero to sit out");
  if (amount > player.chips) throw new RangeError("Your wager cannot exceed your wallet");
  player.bet = amount;
  player.sittingOut = amount === 0;
  return next;
}

export function blackjackConfirmBet(state: BlackjackState, playerId: PlayerId): BlackjackState {
  if (state.status !== "betting") throw new Error("Bets are closed");
  const next = structuredClone(state);
  const player = next.players.find(item => item.id === playerId);
  if (!player) throw new Error("Player is not seated at this table");
  if (player.betConfirmed) throw new Error("Your wager is already confirmed");
  if (!player.sittingOut && (!player.bet || player.bet < 100)) throw new Error("Place at least 100 chips or choose to sit out");
  if ((player.bet ?? 0) > player.chips) throw new Error("Your wager exceeds your wallet");
  player.betConfirmed = true;
  next.history.push({ type: player.sittingOut ? "sit-out" : "bet", playerId, detail: player.sittingOut ? `${playerId} sits out` : `${playerId} confirms ${player.bet} chips` });
  return next;
}

export function blackjackSitOut(state: BlackjackState, playerId: PlayerId): BlackjackState {
  const next = blackjackSetBet(state, playerId, 0);
  return blackjackConfirmBet(next, playerId);
}

export function blackjackStartDeal(state: BlackjackState, random?: RandomSource): BlackjackState {
  if (state.status !== "betting") throw new Error("The table is not accepting bets");
  if (state.players.some(player => !player.betConfirmed)) throw new Error("Every player must confirm a wager or sit out before dealing");
  if (!state.players.some(player => (player.bet ?? 0) > 0 && !player.sittingOut)) throw new Error("At least one player must place a wager");
  const next = structuredClone(state);
  if (random) next.deck = shuffle(createDeck(), random).filter((card): card is Card => !card.joker);
  for (const player of next.players) {
    const bet = player.bet ?? 0;
    if (bet > 0 && !player.sittingOut) {
      player.chips -= bet;
      player.hands = [{ cards: [], bet, status: "playing", doubled: false, splitAces: false }];
    }
  }
  for (let pass = 0; pass < 2; pass += 1) {
    for (const player of next.players) {
      const hand = player.hands[0];
      if (hand) hand.cards.push(next.deck.shift()!);
    }
    next.dealer.push(next.deck.shift()!);
  }
  for (const player of next.players) {
    const hand = player.hands[0];
    if (hand && handValue(hand.cards).total === 21) hand.status = "blackjack";
  }
  const dealerNatural = next.dealer.length === 2 && handValue(next.dealer).total === 21;
  if (next.dealer[0]?.rank === 14) {
    next.status = "insurance";
    next.insuranceIndex = next.players.findIndex(player => player.hands.length > 0);
  } else if (dealerNatural) dealerTurn(next);
  else beginOnlinePlayerTurns(next);
  next.history.push({ type: "deal", detail: "Server dealt the opening cards" });
  return next;
}

export function blackjackDecideInsurance(state: BlackjackState, playerId: PlayerId, take: boolean): BlackjackState {
  if (state.status !== "insurance") throw new Error("Insurance is not being offered");
  const next = structuredClone(state);
  const player = next.players[next.insuranceIndex ?? -1];
  if (!player || player.id !== playerId) throw new Error("It is another player's insurance decision");
  if (take) {
    const originalBet = player.hands[0]?.bet ?? 0;
    const amount = Math.floor(originalBet / 2);
    if (amount < 1 || player.chips < amount) throw new Error("There are not enough chips for insurance");
    player.chips -= amount; player.insuranceBet = amount;
  }
  next.history.push({ type: take ? "insurance" : "insurance-declined", playerId, detail: `${playerId} ${take ? "takes insurance" : "declines insurance"}` });
  const nextIndex = next.players.findIndex((item, index) => index > (next.insuranceIndex ?? -1) && item.hands.length > 0);
  if (nextIndex >= 0) next.insuranceIndex = nextIndex;
  else {
    const dealerNatural = next.dealer.length === 2 && handValue(next.dealer).total === 21;
    if (dealerNatural) dealerTurn(next); else beginOnlinePlayerTurns(next);
  }
  return next;
}

export function createBlackjackGame(
  players: Array<{ id: PlayerId; chips: number; bet: number }>,
  options: Partial<BlackjackRules> = {},
  random: RandomSource = Math.random,
): BlackjackState {
  if (players.length < 1 || players.length > 9) throw new RangeError("Online Blackjack supports 1–9 players");
  const rules = { ...DEFAULT_RULES, ...options };
  for (const p of players) {
    if (!Number.isSafeInteger(p.chips) || !Number.isSafeInteger(p.bet) || p.bet < 1 || p.chips < p.bet) throw new RangeError("Each player needs enough integer chips for the bet");
    if (rules.blackjackNumerator === 3 && rules.blackjackDenominator === 2 && p.bet % 2 !== 0) throw new RangeError("Use an even bet for exact 3:2 blackjack payouts");
  }
  const deck = shuffle(createDeck(), random).filter((card): card is Card => !card.joker);
  const state: BlackjackState = {
    gameId: "blackjack", status: "player-turn",
    players: players.map(p => ({ id: p.id, chips: p.chips - p.bet, hands: [{ cards: [], bet: p.bet, status: "playing", doubled: false, splitAces: false }] })),
    dealer: [], deck, activePlayerIndex: 0, activeHandIndex: 0, rules, results: {}, history: [],
  };
  for (let pass = 0; pass < 2; pass += 1) {
    for (const p of state.players) p.hands[0]!.cards.push(state.deck.shift()!);
    state.dealer.push(state.deck.shift()!);
  }
  for (const p of state.players) {
    const hand = p.hands[0]!;
    if (handValue(hand.cards).total === 21) hand.status = "blackjack";
  }
  if (state.players.every(p => p.hands[0]!.status !== "playing")) dealerTurn(state);
  else while (state.players[state.activePlayerIndex]!.hands[0]!.status !== "playing" && !findNext(state)) dealerTurn(state);
  state.history.push({ type: "deal", detail: "Initial cards dealt" });
  return state;
}

export function blackjackNextRound(state: BlackjackState, random: RandomSource = Math.random): BlackjackState {
  if (state.status !== "complete") throw new Error("The current round must be settled before starting another");
  const next = structuredClone(state);
  next.status = "betting";
  next.deck = shuffle(createDeck(), random).filter((card): card is Card => !card.joker);
  next.dealer = [];
  next.activePlayerIndex = 0;
  next.activeHandIndex = 0;
  delete next.insuranceIndex;
  next.results = {};
  for (const player of next.players) {
    player.hands = []; player.bet = 0; player.betConfirmed = false; player.sittingOut = false; player.insuranceBet = 0;
  }
  next.history.push({ type: "next-round", detail: "A new Blackjack betting round has opened" });
  return next;
}

export function blackjackAction(state: BlackjackState, playerId: PlayerId, action: BlackjackAction): BlackjackState {
  if (state.status !== "player-turn") throw new Error("Round is not accepting actions");
  const player = state.players[state.activePlayerIndex];
  if (!player || player.id !== playerId) throw new Error("Not this player's turn");
  const hand = activeHand(state);
  if (hand.status !== "playing") throw new Error("Hand is not active");
  const next: BlackjackState = structuredClone(state);
  const currentPlayer = next.players[next.activePlayerIndex]!;
  const current = currentPlayer.hands[next.activeHandIndex]!;
  if (action === "surrender") {
    if (current.cards.length !== 2 || current.doubled || currentPlayer.hands.length !== 1) throw new Error("Surrender is only available on the original two-card hand");
    current.status = "surrendered";
  } else if (action === "hit") {
    const card = next.deck.shift(); if (!card) throw new Error("No cards remaining");
    current.cards.push(card);
    const value = handValue(current.cards).total;
    if (value > 21) current.status = "busted";
    else if (value === 21) current.status = "stood";
  } else if (action === "stand") current.status = "stood";
  else if (action === "double") {
    if (!next.rules.allowDouble || current.cards.length !== 2 || current.doubled || currentPlayer.chips < current.bet) throw new Error("Double down is not legal");
    currentPlayer.chips -= current.bet; current.bet *= 2; current.doubled = true;
    const card = next.deck.shift(); if (!card) throw new Error("No cards remaining");
    current.cards.push(card);
    current.status = handValue(current.cards).total > 21 ? "busted" : "stood";
  } else if (action === "split") {
    if (!next.rules.allowSplit || current.cards.length !== 2 || current.cards[0]!.rank !== current.cards[1]!.rank || currentPlayer.hands.length >= next.rules.maxHands || currentPlayer.chips < current.bet) throw new Error("Split is not legal");
    currentPlayer.chips -= current.bet;
    const isAces = current.cards[0]!.rank === 14;
    const secondCard = current.cards.pop()!;
    const splitCard = next.deck.shift(); const originalCard = next.deck.shift();
    if (!splitCard || !originalCard) throw new Error("No cards remaining");
    current.cards.push(splitCard); current.splitAces = isAces;
    if (isAces || handValue(current.cards).total === 21) current.status = "stood";
    const secondCards = [secondCard, originalCard];
    const second: BlackjackHand = { cards: secondCards, bet: current.bet, status: isAces || handValue(secondCards).total === 21 ? "stood" : "playing", doubled: false, splitAces: isAces };
    currentPlayer.hands.splice(next.activeHandIndex + 1, 0, second);
  }
  next.history.push({ type: action, playerId, detail: `${playerId} ${action}` });
  advance(next);
  return next;
}
