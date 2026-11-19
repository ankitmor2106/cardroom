import assert from 'node:assert/strict';
import { createDeck } from '../.check-build/packages/shared/src/cards.js';
import {
  createBlackjackBettingGame, blackjackSetBet, blackjackConfirmBet, blackjackSitOut, blackjackStartDeal, blackjackDecideInsurance, blackjackNextRound, blackjackAction, blackjackValue,
} from '../.check-build/packages/shared/src/games/blackjack.js';
import {
  createBlackjackCompanion, companionSetBet, companionConfirmBet, companionSitOut, companionStartDeal,
  companionSelectCard, companionPlayerAction, companionDealerHit, companionDealerStand,
  companionNextRound, companionSelectBettingPlayer, companionTopUpWallet, companionDecideInsurance,
} from '../.check-build/packages/shared/src/games/blackjack-companion.js';

const deterministic = () => 0.37;
const card = id => createDeck().find(item => item.id === id);
const confirm = (state, id, bet = 500) => {
  let next = companionSetBet(state, id, bet);
  return companionConfirmBet(next, id);
};
const enter = (state, ids) => ids.reduce((next, id) => companionSelectCard(next, id), state);

// Manual betting order and wallet top-ups are available before any wager is locked.
let betting = createBlackjackCompanion([{ name: 'Asha', balance: 10_000 }, { name: 'Kabir', balance: 10_000 }, { name: 'Mira', balance: 10_000 }]);
betting = companionSelectBettingPlayer(betting, 'local-3');
betting = companionTopUpWallet(betting, 'local-3', 2_000);
assert.equal(betting.players[2].balance, 12_000);
betting = confirm(betting, 'local-3', 1_000);
assert.equal(betting.players[2].betConfirmed, true);
assert.equal(betting.players[0].betConfirmed, false);
assert.equal(betting.bettingIndex, 0, 'After player three confirms, selection wraps to the first unconfirmed player.');
betting = confirm(betting, 'local-1', 500);
betting = confirm(betting, 'local-2', 500);
assert.equal(betting.bettingIndex, 3);
assert.throws(() => companionTopUpWallet(betting, 'local-1', 500), /already locked/);

// Opening physical deal: all active players first, dealer up-card, then all player second cards.
let local = createBlackjackCompanion([{ name: 'Asha', balance: 10_000 }, { name: 'Kabir', balance: 10_000 }]);
local = confirm(local, 'local-1', 500);
local = confirm(local, 'local-2', 500);
local = companionStartDeal(local);
assert.equal(local.stage, 'dealing');
const opening = ['0-spades-5', '0-hearts-6', '0-diamonds-10', '0-clubs-8', '0-spades-7'];
local = companionSelectCard(local, opening[0]);
assert.throws(() => companionSelectCard(local, opening[0]), /already been used/);
for (const id of opening.slice(1)) local = companionSelectCard(local, id);
assert.equal(local.stage, 'playing');
assert.deepEqual(local.players.map(player => player.hands[0].cards.length), [2, 2]);
assert.equal(local.dealer.length, 1, 'Dealer receives only the up-card during the opening deal.');
assert.equal(local.dealerRevealed, false);
local = companionPlayerAction(local, 'local-1', 'stand');
local = companionPlayerAction(local, 'local-2', 'stand');
assert.equal(local.stage, 'dealer');
assert.equal(local.pendingCards[0].kind, 'dealer', 'Dealer hole card is entered only after every player is finished.');
local = companionSelectCard(local, '0-clubs-4'); // Dealer is now on 14.
assert.equal(local.dealer.length, 2);
assert.equal(local.dealerRevealed, true);
local = companionDealerHit(local);
local = companionSelectCard(local, '0-clubs-3'); // Dealer reaches 17.
local = companionDealerStand(local);
assert.equal(local.stage, 'complete');
assert.equal(local.players[0].balance, 9_500);
assert.equal(local.players[1].balance, 9_500);
local = companionNextRound(local);
assert.equal(local.stage, 'betting');
assert.equal(local.roundNumber, 2);
assert.equal(local.players[0].balance, 9_500);

// Surrender waits for the dealer hole card before settling the table.
let surrender = createBlackjackCompanion([{ name: 'Mira', balance: 10_000 }, { name: 'Dev', balance: 10_000 }]);
surrender = confirm(surrender, 'local-1', 1_000);
surrender = companionSitOut(surrender, 'local-2');
surrender = companionStartDeal(surrender);
surrender = enter(surrender, ['0-spades-8', '0-diamonds-6', '0-hearts-7']);
assert.equal(surrender.stage, 'playing');
surrender = companionPlayerAction(surrender, 'local-1', 'surrender');
assert.equal(surrender.stage, 'dealer');
assert.equal(surrender.stage === 'complete', false);
surrender = companionSelectCard(surrender, '0-clubs-10');
assert.equal(surrender.stage, 'complete');
assert.equal(surrender.players[0].balance, 9_500);
assert.equal(surrender.dealerOutcome, 'no-live-hands');

// If every active hand busts, the dealer hole card is still entered at the end, then dealer draws are skipped.
let allBusted = createBlackjackCompanion([{ name: 'Tara', balance: 10_000 }, { name: 'Neil', balance: 10_000 }]);
allBusted = confirm(allBusted, 'local-1', 1_000);
allBusted = companionSitOut(allBusted, 'local-2');
allBusted = companionStartDeal(allBusted);
allBusted = enter(allBusted, ['0-spades-10', '0-diamonds-6', '0-hearts-9']);
allBusted = companionPlayerAction(allBusted, 'local-1', 'hit');
allBusted = companionSelectCard(allBusted, '0-clubs-5');
assert.equal(allBusted.players[0].hands[0].status, 'busted');
assert.equal(allBusted.stage, 'dealer');
assert.equal(allBusted.pendingCards[0].kind, 'dealer');
allBusted = companionSelectCard(allBusted, '0-spades-4');
assert.equal(allBusted.stage, 'complete');
assert.equal(allBusted.dealerOutcome, 'no-live-hands');
assert.equal(allBusted.players[0].balance, 9_000);

// Offline insurance uses the visible Ace without revealing the delayed dealer hole card.
let insured = createBlackjackCompanion([{ name: 'Avi', balance: 10_000 }, { name: 'Sana', balance: 10_000 }]);
insured = confirm(insured, 'local-1', 1_000);
insured = confirm(insured, 'local-2', 1_000);
insured = companionStartDeal(insured);
insured = enter(insured, ['0-spades-8', '0-hearts-10', '0-diamonds-14', '0-clubs-9', '0-spades-7']);
assert.equal(insured.stage, 'insurance');
assert.equal(insured.dealer.length, 1, 'Insurance does not reveal or enter the dealer hole card.');
insured = companionDecideInsurance(insured, 'local-1', true);
assert.equal(insured.players[0].balance, 8_500);
insured = companionDecideInsurance(insured, 'local-2', false);
assert.equal(insured.stage, 'playing');
insured = companionPlayerAction(insured, 'local-1', 'stand');
insured = companionPlayerAction(insured, 'local-2', 'stand');
assert.equal(insured.stage, 'dealer');
insured = companionSelectCard(insured, '0-hearts-13');
assert.equal(insured.stage, 'complete');
assert.equal(insured.dealerOutcome, 'blackjack');
assert.equal(insured.players[0].balance, 10_000, 'Insurance returns stake plus 2:1 winnings when dealer has Blackjack.');
assert.equal(insured.players[1].balance, 9_000, 'A player who declined insurance loses the original wager.');

// A dealer natural is determined only once the deferred hole card is selected.
let dealerNatural = createBlackjackCompanion([{ name: 'Ira', balance: 10_000 }, { name: 'Noah', balance: 10_000 }]);
dealerNatural = confirm(dealerNatural, 'local-1', 1_000);
dealerNatural = companionSitOut(dealerNatural, 'local-2');
dealerNatural = companionStartDeal(dealerNatural);
dealerNatural = enter(dealerNatural, ['0-spades-8', '0-diamonds-10', '0-hearts-9']);
assert.equal(dealerNatural.stage, 'playing', 'A ten-valued dealer up-card does not trigger insurance.');
dealerNatural = companionPlayerAction(dealerNatural, 'local-1', 'stand');
assert.equal(dealerNatural.stage, 'dealer');
dealerNatural = companionSelectCard(dealerNatural, '0-clubs-14');
assert.equal(dealerNatural.stage, 'complete');
assert.equal(dealerNatural.dealerOutcome, 'blackjack');
assert.equal(dealerNatural.players[0].balance, 9_000);

// Double down takes one exact physical card and doubles wager before the dealer phase.
let doubled = createBlackjackCompanion([{ name: 'Riya', balance: 10_000 }, { name: 'Arjun', balance: 10_000 }]);
doubled = confirm(doubled, 'local-1', 1_000);
doubled = companionSitOut(doubled, 'local-2');
doubled = companionStartDeal(doubled);
doubled = enter(doubled, ['0-spades-5', '0-diamonds-6', '0-hearts-6']);
doubled = companionPlayerAction(doubled, 'local-1', 'double');
assert.equal(doubled.players[0].balance, 8_000);
assert.equal(doubled.players[0].hands[0].bet, 2_000);
doubled = companionSelectCard(doubled, '0-spades-10');
assert.equal(doubled.stage, 'dealer');
doubled = companionSelectCard(doubled, '0-clubs-6'); // Dealer hole card makes 12.
doubled = companionDealerHit(doubled);
doubled = companionSelectCard(doubled, '0-clubs-5'); // Dealer reaches 17.
doubled = companionDealerStand(doubled);
assert.equal(doubled.players[0].balance, 12_000);

// Split pair creates two hands; after both stand, dealer hole card is selected.
let split = createBlackjackCompanion([{ name: 'Nia', balance: 10_000 }, { name: 'Ishaan', balance: 10_000 }]);
split = confirm(split, 'local-1', 500);
split = companionSitOut(split, 'local-2');
split = companionStartDeal(split);
split = enter(split, ['0-spades-8', '0-diamonds-6', '0-hearts-8']);
split = companionPlayerAction(split, 'local-1', 'split');
assert.equal(split.pendingCards.length, 2);
split = companionSelectCard(split, '0-clubs-3');
split = companionSelectCard(split, '0-hearts-4');
assert.equal(split.players[0].hands.length, 2);
assert.deepEqual(split.players[0].hands.map(hand => hand.cards.length), [2, 2]);
split = companionPlayerAction(split, 'local-1', 'stand');
split = companionPlayerAction(split, 'local-1', 'stand');
assert.equal(split.stage, 'dealer');
split = companionSelectCard(split, '0-clubs-6');
split = companionDealerHit(split);
split = companionSelectCard(split, '0-spades-5');
split = companionDealerStand(split);
assert.equal(split.players[0].balance, 9_000);

// A natural 21 pays 3:2 when the dealer does not also have Blackjack.
let natural = createBlackjackCompanion([{ name: 'Zoya', balance: 10_000 }, { name: 'Veer', balance: 10_000 }]);
natural = confirm(natural, 'local-1', 1_000);
natural = companionSitOut(natural, 'local-2');
natural = companionStartDeal(natural);
natural = enter(natural, ['0-spades-14', '0-diamonds-6', '0-hearts-13']);
assert.equal(natural.players[0].hands[0].status, 'blackjack');
assert.equal(natural.stage, 'dealer');
natural = companionSelectCard(natural, '0-clubs-2'); // Dealer 8.
natural = companionDealerHit(natural); natural = companionSelectCard(natural, '0-diamonds-5'); // 13.
natural = companionDealerHit(natural); natural = companionSelectCard(natural, '0-hearts-4'); // 17.
natural = companionDealerStand(natural);
assert.equal(natural.players[0].balance, 11_500);

// 2–9 seat bounds and value semantics.
assert.throws(() => createBlackjackCompanion([{ name: 'Only one', balance: 1000 }]), /2–9/);
assert.throws(() => createBlackjackCompanion(Array.from({ length: 10 }, (_, i) => ({ name: `P${i}`, balance: 1000 }))), /2–9/);
assert.equal(blackjackValue([{ id: 'ace', suit: 'spades', rank: 14 }, { id: 'six', suit: 'clubs', rank: 6 }]).total, 17);

// Online table remains server-dealt and retains its existing insurance flow.
let online = createBlackjackBettingGame([{ id: 'p1', chips: 10_000 }, { id: 'p2', chips: 10_000 }], {}, deterministic);
assert.equal(online.status, 'betting');
online = blackjackSetBet(online, 'p1', 500); online = blackjackConfirmBet(online, 'p1');
assert.throws(() => blackjackStartDeal(online), /Every player/);
online = blackjackSetBet(online, 'p2', 1_000); online = blackjackConfirmBet(online, 'p2');
const shoe = ['0-spades-5', '0-hearts-6', '0-diamonds-10', '0-clubs-7', '0-spades-8', '0-clubs-6'];
online.deck = [...shoe.map(id => card(id)), ...createDeck().filter(c => !shoe.includes(c.id))];
online = blackjackStartDeal(online);
assert.equal(online.status, 'player-turn');
assert.deepEqual(online.players.map(p => p.hands[0].cards.length), [2, 2]);
assert.equal(online.players[0].chips, 9_500);
assert.equal(online.players[1].chips, 9_000);
online = blackjackAction(online, 'p1', 'stand');
online = blackjackAction(online, 'p2', 'surrender');
assert.equal(online.status, 'complete');
assert.equal(online.players[1].chips, 9_500);
assert.equal(online.players[0].hands[0].outcome, 'loss');
assert.equal(online.players[0].hands[0].net, -500);
assert.equal(online.players[1].hands[0].outcome, 'surrender');
assert.equal(online.players[1].hands[0].net, -500);
assert.deepEqual(online.results, { p1: -500, p2: -500 });
const nextOnline = blackjackNextRound(online, deterministic);
assert.equal(nextOnline.status, 'betting');
assert.equal(nextOnline.players[0].chips, online.players[0].chips);
assert.equal(nextOnline.players[0].betConfirmed, false);
assert.deepEqual(nextOnline.results, {}, 'A new round clears prior outcome totals.');
let onlineInsurance = createBlackjackBettingGame([{ id: 'ia', chips: 10_000 }, { id: 'ib', chips: 10_000 }], {}, deterministic);
onlineInsurance = blackjackSetBet(onlineInsurance, 'ia', 1_000); onlineInsurance = blackjackConfirmBet(onlineInsurance, 'ia');
onlineInsurance = blackjackSitOut(onlineInsurance, 'ib');
const insuranceShoe = ['0-spades-8', '0-diamonds-14', '0-hearts-9', '0-clubs-13'];
onlineInsurance.deck = [...insuranceShoe.map(id => card(id)), ...createDeck().filter(c => !insuranceShoe.includes(c.id))];
onlineInsurance = blackjackStartDeal(onlineInsurance);
assert.equal(onlineInsurance.status, 'insurance');
onlineInsurance = blackjackDecideInsurance(onlineInsurance, 'ia', true);
assert.equal(onlineInsurance.status, 'complete');
assert.equal(onlineInsurance.players[0].chips, 10_000);
assert.equal(onlineInsurance.players[0].hands[0].outcome, 'loss');
assert.equal(onlineInsurance.results.ia, 0, 'The insurance profit offsets the main-hand loss in the net result.');
assert.equal(onlineInsurance.results.ib, 0, 'A player who sits out has a neutral result.');

// A split player can win one hand and lose the other; the engine keeps both results and one neutral net.
let mixedSplit = {
  gameId: 'blackjack', status: 'player-turn',
  players: [{ id: 'split-player', chips: 800, hands: [
    { cards: [card('0-spades-13'), card('0-hearts-12')], bet: 100, status: 'playing', doubled: false, splitAces: false },
    { cards: [card('0-clubs-10'), card('0-diamonds-6')], bet: 100, status: 'playing', doubled: false, splitAces: false },
  ] }],
  dealer: [card('0-spades-10'), card('0-clubs-8')], deck: [], activePlayerIndex: 0, activeHandIndex: 0,
  rules: { dealerHitsSoft17: false, blackjackNumerator: 3, blackjackDenominator: 2, allowDouble: true, allowSplit: true, maxHands: 4 }, results: {}, history: [],
};
mixedSplit = blackjackAction(mixedSplit, 'split-player', 'stand');
mixedSplit = blackjackAction(mixedSplit, 'split-player', 'stand');
assert.deepEqual(mixedSplit.players[0].hands.map(hand => hand.outcome), ['win', 'loss']);
assert.deepEqual(mixedSplit.players[0].hands.map(hand => hand.net), [100, -100]);
assert.equal(mixedSplit.results['split-player'], 0);
assert.equal(createDeck().length, 52);
console.log('PASS: offline Blackjack physical-card flow and online dealing, with per-player win/loss/push/surrender/insurance net results and mixed split-hand outcomes persisted for the result UI.');
