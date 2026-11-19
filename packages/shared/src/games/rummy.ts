import { createDeck, shuffle, type Card, type PlayingCard, type RandomSource } from "../cards.js";
import type { PlayerId } from "../contracts.js";

export interface RummyGroup { cardIds: string[] }
export interface RummyValidation { valid: boolean; errors: string[]; pureSequences: number; sequences: number; sets: number }
const rankValue = (card: PlayingCard): number => card.joker ? 0 : card.rank;
function isPrintedJoker(card: PlayingCard): boolean { return card.joker === true; }

function sequenceCheck(cards: PlayingCard[], wildRank: number): { valid: boolean; pure: boolean } {
  const jokers = cards.filter(c => isPrintedJoker(c) || (!c.joker && c.rank === wildRank));
  const naturals = cards.filter(c => !jokers.includes(c));
  if (naturals.length === 0 || cards.length < 3 || naturals.some(c => c.joker)) return { valid: false, pure: false };
  if (naturals.some(c => c.suit !== naturals[0]!.suit)) return { valid: false, pure: false };
  const rawValues = naturals.map(rankValue);
  if (new Set(rawValues).size !== rawValues.length) return { valid: false, pure: false };
  const aceModes = rawValues.some(v => v === 14) ? [rawValues, rawValues.map(v => v === 14 ? 1 : v)] : [rawValues];
  const canForm = aceModes.some(values => {
    const minStart = Math.max(1, Math.max(...values) - cards.length + 1);
    const maxStart = Math.min(14 - cards.length + 1, Math.min(...values));
    for (let start = minStart; start <= maxStart; start += 1) {
      const run = new Set(Array.from({ length: cards.length }, (_, i) => start + i));
      if (values.every(v => run.has(v)) && run.size - values.length === jokers.length) return true;
    }
    return false;
  });
  return { valid: canForm, pure: canForm && jokers.length === 0 };
}
function setCheck(cards: PlayingCard[], wildRank: number): boolean {
  if (cards.length < 3 || cards.length > 4) return false;
  const jokers = cards.filter(c => isPrintedJoker(c) || (!c.joker && c.rank === wildRank));
  const naturals = cards.filter(c => !jokers.includes(c));
  if (!naturals.length) return false;
  const rank = naturals[0]!.rank;
  return naturals.every(c => !c.joker && c.rank === rank) && new Set(naturals.map(c => c.suit)).size === naturals.length && naturals.length + jokers.length <= 4;
}

export function classifyRummyGroup(cards: readonly PlayingCard[], wildRank: number): "pure-sequence" | "impure-sequence" | "set" | null {
  const group = [...cards];
  const sequence = sequenceCheck(group, wildRank);
  if (sequence.valid) return sequence.pure ? "pure-sequence" : "impure-sequence";
  return setCheck(group, wildRank) ? "set" : null;
}

export function validateIndianRummyDeclaration(cards: readonly PlayingCard[], groups: readonly RummyGroup[], wildRank: number): RummyValidation {
  const errors: string[] = [];
  if (cards.length !== 13) errors.push("A valid declaration must contain exactly 13 cards.");
  const allIds = cards.map(c => c.id);
  if (new Set(allIds).size !== allIds.length) errors.push("The hand contains duplicate card identities.");
  const byId = new Map(cards.map(c => [c.id, c]));
  const used: string[] = groups.flatMap(g => g.cardIds);
  if (used.length !== cards.length || new Set(used).size !== used.length || used.some(id => !byId.has(id))) errors.push("Every card must appear exactly once across the groups.");
  let sequences = 0, pureSequences = 0, sets = 0;
  for (const group of groups) {
    const groupCards = group.cardIds.map(id => byId.get(id)).filter((c): c is PlayingCard => Boolean(c));
    if (groupCards.length < 3) { errors.push("Every sequence or set must contain at least three cards."); continue; }
    const seq = sequenceCheck(groupCards, wildRank);
    if (seq.valid) { sequences += 1; if (seq.pure) pureSequences += 1; }
    else if (setCheck(groupCards, wildRank)) sets += 1;
    else errors.push(`Group ${group.cardIds.join(", ")} is neither a valid sequence nor a valid set.`);
  }
  if (sequences < 2) errors.push("At least two sequences are required.");
  if (pureSequences < 1) errors.push("At least one pure sequence is required.");
  return { valid: errors.length === 0, errors, pureSequences, sequences, sets };
}

export function validateRummy10Declaration(cards: readonly PlayingCard[], groups: readonly RummyGroup[], wildRank: number): RummyValidation {
  const errors: string[] = [];
  if (cards.length !== 10) errors.push("A 3-3-4 declaration must contain exactly 10 cards.");
  if (new Set(cards.map(c => c.id)).size !== cards.length) errors.push("The hand contains duplicate card identities.");
  const byId = new Map(cards.map(c => [c.id, c]));
  const sizes = groups.map(g => g.cardIds.length).sort((a, b) => a - b);
  if (groups.length !== 3 || sizes.join(",") !== "3,3,4") errors.push("The declaration must contain exactly three sets sized 3, 3, and 4.");
  const used = groups.flatMap(g => g.cardIds);
  if (used.length !== 10 || new Set(used).size !== used.length || used.some(id => !byId.has(id))) errors.push("Every card must appear exactly once across the three sets.");
  let sets = 0;
  for (const group of groups) {
    const groupCards = group.cardIds.map(id => byId.get(id)).filter((c): c is PlayingCard => Boolean(c));
    if (groupCards.length < 3 || groupCards.length > 4) continue;
    if (setCheck(groupCards, wildRank)) sets += 1;
    else errors.push("Each group must be a same-rank set with distinct suits; runs are not accepted.");
  }
  if (sets !== 3) errors.push("All three groups must be valid sets.");
  return { valid: errors.length === 0, errors, pureSequences: 0, sequences: 0, sets };
}

export interface RummyPlayer { id: PlayerId; hand: PlayingCard[]; points: number; dropped: boolean }
export function rummyCardPoints(card: PlayingCard): number {
  if (card.joker) return 0;
  return card.rank >= 10 || card.rank === 14 ? 10 : card.rank;
}
export function calculateRummyPenalty(cards: readonly PlayingCard[], gameId: RummyState["gameId"]): number {
  const total = cards.reduce((sum, card) => sum + rummyCardPoints(card), 0);
  return gameId === "rummy-13" ? Math.min(80, total) : total;
}
export interface RummyState {
  gameId: "rummy-13" | "rummy-10"; status: "draw" | "discard" | "complete";
  players: RummyPlayer[]; drawPile: PlayingCard[]; drawPileCount?: number; discardPile: PlayingCard[]; wildRank: number; wildIndicator?: PlayingCard;
  currentIndex: number; handSize: 10 | 13; winnerId?: PlayerId; lastDeclaration?: RummyValidation;
  history: Array<{ playerId: PlayerId; action: string; cardId?: string }>;
}

export function createRummyGame(gameId: "rummy-13" | "rummy-10", playerIds: PlayerId[], random: RandomSource = Math.random): RummyState {
  if (playerIds.length < 2 || playerIds.length > 6) throw new RangeError("Rummy supports 2–6 players");
  const handSize = gameId === "rummy-13" ? 13 : 10;
  const decksNeeded = Math.ceil((playerIds.length * handSize + 3) / 54);
  const deck = shuffle(createDeck({ jokers: 2, decks: Math.max(1, decksNeeded) }), random);
  const players = playerIds.map(id => ({ id, hand: [] as PlayingCard[], points: 0, dropped: false }));
  for (let n = 0; n < handSize; n += 1) for (const p of players) p.hand.push(deck.shift()!);
  const firstDiscard = deck.shift()!;
  const indicatorIndex = deck.findIndex(c => !c.joker);
  const indicator = indicatorIndex >= 0 ? deck.splice(indicatorIndex, 1)[0]! : deck.shift()!;
  return { gameId, status: "draw", players, drawPile: deck, discardPile: [firstDiscard], wildRank: indicator.rank || 14, wildIndicator: indicator, currentIndex: 0, handSize, history: [] };
}

export function drawRummyCard(state: RummyState, playerId: PlayerId, source: "stock" | "discard"): RummyState {
  if (state.status !== "draw") throw new Error("Player must be in the draw phase");
  const player = state.players[state.currentIndex]; if (!player || player.id !== playerId || player.dropped) throw new Error("Not this player's turn");
  const next = structuredClone(state); const target = next.players[next.currentIndex]!;
  const card = source === "stock" ? next.drawPile.shift() : next.discardPile.pop();
  if (!card) throw new Error("Selected pile is empty");
  target.hand.push(card); next.status = "discard"; next.history.push({ playerId, action: `draw-${source}`, cardId: card.id });
  return next;
}
export function discardRummyCard(state: RummyState, playerId: PlayerId, cardId: string, random: RandomSource = Math.random): RummyState {
  if (state.status !== "discard") throw new Error("Draw a card before discarding");
  const player = state.players[state.currentIndex]; if (!player || player.id !== playerId) throw new Error("Not this player's turn");
  const next = structuredClone(state); const target = next.players[next.currentIndex]!;
  if (target.hand.length !== next.handSize + 1) throw new Error("Hand must contain one extra card before discard");
  const index = target.hand.findIndex(c => c.id === cardId); if (index < 0) throw new Error("Card is not in this hand");
  const [card] = target.hand.splice(index, 1); next.discardPile.push(card!);
  next.history.push({ playerId, action: "discard", cardId }); next.currentIndex = (next.currentIndex + 1) % next.players.length; next.status = "draw";
  if (next.drawPile.length === 0) {
    const top = next.discardPile.pop();
    next.drawPile = shuffle(next.discardPile, random);
    next.discardPile = top ? [top] : [];
  }
  return next;
}
export function declareRummy(state: RummyState, playerId: PlayerId, groups: RummyGroup[]): RummyState {
  if (state.status !== "discard") throw new Error("Draw a card before making a declaration");
  const player = state.players[state.currentIndex];
  if (!player || player.id !== playerId || player.dropped) throw new Error("Not this player's turn");
  if (player.hand.length !== state.handSize + 1) throw new Error("A declaration requires the drawn card and one final discard");

  const groupedIds = groups.flatMap(group => group.cardIds);
  const groupedSet = new Set(groupedIds);
  const declarationCards = player.hand.filter(card => groupedSet.has(card.id));
  const ungroupedCards = player.hand.filter(card => !groupedSet.has(card.id));
  const completeGrouping = groupedIds.length === state.handSize && groupedSet.size === state.handSize
    && declarationCards.length === state.handSize && ungroupedCards.length === 1;
  const validation = state.gameId === "rummy-13"
    ? validateIndianRummyDeclaration(declarationCards, groups, state.wildRank)
    : validateRummy10Declaration(declarationCards, groups, state.wildRank);
  if (!completeGrouping) {
    validation.valid = false;
    validation.errors.push(`Group exactly ${state.handSize} cards and leave one card to discard.`);
  }

  const next = structuredClone(state);
  next.lastDeclaration = validation;
  if (validation.valid) {
    const winner = next.players.find(p => p.id === playerId)!;
    const extraCard = winner.hand.find(card => !groupedSet.has(card.id))!;
    winner.hand = winner.hand.filter(card => card.id !== extraCard.id);
    next.discardPile.push(extraCard);
    next.status = "complete";
    next.winnerId = playerId;
    for (const contender of next.players) {
      if (contender.id === playerId) contender.points = 0;
      else {
        const handPenalty = calculateRummyPenalty(contender.hand, next.gameId);
        contender.points = next.gameId === "rummy-13" ? Math.min(80, contender.points + handPenalty) : Math.max(contender.points, handPenalty);
      }
    }
    next.history.push({ playerId, action: "valid-declaration", cardId: extraCard.id });
  } else {
    const failed = next.players.find(p => p.id === playerId)!;
    const penalty = next.gameId === "rummy-13" ? 80 : calculateRummyPenalty(failed.hand, next.gameId);
    failed.points = next.gameId === "rummy-13" ? Math.min(80, failed.points + penalty) : failed.points + penalty;
    next.history.push({ playerId, action: "invalid-declaration" });
  }
  return next;
}

export function isCard(card: PlayingCard): card is Card { return !card.joker; }
