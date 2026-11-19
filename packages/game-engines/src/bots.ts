import type { Card } from "@cardroom/shared/cards";
import { blackjackValue } from "@cardroom/shared/games/blackjack";
import type { BlackjackState } from "@cardroom/shared/games/blackjack";
import type { HoldemState, HoldemAction } from "@cardroom/shared/games/holdem";
import { compareTeenPatti, evaluateTeenPatti, teenPattiShowCost, teenPattiWagerBounds, type TeenPattiAction, type TeenPattiState } from "@cardroom/shared/games/teenPatti";
import type { CallbreakState } from "@cardroom/shared/games/callbreak";
import { getLegalCallbreakCardIds } from "@cardroom/shared/games/callbreak";
import { classifyRummyGroup, validateIndianRummyDeclaration, validateRummy10Declaration, type RummyGroup, type RummyState } from "@cardroom/shared/games/rummy";

export type BotDifficulty = "easy" | "medium" | "hard";
const randomChoice = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)]!;
const botStrength = (difficulty: BotDifficulty) => ({ easy: 0.35, medium: 0.62, hard: 0.82 })[difficulty];

export function chooseBlackjackBotAction(state: BlackjackState, playerId: string, difficulty: BotDifficulty = "medium"): "hit" | "stand" | "double" | "split" {
  const player = state.players.find(p => p.id === playerId)!;
  const hand = player.hands.find(h => h.status === "playing")!;
  const value = blackjackValue(hand.cards).total;
  if (state.rules.allowSplit && hand.cards.length === 2 && hand.cards[0]!.rank === hand.cards[1]!.rank && [8, 11, 14].includes(hand.cards[0]!.rank) && player.chips >= hand.bet && difficulty !== "easy") return "split";
  if (state.rules.allowDouble && hand.cards.length === 2 && value === 11 && player.chips >= hand.bet && difficulty !== "easy") return "double";
  if (value < 12) return "hit";
  if (value < (difficulty === "hard" ? 17 : difficulty === "easy" ? 15 : 16)) return "hit";
  return "stand";
}

export function chooseHoldemBotAction(state: HoldemState, playerId: string, difficulty: BotDifficulty = "medium"): HoldemAction {
  const player = state.players.find(p => p.id === playerId)!;
  const toCall = Math.max(0, state.currentBet - player.streetContribution);
  const high = Math.max(...player.hole.map(c => c.rank));
  const pair = player.hole[0]?.rank === player.hole[1]?.rank;
  const suited = player.hole[0]?.suit === player.hole[1]?.suit;
  const strength = botStrength(difficulty);
  const good = pair || high >= (difficulty === "hard" ? 11 : 12) || (suited && high >= 10);
  if (toCall === 0) {
    if (state.currentBet === 0 && good && Math.random() < strength && player.chips > state.bigBlind * 2) return { type: "bet", amount: Math.min(player.chips + player.streetContribution, state.bigBlind * (difficulty === "hard" ? 3 : 2)) };
    return { type: "check" };
  }
  if (good && toCall <= player.chips * (difficulty === "hard" ? 0.45 : 0.28)) return { type: "call" };
  if (toCall <= player.chips * 0.06 && Math.random() < strength) return { type: "call" };
  return { type: "fold" };
}

export function chooseTeenPattiBotAction(state: TeenPattiState, playerId: string, difficulty: BotDifficulty = "medium"): TeenPattiAction {
  const player = state.players.find(p => p.id === playerId);
  if (!player || player.folded || state.status !== "playing") return "pack";
  const chance = botStrength(difficulty);

  // A bot can be the target of a sideshow while it is not the normal acting seat.
  if (state.pendingSideshow?.targetId === playerId) {
    const requester = state.players.find(p => p.id === state.pendingSideshow!.requesterId);
    if (!requester) return "sideshow-decline";
    const comparison = compareTeenPatti(evaluateTeenPatti(player.cards), evaluateTeenPatti(requester.cards));
    return comparison >= 0 ? "sideshow-accept" : "sideshow-decline";
  }

  const live = state.players.filter(p => !p.folded);
  const rank = evaluateTeenPatti(player.cards);
  const bounds = teenPattiWagerBounds(state.currentStake, player.seen, player.chips);
  if (bounds.max < bounds.min) return "pack";

  if (live.length === 2) {
    const opponent = live.find(p => p.id !== playerId)!;
    const showCost = teenPattiShowCost(state.currentStake, player.seen, opponent.seen);
    // Seen players cannot call a show against a blind player. They must continue
    // with a legal chaal or pack instead.
    if (showCost !== null && player.chips >= showCost) {
      const strongEnough = rank.tuple[0]! >= (difficulty === "hard" ? 2 : 3);
      if (strongEnough || Math.random() < chance * 0.25) return "show";
    }
    if (player.seen) return bounds.max >= bounds.min ? "chaal" : "pack";
    return "blind";
  }

  // Classic sideshow requires every active player to be seen and targets the previous seen bettor.
  const previous = state.players.find(p => p.id === state.lastActionPlayerId);
  const sideshowCost = state.currentStake * 2;
  if (player.seen && live.length >= 3 && live.every(p => p.seen) && previous && previous.id !== playerId && !previous.folded && previous.seen && player.chips >= sideshowCost) {
    if (rank.tuple[0]! <= 2 && Math.random() < chance) return "sideshow";
  }

  if (!player.seen && state.turns < 4 && Math.random() < 0.65) return "blind";
  if (rank.tuple[0]! <= 1 && Math.random() > chance) return "pack";
  return player.seen ? "chaal" : "blind";
}

export function chooseCallbreakBid(hand: readonly Card[], difficulty: BotDifficulty = "medium"): number {
  const highHonors = hand.filter(c => c.rank >= 13).length;
  const aceCount = hand.filter(c => c.rank === 14).length;
  const trumpCount = hand.filter(c => c.suit === "spades").length;
  const shortSuits = new Set(hand.map(c => c.suit)).size;
  const estimate = Math.max(1, Math.min(13, Math.round(0.7 + aceCount * 0.9 + highHonors * 0.28 + trumpCount * 0.36 + (4 - shortSuits) * 0.2)));
  return Math.max(1, Math.min(13, estimate + (difficulty === "hard" ? 0 : difficulty === "easy" ? -1 : 0)));
}
export function chooseCallbreakCard(state: CallbreakState, playerId: string, difficulty: BotDifficulty = "medium"): string {
  const player = state.players[state.currentIndex]!;
  const allowed = getLegalCallbreakCardIds(state, playerId);
  const cards = player.hand.filter(c => allowed.includes(c.id));
  if (cards.length === 1) return cards[0]!.id;
  const leadSuit = state.trick[0]?.card.suit;
  const currentWinner = state.trick.length ? state.trick.reduce((best, item) => {
    const bestCard = best.card;
    const bestTrump = bestCard.suit === "spades", itemTrump = item.card.suit === "spades";
    if (itemTrump !== bestTrump) return itemTrump ? item : best;
    if (item.card.suit !== bestCard.suit) return best;
    return item.card.rank > bestCard.rank ? item : best;
  }) : null;
  const shouldWin = player.tricksWon < (player.bid ?? 1) || difficulty === "hard";
  const winning = cards.filter(c => !currentWinner || ((c.suit === "spades" && currentWinner.card.suit !== "spades") || (c.suit === currentWinner.card.suit && c.rank > currentWinner.card.rank)));
  if (shouldWin && winning.length) return winning.sort((a, b) => a.rank - b.rank)[0]!.id;
  if (!shouldWin || !winning.length) return cards.sort((a, b) => a.rank - b.rank)[0]!.id;
  return randomChoice(cards).id;
}

export function findRummyDeclaration(state: RummyState, playerId: string): RummyGroup[] | null {
  const player = state.players.find(p => p.id === playerId);
  if (!player || (player.hand.length !== state.handSize && player.hand.length !== state.handSize + 1)) return null;

  const searchHand = (hand: Card[]): RummyGroup[] | null => {
    const n = hand.length;
    const candidateGroups: Array<{ mask: number; ids: string[]; size: number; kind: "pure-sequence" | "impure-sequence" | "set" }> = [];
    const build = (start: number, chosen: number[]) => {
      if (chosen.length >= 3) {
        const cards = chosen.map(i => hand[i]!);
        const kind = classifyRummyGroup(cards, state.wildRank);
        if (kind && (state.gameId !== "rummy-10" || kind === "set")) {
          const mask = chosen.reduce((value, index) => value | (1 << index), 0);
          candidateGroups.push({ mask, ids: cards.map(c => c.id), size: cards.length, kind });
        }
      }
      if (chosen.length === n) return;
      for (let i = start; i < n; i += 1) {
        chosen.push(i); build(i + 1, chosen); chosen.pop();
      }
    };
    build(0, []);
    const byCard = Array.from({ length: n }, (_, index) => candidateGroups.filter(group => (group.mask & (1 << index)) !== 0));
    const fullMask = (1 << n) - 1;
    const search13 = (remaining: number, groups: RummyGroup[], sequences: number, pure: number): RummyGroup[] | null => {
      if (remaining === 0) return validateIndianRummyDeclaration(hand, groups, state.wildRank).valid ? groups : null;
      const remainingCount = remaining.toString(2).replace(/0/g, "").length;
      if (remainingCount < 3 || sequences + Math.floor(remainingCount / 3) < 2 || (pure === 0 && remainingCount < 3)) return null;
      const first = Math.log2(remaining & -remaining) | 0;
      for (const group of byCard[first]!) {
        if ((group.mask & remaining) !== group.mask) continue;
        const nextSequences = sequences + (group.kind === "set" ? 0 : 1);
        const nextPure = pure + (group.kind === "pure-sequence" ? 1 : 0);
        const result = search13(remaining ^ group.mask, [...groups, { cardIds: group.ids }], nextSequences, nextPure);
        if (result) return result;
      }
      return null;
    };
    if (state.gameId === "rummy-13") return search13(fullMask, [], 0, 0);

    const search10 = (remaining: number, sizes: number[], groups: RummyGroup[]): RummyGroup[] | null => {
      if (remaining === 0) return sizes.length === 0 && validateRummy10Declaration(hand, groups, state.wildRank).valid ? groups : null;
      if (sizes.length === 0) return null;
      const first = Math.log2(remaining & -remaining) | 0;
      for (const group of byCard[first]!) {
        const matchingSize = sizes.indexOf(group.size);
        if (matchingSize < 0 || (group.mask & remaining) !== group.mask) continue;
        const nextSizes = sizes.filter((_, index) => index !== matchingSize);
        const result = search10(remaining ^ group.mask, nextSizes, [...groups, { cardIds: group.ids }]);
        if (result) return result;
      }
      return null;
    };
    return search10(fullMask, [3, 3, 4], []);
  };

  if (player.hand.length === state.handSize) return searchHand(player.hand as Card[]);
  // A player may declare after drawing: all but one card must form a valid hand.
  for (let discardIndex = 0; discardIndex < player.hand.length; discardIndex += 1) {
    const candidate = player.hand.filter((_, index) => index !== discardIndex) as Card[];
    const groups = searchHand(candidate);
    if (groups) return groups;
  }
  return null;
}

export function chooseRummyDiscard(state: RummyState, playerId: string): string {
  const player = state.players.find(p => p.id === playerId)!;
  const hand = player.hand;
  const score = (card: Card): number => {
    const sameRank = hand.filter(c => !c.joker && c.rank === card.rank && c.id !== card.id).length;
    const neighbor = hand.filter(c => !c.joker && c.suit === card.suit && Math.abs(c.rank - card.rank) <= 2 && c.id !== card.id).length;
    const highPenalty = card.rank >= 11 ? 2 : 0;
    return sameRank * 5 + neighbor * 3 + (card.rank === state.wildRank ? 20 : 0) + (card.joker ? 30 : 0) - highPenalty;
  };
  return hand.filter((c): c is Card => !c.joker).sort((a, b) => score(a) - score(b))[0]?.id ?? hand[0]!.id;
}
