import { createDeck, shuffle, type Card, type RandomSource } from "../cards.js";
import type { PlayerId } from "../contracts.js";

export type TeenPattiCategory = "high-card" | "pair" | "color" | "sequence" | "pure-sequence" | "trail";
export interface TeenPattiRank { category: TeenPattiCategory; tuple: number[] }
export interface TeenPattiPlayer { id: PlayerId; chips: number; cards: Card[]; seen: boolean; folded: boolean; contribution: number; foldReason?: string }
export interface TeenPattiSettlement {
  playerId: PlayerId;
  outcome: "winner" | "shared" | "lost" | "folded";
  payout: number;
  net: number;
  rank?: TeenPattiRank;
  reason: string;
}
export interface TeenPattiState {
  gameId: "teen-patti";
  status: "playing" | "complete";
  players: TeenPattiPlayer[];
  /** Server-only undealt cards. Never include in player snapshots. */
  deck: Card[];
  pot: number;
  boot: number;
  /** Blind stake. A seen wager is 2x–4x this value and sets the next blind stake to half the wager. */
  currentStake: number;
  turnIndex: number;
  /** Safety ceiling for pathological rounds; normal play ends by pack or show. */
  maxTurns: number;
  turns: number;
  lastActionPlayerId?: PlayerId;
  pendingSideshow?: { requesterId: PlayerId; targetId: PlayerId };
  winnerId?: PlayerId;
  winnerIds?: PlayerId[];
  result?: { playerId: PlayerId; rank: TeenPattiRank }[];
  settlement?: TeenPattiSettlement[];
  history: Array<{ playerId?: PlayerId; action: string; amount?: number; accepted?: boolean }>;
}
export type TeenPattiAction = "blind" | "chaal" | "fold" | "pack" | "show" | "sideshow" | "sideshow-accept" | "sideshow-decline";

/** Classic stake ranges. Seen wagers must be even so their half-stake remains a whole chip. */
export function teenPattiWagerBounds(currentStake: number, seen: boolean, available: number): { min: number; max: number } {
  const multiplier = seen ? 2 : 1;
  const min = currentStake * multiplier;
  const nominalMax = currentStake * multiplier * 2;
  let max = Math.max(0, Math.min(nominalMax, available));
  if (seen) max -= max % 2;
  return { min, max };
}

/** A seen player cannot demand a show against a blind player. */
export function teenPattiShowCost(currentStake: number, callerSeen: boolean, opponentSeen: boolean): number | null {
  if (callerSeen && !opponentSeen) return null;
  return currentStake * (callerSeen ? 2 : 1);
}

function sequenceHigh(ranks: number[]): number | null {
  const sorted = [...new Set(ranks)].sort((a, b) => b - a);
  if (sorted.length !== 3) return null;
  if (sorted[0] === 14 && sorted[1] === 3 && sorted[2] === 2) return 15; // A-2-3 is highest
  if (sorted[0] === 14 && sorted[1] === 13 && sorted[2] === 12) return 14; // A-K-Q is next
  return sorted[0]! - sorted[2]! === 2 ? sorted[0]! : null;
}

export function evaluateTeenPatti(cards: readonly Card[]): TeenPattiRank {
  if (cards.length !== 3) throw new RangeError("Teen Patti hand must contain three cards");
  const ranks = cards.map(card => card.rank).sort((a, b) => b - a);
  const sameSuit = cards.every(card => card.suit === cards[0]!.suit);
  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const repeated = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const sequence = sequenceHigh(ranks);
  if (repeated[0]![1] === 3) return { category: "trail", tuple: [6, ranks[0]!] };
  if (sameSuit && sequence !== null) return { category: "pure-sequence", tuple: [5, sequence] };
  if (sequence !== null) return { category: "sequence", tuple: [4, sequence] };
  if (sameSuit) return { category: "color", tuple: [3, ...ranks] };
  if (repeated[0]![1] === 2) return { category: "pair", tuple: [2, repeated[0]![0], ...ranks.filter(rank => rank !== repeated[0]![0])] };
  return { category: "high-card", tuple: [1, ...ranks] };
}

export function compareTeenPatti(a: TeenPattiRank, b: TeenPattiRank): number {
  for (let index = 0; index < Math.max(a.tuple.length, b.tuple.length); index += 1) {
    const difference = (a.tuple[index] ?? 0) - (b.tuple[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function activePlayers(state: TeenPattiState): TeenPattiPlayer[] { return state.players.filter(player => !player.folded); }

function previousActiveSeenBettor(state: TeenPattiState, excludingPlayerId: PlayerId): PlayerId | undefined {
  for (const event of [...state.history].reverse()) {
    if (!event.playerId || event.playerId === excludingPlayerId) continue;
    if (event.action !== "blind" && event.action !== "chaal" && event.action !== "sideshow-request") continue;
    const candidate = state.players.find(player => player.id === event.playerId);
    if (candidate && candidate.seen && !candidate.folded) return candidate.id;
  }
  return undefined;
}

export function teenPattiRankLabel(rank: TeenPattiRank): string {
  const valueName = (value: number) => value === 14 ? "Ace" : value === 13 ? "King" : value === 12 ? "Queen" : value === 11 ? "Jack" : String(value);
  if (rank.category === "trail") return `Trail of ${valueName(rank.tuple[1] ?? 2)}s`;
  if (rank.category === "pair") return `Pair of ${valueName(rank.tuple[1] ?? 2)}s`;
  const sequenceName = (value: number) => value === 15 ? "A–2–3 high" : value === 14 ? "A–K–Q high" : `${valueName(value)} high`;
  if (rank.category === "pure-sequence") return `Pure sequence · ${sequenceName(rank.tuple[1] ?? 2)}`;
  if (rank.category === "sequence") return `Sequence · ${sequenceName(rank.tuple[1] ?? 2)}`;
  if (rank.category === "color") return `Color · ${rank.tuple.slice(1).map(valueName).join("–")}`;
  return `High card · ${rank.tuple.slice(1).map(valueName).join("–")}`;
}

function buildSettlement(
  state: TeenPattiState,
  winnerIds: PlayerId[],
  ranks: Map<PlayerId, TeenPattiRank> = new Map(),
  reveal: boolean,
  tieCallerId?: PlayerId,
): void {
  const share = winnerIds.length ? Math.floor(state.pot / winnerIds.length) : 0;
  let remainder = winnerIds.length ? state.pot - share * winnerIds.length : 0;
  const winnerNames = winnerIds.map(id => id);
  state.settlement = state.players.map(player => {
    const rank = ranks.get(player.id);
    const isWinner = winnerIds.includes(player.id);
    const payout = isWinner ? share + (remainder-- > 0 ? 1 : 0) : 0;
    player.chips += payout;
    const outcome: TeenPattiSettlement["outcome"] = player.folded ? "folded" : isWinner ? (winnerIds.length > 1 ? "shared" : "winner") : "lost";
    const winnerLabel = winnerNames.join(" and ");
    const reason = player.folded
      ? (player.foldReason ?? "Packed before the round ended and forfeited all chips contributed to the pot.")
      : player.id === tieCallerId
        ? "The hands tied at the show. Under this table's rule, the player who called the show loses the tie."
        : isWinner
          ? winnerIds.length > 1 ? `Shared the pot with a tied top hand${rank ? ` (${teenPattiRankLabel(rank)})` : ""}.` : `Won the show with the strongest hand${rank ? `: ${teenPattiRankLabel(rank)}.` : "."}`
          : reveal && rank ? `Lost to ${winnerLabel}; your ${teenPattiRankLabel(rank)} ranked below the winning hand.` : `Lost the pot to ${winnerLabel}.`;
    return { playerId: player.id, outcome, payout, net: payout - player.contribution, ...(reveal && rank ? { rank } : {}), reason };
  });
}

function finishByFold(state: TeenPattiState, winner: TeenPattiPlayer): void {
  state.winnerId = winner.id;
  state.winnerIds = [winner.id];
  buildSettlement(state, [winner.id], new Map(), false);
  const winnerSettlement = state.settlement?.find(row => row.playerId === winner.id);
  if (winnerSettlement) winnerSettlement.reason = "Last player remaining; every other active player packed, so this player takes the pot without a show.";
  state.status = "complete";
}

function finishByShowdown(state: TeenPattiState, callerId?: PlayerId): void {
  const ranked = activePlayers(state)
    .map(player => ({ playerId: player.id, rank: evaluateTeenPatti(player.cards) }))
    .sort((a, b) => compareTeenPatti(b.rank, a.rank));
  if (!ranked.length) throw new Error("No active player remains for showdown");
  const best = ranked[0]!;
  let winners = ranked.filter(row => compareTeenPatti(row.rank, best.rank) === 0);
  let tieCallerId: PlayerId | undefined;
  if (callerId && ranked.length === 2 && winners.length === 2) {
    tieCallerId = callerId;
    winners = ranked.filter(row => row.playerId !== callerId);
  }
  state.winnerId = winners[0]!.playerId;
  state.winnerIds = winners.map(row => row.playerId);
  state.result = ranked;
  buildSettlement(state, state.winnerIds, new Map(ranked.map(row => [row.playerId, row.rank])), true, tieCallerId);
  state.status = "complete";
}

function nextTurn(state: TeenPattiState, fromIndex: number): void {
  const active = activePlayers(state);
  if (active.length <= 1) {
    const winner = active[0];
    if (winner) finishByFold(state, winner);
    return;
  }
  for (let step = 1; step <= state.players.length; step += 1) {
    const index = (fromIndex + step) % state.players.length;
    if (!state.players[index]!.folded) { state.turnIndex = index; return; }
  }
}

function validatePlayers(players: Array<{ id: PlayerId; chips: number }>, boot: number): void {
  if (players.length < 2 || players.length > 6) throw new RangeError("Teen Patti supports 2–6 players");
  if (new Set(players.map(player => player.id)).size !== players.length) throw new RangeError("Player IDs must be unique");
  if (!Number.isSafeInteger(boot) || boot < 1 || !Number.isSafeInteger(boot * players.length) || players.some(player => !Number.isSafeInteger(player.chips) || player.chips < boot)) {
    throw new RangeError("Invalid boot or chip balance");
  }
}

export function createTeenPattiGame(players: Array<{ id: PlayerId; chips: number }>, boot = 10, random: RandomSource = Math.random): TeenPattiState {
  validatePlayers(players, boot);
  const deck = shuffle(createDeck(), random).filter((card): card is Card => !card.joker);
  const result: TeenPattiState = {
    gameId: "teen-patti", status: "playing",
    players: players.map(player => ({ ...player, chips: player.chips - boot, cards: [], seen: false, folded: false, contribution: boot })),
    deck, pot: boot * players.length, boot, currentStake: boot, turnIndex: 0, maxTurns: 240, turns: 0, history: [],
  };
  // Deal one card at a time around the table, rather than three consecutively to each seat.
  for (let pass = 0; pass < 3; pass += 1) for (const player of result.players) player.cards.push(result.deck.shift()!);
  return result;
}

/** Authoritative turn/action resolver for classic blind/seen Teen Patti. */
export function teenPattiAction(state: TeenPattiState, playerId: PlayerId, action: TeenPattiAction, amount?: number): TeenPattiState {
  if (state.status !== "playing") throw new Error("Round is complete");
  const next = structuredClone(state);

  if (action === "sideshow-accept" || action === "sideshow-decline") {
    const request = next.pendingSideshow;
    if (!request || request.targetId !== playerId) throw new Error("There is no sideshow request for this player");
    const requester = next.players.find(player => player.id === request.requesterId)!;
    const target = next.players.find(player => player.id === request.targetId)!;
    delete next.pendingSideshow;
    const accept = action === "sideshow-accept";
    next.history.push({ playerId, action, accepted: accept });
    if (accept) {
      const comparison = compareTeenPatti(evaluateTeenPatti(requester.cards), evaluateTeenPatti(target.cards));
      // The lower hand packs; on equal cards, the requester packs.
      if (comparison <= 0) {
        requester.folded = true;
        requester.foldReason = comparison === 0
          ? "The sideshow hands tied. Under this table's rule, the player who requested the sideshow packs."
          : "The accepted sideshow showed a weaker hand than the target, so the requester packed.";
        next.lastActionPlayerId = target.id;
      } else {
        target.folded = true;
        target.foldReason = "The accepted sideshow showed this hand ranked below the requester, so this player packed.";
      }
      next.history.push({ playerId: requester.id, action: comparison === 0 ? "sideshow-tie-requester-packed" : comparison < 0 ? "sideshow-requester-weaker-packed" : "sideshow-target-weaker-packed", accepted: true });
      if (activePlayers(next).length === 1) {
        const winner = activePlayers(next)[0]!;
        finishByFold(next, winner);
        return next;
      }
    }
    // A declined or completed sideshow consumes the requester's action. Continue after them.
    nextTurn(next, next.players.findIndex(player => player.id === request.requesterId));
    return next;
  }

  const player = next.players[next.turnIndex];
  if (!player || player.id !== playerId || player.folded) throw new Error("Not this player's turn");
  const live = activePlayers(next);

  if (action === "fold" || action === "pack") {
    player.folded = true;
    player.foldReason = "Packed voluntarily and forfeited the chips already contributed to the pot.";
    if (next.lastActionPlayerId === playerId) {
      const previousBettor = previousActiveSeenBettor(next, playerId);
      if (previousBettor) next.lastActionPlayerId = previousBettor;
      else delete next.lastActionPlayerId;
    }
    next.history.push({ playerId, action: "pack" });
    if (activePlayers(next).length === 1) {
      finishByFold(next, activePlayers(next)[0]!);
      return next;
    }
    // A pack is not a bet and must not become the previous player for a sideshow.
    nextTurn(next, next.turnIndex);
    next.turns += 1;
    return next;
  }

  if (action === "sideshow") {
    if (!player.seen) throw new Error("Only a seen player can request a sideshow");
    if (live.length < 3) throw new Error("A sideshow requires at least three active players");
    if (!live.every(active => active.seen)) throw new Error("A sideshow is available only after every active player has seen their cards");
    const previous = next.players.find(item => item.id === next.lastActionPlayerId);
    if (!previous || previous.folded || !previous.seen || previous.id === playerId) throw new Error("The immediately previous betting player must also be seen");
    const cost = next.currentStake * 2;
    if (player.chips < cost) throw new Error("Not enough chips to pay for the sideshow");
    player.chips -= cost;
    player.contribution += cost;
    next.pot += cost;
    // A sideshow request is itself the minimum seen wager. Its half-stake is unchanged.
    next.lastActionPlayerId = playerId;
    next.pendingSideshow = { requesterId: playerId, targetId: previous.id };
    next.turnIndex = next.players.findIndex(item => item.id === previous.id);
    next.history.push({ playerId, action: "sideshow-request", amount: cost });
    next.turns += 1;
    return next;
  }

  if (action === "show") {
    if (live.length !== 2) throw new Error("A show is available only when exactly two players remain");
    const opponent = live.find(item => item.id !== playerId)!;
    const cost = teenPattiShowCost(next.currentStake, player.seen, opponent.seen);
    if (cost === null) throw new Error("A seen player cannot request a show against a blind player");
    if (player.chips < cost) throw new Error("Insufficient chips to show; pack instead");
    player.chips -= cost;
    player.contribution += cost;
    next.pot += cost;
    next.history.push({ playerId, action, amount: cost });
    finishByShowdown(next, playerId);
    return next;
  }

  if (action !== "blind" && action !== "chaal") throw new Error("Unsupported Teen Patti action");
  if (action === "blind" && player.seen) throw new Error("A seen player cannot switch back to blind");
  const seenAction = action === "chaal";
  const bounds = teenPattiWagerBounds(next.currentStake, player.seen || seenAction, player.chips);
  const wager = amount ?? bounds.min;
  if (!Number.isSafeInteger(wager) || wager < bounds.min || wager > bounds.max) {
    throw new RangeError(`Wager must be between ${bounds.min} and ${bounds.max} chips`);
  }
  if ((player.seen || seenAction) && wager % 2 !== 0) throw new RangeError("Seen chaal must use an even number of chips so the next blind stake stays whole");
  player.chips -= wager;
  player.contribution += wager;
  next.pot += wager;
  if (seenAction) player.seen = true;
  // Traditional rule: blind wager becomes the next stake; seen wager is halved.
  next.currentStake = seenAction ? wager / 2 : wager;
  next.lastActionPlayerId = playerId;
  next.history.push({ playerId, action, amount: wager });
  next.turns += 1;
  if (next.turns > next.maxTurns) { finishByShowdown(next); return next; }
  nextTurn(next, next.turnIndex);
  return next;
}

/** Start another server-authoritative round while carrying forward each player's stack. */
export function teenPattiNextRound(state: TeenPattiState, random: RandomSource = Math.random): TeenPattiState {
  if (state.status !== "complete") throw new Error("Finish the current Teen Patti round first");
  return createTeenPattiGame(state.players.map(player => ({ id: player.id, chips: player.chips })), state.boot, random);
}
