import { createDeck, type Card, type Rank } from "../cards.js";

export type CompanionStage = "betting" | "dealing" | "insurance" | "playing" | "dealer" | "complete";
export type CompanionHandStatus = "awaiting" | "playing" | "stood" | "busted" | "blackjack" | "surrendered";
export type CompanionOutcome = "win" | "blackjack" | "push" | "loss" | "bust" | "surrender";

export interface CompanionHand {
  id: string;
  cards: Card[];
  bet: number;
  status: CompanionHandStatus;
  doubled: boolean;
  splitAces: boolean;
  outcome?: CompanionOutcome;
  payout?: number;
}
export interface CompanionPlayer {
  id: string;
  name: string;
  balance: number;
  bet: number;
  betConfirmed: boolean;
  sittingOut: boolean;
  insuranceBet: number;
  hands: CompanionHand[];
}
export interface BlackjackCompanionRules {
  dealerHitsSoft17: boolean;
  blackjackNumerator: 3;
  blackjackDenominator: 2;
  allowDouble: boolean;
  allowSplit: boolean;
  allowSurrender: boolean;
  maxHands: number;
}
export interface DealTarget { kind: "player" | "dealer"; playerId?: string; handIndex?: number; label: string }
export interface PendingCardTarget { kind: "hand" | "dealer"; playerId?: string; handIndex?: number; action: "hit" | "double" | "split" | "dealer" }
export interface BlackjackCompanionState {
  gameId: "blackjack-companion";
  stage: CompanionStage;
  roundNumber: number;
  players: CompanionPlayer[];
  dealer: Card[];
  dealerRevealed: boolean;
  rules: BlackjackCompanionRules;
  bettingIndex: number;
  dealOrder: DealTarget[];
  dealCursor: number;
  pendingCards: PendingCardTarget[];
  insuranceIndex: number;
  activePlayerIndex: number;
  activeHandIndex: number;
  usedCardIds: string[];
  history: Array<{ type: string; playerId?: string; detail: string }>;
  dealerOutcome?: "blackjack" | "bust" | "stand" | "no-live-hands";
}

const DEFAULT_RULES: BlackjackCompanionRules = {
  dealerHitsSoft17: false,
  blackjackNumerator: 3,
  blackjackDenominator: 2,
  allowDouble: true,
  allowSplit: true,
  allowSurrender: true,
  maxHands: 4,
};
const CARD_MAP = new Map(createDeck().filter((card): card is Card => !card.joker).map(card => [card.id, card]));
const rankLabel = (rank: Rank) => rank <= 10 ? String(rank) : ({ 11: "Jack", 12: "Queen", 13: "King", 14: "Ace" } as Record<number, string>)[rank];

export function companionHandValue(cards: readonly Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += card.rank === 14 ? 11 : Math.min(card.rank, 10);
    if (card.rank === 14) aces += 1;
  }
  while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
  return { total, soft: aces > 0 };
}
function clone<T>(value: T): T { return structuredClone(value); }
function findPlayer(state: BlackjackCompanionState, playerId: string): CompanionPlayer {
  const player = state.players.find(item => item.id === playerId);
  if (!player) throw new Error("Player not found at this table");
  return player;
}
function allBetsConfirmed(state: BlackjackCompanionState): boolean {
  return state.players.every(player => player.betConfirmed);
}
function makeDealOrder(players: CompanionPlayer[]): DealTarget[] {
  const active = players.filter(player => player.bet > 0 && !player.sittingOut);
  const order: DealTarget[] = [];
  // Physical-table order: first card to every active player, dealer up-card,
  // then second card to every active player. The dealer hole card is entered
  // only after every player hand has finished.
  for (const player of active) order.push({ kind: "player", playerId: player.id, handIndex: 0, label: `${player.name} · first card` });
  order.push({ kind: "dealer", label: "Dealer · up card" });
  for (const player of active) order.push({ kind: "player", playerId: player.id, handIndex: 0, label: `${player.name} · second card` });
  return order;
}
function dealerHasNatural(state: BlackjackCompanionState): boolean {
  return state.dealer.length === 2 && companionHandValue(state.dealer).total === 21;
}
function currentHand(state: BlackjackCompanionState): { player: CompanionPlayer; hand: CompanionHand } {
  const player = state.players[state.activePlayerIndex];
  const hand = player?.hands[state.activeHandIndex];
  if (!player || !hand) throw new Error("There is no active hand");
  return { player, hand };
}
function hasDealerMandatoryHit(state: BlackjackCompanionState): boolean {
  const value = companionHandValue(state.dealer);
  return value.total < 17 || (value.total === 17 && value.soft && state.rules.dealerHitsSoft17);
}
function beginPlayerTurns(state: BlackjackCompanionState): void {
  state.stage = "playing";
  const first = findNextPlaying(state, -1, -1);
  if (!first) beginDealerTurn(state);
  else { state.activePlayerIndex = first.playerIndex; state.activeHandIndex = first.handIndex; }
}
function findNextPlaying(state: BlackjackCompanionState, afterPlayer: number, afterHand: number): { playerIndex: number; handIndex: number } | null {
  for (let p = Math.max(0, afterPlayer); p < state.players.length; p += 1) {
    const player = state.players[p]!;
    if (player.sittingOut || player.hands.length === 0) continue;
    const start = p === afterPlayer ? afterHand + 1 : 0;
    for (let h = start; h < player.hands.length; h += 1) {
      if (player.hands[h]!.status === "playing") return { playerIndex: p, handIndex: h };
    }
  }
  return null;
}
function beginDealerTurn(state: BlackjackCompanionState): void {
  state.stage = "dealer";
  if (state.dealer.length < 2) {
    state.dealerRevealed = false;
    state.pendingCards = [{ kind: "dealer", action: "dealer" }];
    return;
  }
  state.dealerRevealed = true;
  if (dealerHasNatural(state)) { settleRound(state, "blackjack"); return; }
  const remainingLiveHands = state.players.some(player => player.hands.some(hand => hand.status !== "busted" && hand.status !== "surrendered"));
  if (!remainingLiveHands) { settleRound(state, "no-live-hands"); return; }
  const value = companionHandValue(state.dealer);
  if (value.total > 21) {
    settleRound(state, "bust");
    return;
  }
  if (!hasDealerMandatoryHit(state) && value.total < 17) throw new Error("Dealer state is inconsistent");
}
function advanceAfterHand(state: BlackjackCompanionState): void {
  const next = findNextPlaying(state, state.activePlayerIndex, state.activeHandIndex);
  if (next) { state.activePlayerIndex = next.playerIndex; state.activeHandIndex = next.handIndex; }
  else beginDealerTurn(state);
}
function settleRound(state: BlackjackCompanionState, dealerOutcome: "blackjack" | "bust" | "stand" | "no-live-hands"): void {
  state.stage = "complete";
  state.dealerRevealed = true;
  state.dealerOutcome = dealerOutcome;
  const dealerNatural = dealerOutcome === "blackjack";
  const dealerValue = companionHandValue(state.dealer).total;
  for (const player of state.players) {
    if (dealerNatural && player.insuranceBet > 0) player.balance += player.insuranceBet * 3;
    for (const hand of player.hands) {
      const playerValue = companionHandValue(hand.cards).total;
      let payout = 0;
      let outcome: CompanionOutcome = "loss";
      if (hand.status === "surrendered") {
        payout = Math.floor(hand.bet / 2);
        outcome = "surrender";
      } else if (hand.status === "busted" || playerValue > 21) {
        outcome = "bust";
      } else if (dealerNatural) {
        if (hand.status === "blackjack") { payout = hand.bet; outcome = "push"; }
      } else if (hand.status === "blackjack") {
        payout = hand.bet + (hand.bet * state.rules.blackjackNumerator) / state.rules.blackjackDenominator;
        outcome = "blackjack";
      } else if (dealerOutcome === "bust" || playerValue > dealerValue) {
        payout = hand.bet * 2;
        outcome = "win";
      } else if (playerValue === dealerValue) {
        payout = hand.bet;
        outcome = "push";
      }
      player.balance += payout;
      hand.payout = payout;
      hand.outcome = outcome;
    }
  }
  state.history.push({ type: "settlement", detail: dealerNatural ? "Dealer blackjack — hands settled" : dealerOutcome === "bust" ? "Dealer bust — hands settled" : dealerOutcome === "no-live-hands" ? "No live player hands remained — dealer draw skipped" : "Dealer stood — hands settled" });
}

export function createBlackjackCompanion(
  drafts: Array<{ name: string; balance: number }>,
  rules: Partial<BlackjackCompanionRules> = {},
): BlackjackCompanionState {
  if (drafts.length < 2 || drafts.length > 9) throw new RangeError("Offline Blackjack supports 2–9 players");
  const players: CompanionPlayer[] = drafts.map((draft, index) => {
    const name = draft.name.trim();
    if (!name || name.length > 20) throw new RangeError("Player names must be between 1 and 20 characters");
    if (!Number.isSafeInteger(draft.balance) || draft.balance < 100 || draft.balance > 1_000_000_000) throw new RangeError("Each wallet must contain at least 100 chips and no more than 1,000,000,000 chips");
    return { id: `local-${index + 1}`, name, balance: draft.balance, bet: 0, betConfirmed: false, sittingOut: false, insuranceBet: 0, hands: [] };
  });
  const names = players.map(player => player.name.toLocaleLowerCase());
  if (new Set(names).size !== names.length) throw new RangeError("Every player must have a different name");
  return {
    gameId: "blackjack-companion", stage: "betting", roundNumber: 1, players, dealer: [], dealerRevealed: false,
    rules: { ...DEFAULT_RULES, ...rules }, bettingIndex: 0, dealOrder: [], dealCursor: 0, pendingCards: [], insuranceIndex: 0,
    activePlayerIndex: 0, activeHandIndex: 0, usedCardIds: [], history: [],
  };
}

export function companionSetBet(state: BlackjackCompanionState, playerId: string, amount: number): BlackjackCompanionState {
  if (state.stage !== "betting") throw new Error("Bets can only be changed before dealing");
  const next = clone(state);
  const player = findPlayer(next, playerId);
  if (player.betConfirmed) throw new Error("This bet is already confirmed");
  if (!Number.isSafeInteger(amount) || amount < 0 || amount % 100 !== 0) throw new RangeError("Bets must be whole 100-chip increments");
  if (amount > player.balance) throw new RangeError("Bet cannot exceed the player's available wallet");
  player.bet = amount;
  player.sittingOut = amount === 0;
  return next;
}

/** Add virtual play chips to an unconfirmed wallet during the betting stage. */
export function companionTopUpWallet(state: BlackjackCompanionState, playerId: string, amount: number): BlackjackCompanionState {
  if (state.stage !== "betting") throw new Error("Wallets can only be topped up before the deal");
  const next = clone(state);
  const player = findPlayer(next, playerId);
  if (player.betConfirmed) throw new Error("This player's wager is already locked");
  if (!Number.isSafeInteger(amount) || amount < 100 || amount % 100 !== 0) throw new RangeError("Top-ups must be whole 100-chip increments");
  if (player.balance + amount > 1_000_000_000) throw new RangeError("The wallet cannot exceed 1,000,000,000 chips");
  player.balance += amount;
  next.history.push({ type: "wallet-top-up", playerId, detail: `${player.name} added ${amount} virtual chips to their wallet` });
  return next;
}

/** Select any player who has not locked their wager yet. */
export function companionSelectBettingPlayer(state: BlackjackCompanionState, playerId: string): BlackjackCompanionState {
  if (state.stage !== "betting") throw new Error("Betting is already closed");
  const next = clone(state);
  const index = next.players.findIndex(player => player.id === playerId);
  if (index < 0) throw new Error("Player not found at this table");
  if (next.players[index]!.betConfirmed) throw new Error("This player's wager is already locked");
  next.bettingIndex = index;
  return next;
}

export function companionConfirmBet(state: BlackjackCompanionState, playerId: string): BlackjackCompanionState {
  if (state.stage !== "betting") throw new Error("Betting is already closed");
  const next = clone(state);
  const player = findPlayer(next, playerId);
  if (player.id !== next.players[next.bettingIndex]?.id) throw new Error("It is another player's turn to confirm a bet");
  if (player.bet < 100 && !player.sittingOut) throw new Error("Place at least 100 chips or choose to sit out");
  if (player.bet > player.balance) throw new Error("Bet exceeds the available wallet");
  player.betConfirmed = true;
  const afterCurrent = next.players.findIndex((item, index) => index > next.bettingIndex && !item.betConfirmed);
  next.bettingIndex = afterCurrent >= 0 ? afterCurrent : next.players.findIndex(item => !item.betConfirmed);
  if (next.bettingIndex < 0) next.bettingIndex = next.players.length;
  next.history.push({ type: player.sittingOut ? "sit-out" : "bet", playerId, detail: player.sittingOut ? `${player.name} sits out` : `${player.name} confirms ${player.bet} chips` });
  return next;
}

export function companionSitOut(state: BlackjackCompanionState, playerId: string): BlackjackCompanionState {
  const next = companionSetBet(state, playerId, 0);
  return companionConfirmBet(next, playerId);
}

export function companionStartDeal(state: BlackjackCompanionState): BlackjackCompanionState {
  if (state.stage !== "betting" || !allBetsConfirmed(state)) throw new Error("Every player must confirm a bet or sit out first");
  if (!state.players.some(player => player.bet > 0 && !player.sittingOut)) throw new Error("At least one player must place a bet");
  const next = clone(state);
  for (const player of next.players) {
    if (player.bet > 0 && !player.sittingOut) {
      player.balance -= player.bet;
      player.hands = [{ id: `${player.id}-r${next.roundNumber}-h1`, cards: [], bet: player.bet, status: "awaiting", doubled: false, splitAces: false }];
    }
  }
  next.dealOrder = makeDealOrder(next.players);
  next.dealCursor = 0;
  next.stage = "dealing";
  next.history.push({ type: "deal-start", detail: `Round ${next.roundNumber} initial deal started` });
  return next;
}

export function companionCurrentDealTarget(state: BlackjackCompanionState): DealTarget | null {
  return state.stage === "dealing" ? state.dealOrder[state.dealCursor] ?? null : null;
}
export function companionCurrentPendingTarget(state: BlackjackCompanionState): PendingCardTarget | null {
  return state.pendingCards[0] ?? null;
}
function useCard(state: BlackjackCompanionState, cardId: string): Card {
  const card = CARD_MAP.get(cardId);
  if (!card) throw new Error("Choose a valid card from a standard 52-card deck");
  if (state.usedCardIds.includes(cardId)) throw new Error("That card has already been used this round");
  state.usedCardIds.push(cardId);
  return card;
}
function afterInitialDeal(state: BlackjackCompanionState): void {
  for (const player of state.players) {
    const hand = player.hands[0];
    if (!hand) continue;
    hand.status = companionHandValue(hand.cards).total === 21 ? "blackjack" : "playing";
  }
  // Insurance is decided from the visible Ace before player turns, without
  // peeking at the hole card. The physical dealer hole card is still entered
  // only after every player has completed every hand.
  const firstInsurablePlayer = state.players.findIndex(player => player.hands.length > 0);
  if (state.dealer[0]?.rank === 14 && firstInsurablePlayer >= 0) {
    state.stage = "insurance";
    state.insuranceIndex = firstInsurablePlayer;
  } else {
    beginPlayerTurns(state);
  }
}

export function companionSelectCard(state: BlackjackCompanionState, cardId: string): BlackjackCompanionState {
  const next = clone(state);
  if (next.stage === "dealing") {
    const target = companionCurrentDealTarget(next);
    if (!target) throw new Error("There are no more opening cards to enter");
    const card = useCard(next, cardId);
    if (target.kind === "dealer") next.dealer.push(card);
    else {
      const hand = findPlayer(next, target.playerId!).hands[target.handIndex ?? 0];
      if (!hand) throw new Error("The target hand no longer exists");
      hand.cards.push(card);
    }
    next.dealCursor += 1;
    next.history.push({ type: "card-entered", ...(target.playerId ? { playerId: target.playerId } : {}), detail: `${target.label}: ${rankLabel(card.rank)} of ${card.suit}` });
    if (next.dealCursor >= next.dealOrder.length) afterInitialDeal(next);
    return next;
  }
  if (next.pendingCards.length === 0) throw new Error("There is no pending card to enter");
  const target = next.pendingCards[0]!;
  const card = useCard(next, cardId);
  if (target.kind === "dealer") {
    next.dealer.push(card);
    next.pendingCards.shift();
    if (next.dealer.length === 2) {
      next.dealerRevealed = true;
      if (dealerHasNatural(next)) settleRound(next, "blackjack");
      else {
        const remainingLiveHands = next.players.some(player => player.hands.some(hand => hand.status !== "busted" && hand.status !== "surrendered"));
        if (!remainingLiveHands) settleRound(next, "no-live-hands");
        else if (companionHandValue(next.dealer).total > 21) settleRound(next, "bust");
      }
    } else if (companionHandValue(next.dealer).total > 21) settleRound(next, "bust");
    return next;
  }
  const player = findPlayer(next, target.playerId!);
  const hand = player.hands[target.handIndex ?? 0];
  if (!hand) throw new Error("The target hand no longer exists");
  hand.cards.push(card);
  next.pendingCards.shift();
  if (target.action === "hit" || target.action === "double") {
    const total = companionHandValue(hand.cards).total;
    hand.status = total > 21 ? "busted" : target.action === "double" || total === 21 ? "stood" : "playing";
    if (hand.status !== "playing") advanceAfterHand(next);
  } else if (target.action === "split" && next.pendingCards.length === 0) {
    const splitHands = player.hands.filter(item => item.status === "awaiting" && item.splitAces);
    const newlySplit = player.hands.filter(item => item.status === "awaiting");
    for (const splitHand of newlySplit) {
      const total = companionHandValue(splitHand.cards).total;
      splitHand.status = splitHand.splitAces || total >= 21 ? "stood" : "playing";
    }
    if (splitHands.length > 0 && newlySplit.every(item => item.status !== "playing")) advanceAfterHand(next);
    else if (player.hands[next.activeHandIndex]?.status !== "playing") {
      const firstPlayable = findNextPlaying(next, next.activePlayerIndex, next.activeHandIndex - 1);
      if (firstPlayable) { next.activePlayerIndex = firstPlayable.playerIndex; next.activeHandIndex = firstPlayable.handIndex; }
      else beginDealerTurn(next);
    }
  }
  next.history.push({ type: target.action, playerId: player.id, detail: `${player.name} receives ${rankLabel(card.rank)} of ${card.suit}` });
  return next;
}

export function companionDecideInsurance(state: BlackjackCompanionState, playerId: string, take: boolean): BlackjackCompanionState {
  if (state.stage !== "insurance") throw new Error("Insurance is not being offered");
  const next = clone(state);
  const player = next.players[next.insuranceIndex];
  if (!player || player.id !== playerId) throw new Error("It is another player's insurance decision");
  if (take) {
    const amount = Math.floor(player.bet / 2);
    if (amount < 1 || player.balance < amount) throw new Error("There are not enough chips for insurance");
    player.balance -= amount;
    player.insuranceBet = amount;
  }
  next.history.push({ type: take ? "insurance" : "insurance-declined", playerId, detail: `${player.name} ${take && player.insuranceBet > 0 ? `takes ${player.insuranceBet} chips insurance` : "declines insurance"}` });
  const nextIndex = next.players.findIndex((item, index) => index > next.insuranceIndex && item.hands.length > 0);
  if (nextIndex >= 0) next.insuranceIndex = nextIndex;
  else if (dealerHasNatural(next)) settleRound(next, "blackjack");
  else beginPlayerTurns(next);
  return next;
}

export function companionPlayerAction(state: BlackjackCompanionState, playerId: string, action: "hit" | "stand" | "double" | "split" | "surrender"): BlackjackCompanionState {
  if (state.stage !== "playing" || state.pendingCards.length > 0) throw new Error("The table is not ready for a player action");
  const { player, hand } = currentHand(state);
  if (player.id !== playerId) throw new Error("It is another player's turn");
  if (hand.status !== "playing") throw new Error("This hand is no longer active");
  const next = clone(state);
  const currentPlayer = findPlayer(next, playerId);
  const current = currentPlayer.hands[next.activeHandIndex]!;
  if (action === "stand") {
    current.status = "stood";
    next.history.push({ type: "stand", playerId, detail: `${player.name} stands on ${companionHandValue(current.cards).total}` });
    advanceAfterHand(next);
    return next;
  }
  if (action === "surrender") {
    if (!next.rules.allowSurrender || current.cards.length !== 2 || current.doubled || currentPlayer.hands.length !== 1) throw new Error("Surrender is only available on the original two-card hand");
    current.status = "surrendered";
    next.history.push({ type: "surrender", playerId, detail: `${player.name} surrenders` });
    advanceAfterHand(next);
    return next;
  }
  if (action === "hit") {
    current.status = "awaiting";
    next.pendingCards = [{ kind: "hand", playerId, handIndex: next.activeHandIndex, action: "hit" }];
    return next;
  }
  if (action === "double") {
    if (!next.rules.allowDouble || current.cards.length !== 2 || current.doubled || currentPlayer.balance < current.bet) throw new Error("Double down is not available or there are not enough chips");
    currentPlayer.balance -= current.bet;
    current.bet *= 2;
    current.doubled = true;
    current.status = "awaiting";
    next.pendingCards = [{ kind: "hand", playerId, handIndex: next.activeHandIndex, action: "double" }];
    next.history.push({ type: "double", playerId, detail: `${player.name} doubles to ${current.bet} chips` });
    return next;
  }
  if (action === "split") {
    if (!next.rules.allowSplit || current.cards.length !== 2 || current.cards[0]!.rank !== current.cards[1]!.rank || currentPlayer.hands.length >= next.rules.maxHands || currentPlayer.balance < current.bet) throw new Error("Split is not available or there are not enough chips");
    currentPlayer.balance -= current.bet;
    const [first, second] = current.cards;
    const isAces = first!.rank === 14;
    current.cards = [first!];
    current.splitAces = isAces;
    current.status = "awaiting";
    const newHandIndex = next.activeHandIndex + 1;
    const splitHand: CompanionHand = { id: `${currentPlayer.id}-r${next.roundNumber}-h${currentPlayer.hands.length + 1}`, cards: [second!], bet: current.bet, status: "awaiting", doubled: false, splitAces: isAces };
    currentPlayer.hands.splice(newHandIndex, 0, splitHand);
    next.pendingCards = [
      { kind: "hand", playerId, handIndex: next.activeHandIndex, action: "split" },
      { kind: "hand", playerId, handIndex: newHandIndex, action: "split" },
    ];
    next.history.push({ type: "split", playerId, detail: `${player.name} splits into two hands` });
    return next;
  }
  throw new Error("Unsupported Blackjack action");
}

export function companionDealerHit(state: BlackjackCompanionState): BlackjackCompanionState {
  if (state.stage !== "dealer" || state.pendingCards.length > 0) throw new Error("The dealer is not ready to draw");
  if (!hasDealerMandatoryHit(state)) throw new Error("The dealer must stand on this total");
  const next = clone(state);
  next.pendingCards = [{ kind: "dealer", action: "dealer" }];
  return next;
}
export function companionDealerStand(state: BlackjackCompanionState): BlackjackCompanionState {
  if (state.stage !== "dealer" || state.pendingCards.length > 0) throw new Error("The dealer cannot stand right now");
  if (hasDealerMandatoryHit(state)) throw new Error("The dealer must hit under this table's rules");
  const next = clone(state);
  settleRound(next, "stand");
  return next;
}

export function companionNextRound(state: BlackjackCompanionState): BlackjackCompanionState {
  if (state.stage !== "complete") throw new Error("Finish the current round before starting another");
  const next = clone(state);
  next.stage = "betting";
  next.roundNumber += 1;
  next.dealer = [];
  next.dealerRevealed = false;
  next.bettingIndex = 0;
  next.dealOrder = [];
  next.dealCursor = 0;
  next.pendingCards = [];
  next.insuranceIndex = 0;
  next.activePlayerIndex = 0;
  next.activeHandIndex = 0;
  next.usedCardIds = [];
  delete next.dealerOutcome;
  for (const player of next.players) {
    player.bet = 0;
    player.betConfirmed = false;
    player.sittingOut = player.balance < 100;
    player.insuranceBet = 0;
    player.hands = [];
  }
  return next;
}
