import { describe, expect, it } from "vitest";
import { chooseTeenPattiBotAction, findRummyDeclaration } from "../src/bots.js";
import { createDeck, shuffle, SUITS, type Card, type PlayingCard } from "@cardroom/shared/cards";
import { blackjackValue, blackjackAction, type BlackjackState } from "@cardroom/shared/games/blackjack";
import { evaluateFive, evaluateBestHand, comparePokerHands, createHoldemGame, holdemAction } from "@cardroom/shared/games/holdem";
import { evaluateTeenPatti, compareTeenPatti, createTeenPattiGame, teenPattiAction, teenPattiNextRound, teenPattiShowCost, teenPattiWagerBounds } from "@cardroom/shared/games/teenPatti";
import { createTeenPattiCompanion, teenPattiCompanionAct, teenPattiCompanionActionBounds, teenPattiCompanionBetBounds, teenPattiCompanionCardChoices, teenPattiCompanionNextRound, teenPattiCompanionOpeningBetBounds, teenPattiCompanionPostOpeningBet, teenPattiCompanionRespondSideshow, teenPattiCompanionSelectCard } from "@cardroom/shared/games/teen-patti-companion";
import { callbreakPlay, callbreakBid, callbreakChooseTrump, createCallbreakRound, getCallbreakMinimumBid, getLegalCallbreakCardIds, startNextCallbreakRound, type CallbreakState } from "@cardroom/shared/games/callbreak";
import { createCallbreakScorekeeper, formatCallbreakScore, nextCallbreakScorekeeperRound, submitCallbreakScorekeeperBids, submitCallbreakScorekeeperTricks } from "@cardroom/shared/games/callbreak-companion";
import { createRummyGame, drawRummyCard, discardRummyCard, validateIndianRummyDeclaration, validateRummy10Declaration, type RummyGroup, calculateRummyPenalty, declareRummy } from "@cardroom/shared/games/rummy";

const c = (id: string, suit: Card["suit"], rank: Card["rank"]): Card => ({ id, suit, rank });
const joker: PlayingCard = { id: "joker-1", suit: null, rank: 0, joker: true };

describe("shared card primitives", () => {
  it("builds a standard 52-card deck with stable identities", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(card => card.id)).size).toBe(52);
  });
  it("shuffles deterministically when a random source is injected", () => {
    const random = () => 0.37;
    expect(shuffle(createDeck(), random)).toEqual(shuffle(createDeck(), random));
  });
});

describe("blackjack rules", () => {
  it("values aces as 1 or 11 without busting unnecessarily", () => {
    expect(blackjackValue([c("a", "spades", 14), c("6", "clubs", 6)])).toEqual({ total: 17, soft: true });
    expect(blackjackValue([c("a1", "spades", 14), c("a2", "hearts", 14), c("9", "clubs", 9)])).toEqual({ total: 21, soft: true });
    expect(blackjackValue([c("a", "spades", 14), c("k", "clubs", 13), c("5", "hearts", 5)])).toEqual({ total: 16, soft: false });
  });
  it("rejects a player action when it is not that player's turn", () => {
    const state = {
      gameId: "blackjack", status: "player-turn", players: [{ id: "p1", chips: 90, hands: [{ cards: [c("2", "clubs", 2), c("3", "diamonds", 3)], bet: 10, status: "playing", doubled: false, splitAces: false }] }],
      dealer: [c("d1", "clubs", 10), c("d2", "hearts", 8)], deck: [c("x", "spades", 5)], activePlayerIndex: 0, activeHandIndex: 0,
      rules: { dealerHitsSoft17: false, blackjackNumerator: 3, blackjackDenominator: 2, allowDouble: true, allowSplit: true, maxHands: 4 }, results: {}, history: [],
    } as BlackjackState;
    expect(() => blackjackAction(state, "p2", "hit")).toThrow(/turn/);
  });
  it("records a separate authoritative win and loss for every player at settlement", () => {
    const state: BlackjackState = {
      gameId: "blackjack", status: "player-turn",
      players: [
        { id: "p1", chips: 900, hands: [{ cards: [c("p1-k", "spades", 13), c("p1-q", "hearts", 12)], bet: 100, status: "playing", doubled: false, splitAces: false }] },
        { id: "p2", chips: 900, hands: [{ cards: [c("p2-10", "clubs", 10), c("p2-6", "diamonds", 6)], bet: 100, status: "playing", doubled: false, splitAces: false }] },
      ],
      dealer: [c("dealer-10", "spades", 10), c("dealer-8", "clubs", 8)], deck: [], activePlayerIndex: 0, activeHandIndex: 0,
      rules: { dealerHitsSoft17: false, blackjackNumerator: 3, blackjackDenominator: 2, allowDouble: true, allowSplit: true, maxHands: 4 }, results: {}, history: [],
    };
    const afterFirst = blackjackAction(state, "p1", "stand");
    const settled = blackjackAction(afterFirst, "p2", "stand");
    expect(settled.status).toBe("complete");
    expect(settled.players[0]!.hands[0]!.outcome).toBe("win");
    expect(settled.players[0]!.hands[0]!.payout).toBe(200);
    expect(settled.players[0]!.hands[0]!.net).toBe(100);
    expect(settled.players[1]!.hands[0]!.outcome).toBe("loss");
    expect(settled.players[1]!.hands[0]!.payout).toBe(0);
    expect(settled.players[1]!.hands[0]!.net).toBe(-100);
    expect(settled.results).toEqual({ p1: 100, p2: -100 });
    expect(settled.players.map(player => player.chips)).toEqual([1_100, 900]);
  });
  it("marks a matching total as a push and returns the player's stake", () => {
    const state: BlackjackState = {
      gameId: "blackjack", status: "player-turn",
      players: [{ id: "p1", chips: 900, hands: [{ cards: [c("p1-10", "spades", 10), c("p1-8", "hearts", 8)], bet: 100, status: "playing", doubled: false, splitAces: false }] }],
      dealer: [c("dealer-10", "clubs", 10), c("dealer-8", "diamonds", 8)], deck: [], activePlayerIndex: 0, activeHandIndex: 0,
      rules: { dealerHitsSoft17: false, blackjackNumerator: 3, blackjackDenominator: 2, allowDouble: true, allowSplit: true, maxHands: 4 }, results: {}, history: [],
    };
    const settled = blackjackAction(state, "p1", "stand");
    expect(settled.players[0]!.hands[0]!.outcome).toBe("push");
    expect(settled.players[0]!.hands[0]!.net).toBe(0);
    expect(settled.results.p1).toBe(0);
    expect(settled.players[0]!.chips).toBe(1_000);
  });
  it("keeps mixed split-hand outcomes separate while calculating one net player result", () => {
    const state: BlackjackState = {
      gameId: "blackjack", status: "player-turn",
      players: [{ id: "split-player", chips: 800, hands: [
        { cards: [c("split-win-k", "spades", 13), c("split-win-q", "hearts", 12)], bet: 100, status: "playing", doubled: false, splitAces: false },
        { cards: [c("split-loss-10", "clubs", 10), c("split-loss-6", "diamonds", 6)], bet: 100, status: "playing", doubled: false, splitAces: false },
      ] }],
      dealer: [c("split-dealer-10", "spades", 10), c("split-dealer-8", "clubs", 8)], deck: [], activePlayerIndex: 0, activeHandIndex: 0,
      rules: { dealerHitsSoft17: false, blackjackNumerator: 3, blackjackDenominator: 2, allowDouble: true, allowSplit: true, maxHands: 4 }, results: {}, history: [],
    };
    const first = blackjackAction(state, "split-player", "stand");
    const settled = blackjackAction(first, "split-player", "stand");
    expect(settled.players[0]!.hands.map(hand => hand.outcome)).toEqual(["win", "loss"]);
    expect(settled.players[0]!.hands.map(hand => hand.net)).toEqual([100, -100]);
    expect(settled.results["split-player"]).toBe(0);
    expect(settled.players[0]!.chips).toBe(1_000);
  });
});

describe("Texas Hold'em hand evaluation", () => {
  it("recognizes the wheel straight with a five-high ranking", () => {
    const wheel = evaluateFive([c("a", "spades", 14), c("2", "clubs", 2), c("3", "hearts", 3), c("4", "diamonds", 4), c("5", "spades", 5)]);
    expect(wheel.category).toBe("straight");
    expect(wheel.rank).toEqual([4, 5]);
  });
  it("compares kickers for otherwise equal pairs", () => {
    const pairA = evaluateFive([c("a1", "spades", 14), c("a2", "hearts", 14), c("k", "clubs", 13), c("9", "diamonds", 9), c("2", "spades", 2)]);
    const pairB = evaluateFive([c("a3", "clubs", 14), c("a4", "diamonds", 14), c("q", "clubs", 12), c("j", "diamonds", 11), c("2b", "spades", 2)]);
    expect(comparePokerHands(pairA, pairB)).toBeGreaterThan(0);
  });
  it("uses seat order left of the dealer after the flop and conserves all-in side pots", () => {
    let state = createHoldemGame([{ id: "p0", chips: 100 }, { id: "p1", chips: 50 }, { id: "p2", chips: 25 }], { smallBlind: 5, bigBlind: 10, dealerIndex: 1 }, () => 0.4);
    state = holdemAction(state, state.players[state.actingIndex]!.id, { type: "call" });
    state = holdemAction(state, state.players[state.actingIndex]!.id, { type: "call" });
    state = holdemAction(state, state.players[state.actingIndex]!.id, { type: "check" });
    expect(state.street).toBe("flop");
    expect(state.players[state.actingIndex]!.id).toBe("p2");

    let allIn = createHoldemGame([{ id: "a", chips: 100 }, { id: "b", chips: 50 }, { id: "c", chips: 25 }], { smallBlind: 5, bigBlind: 10 }, () => 0.4);
    allIn = holdemAction(allIn, "a", { type: "raise", amount: 100 });
    allIn = holdemAction(allIn, "b", { type: "all-in" });
    allIn = holdemAction(allIn, "c", { type: "all-in" });
    expect(allIn.status).toBe("complete");
    expect(allIn.players.reduce((sum, p) => sum + p.chips, 0)).toBe(175);
    expect(allIn.pots.map(p => p.amount)).toEqual([75, 50, 50]);

    let shortRaise = createHoldemGame([{ id: "p0", chips: 300 }, { id: "p1", chips: 300 }, { id: "p2", chips: 65 }], { smallBlind: 5, bigBlind: 10, dealerIndex: 2 }, () => 0.4);
    shortRaise = holdemAction(shortRaise, "p2", { type: "call" });
    shortRaise = holdemAction(shortRaise, "p0", { type: "call" });
    shortRaise = holdemAction(shortRaise, "p1", { type: "check" });
    shortRaise = holdemAction(shortRaise, "p0", { type: "bet", amount: 50 });
    shortRaise = holdemAction(shortRaise, "p1", { type: "call" });
    shortRaise = holdemAction(shortRaise, "p2", { type: "all-in" });
    shortRaise = holdemAction(shortRaise, "p0", { type: "call" });
    expect(shortRaise.players[shortRaise.actingIndex]!.id).toBe("p1");
    expect(() => holdemAction(shortRaise, "p1", { type: "raise", amount: 100 })).toThrow(/not reopened/);
  });
  it("finds the best five cards from seven and ties equivalent ranks", () => {
    const seven = [c("a", "spades", 14), c("k", "spades", 13), c("q", "spades", 12), c("j", "spades", 11), c("10", "spades", 10), c("2", "clubs", 2), c("3", "hearts", 3)];
    expect(evaluateBestHand(seven).category).toBe("straight-flush");
    const tie1 = evaluateFive([c("a", "spades", 14), c("k", "clubs", 13), c("q", "hearts", 12), c("j", "diamonds", 11), c("10", "spades", 10)]);
    const tie2 = evaluateFive([c("a2", "hearts", 14), c("k2", "diamonds", 13), c("q2", "clubs", 12), c("j2", "spades", 11), c("102", "clubs", 10)]);
    expect(comparePokerHands(tie1, tie2)).toBe(0);
  });
});

describe("Teen Patti ranking and classic betting rules", () => {
  it("orders trail, pure sequence, sequence, color, pair, and high card", () => {
    const trail = evaluateTeenPatti([c("a", "spades", 9), c("b", "hearts", 9), c("c", "diamonds", 9)]);
    const pure = evaluateTeenPatti([c("d", "spades", 5), c("e", "spades", 6), c("f", "spades", 7)]);
    const sequence = evaluateTeenPatti([c("s1", "spades", 5), c("s2", "hearts", 6), c("s3", "clubs", 7)]);
    const color = evaluateTeenPatti([c("co1", "clubs", 14), c("co2", "clubs", 10), c("co3", "clubs", 4)]);
    const pair = evaluateTeenPatti([c("g", "clubs", 8), c("h", "hearts", 8), c("i", "spades", 3)]);
    const high = evaluateTeenPatti([c("j", "clubs", 14), c("k", "hearts", 10), c("l", "spades", 4)]);
    expect([compareTeenPatti(trail, pure), compareTeenPatti(pure, sequence), compareTeenPatti(sequence, color), compareTeenPatti(color, pair), compareTeenPatti(pair, high)].every(value => value > 0)).toBe(true);
  });
  it("ranks A-2-3 above A-K-Q in the configured classic variant", () => {
    const akq = evaluateTeenPatti([c("a", "clubs", 14), c("k", "hearts", 13), c("q", "spades", 12)]);
    const a23 = evaluateTeenPatti([c("a2", "clubs", 14), c("2", "hearts", 2), c("3", "spades", 3)]);
    expect(akq.category).toBe("sequence");
    expect(a23.category).toBe("sequence");
    expect(compareTeenPatti(a23, akq)).toBeGreaterThan(0);
  });
  it("calculates classic blind/seen ranges and show costs", () => {
    expect(teenPattiWagerBounds(10, false, 100)).toEqual({ min: 10, max: 20 });
    expect(teenPattiWagerBounds(10, true, 100)).toEqual({ min: 20, max: 40 });
    expect(teenPattiWagerBounds(10, true, 29)).toEqual({ min: 20, max: 28 });
    expect(teenPattiShowCost(10, false, true)).toBe(10);
    expect(teenPattiShowCost(10, true, true)).toBe(20);
    expect(teenPattiShowCost(10, true, false)).toBeNull();
  });
  it("settles an online equal-hand show in favor of the player who did not call", () => {
    let state = createTeenPattiGame([{ id: "p1", chips: 500 }, { id: "p2", chips: 500 }], 10, () => 0.4);
    state = { ...state, players: state.players.map((p) => ({ ...p, seen: true, cards: p.id === "p1"
      ? [c("a", "spades", 14), c("k", "spades", 13), c("q", "hearts", 12)]
      : [c("a2", "clubs", 14), c("k2", "clubs", 13), c("q2", "diamonds", 12)] })) };
    const result = teenPattiAction(state, "p1", "show");
    expect(result.winnerIds).toEqual(["p2"]);
    expect(result.settlement?.find(row => row.playerId === "p1")?.reason).toMatch(/player who called the show loses the tie/);
    expect(result.players.reduce((sum, player) => sum + player.chips, 0)).toBe(1000);
  });
  it("enforces the configured maximum pot and carries it into the next round", () => {
    let state = createTeenPattiGame(
      [{ id: "p1", chips: 100 }, { id: "p2", chips: 100 }],
      10,
      () => 0.4,
      40,
    );
    expect(state.maxPot).toBe(40);
    expect(() => teenPattiAction(state, "p1", "blind", 21)).toThrow(/between 10 and 20/);
    state = teenPattiAction(state, "p1", "blind", 20);
    expect(state.pot).toBe(40);
    expect(state.status).toBe("complete");
    expect(state.settlement).toHaveLength(2);
    expect(state.players.reduce((sum, player) => sum + player.chips, 0)).toBe(200);
    const next = teenPattiNextRound(state, () => 0.4);
    expect(next.maxPot).toBe(40);
  });
  it("allows an exact short final wager to fill the remaining maximum pot", () => {
    let state = createTeenPattiGame(
      [{ id: "p1", chips: 100 }, { id: "p2", chips: 100 }],
      10,
      () => 0.4,
      45,
    );
    state = teenPattiAction(state, "p1", "blind", 20);
    expect(state.pot).toBe(40);
    expect(teenPattiWagerBounds(state.currentStake, false, state.maxPot - state.pot)).toEqual({ min: 5, max: 5 });
    state = teenPattiAction(state, "p2", "blind", 5);
    expect(state.pot).toBe(45);
    expect(state.status).toBe("complete");
    expect(state.settlement).toHaveLength(2);
  });
  it("allows an odd seen wager only when it exactly fills the maximum pot", () => {
    let state = createTeenPattiGame(
      [{ id: "p1", chips: 100 }, { id: "p2", chips: 100 }],
      10,
      () => 0.4,
      45,
    );
    state = teenPattiAction(state, "p1", "blind", 20);
    state = teenPattiAction(state, "p2", "chaal", 5);
    expect(state.pot).toBe(45);
    expect(state.status).toBe("complete");

    let shortStack = createTeenPattiGame(
      [{ id: "p1", chips: 100 }, { id: "p2", chips: 100 }],
      10,
      () => 0.4,
      60,
    );
    shortStack = { ...shortStack, players: shortStack.players.map(player => player.id === "p2" ? { ...player, chips: 15 } : player) };
    shortStack = teenPattiAction(shortStack, "p1", "blind", 10);
    expect(() => teenPattiAction(shortStack, "p2", "chaal", 15)).toThrow(/even number/);
  });
  it("rejects a configured pot cap that cannot cover the boot and opening wager", () => {
    expect(() => createTeenPattiGame(
      [{ id: "p1", chips: 100 }, { id: "p2", chips: 100 }],
      10,
      () => 0.4,
      20,
    )).toThrow(/Maximum pot must cover/);
  });
  it("requires a seen player to have a seen opponent before calling a show", () => {
    let state = createTeenPattiGame([{ id: "p1", chips: 500 }, { id: "p2", chips: 500 }], 10, () => 0.4);
    state = { ...state, players: state.players.map((p, i) => ({ ...p, seen: i === 0 })) };
    expect(() => teenPattiAction(state, "p1", "show")).toThrow(/cannot request a show/);
  });
  it("makes an unaffordable Teen Patti bot pack instead of emitting an illegal bet", () => {
    const state = createTeenPattiGame([{ id: "bot", chips: 1000 }, { id: "other", chips: 1000 }], 10, () => 0.4);
    state.players[0]!.chips = 0;
    expect(chooseTeenPattiBotAction(state, "bot", "hard")).toBe("pack");
  });
});

describe("Teen Patti physical-table companion", () => {
  const roster = [
    { id: "p1", name: "Ankit", wallet: 1000 },
    { id: "p2", name: "Aryan", wallet: 1000 },
  ];
  const postAllOpeningBets = (players = roster, maxPot = 500) => {
    let state = createTeenPattiCompanion(players, { bootAmount: 10, maxPot });
    for (const player of players) state = teenPattiCompanionPostOpeningBet(state, player.id, 10);
    return state;
  };
  const enterCards = (start: ReturnType<typeof createTeenPattiCompanion>, picks: string[]) => {
    let state = start;
    for (const id of picks) state = teenPattiCompanionSelectCard(state, id);
    return state;
  };
  const twoPlayerCards = ["0-spades-14", "0-hearts-14", "0-diamonds-14", "0-clubs-13", "0-spades-13", "0-hearts-13"];

  it("keeps card entry locked through opening bets and repeated betting turns", () => {
    let state = createTeenPattiCompanion(roster, { bootAmount: 10, maxPot: 500 });
    expect(state.stage).toBe("opening");
    expect(() => teenPattiCompanionSelectCard(state, twoPlayerCards[0]!)).toThrow(/only after betting is finished/i);
    expect(() => teenPattiCompanionAct(state, "p1", "blind", 10)).toThrow(/betting is not open/i);
    expect(() => teenPattiCompanionPostOpeningBet(state, "p2", 10)).toThrow(/Pass the device to Ankit/);
    expect(teenPattiCompanionOpeningBetBounds(state, "p1")).toMatchObject({ min: 10, max: 20, canAct: true });
    state = teenPattiCompanionPostOpeningBet(state, "p1", 20);
    expect(state.stage).toBe("opening");
    expect(state.currentStake).toBe(20);
    state = teenPattiCompanionPostOpeningBet(state, "p2", 20);
    expect(state.stage).toBe("playing");
    expect(state.pot).toBe(60);
    expect(state.players.map(player => player.bet)).toEqual([30, 30]);
    expect(state.players.every(player => player.cards.length === 0)).toBe(true);
    expect(teenPattiCompanionBetBounds(state, "p1").canAct).toBe(true);
    expect(() => teenPattiCompanionSelectCard(state, twoPlayerCards[0]!)).toThrow(/only after betting is finished/i);
  });

  it("allows multiple blind raises and seen chaals until the maximum pot closes betting", () => {
    let state = postAllOpeningBets(roster, 160);
    expect(state.stage).toBe("playing");
    // Opening boot + wager is 40. The next four actions are four separate turns.
    state = teenPattiCompanionAct(state, "p1", "blind", 20); // pot 60, next blind stake 20
    state = teenPattiCompanionAct(state, "p2", "chaal", 40); // pot 100, next blind stake 20
    state = teenPattiCompanionAct(state, "p1", "blind", 20); // pot 120
    expect(state.stage).toBe("playing");
    state = teenPattiCompanionAct(state, "p2", "chaal", 40); // pot 160 = cap
    expect(state.stage).toBe("dealing");
    expect(state.completionReason).toBe("max-pot");
    expect(state.pot).toBe(160);
    expect(state.history.filter(item => item.type === "action" && (item.action === "blind" || item.action === "chaal")).length).toBe(4);
    expect(state.players.every(player => player.cards.length === 0)).toBe(true);
    expect(() => teenPattiCompanionAct(state, "p1", "blind", 20)).toThrow(/betting is not open/i);
    state = enterCards(state, twoPlayerCards);
    expect(state.stage).toBe("complete");
    expect(state.completionReason).toBe("max-pot");
    expect(state.players.reduce((sum, player) => sum + (player.netChange ?? 0), 0)).toBe(0);
  });

  it("lets every player take repeated betting turns until an exact maximum-pot close", () => {
    const players = [
      { id: "c1", name: "One", wallet: 1000 },
      { id: "c2", name: "Two", wallet: 1000 },
      { id: "c3", name: "Three", wallet: 1000 },
    ];
    let state = createTeenPattiCompanion(players, { bootAmount: 10, maxPot: 250 });
    for (const player of players) state = teenPattiCompanionPostOpeningBet(state, player.id, 10);
    const actions: Array<[string, number]> = [
      ["c1", 20], ["c2", 20], ["c3", 20],
      ["c1", 20], ["c2", 20], ["c3", 20],
      ["c1", 20], ["c2", 20], ["c3", 20],
      ["c1", 10],
    ];
    for (const [playerId, amount] of actions) state = teenPattiCompanionAct(state, playerId, "blind", amount);
    expect(state.pot).toBe(250);
    expect(state.stage).toBe("dealing");
    expect(state.completionReason).toBe("max-pot");
    expect(() => teenPattiCompanionAct(state, "c2", "blind", 20)).toThrow(/betting is not open/i);
    for (const id of ["0-spades-14", "0-hearts-14", "0-diamonds-14", "0-clubs-13", "0-spades-13", "0-hearts-13", "0-clubs-12", "0-diamonds-12", "0-spades-8"]) {
      state = teenPattiCompanionSelectCard(state, id);
    }
    expect(state.stage).toBe("complete");
    for (const player of players) {
      expect(state.history.filter(event => event.type === "action" && event.playerId === player.id && event.action === "blind").length).toBeGreaterThanOrEqual(2);
    }
    expect(state.players.reduce((sum, player) => sum + (player.netChange ?? 0), 0)).toBe(0);
  });

  it("keeps opening blind/seen status and correct stake carry-forward through repeated betting", () => {
    let state = createTeenPattiCompanion(roster, { bootAmount: 10, maxPot: 500 });
    expect(teenPattiCompanionOpeningBetBounds(state, "p1", true)).toMatchObject({ min: 20, max: 40, canAct: true });
    state = teenPattiCompanionPostOpeningBet(state, "p1", 20, true);
    expect(state.players[0]!.seen).toBe(true);
    expect(state.currentStake).toBe(10);
    state = teenPattiCompanionPostOpeningBet(state, "p2", 10, false);
    expect(state.stage).toBe("playing");
    expect(teenPattiCompanionActionBounds(state, "p1", false).canAct).toBe(false);
    expect(teenPattiCompanionActionBounds(state, "p1", true)).toMatchObject({ min: 20, max: 40, canAct: true });
    state = teenPattiCompanionAct(state, "p1", "chaal", 40);
    expect(state.currentStake).toBe(20);
    expect(state.players[0]!.seen).toBe(true);
    expect(teenPattiCompanionActionBounds(state, "p2", false).canAct).toBe(true);
  });

  it("allows an odd seen wager only when it exactly fills the maximum pot", () => {
    let state = createTeenPattiCompanion(roster, { bootAmount: 10, maxPot: 95 });
    state = teenPattiCompanionPostOpeningBet(state, "p1", 10, false);
    state = teenPattiCompanionPostOpeningBet(state, "p2", 10, false);
    state = teenPattiCompanionAct(state, "p1", "blind", 20);
    expect(teenPattiCompanionActionBounds(state, "p2", true)).toMatchObject({ min: 35, max: 35, canAct: true });
    state = teenPattiCompanionAct(state, "p2", "chaal", 35);
    expect(state.pot).toBe(95);
    expect(state.stage).toBe("dealing");
    expect(state.completionReason).toBe("max-pot");
  });

  it("enters cards only after a show closes betting and settles after private card entry", () => {
    let state = createTeenPattiCompanion(roster, { bootAmount: 10, maxPot: 500 });
    state = teenPattiCompanionPostOpeningBet(state, "p1", 10, false);
    state = teenPattiCompanionPostOpeningBet(state, "p2", 20, true);
    expect(state.stage).toBe("playing");
    state = teenPattiCompanionAct(state, "p1", "show");
    expect(state.stage).toBe("dealing");
    expect(state.completionReason).toBe("show");
    expect(state.showCallerId).toBe("p1");
    expect(() => teenPattiCompanionAct(state, "p2", "blind", 10)).toThrow(/betting is not open/i);
    state = enterCards(state, twoPlayerCards);
    expect(state.stage).toBe("complete");
    expect(state.completionReason).toBe("show");
    expect(state.winnerIds).toEqual(["p1"]);
  });

  it("makes the caller lose a tied two-player show after private card entry", () => {
    let state = createTeenPattiCompanion(roster, { bootAmount: 10, maxPot: 500 });
    state = teenPattiCompanionPostOpeningBet(state, "p1", 10, false);
    state = teenPattiCompanionPostOpeningBet(state, "p2", 10, false);
    state = teenPattiCompanionAct(state, "p1", "show");
    state = enterCards(state, ["0-spades-14", "0-hearts-13", "0-clubs-12", "0-clubs-14", "0-diamonds-13", "0-hearts-12"]);
    expect(state.stage).toBe("complete");
    expect(state.winnerIds).toEqual(["p2"]);
    expect(state.players[0]!.reason).toMatch(/player who called the show loses the tie/i);
  });

  it("requires every active player to be seen before a sideshow and records a physical comparison", () => {
    const three = [
      { id: "p1", name: "A", wallet: 1000 },
      { id: "p2", name: "B", wallet: 1000 },
      { id: "p3", name: "C", wallet: 1000 },
    ];
    let state = createTeenPattiCompanion(three, { bootAmount: 10, maxPot: 1000 });
    for (const player of three) state = teenPattiCompanionPostOpeningBet(state, player.id, 10, false);
    state = teenPattiCompanionAct(state, "p1", "chaal", 20);
    state = teenPattiCompanionAct(state, "p2", "blind", 10);
    state = teenPattiCompanionAct(state, "p3", "chaal", 20);
    expect(() => teenPattiCompanionAct(state, "p1", "sideshow")).toThrow(/every active player has seen/i);
    state = teenPattiCompanionAct(state, "p1", "chaal", 20);
    state = teenPattiCompanionAct(state, "p2", "chaal", 20);
    state = teenPattiCompanionAct(state, "p3", "sideshow");
    expect(state.pendingSideshow?.targetId).toBe("p2");
    expect(state.players.every(player => player.cards.length === 0)).toBe(true);
    expect(() => teenPattiCompanionRespondSideshow(state, "p2", true)).toThrow(/select who has the weaker hand/i);
    state = teenPattiCompanionRespondSideshow(state, "p2", true, "p2");
    expect(state.players.find(player => player.id === "p2")!.folded).toBe(true);
    expect(state.players.find(player => player.id === "p2")!.foldReason).toMatch(/weaker hand/i);
    expect(state.stage).toBe("playing");
  });

  it("makes the requester pack on a sideshow tie and preserves a declined sideshow charge", () => {
    const three = [
      { id: "p1", name: "A", wallet: 1000 },
      { id: "p2", name: "B", wallet: 1000 },
      { id: "p3", name: "C", wallet: 1000 },
    ];
    let tied = createTeenPattiCompanion(three, { bootAmount: 10, maxPot: 1000 });
    for (const player of three) tied = teenPattiCompanionPostOpeningBet(tied, player.id, 10, false);
    for (const id of ["p1", "p2", "p3"]) tied = teenPattiCompanionAct(tied, id, "chaal", 20);
    tied = teenPattiCompanionAct(tied, "p1", "sideshow");
    tied = teenPattiCompanionRespondSideshow(tied, "p3", true, "tie");
    expect(tied.players.find(player => player.id === "p1")!.folded).toBe(true);

    let declined = createTeenPattiCompanion(three, { bootAmount: 10, maxPot: 1000 });
    for (const player of three) declined = teenPattiCompanionPostOpeningBet(declined, player.id, 10, false);
    for (const id of ["p1", "p2", "p3"]) declined = teenPattiCompanionAct(declined, id, "chaal", 20);
    const pot = declined.pot;
    declined = teenPattiCompanionAct(declined, "p1", "sideshow");
    declined = teenPattiCompanionRespondSideshow(declined, "p3", false);
    expect(declined.pot).toBe(pot + 20);
    expect(declined.turnIndex).toBe(1);
  });

  it("allows a final short cap contribution, then locks all betting before card entry", () => {
    let state = postAllOpeningBets(roster, 45); // Opening pot is 40; only five chips remain.
    expect(state.stage).toBe("playing");
    expect(teenPattiCompanionActionBounds(state, "p1", false)).toEqual({ min: 5, max: 5, canAct: true });
    state = teenPattiCompanionAct(state, "p1", "blind", 5);
    expect(state.pot).toBe(45);
    expect(state.stage).toBe("dealing");
    expect(state.completionReason).toBe("max-pot");
    state = enterCards(state, twoPlayerCards);
    expect(state.stage).toBe("complete");
  });

  it("settles immediately when all but one player pack and carries balances into the next round", () => {
    let state = postAllOpeningBets();
    state = teenPattiCompanionAct(state, "p1", "pack");
    expect(state.stage).toBe("complete");
    expect(state.completionReason).toBe("last-player");
    expect(state.winnerIds).toEqual(["p2"]);
    const next = teenPattiCompanionNextRound(state);
    expect(next.stage).toBe("opening");
    expect(next.roundNumber).toBe(2);
    expect(next.players[0]!.stats.roundsPlayed).toBe(1);
    expect(next.players[0]!.cards).toHaveLength(0);
  });

  it("exposes a full standard 52-card selector with unique card identities", () => {
    const choices = teenPattiCompanionCardChoices();
    expect(choices).toHaveLength(52);
    expect(new Set(choices.map(card => card.id)).size).toBe(52);
    expect(new Set(choices.map(card => card.suit)).size).toBe(4);
  });
});

describe("Callbreak trick legality and match scoring", () => {
  const base: CallbreakState = {
    gameId: "callbreak", status: "playing", round: 1, dealerIndex: 0,
    players: [
      { id: "p0", hand: [c("h10", "hearts", 10)], bid: 1, tricksWon: 0, scoreTenths: 0 },
      { id: "p1", hand: [c("sA", "spades", 14), c("h3", "hearts", 3), c("hQ", "hearts", 12)], bid: 1, tricksWon: 0, scoreTenths: 0 },
      { id: "p2", hand: [c("hK", "hearts", 13)], bid: 1, tricksWon: 0, scoreTenths: 0 },
      { id: "p3", hand: [c("h2", "hearts", 2)], bid: 1, tricksWon: 0, scoreTenths: 0 },
    ], currentIndex: 0, leaderIndex: 0, trick: [], trickNumber: 0, history: [],
  };

  it("requires following suit and rejects a trump discard when the led suit is held", () => {
    const first = callbreakPlay(base, "p0", "h10");
    expect(getLegalCallbreakCardIds(first, "p1")).toEqual(["hQ"]);
    expect(() => callbreakPlay(first, "p1", "sA")).toThrow(/follow the led suit/);
  });

  it("requires beating the highest led-suit card when possible", () => {
    const first = callbreakPlay(base, "p0", "h10");
    expect(getLegalCallbreakCardIds(first, "p1")).toEqual(["hQ"]);
    expect(() => callbreakPlay(first, "p1", "h3")).toThrow(/beat its highest card/);
  });

  it("allows any follow-suit card after a trump has already beaten the led suit", () => {
    const first = callbreakPlay(base, "p0", "h10");
    const noHearts = { ...first, players: first.players.map(p => p.id === "p1" ? { ...p, hand: [c("s2", "spades", 2)] } : p) };
    const trumped = callbreakPlay(noHearts, "p1", "s2");
    expect(getLegalCallbreakCardIds(trumped, "p2")).toEqual(["hK"]);
  });

  it("requires trumping when void and overtrumping when possible", () => {
    const tricked: CallbreakState = {
      ...base,
      players: [
        { ...base.players[0]!, hand: [c("h10", "hearts", 10)] },
        { ...base.players[1]!, hand: [c("sK", "spades", 13)] },
        { ...base.players[2]!, hand: [c("s7", "spades", 7), c("sA2", "spades", 14), c("dA", "diamonds", 14)] },
        { ...base.players[3]!, hand: [c("h2", "hearts", 2)] },
      ], currentIndex: 0,
    };
    const first = callbreakPlay(tricked, "p0", "h10");
    const second = callbreakPlay(first, "p1", "sK");
    expect(getLegalCallbreakCardIds(second, "p2")).toEqual(["sA2"]);
    expect(() => callbreakPlay(second, "p2", "dA")).toThrow(/play a card in spades/);
  });

  it("allows a lower trump only when no overtrump is held", () => {
    const tricked: CallbreakState = {
      ...base,
      players: [
        { ...base.players[0]!, hand: [c("h10", "hearts", 10)] },
        { ...base.players[1]!, hand: [c("sK", "spades", 13)] },
        { ...base.players[2]!, hand: [c("s7", "spades", 7), c("dA", "diamonds", 14)] },
        { ...base.players[3]!, hand: [c("h2", "hearts", 2)] },
      ], currentIndex: 0,
    };
    const first = callbreakPlay(tricked, "p0", "h10");
    const second = callbreakPlay(first, "p1", "sK");
    expect(getLegalCallbreakCardIds(second, "p2")).toEqual(["s7"]);
  });

  it("uses the selected trump suit, not a hard-coded spade suit", () => {
    const customTrump: CallbreakState = {
      ...base,
      trumpSuit: "hearts",
      players: [
        { ...base.players[0]!, hand: [c("c10", "clubs", 10)] },
        { ...base.players[1]!, hand: [c("h2", "hearts", 2), c("dA", "diamonds", 14)] },
        { ...base.players[2]!, hand: [c("cK", "clubs", 13)] },
        { ...base.players[3]!, hand: [c("c2", "clubs", 2)] },
      ],
    };
    const first = callbreakPlay(customTrump, "p0", "c10");
    expect(getLegalCallbreakCardIds(first, "p1")).toEqual(["h2"]);
    const second = callbreakPlay(first, "p1", "h2");
    expect(getLegalCallbreakCardIds(second, "p2")).toEqual(["cK"]);
  });

  it("calculates the bid and 0.1 overtrick scoring in integer tenths", () => {
    let state: CallbreakState = {
      gameId: "callbreak", status: "playing", round: 2,
      players: [
        { id: "p0", hand: [c("s2", "spades", 2)], bid: 1, tricksWon: 1, scoreTenths: 0 },
        { id: "p1", hand: [c("s3", "spades", 3)], bid: 2, tricksWon: 1, scoreTenths: 0 },
        { id: "p2", hand: [c("hA", "hearts", 14)], bid: 1, tricksWon: 0, scoreTenths: 0 },
        { id: "p3", hand: [c("sK", "spades", 13)], bid: 1, tricksWon: 0, scoreTenths: 0 },
      ], currentIndex: 0, leaderIndex: 0, trick: [], trickNumber: 12, history: [],
    };
    state = callbreakPlay(state, "p0", "s2");
    state = callbreakPlay(state, "p1", "s3");
    state = callbreakPlay(state, "p2", "hA");
    state = callbreakPlay(state, "p3", "sK");
    expect(state.status).toBe("round-complete");
    expect(state.roundScores).toEqual({ p0: 10, p1: -20, p2: -10, p3: 10 });
    expect(state.players.reduce((sum, player) => sum + player.tricksWon, 0)).toBe(3);
  });

  it("ends the match after the round in which a player reaches 31 points", () => {
    let state: CallbreakState = {
      gameId: "callbreak", status: "playing", round: 4,
      players: [
        { id: "p0", hand: [c("sA", "spades", 14)], bid: 1, tricksWon: 0, scoreTenths: 300 },
        { id: "p1", hand: [c("s3", "spades", 3)], bid: 1, tricksWon: 0, scoreTenths: 50 },
        { id: "p2", hand: [c("hA", "hearts", 14)], bid: 1, tricksWon: 0, scoreTenths: 20 },
        { id: "p3", hand: [c("sK", "spades", 13)], bid: 1, tricksWon: 0, scoreTenths: 10 },
      ], currentIndex: 0, leaderIndex: 0, trick: [], trickNumber: 12, history: [],
    };
    state = callbreakPlay(state, "p0", "sA");
    state = callbreakPlay(state, "p1", "s3");
    state = callbreakPlay(state, "p2", "hA");
    state = callbreakPlay(state, "p3", "sK");
    expect(state.status).toBe("complete");
    expect(state.players[0]!.scoreTenths).toBe(310);
    expect(state.winnerIds).toEqual(["p0"]);
  });

  it("deals five cards before trump selection, then eight more after all four decisions", () => {
    let state = createCallbreakRound([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], 1, () => 0.4);
    expect(state.status).toBe("trump-selection");
    expect(state.players.map(player => player.hand.length)).toEqual([5, 5, 5, 5]);
    expect(state.deck).toHaveLength(32);
    // Equal scores use clockwise order starting left of dealer.
    expect(state.trumpOrder).toEqual(["b", "c", "d", "a"]);
    state = callbreakChooseTrump(state, "b", "hearts");
    expect(state.trumpSelections?.[0]).toEqual({ playerId: "b", suit: "hearts", minimumTricks: 5 });
    expect(state.players.map(player => player.hand.length)).toEqual([5, 5, 5, 5]);
    state = callbreakChooseTrump(state, "c", "diamonds");
    state = callbreakChooseTrump(state, "d", null);
    state = callbreakChooseTrump(state, "a", "clubs");
    expect(state.status).toBe("bidding");
    expect(state.players.map(player => player.hand.length)).toEqual([13, 13, 13, 13]);
    expect(state.deck).toEqual([]);
    expect(state.trumpSuit).toBe("clubs");
    expect(getCallbreakMinimumBid(state, "b")).toBe(5);
    expect(getCallbreakMinimumBid(state, "c")).toBe(6);
    expect(getCallbreakMinimumBid(state, "d")).toBe(1);
    expect(getCallbreakMinimumBid(state, "a")).toBe(7);
    const previousDealer = state.dealerIndex;
    const next = startNextCallbreakRound({ ...state, status: "round-complete", players: state.players.map((player, index) => ({ ...player, scoreTenths: index * 10 })) }, () => 0.4);
    expect(next.status).toBe("trump-selection");
    expect(next.dealerIndex).toBe((previousDealer! + 1) % 4);
    expect(next.players.map(player => player.scoreTenths)).toEqual([0, 10, 20, 30]);
    expect(next.players.map(player => player.hand.length)).toEqual([5, 5, 5, 5]);
  });

  it("orders trump choices from the lowest score upward and makes each choice a personal minimum bid", () => {
    let state = createCallbreakRound([
      { id: "a", scoreTenths: 40 }, { id: "b", scoreTenths: -10 },
      { id: "c", scoreTenths: 20 }, { id: "d", scoreTenths: 0 },
    ], 1, () => 0.22);
    expect(state.trumpOrder).toEqual(["b", "d", "c", "a"]);
    state = callbreakChooseTrump(state, "b", "spades");
    state = callbreakChooseTrump(state, "d", "hearts");
    state = callbreakChooseTrump(state, "c", "clubs");
    state = callbreakChooseTrump(state, "a", "diamonds");
    expect(state.trumpSuit).toBe("diamonds");
    expect(getCallbreakMinimumBid(state, "b")).toBe(5);
    expect(getCallbreakMinimumBid(state, "d")).toBe(6);
    expect(getCallbreakMinimumBid(state, "c")).toBe(7);
    expect(getCallbreakMinimumBid(state, "a")).toBe(8);
    // Bidding begins to the left of dealer, not in trump-auction order.
    expect(state.players[state.currentIndex]?.id).toBe("b");
    expect(() => callbreakBid(state, "b", 4)).toThrow(/between 5 and 13/);
    state = callbreakBid(state, "b", 5);
    expect(state.players.find(player => player.id === "b")?.bid).toBe(5);
  });

  it("defaults to spades when every player passes the trump auction", () => {
    let state = createCallbreakRound([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], 1, () => 0.2);
    for (const playerId of state.trumpOrder ?? []) state = callbreakChooseTrump(state, playerId, null);
    expect(state.status).toBe("bidding");
    expect(state.trumpSuit).toBe("spades");
    expect(state.trumpSelections).toEqual([]);
    expect(state.players.every(player => getCallbreakMinimumBid(state, player.id) === 1)).toBe(true);
  });

  it("does not increase the 5/6/7/8 contract sequence when earlier players pass", () => {
    let state = createCallbreakRound([
      { id: "a", scoreTenths: 30 }, { id: "b", scoreTenths: -20 },
      { id: "c", scoreTenths: 10 }, { id: "d", scoreTenths: 0 },
    ], 1, () => 0.18);
    expect(state.trumpOrder).toEqual(["b", "d", "c", "a"]);
    state = callbreakChooseTrump(state, "b", null);
    state = callbreakChooseTrump(state, "d", "hearts");
    state = callbreakChooseTrump(state, "c", null);
    state = callbreakChooseTrump(state, "a", "clubs");
    expect(state.trumpSelections?.map(item => [item.playerId, item.minimumTricks])).toEqual([["d", 5], ["a", 6]]);
    expect(state.trumpSuit).toBe("clubs");
    expect(getCallbreakMinimumBid(state, "b")).toBe(1);
    expect(getCallbreakMinimumBid(state, "d")).toBe(5);
    expect(getCallbreakMinimumBid(state, "c")).toBe(1);
    expect(getCallbreakMinimumBid(state, "a")).toBe(6);
  });
});

describe("Offline Callbreak physical scorekeeper", () => {
  it("supports four players, bid scoring, overtricks and the complete round scorecard", () => {
    let state = createCallbreakScorekeeper([{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }]);
    expect(state.tricksPerRound).toBe(13);
    state = submitCallbreakScorekeeperBids(state, { a: 3, b: 4, c: 2, d: 1 });
    expect(state.status).toBe("score-entry");
    state = submitCallbreakScorekeeperTricks(state, { a: 4, b: 3, c: 3, d: 3 });
    expect(state.status).toBe("round-results");
    expect(state.roundLedger?.map(row => row.scoreTenths)).toEqual([31, -40, 21, 12]);
    expect(state.players.map(player => player.scoreTenths)).toEqual([31, -40, 21, 12]);
    expect(formatCallbreakScore(state.roundLedger![0]!.scoreTenths)).toBe("+3.1");
    expect(nextCallbreakScorekeeperRound(state).round).toBe(2);
  });

  it("uses a 39-card suit-removal deal with 13 cards and 13 tricks for three players", () => {
    let state = createCallbreakScorekeeper([{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }], 0, "hearts");
    expect(state.tricksPerRound).toBe(13);
    expect(state.removedSuit).toBe("hearts");
    expect(() => createCallbreakScorekeeper([{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }], 0, "invalid" as never)).toThrow(/four suits/);
    state = submitCallbreakScorekeeperBids(state, { a: 13, b: 5, c: 8 });
    state = submitCallbreakScorekeeperTricks(state, { a: 6, b: 4, c: 3 });
    expect(state.roundLedger?.map(row => row.scoreTenths)).toEqual([-130, -50, -80]);
    expect(state.roundLedger?.reduce((sum, row) => sum + row.tricksWon, 0)).toBe(13);
    const fresh = createCallbreakScorekeeper([{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }]);
    expect(() => submitCallbreakScorekeeperBids(fresh, { a: 14, b: 1, c: 1 })).toThrow(/between 1 and 13/);
  });

  it("accepts every one of the four suits as the removed suit for the three-player deck", () => {
    for (const suit of SUITS) {
      const state = createCallbreakScorekeeper([
        { id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" },
      ], 0, suit);
      expect(state.removedSuit).toBe(suit);
      expect(state.tricksPerRound).toBe(13);
    }
  });

  it("rejects wrong trick totals and calls outside the valid range", () => {
    const state = createCallbreakScorekeeper([{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }]);
    expect(() => submitCallbreakScorekeeperBids(state, { a: 0, b: 2, c: 2, d: 2 })).toThrow(/call must be between/);
    const scored = submitCallbreakScorekeeperBids(state, { a: 1, b: 1, c: 1, d: 1 });
    expect(() => submitCallbreakScorekeeperTricks(scored, { a: 4, b: 4, c: 4, d: 0 })).toThrow(/add up to exactly 13/);
  });

  it("ends the match when a player reaches 31 points and keeps a JSON-safe best-round stat", () => {
    let state = createCallbreakScorekeeper([{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }]);
    state = { ...state, players: state.players.map((player, index) => ({ ...player, scoreTenths: index === 0 ? 300 : 0 })) };
    state = submitCallbreakScorekeeperBids(state, { a: 1, b: 1, c: 1, d: 1 });
    state = submitCallbreakScorekeeperTricks(state, { a: 1, b: 4, c: 4, d: 4 });
    expect(state.status).toBe("complete");
    expect(state.winnerIds).toEqual(["a"]);
    expect(state.players[0]!.bestRoundTenths).toBe(10);
    expect(JSON.parse(JSON.stringify(state)).players[0].bestRoundTenths).toBe(10);
  });
});

describe("Rummy declarations", () => {
  it("applies integer card-point penalties and the 80-point 13-card cap", () => {
    const hand: PlayingCard[] = [c("a", "spades", 14), c("9", "hearts", 9), c("k", "clubs", 13), joker];
    expect(calculateRummyPenalty(hand, "rummy-13")).toBe(29);
    expect(calculateRummyPenalty([...hand, ...hand, ...hand], "rummy-13")).toBe(80);
  });
  it("applies an 80-point penalty for an invalid 13-card declaration after drawing", () => {
    let state = createRummyGame("rummy-13", ["p1", "p2"], () => 0.31);
    state = drawRummyCard(state, "p1", "stock");
    const invalid = declareRummy(state, "p1", []);
    expect(invalid.status).toBe("discard");
    expect(invalid.players[0]!.points).toBe(80);
  });
  it("accepts a 13-card hand with two sequences and one pure sequence", () => {
    const cards: PlayingCard[] = [
      c("s2", "spades", 2), c("s3", "spades", 3), c("s4", "spades", 4),
      c("h5", "hearts", 5), c("h7", "hearts", 7), joker,
      c("kC", "clubs", 13), c("kD", "diamonds", 13), c("kH", "hearts", 13),
      c("6C", "clubs", 6), c("6D", "diamonds", 6), c("6H", "hearts", 6), c("6S", "spades", 6),
    ];
    const groups: RummyGroup[] = [{ cardIds: ["s2", "s3", "s4"] }, { cardIds: ["h5", "h7", "joker-1"] }, { cardIds: ["kC", "kD", "kH"] }, { cardIds: ["6C", "6D", "6H", "6S"] }];
    const result = validateIndianRummyDeclaration(cards, groups, 11);
    expect(result.valid).toBe(true);
    expect(result.pureSequences).toBe(1);
    expect(result.sequences).toBe(2);
  });
  it("rejects a 13-card hand with only one sequence", () => {
    const cards: PlayingCard[] = [c("s2", "spades", 2), c("s3", "spades", 3), c("s4", "spades", 4), ...[5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((rank, i) => c(`x${i}`, ["clubs", "diamonds", "hearts", "spades"][i % 4] as Card["suit"], rank as Card["rank"]))];
    const groups: RummyGroup[] = [{ cardIds: ["s2", "s3", "s4"] }, { cardIds: cards.slice(3).map(c => c.id) }];
    expect(validateIndianRummyDeclaration(cards, groups, 4).valid).toBe(false);
  });
  it("completes a 13-card declaration from a fourteen-card draw hand", () => {
    const groups: RummyGroup[] = [
      { cardIds: ["s2", "s3", "s4"] },
      { cardIds: ["h5", "h7", "joker-1"] },
      { cardIds: ["kC", "kD", "kH"] },
      { cardIds: ["6C", "6D", "6H", "6S"] },
    ];
    const hand: PlayingCard[] = [
      c("s2", "spades", 2), c("s3", "spades", 3), c("s4", "spades", 4),
      c("h5", "hearts", 5), c("h7", "hearts", 7), joker,
      c("kC", "clubs", 13), c("kD", "diamonds", 13), c("kH", "hearts", 13),
      c("6C", "clubs", 6), c("6D", "diamonds", 6), c("6H", "hearts", 6), c("6S", "spades", 6),
      c("final-discard", "clubs", 2),
    ];
    const state = { gameId: "rummy-13", status: "discard", players: [{ id: "p1", hand, points: 0, dropped: false }, { id: "p2", hand: [c("other", "spades", 10)], points: 0, dropped: false }], drawPile: [], discardPile: [], wildRank: 11, currentIndex: 0, handSize: 13, history: [] } as never;
    const result = declareRummy(state, "p1", groups);
    expect(result.status).toBe("complete");
    expect(result.winnerId).toBe("p1");
    expect(result.players[0]!.hand).toHaveLength(13);
    expect(result.discardPile.at(-1)?.id).toBe("final-discard");
  });
  it("accepts exactly three sets of 3, 3, and 4, and rejects runs", () => {
    const cards: Card[] = [
      c("5s", "spades", 5), c("5h", "hearts", 5), c("5c", "clubs", 5),
      c("8s", "spades", 8), c("8h", "hearts", 8), c("8d", "diamonds", 8),
      c("qs", "spades", 12), c("qh", "hearts", 12), c("qc", "clubs", 12), c("qd", "diamonds", 12),
    ];
    const sets: RummyGroup[] = [{ cardIds: ["5s", "5h", "5c"] }, { cardIds: ["8s", "8h", "8d"] }, { cardIds: ["qs", "qh", "qc", "qd"] }];
    expect(validateRummy10Declaration(cards, sets, 2).valid).toBe(true);
    const runs = [{ cardIds: ["5s", "8s", "qs"] }, ...sets.slice(1)];
    expect(validateRummy10Declaration(cards, runs, 2).valid).toBe(false);
  });
  it("preserves the wild indicator outside the playable stock", () => {
    const state = createRummyGame("rummy-13", ["p1", "p2"], () => 0.31);
    const all = [...state.players.flatMap(p => p.hand), ...state.drawPile, ...state.discardPile, ...(state.wildIndicator ? [state.wildIndicator] : [])];
    expect(all).toHaveLength(54);
    expect(new Set(all.map(card => card.id)).size).toBe(54);
    expect(state.drawPile.some(card => card.id === state.wildIndicator?.id)).toBe(false);
  });
  it("lets a bot declare a valid 3-3-4 hand after drawing one extra card", () => {
    const cards: Card[] = [
      c("5s", "spades", 5), c("5h", "hearts", 5), c("5c", "clubs", 5),
      c("8s", "spades", 8), c("8h", "hearts", 8), c("8d", "diamonds", 8),
      c("qs", "spades", 12), c("qh", "hearts", 12), c("qc", "clubs", 12), c("qd", "diamonds", 12),
      c("discard-me", "clubs", 2),
    ];
    const state = { gameId: "rummy-10", status: "discard", players: [{ id: "bot-1", hand: cards, points: 0, dropped: false }], drawPile: [], discardPile: [], wildRank: 2, currentIndex: 0, handSize: 10, history: [] } as never;
    const groups = findRummyDeclaration(state, "bot-1");
    expect(groups).not.toBeNull();
    const declared = declareRummy(state, "bot-1", groups!);
    expect(declared.status).toBe("complete");
    expect(declared.winnerId).toBe("bot-1");
  });
  it("lets a Rummy bot find a valid 3-3-4 set partition", () => {
    const cards: Card[] = [
      c("5s", "spades", 5), c("5h", "hearts", 5), c("5c", "clubs", 5),
      c("8s", "spades", 8), c("8h", "hearts", 8), c("8d", "diamonds", 8),
      c("qs", "spades", 12), c("qh", "hearts", 12), c("qc", "clubs", 12), c("qd", "diamonds", 12),
    ];
    const state = { gameId: "rummy-10", status: "draw", players: [{ id: "bot-1", hand: cards, points: 0, dropped: false }], drawPile: [], discardPile: [], wildRank: 2, currentIndex: 0, handSize: 10, history: [] } as const;
    const groups = findRummyDeclaration(state as never, "bot-1");
    expect(groups).not.toBeNull();
    expect(groups?.map(g => g.cardIds.length).sort()).toEqual([3, 3, 4]);
  });

  it("recycles the discard pile without losing cards", () => {
    let state = createRummyGame("rummy-13", ["p1", "p2"], () => 0.31);
    const [drawn, ...remainingStock] = state.drawPile;
    const movedFromOpponent = state.players[1]!.hand.slice(0, 2);
    const previousDiscard = [...state.discardPile];
    const hand = [...state.players[0]!.hand, drawn!];
    state = {
      ...state,
      status: "discard",
      players: state.players.map((p, i) => i === 0 ? { ...p, hand } : i === 1 ? { ...p, hand: p.hand.slice(2) } : p),
      drawPile: [],
      discardPile: [...previousDiscard, ...remainingStock, ...movedFromOpponent],
    };
    const next = discardRummyCard(state, "p1", hand[0]!.id, () => 0.5);
    const all = [...next.players.flatMap(p => p.hand), ...next.drawPile, ...next.discardPile, ...(next.wildIndicator ? [next.wildIndicator] : [])];
    expect(new Set(all.map(card => card.id)).size).toBe(all.length);
    expect(all).toHaveLength(54);
    expect(next.drawPile).toHaveLength(remainingStock.length + previousDiscard.length + movedFromOpponent.length);
    expect(next.discardPile).toHaveLength(1);
  });

});
