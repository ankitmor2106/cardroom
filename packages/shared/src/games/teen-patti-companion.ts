import { createDeck, type Card, type PlayingCard } from "../cards.js";
import type { PlayerId } from "../contracts.js";
import { compareTeenPatti, evaluateTeenPatti, teenPattiShowCost, teenPattiWagerBounds, type TeenPattiRank } from "./teenPatti.js";

/**
 * Offline Teen Patti uses boot + opening wager -> repeated blind/seen betting ->
 * private physical-card entry after betting closes -> showdown. The app never stores
 * or reveals card identities during betting; card entry only unlocks after max pot,
 * a heads-up show, or last-player-standing ends the betting phase.
 *
 * House-rule choices for this implementation:
 * - blind wager range: 1x–2x the current stake;
 * - seen/chaal wager range: 2x–4x the current stake;
 * - a blind wager becomes the next current stake; a seen chaal halves the next stake;
 * - sideshow is available only after every active player has seen, against the previous seen
 *   bettor while at least three players remain; the requester pays 2x immediately;
 * - the weaker hand packs on an accepted sideshow; a tie makes the requester pack;
 * - show is available only heads-up, costs 1x for a blind caller or 2x for a seen caller,
 *   and a tied show is lost by the player who requested it.
 */
export type TeenPattiCompanionStage = "opening" | "playing" | "dealing" | "complete";
export type TeenPattiCompanionOutcome = "winner" | "shared" | "lost" | "folded";
export type TeenPattiCompanionAction = "blind" | "chaal" | "pack" | "show" | "sideshow";
export interface TeenPattiCompanionStats { roundsPlayed: number; wins: number; losses: number; netChips: number }
export interface TeenPattiCompanionPlayer {
  id: PlayerId;
  name: string;
  wallet: number;
  stats: TeenPattiCompanionStats;
  /** Total chips contributed to the pot, including the boot. */
  bet: number;
  betConfirmed: boolean;
  cards: Card[];
  seen: boolean;
  folded: boolean;
  foldReason?: string;
  rank?: TeenPattiRank;
  outcome?: TeenPattiCompanionOutcome;
  payout?: number;
  netChange?: number;
  reason?: string;
}
export interface TeenPattiCompanionState {
  gameId: "teen-patti-companion";
  stage: TeenPattiCompanionStage;
  roundNumber: number;
  bootAmount: number;
  maxPot: number;
  players: TeenPattiCompanionPlayer[];
  pot: number;
  /** Index of the next player who must post the fixed boot. */
  bettingIndex: number;
  dealingPlayerIndex: number;
  /** Index of the next player to act during blind/seen betting. */
  turnIndex: number;
  currentStake: number;
  lastActionPlayerId?: PlayerId;
  pendingSideshow?: { requesterId: PlayerId; targetId: PlayerId };
  /** Set when a heads-up show closes betting; tied hands then lose for the caller. */
  showCallerId?: PlayerId;
  completionReason?: "max-pot" | "show" | "last-player";
  usedCardIds: string[];
  winnerIds: PlayerId[];
  history: Array<{ type: "boot" | "action" | "sideshow-request" | "sideshow-response" | "card" | "settlement"; playerId?: PlayerId; action?: string; amount?: number; cardId?: string; accepted?: boolean }>;
}

const physicalCards = new Map(createDeck().filter((card): card is Card => !card.joker).map(card => [card.id, card]));
const clone = <T,>(value: T): T => structuredClone(value);
const validChipAmount = (amount: number) => Number.isSafeInteger(amount) && amount >= 0;

function validatePlayers(players: Array<{ id: PlayerId; name: string; wallet: number }>, bootAmount: number, maxPot: number): void {
  if (players.length < 2 || players.length > 6) throw new RangeError("Teen Patti supports 2–6 players");
  if (new Set(players.map(player => player.id)).size !== players.length) throw new RangeError("Player IDs must be unique");
  if (!Number.isSafeInteger(bootAmount) || bootAmount < 1) throw new RangeError("Starting boot must be a positive whole number");
  // The privacy-first offline flow collects the boot and one opening wager
  // (blind or seen) before the card-entry screen is unlocked.
  if (!Number.isSafeInteger(maxPot) || maxPot < bootAmount * 2 * players.length) throw new RangeError("Maximum pot must cover every player's boot and minimum opening blind wager");
  for (const player of players) {
    if (!player.name.trim() || player.name.trim().length > 20) throw new RangeError("Player names must be 1–20 characters");
    if (!Number.isSafeInteger(player.wallet) || player.wallet < bootAmount * 2 || player.wallet > 1_000_000_000) throw new RangeError(`${player.name} needs at least ${bootAmount * 2} chips for the boot and minimum opening blind wager`);
  }
}

export function createTeenPattiCompanion(
  players: Array<{ id: PlayerId; name: string; wallet: number; stats?: Partial<TeenPattiCompanionStats> }>,
  options: { bootAmount?: number; maxPot?: number } = {},
  roundNumber = 1,
): TeenPattiCompanionState {
  const bootAmount = options.bootAmount ?? 10;
  const maxPot = options.maxPot ?? Math.max(10_000, bootAmount * 2 * players.length);
  validatePlayers(players, bootAmount, maxPot);
  return {
    gameId: "teen-patti-companion", stage: "opening", roundNumber, bootAmount, maxPot,
    players: players.map(player => ({
      id: player.id, name: player.name.trim(), wallet: player.wallet,
      stats: { roundsPlayed: player.stats?.roundsPlayed ?? 0, wins: player.stats?.wins ?? 0, losses: player.stats?.losses ?? 0, netChips: player.stats?.netChips ?? 0 },
      bet: 0, betConfirmed: false, cards: [], seen: false, folded: false,
    })),
    pot: 0, bettingIndex: 0, dealingPlayerIndex: 0, turnIndex: 0, currentStake: bootAmount,
    usedCardIds: [], winnerIds: [], history: [],
  };
}

function activePlayers(state: TeenPattiCompanionState): TeenPattiCompanionPlayer[] { return state.players.filter(player => !player.folded); }
function previousActiveSeenBettor(state: TeenPattiCompanionState, excludingPlayerId: PlayerId): PlayerId | undefined {
  for (const event of [...state.history].reverse()) {
    if (!event.playerId || event.playerId === excludingPlayerId) continue;
    const isBetAction = (event.type === "action" && (event.action === "blind" || event.action === "chaal" || event.action === "seen-opening")) || event.type === "sideshow-request";
    if (!isBetAction) continue;
    const candidate = state.players.find(player => player.id === event.playerId);
    if (candidate && candidate.seen && !candidate.folded) return candidate.id;
  }
  return undefined;
}
function currentOpeningPlayer(state: TeenPattiCompanionState): TeenPattiCompanionPlayer {
  const player = state.players[state.bettingIndex];
  if (!player || player.betConfirmed) throw new Error("No player is waiting to place the opening wager");
  return player;
}
function currentActor(state: TeenPattiCompanionState): TeenPattiCompanionPlayer {
  if (state.stage !== "playing") throw new Error("Teen Patti betting is not open");
  if (state.pendingSideshow) throw new Error("A sideshow response is required first");
  const player = state.players[state.turnIndex];
  if (!player || player.folded) throw new Error("No active player is waiting to act");
  return player;
}
function nextActiveIndex(state: TeenPattiCompanionState, fromIndex: number): number {
  for (let step = 1; step <= state.players.length; step += 1) {
    const index = (fromIndex + step) % state.players.length;
    if (!state.players[index]!.folded) return index;
  }
  return fromIndex;
}
function firstActiveIndex(state: TeenPattiCompanionState): number {
  const index = state.players.findIndex(player => !player.folded);
  return index < 0 ? 0 : index;
}
function moveToCardEntry(state: TeenPattiCompanionState, reason: "max-pot" | "show"): void {
  state.stage = "dealing";
  state.completionReason = reason;
  state.dealingPlayerIndex = firstActiveIndex(state);
  state.history.push({ type: "action", action: reason === "max-pot" ? "maximum-pot-reached" : "show-called" });
}
function stopBettingIfPotFull(state: TeenPattiCompanionState): void {
  if (state.pot >= state.maxPot && state.stage === "playing" && !state.pendingSideshow) {
    moveToCardEntry(state, "max-pot");
  }
}
function amountBounds(state: TeenPattiCompanionState, player: TeenPattiCompanionPlayer, seen = player.seen): { min: number; max: number } {
  const available = Math.max(0, Math.min(player.wallet, state.maxPot - state.pot));
  const standard = teenPattiWagerBounds(state.currentStake, seen, available);
  // When less than the normal minimum remains before the hard pot cap (or in a
  // short all-in), permit that exact remainder. This is the final cap contribution.
  if (available > 0 && standard.max < standard.min) return { min: available, max: available };
  return standard;
}

function openingWagerAvailable(state: TeenPattiCompanionState, player: TeenPattiCompanionPlayer, seen: boolean): number {
  const remaining = state.players.filter(item => !item.betConfirmed);
  const remainingCount = remaining.length;
  const futureWalletLimit = remaining
    .filter(item => item.id !== player.id)
    .reduce((limit, item) => Math.min(limit, item.wallet - state.bootAmount), Number.POSITIVE_INFINITY);
  const remainingPot = state.maxPot - state.pot;
  // A blind wager becomes the next stake; a seen chaal halves it. Reserve enough
  // for every later player to post their boot and at least the next blind stake.
  const potWagerLimit = seen
    ? Math.floor((2 * (remainingPot - remainingCount * state.bootAmount)) / (remainingCount + 1))
    : Math.floor(remainingPot / remainingCount - state.bootAmount);
  const futureWalletWagerLimit = seen ? futureWalletLimit * 2 : futureWalletLimit;
  return Math.max(0, Math.min(player.wallet - state.bootAmount, futureWalletWagerLimit, potWagerLimit));
}

/**
 * Each offline player posts the compulsory boot and an opening blind/seen wager
 * before any card identities are entered in the app. This privacy-first house
 * flow keeps all entered hands out of the shared device during opening betting.
 */
export function teenPattiCompanionPostOpeningBet(state: TeenPattiCompanionState, playerId: PlayerId, wager: number, seen = false): TeenPattiCompanionState {
  if (state.stage !== "opening") throw new Error("The opening betting phase is closed");
  const current = currentOpeningPlayer(state);
  if (current.id !== playerId) throw new Error(`Pass the device to ${current.name}`);
  const bounds = teenPattiWagerBounds(state.currentStake, seen, openingWagerAvailable(state, current, seen));
  if (!validChipAmount(wager) || wager < bounds.min || wager > bounds.max) {
    const kind = seen ? "seen opening chaal" : "blind opening wager";
    throw new RangeError(`Choose a ${kind} from ${bounds.min.toLocaleString("en-US")} to ${bounds.max.toLocaleString("en-US")} chips`);
  }
  const totalDebit = state.bootAmount + wager;
  if (current.wallet < totalDebit) throw new Error(`${current.name} does not have enough chips for the boot and opening wager`);
  if (state.pot + totalDebit > state.maxPot) throw new Error("The opening wager would exceed the maximum pot");
  const next = clone(state);
  const player = next.players[next.bettingIndex]!;
  player.wallet -= totalDebit;
  player.bet = totalDebit;
  player.betConfirmed = true;
  next.pot += totalDebit;
  next.history.push({ type: "boot", playerId, amount: next.bootAmount });
  next.history.push({ type: "action", playerId, action: seen ? "seen-opening" : "blind-opening", amount: wager });
  player.seen = seen;
  next.currentStake = seen ? wager / 2 : wager;
  next.lastActionPlayerId = playerId;
  const nextIndex = next.players.findIndex(item => !item.betConfirmed);
  if (nextIndex === -1) {
    if (next.pot >= next.maxPot) moveToCardEntry(next, "max-pot");
    else { next.stage = "playing"; next.turnIndex = firstActiveIndex(next); }
  } else next.bettingIndex = nextIndex;
  return next;
}

/** Legal opening blind or seen/chaal wager range for the prompted player. */
export function teenPattiCompanionOpeningBetBounds(state: TeenPattiCompanionState, playerId?: PlayerId, seen = false): { min: number; max: number; canAct: boolean } {
  if (state.stage !== "opening") return { min: 0, max: 0, canAct: false };
  const player = state.players[state.bettingIndex];
  if (!player || player.betConfirmed || (playerId && player.id !== playerId)) return { min: 0, max: 0, canAct: false };
  const bounds = teenPattiWagerBounds(state.currentStake, seen, openingWagerAvailable(state, player, seen));
  return { ...bounds, canAct: bounds.max >= bounds.min && bounds.min > 0 };
}

export function teenPattiCompanionSelectCard(state: TeenPattiCompanionState, cardId: string): TeenPattiCompanionState {
  if (state.stage !== "dealing") throw new Error("Card entry opens only after betting is finished and the pot cap or a show has ended betting");
  const card = physicalCards.get(cardId);
  if (!card) throw new Error("Choose a valid card from a standard 52-card deck");
  if (state.usedCardIds.includes(cardId)) throw new Error("That physical card has already been entered");
  const player = state.players[state.dealingPlayerIndex];
  if (!player || player.folded) throw new Error("No active player is waiting for cards");
  if (player.cards.length >= 3) throw new Error("This player already has three cards");
  const next = clone(state);
  const target = next.players[next.dealingPlayerIndex]!;
  target.cards.push(card);
  next.usedCardIds.push(cardId);
  next.history.push({ type: "card", playerId: target.id, cardId });
  if (target.cards.length === 3) {
    const nextIndex = next.players.findIndex((item, index) => index > next.dealingPlayerIndex && !item.folded && item.cards.length < 3);
    if (nextIndex !== -1) next.dealingPlayerIndex = nextIndex;
    else {
      const wrappedIndex = next.players.findIndex((item, index) => index < next.dealingPlayerIndex && !item.folded && item.cards.length < 3);
      if (wrappedIndex !== -1) next.dealingPlayerIndex = wrappedIndex;
      else return settleShowdown(next, next.showCallerId);
    }
  }
  return next;
}

function rankDescription(rank: TeenPattiRank): string {
  const top = rank.tuple;
  const label = rank.category === "trail" ? "Trail (three of a kind)"
    : rank.category === "pure-sequence" ? "Pure sequence (straight flush)"
    : rank.category === "sequence" ? "Sequence (straight)"
    : rank.category === "color" ? "Color (flush)"
    : rank.category === "pair" ? "Pair"
    : "High card";
  const rankName = (value: number) => value === 14 ? "Ace" : value === 13 ? "King" : value === 12 ? "Queen" : value === 11 ? "Jack" : String(value);
  const sequenceName = (value: number) => value === 15 ? "A–2–3 high" : value === 14 ? "A–K–Q high" : `${rankName(value)} high`;
  if (rank.category === "trail") return `${rankName(top[1] ?? 2)}s`;
  if (rank.category === "pair") return `Pair of ${rankName(top[1] ?? 2)}s`;
  if (rank.category === "pure-sequence" || rank.category === "sequence") return `${label} · ${sequenceName(top[1] ?? 2)}`;
  const ranks = top.slice(1).map(rankName).join("–");
  return ranks ? `${label} · ${ranks}` : label;
}
export function teenPattiCompanionRankLabel(rank: TeenPattiRank): string { return rankDescription(rank); }

function settleByFold(state: TeenPattiCompanionState, winner: TeenPattiCompanionPlayer): TeenPattiCompanionState {
  const next = clone(state);
  const winnerOnNext = next.players.find(player => player.id === winner.id)!;
  const payout = next.pot;
  winnerOnNext.wallet += payout;
  next.winnerIds = [winner.id];
  for (const player of next.players) {
    const isWinner = player.id === winner.id;
    player.payout = isWinner ? payout : 0;
    player.netChange = player.payout - player.bet;
    player.outcome = isWinner ? "winner" : "folded";
    player.reason = isWinner ? "Won because every other player packed. No showdown was needed." : (player.foldReason ?? `Packed and forfeited ${player.bet.toLocaleString("en-US")} chips to the pot.`);
    player.stats.roundsPlayed += 1;
    if (isWinner) player.stats.wins += 1; else player.stats.losses += 1;
    player.stats.netChips += player.netChange;
  }
  next.stage = "complete";
  next.completionReason = "last-player";
  next.history.push({ type: "settlement", action: "last-player-standing" });
  return next;
}

function settleShowdown(state: TeenPattiCompanionState, callerId?: PlayerId): TeenPattiCompanionState {
  const next = clone(state);
  const ranked = activePlayers(next).map(player => ({ playerId: player.id, rank: evaluateTeenPatti(player.cards) }));
  if (!ranked.length) throw new Error("There are no active players to settle");
  const best = ranked.reduce((top, item) => compareTeenPatti(item.rank, top.rank) > 0 ? item : top, ranked[0]!);
  let winners = ranked.filter(item => compareTeenPatti(item.rank, best.rank) === 0);
  const tiedAtShow = Boolean(callerId) && ranked.length === 2 && winners.length === 2;
  if (tiedAtShow && callerId) winners = ranked.filter(item => item.playerId !== callerId);
  const winnerIds = winners.map(item => item.playerId);
  const share = Math.floor(next.pot / winners.length);
  let remainder = next.pot - share * winners.length;
  const winnerNames = winners.map(item => next.players.find(player => player.id === item.playerId)!.name);
  for (const player of next.players) {
    const entry = ranked.find(item => item.playerId === player.id);
    const isWinner = winnerIds.includes(player.id);
    const payout = isWinner ? share + (remainder-- > 0 ? 1 : 0) : 0;
    player.wallet += payout;
    if (entry) player.rank = entry.rank; else delete player.rank;
    player.outcome = player.folded ? "folded" : isWinner ? (winners.length > 1 ? "shared" : "winner") : "lost";
    player.payout = payout;
    player.netChange = payout - player.bet;
    player.stats.roundsPlayed += 1;
    if (isWinner) player.stats.wins += 1; else player.stats.losses += 1;
    player.stats.netChips += player.netChange;
    player.reason = player.folded
      ? (player.foldReason ?? `Packed before showdown and forfeited ${player.bet.toLocaleString("en-US")} chips.`)
      : tiedAtShow && player.id === callerId
        ? "The hands tied at the show. Under this table's rule, the player who called the show loses the tie."
        : isWinner
        ? winners.length > 1 ? `Tied for the strongest hand (${rankDescription(best.rank)}) with ${winnerNames.filter(name => name !== player.name).join(", ")}.` : `Highest hand at showdown: ${rankDescription(best.rank)}.`
        : `Beaten by ${winnerNames.join(" and ")}: your ${rankDescription(entry!.rank)} ranked below ${rankDescription(best.rank)}.`;
  }
  next.winnerIds = winnerIds;
  next.stage = "complete";
  next.completionReason = state.completionReason ?? (callerId ? "show" : "max-pot");
  next.history.push({ type: "settlement", action: "showdown" });
  return next;
}

function finishIfOneLeft(state: TeenPattiCompanionState): TeenPattiCompanionState | null {
  const remaining = activePlayers(state);
  if (remaining.length === 1) return settleByFold(state, remaining[0]!);
  return null;
}

function moveAfter(state: TeenPattiCompanionState, playerId: PlayerId): void {
  const index = state.players.findIndex(player => player.id === playerId);
  state.turnIndex = nextActiveIndex(state, index);
}

export function teenPattiCompanionBetBounds(state: TeenPattiCompanionState, playerId?: PlayerId): { min: number; max: number; canAct: boolean; seen: boolean } {
  if (state.stage !== "playing" || state.pendingSideshow) return { min: 0, max: 0, canAct: false, seen: false };
  const player = state.players[state.turnIndex];
  if (!player || (playerId && player.id !== playerId) || player.folded) return { min: 0, max: 0, canAct: false, seen: Boolean(player?.seen) };
  const bounds = amountBounds(state, player);
  return { ...bounds, canAct: bounds.max >= bounds.min, seen: player.seen };
}
/** Wager range for the current actor when choosing to remain blind or switch to seen. */
export function teenPattiCompanionActionBounds(state: TeenPattiCompanionState, playerId: PlayerId, seen: boolean): { min: number; max: number; canAct: boolean } {
  if (state.stage !== "playing" || state.pendingSideshow) return { min: 0, max: 0, canAct: false };
  const player = state.players[state.turnIndex];
  if (!player || player.id !== playerId || player.folded || (player.seen && !seen)) return { min: 0, max: 0, canAct: false };
  const bounds = amountBounds(state, player, seen);
  return { ...bounds, canAct: bounds.max >= bounds.min && bounds.max > 0 };
}

export function teenPattiCompanionAct(
  state: TeenPattiCompanionState,
  playerId: PlayerId,
  action: TeenPattiCompanionAction,
  amount?: number,
): TeenPattiCompanionState {
  const current = currentActor(state);
  if (current.id !== playerId) throw new Error(`It is ${current.name}'s turn`);
  const next = clone(state);
  const player = next.players[next.turnIndex]!;
  const activeCount = activePlayers(next).length;

  if (action === "pack") {
    player.folded = true;
    player.foldReason = "Packed voluntarily and forfeited the chips already contributed to the pot.";
    if (next.lastActionPlayerId === playerId) {
      const previousBettor = previousActiveSeenBettor(next, playerId);
      if (previousBettor) next.lastActionPlayerId = previousBettor;
      else delete next.lastActionPlayerId;
    }
    next.history.push({ type: "action", playerId, action });
    const finished = finishIfOneLeft(next);
    if (finished) return finished;
    // Packing is not a wager; preserve the previous bettor for sideshow eligibility.
    moveAfter(next, playerId);
    return next;
  }

  if (action === "sideshow") {
    if (!player.seen) throw new Error("Only a seen player can request a sideshow");
    if (activeCount < 3) throw new Error("Sideshow is only available with at least three active players");
    if (!activePlayers(next).every(active => active.seen)) throw new Error("A sideshow is available only after every active player has seen their cards");
    const previous = next.players.find(item => item.id === next.lastActionPlayerId);
    if (!previous || previous.folded || !previous.seen || previous.id === playerId) throw new Error("The immediately previous betting player must also be seen");
    const cost = next.currentStake * 2;
    if (player.wallet < cost) throw new Error("Not enough chips to pay for the sideshow");
    if (next.pot + cost > next.maxPot) throw new Error("The sideshow stake would exceed the maximum pot");
    player.wallet -= cost;
    player.bet += cost;
    next.pot += cost;
    // Requesting a sideshow is itself the minimum seen wager; its half-stake remains unchanged.
    next.lastActionPlayerId = playerId;
    next.pendingSideshow = { requesterId: playerId, targetId: previous.id };
    next.turnIndex = next.players.findIndex(item => item.id === previous.id);
    next.history.push({ type: "sideshow-request", playerId, action: "sideshow", amount: cost });
    return next;
  }

  if (action === "show") {
    if (activeCount !== 2) throw new Error("Show is available only when exactly two players remain");
    const opponent = activePlayers(next).find(item => item.id !== playerId)!;
    const cost = teenPattiShowCost(next.currentStake, player.seen, opponent.seen);
    if (cost === null) throw new Error("A seen player cannot request a show against a blind player");
    if (player.wallet < cost) throw new Error("Not enough chips to pay for a show; pack instead");
    if (next.pot + cost > next.maxPot) throw new Error("The maximum pot would be exceeded; use a cap wager instead");
    player.wallet -= cost; player.bet += cost; next.pot += cost;
    next.history.push({ type: "action", playerId, action, amount: cost });
    next.showCallerId = playerId;
    moveToCardEntry(next, "show");
    return next;
  }

  const isSeenAction = action === "chaal";
  if (action === "blind" && player.seen) throw new Error("A seen player cannot switch back to blind");
  const bounds = amountBounds(next, player, player.seen || isSeenAction);
  const wager = amount ?? bounds.min;
  if (!validChipAmount(wager) || wager < bounds.min || wager > bounds.max) throw new RangeError(`Choose a wager from ${bounds.min.toLocaleString("en-US")} to ${bounds.max.toLocaleString("en-US")} chips`);
  if ((player.seen || isSeenAction) && wager % 2 !== 0 && next.pot + wager < next.maxPot) {
    throw new RangeError("Seen chaal must use an even number of chips so the next blind stake stays whole; an odd final cap contribution is allowed because betting ends immediately");
  }
  player.wallet -= wager;
  player.bet += wager;
  next.pot += wager;
  if (isSeenAction) player.seen = true;
  // Traditional rule: blind wager becomes next stake; seen wager is halved.
  next.currentStake = isSeenAction ? Math.floor(wager / 2) : wager;
  next.history.push({ type: "action", playerId, action, amount: wager });
  next.lastActionPlayerId = playerId;
  moveAfter(next, playerId);
  stopBettingIfPotFull(next);
  return next;
}

export function teenPattiCompanionRespondSideshow(state: TeenPattiCompanionState, targetId: PlayerId, accept: boolean, weakerPlayerId?: PlayerId | "tie"): TeenPattiCompanionState {
  const request = state.pendingSideshow;
  if (state.stage !== "playing" || !request) throw new Error("There is no sideshow waiting for a response");
  if (request.targetId !== targetId) throw new Error("Only the requested player can respond to this sideshow");
  const next = clone(state);
  const requester = next.players.find(player => player.id === request.requesterId)!;
  const target = next.players.find(player => player.id === request.targetId)!;
  delete next.pendingSideshow;
  next.history.push({ type: "sideshow-response", playerId: targetId, action: accept ? "accept" : "decline", accepted: accept });
  if (accept) {
    if (!weakerPlayerId || (weakerPlayerId !== requester.id && weakerPlayerId !== target.id && weakerPlayerId !== "tie")) {
      throw new Error("Compare the physical hands and select who has the weaker hand (or choose tie)");
    }
    // The players compare their real cards at the table. Card identities are
    // deliberately not entered into the app until all betting has ended.
    const requesterPacks = weakerPlayerId === requester.id || weakerPlayerId === "tie";
    if (requesterPacks) {
      requester.folded = true;
      requester.foldReason = weakerPlayerId === "tie"
        ? "The physical sideshow hands tied. Under this table's rule, the requester packs."
        : "The physical sideshow comparison showed the requester had the weaker hand, so the requester packed.";
      next.lastActionPlayerId = target.id;
    } else {
      target.folded = true;
      target.foldReason = "The physical sideshow comparison showed this player had the weaker hand, so this player packed.";
    }
    next.history.push({ type: "action", playerId: requester.id, action: weakerPlayerId === "tie" ? "sideshow-tie-requester-packed" : requesterPacks ? "sideshow-requester-weaker-packed" : "sideshow-target-weaker-packed" });
    const finished = finishIfOneLeft(next);
    if (finished) return finished;
  }
  // The requester paid the sideshow stake when asking; continue after that player's turn.
  moveAfter(next, requester.id);
  stopBettingIfPotFull(next);
  return next;
}

/** Backward-compatible helper retained for existing components/tests. */
export function teenPattiCompanionMaxBet(state: TeenPattiCompanionState): number {
  const bounds = teenPattiCompanionBetBounds(state);
  return bounds.max;
}

export function teenPattiCompanionNextRound(state: TeenPattiCompanionState): TeenPattiCompanionState {
  if (state.stage !== "complete") throw new Error("Finish the current round first");
  return createTeenPattiCompanion(state.players.map(player => ({ id: player.id, name: player.name, wallet: player.wallet, stats: player.stats })), { bootAmount: state.bootAmount, maxPot: state.maxPot }, state.roundNumber + 1);
}

export function teenPattiCompanionCardChoices(): Card[] { return [...physicalCards.values()]; }
export function teenPattiCompanionCardById(cardId: string): PlayingCard | undefined { return physicalCards.get(cardId); }
