import assert from 'node:assert/strict';
import { createDeck, shuffle } from '../.check-build/packages/shared/src/cards.js';
import {
  createCallbreakRound,
  callbreakChooseTrump,
  callbreakBid,
  callbreakPlay,
  getLegalCallbreakCardIds,
  startNextCallbreakRound,
} from '../.check-build/packages/shared/src/games/callbreak.js';
import {
  createCallbreakScorekeeper,
  submitCallbreakScorekeeperBids,
  submitCallbreakScorekeeperTricks,
  nextCallbreakScorekeeperRound,
  formatCallbreakScore,
} from '../.check-build/packages/shared/src/games/callbreak-companion.js';

const fixedRandom = () => 0.371;
const card = (id, suit, rank) => ({ id, suit, rank });

// Online: exactly four players. Five cards are dealt, then the score-ordered trump auction runs.
let online = createCallbreakRound([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], 1, fixedRandom);
const expectedDeal = shuffle(createDeck(), fixedRandom);
assert.equal(online.players[1].hand[0].id, expectedDeal[0].id, 'first card is dealt to the seat left of dealer');
assert.equal(online.players[2].hand[0].id, expectedDeal[1].id);
assert.equal(online.players[0].hand[1].id, expectedDeal[7].id, 'deal continues clockwise on each pass');
assert.equal(online.players.length, 4);
assert.deepEqual(online.players.map(player => player.hand.length), [5, 5, 5, 5]);
assert.equal(online.deck.length, 32);
assert.equal(new Set(online.players.flatMap(player => player.hand.map(item => item.id))).size, 20);
for (const playerId of online.trumpOrder) online = callbreakChooseTrump(online, playerId, null);
assert.equal(online.trumpSuit, 'spades', 'all passes leave spades as the default trump');
assert.deepEqual(online.players.map(player => player.hand.length), [13, 13, 13, 13]);
assert.equal(online.deck.length, 0);
assert.equal(new Set(online.players.flatMap(player => player.hand.map(item => item.id))).size, 52);
for (let i = 0; i < 4; i += 1) online = callbreakBid(online, online.players[online.currentIndex].id, 1);

// The last successful selection sets trump; only successful choices increase personal minimum calls.
let auction = createCallbreakRound([
  { id: 'a', scoreTenths: 30 }, { id: 'b', scoreTenths: -20 },
  { id: 'c', scoreTenths: 10 }, { id: 'd', scoreTenths: 0 },
], 1, fixedRandom);
assert.deepEqual(auction.trumpOrder, ['b', 'd', 'c', 'a']);
auction = callbreakChooseTrump(auction, 'b', 'hearts');
auction = callbreakChooseTrump(auction, 'd', null);
auction = callbreakChooseTrump(auction, 'c', 'diamonds');
auction = callbreakChooseTrump(auction, 'a', null);
assert.equal(auction.trumpSuit, 'diamonds');
assert.deepEqual(auction.trumpSelections.map(item => [item.playerId, item.minimumTricks]), [['b', 5], ['c', 6]]);
assert.throws(() => callbreakBid(auction, 'b', 4), /between 5 and 13/);
auction = callbreakBid(auction, 'b', 5);
assert.equal(auction.players.find(player => player.id === 'b').bid, 5);
assert.equal(online.status, 'playing');
let playGuard = 0;
while (online.status === 'playing' && playGuard++ < 60) {
  const current = online.players[online.currentIndex];
  const legal = getLegalCallbreakCardIds(online, current.id);
  assert.ok(legal.length > 0, 'Current player always has a legal play');
  online = callbreakPlay(online, current.id, legal[0]);
}
assert.equal(online.status, 'round-complete');
assert.equal(online.players.reduce((sum, player) => sum + player.tricksWon, 0), 13);
assert.ok(online.roundScores);
const nextOnline = startNextCallbreakRound(online, fixedRandom);
assert.equal(nextOnline.round, 2);
assert.equal(nextOnline.dealerIndex, 1);
assert.equal(nextOnline.players[2].hand[0].id, expectedDeal[0].id, 'next round deal begins left of the rotated dealer');
assert.deepEqual(nextOnline.players.map(player => player.scoreTenths), online.players.map(player => player.scoreTenths));

// Follow suit and beat when possible.
let strict = {
  gameId: 'callbreak', status: 'playing', round: 1,
  players: [
    { id: 'p0', hand: [card('h10', 'hearts', 10)], bid: 1, tricksWon: 0, scoreTenths: 0 },
    { id: 'p1', hand: [card('h3', 'hearts', 3), card('hQ', 'hearts', 12), card('sA', 'spades', 14)], bid: 1, tricksWon: 0, scoreTenths: 0 },
    { id: 'p2', hand: [card('hK', 'hearts', 13)], bid: 1, tricksWon: 0, scoreTenths: 0 },
    { id: 'p3', hand: [card('h2', 'hearts', 2)], bid: 1, tricksWon: 0, scoreTenths: 0 },
  ], currentIndex: 0, leaderIndex: 0, trick: [], trickNumber: 0, history: [],
};
strict = callbreakPlay(strict, 'p0', 'h10');
assert.deepEqual(getLegalCallbreakCardIds(strict, 'p1'), ['hQ']);
assert.throws(() => callbreakPlay(strict, 'p1', 'sA'), /follow the led suit/);
assert.throws(() => callbreakPlay(strict, 'p1', 'h3'), /beat its highest card/);

// When void in the led suit, a player must trump; when possible they must overtrump.
let trump = {
  gameId: 'callbreak', status: 'playing', round: 1,
  players: [
    { id: 't0', hand: [card('th10', 'hearts', 10)], bid: 1, tricksWon: 0, scoreTenths: 0 },
    { id: 't1', hand: [card('ts4', 'spades', 4), card('tsQ', 'spades', 12), card('tc2', 'clubs', 2)], bid: 1, tricksWon: 0, scoreTenths: 0 },
    { id: 't2', hand: [card('td2', 'diamonds', 2)], bid: 1, tricksWon: 0, scoreTenths: 0 },
    { id: 't3', hand: [card('tc3', 'clubs', 3)], bid: 1, tricksWon: 0, scoreTenths: 0 },
  ], currentIndex: 0, leaderIndex: 0, trick: [], trickNumber: 0, history: [],
};
trump = callbreakPlay(trump, 't0', 'th10');
assert.deepEqual(new Set(getLegalCallbreakCardIds(trump, 't1')), new Set(['ts4', 'tsQ']));
assert.throws(() => callbreakPlay(trump, 't1', 'tc2'), /play a card in spades/);
trump = callbreakPlay(trump, 't1', 'tsQ');
trump.players[2].hand = [card('ts8', 'spades', 8), card('tsK', 'spades', 13), card('td3', 'diamonds', 3)];
assert.deepEqual(getLegalCallbreakCardIds(trump, 't2'), ['tsK']);
assert.throws(() => callbreakPlay(trump, 't2', 'ts8'), /overtrump/);
trump.players[2].hand = [card('ts2', 'spades', 2), card('ts8', 'spades', 8)];
assert.deepEqual(new Set(getLegalCallbreakCardIds(trump, 't2')), new Set(['ts2', 'ts8']));

// Offline physical-deck scorekeeper: four players, 13 tricks, 0.1 overtrick accounting.
let offline4 = createCallbreakScorekeeper([
  { id: 'a', name: 'Ada' }, { id: 'b', name: 'Ben' },
  { id: 'c', name: 'Cleo' }, { id: 'd', name: 'Dev' },
]);
assert.equal(offline4.tricksPerRound, 13);
offline4 = submitCallbreakScorekeeperBids(offline4, { a: 3, b: 4, c: 2, d: 1 });
offline4 = submitCallbreakScorekeeperTricks(offline4, { a: 4, b: 3, c: 3, d: 3 });
assert.equal(offline4.status, 'round-results');
assert.deepEqual(offline4.roundLedger.map(row => row.scoreTenths), [31, -40, 21, 12]);
assert.equal(formatCallbreakScore(offline4.roundLedger[0].scoreTenths), '+3.1');
assert.equal(nextCallbreakScorekeeperRound(offline4).round, 2);

// Offline three-player house deal removes all thirteen cards of any one suit: 39 cards, 13 each, 13 tricks.
let offline3 = createCallbreakScorekeeper([
  { id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' },
], 0, 'hearts');
assert.equal(offline3.tricksPerRound, 13);
assert.equal(offline3.removedSuit, 'hearts');
offline3 = submitCallbreakScorekeeperBids(offline3, { a: 5, b: 4, c: 8 });
offline3 = submitCallbreakScorekeeperTricks(offline3, { a: 5, b: 4, c: 4 });
assert.deepEqual(offline3.roundLedger.map(row => row.scoreTenths), [50, 40, -80]);
assert.equal(offline3.roundLedger.reduce((sum, row) => sum + row.tricksWon, 0), 13);
assert.throws(() => submitCallbreakScorekeeperBids(createCallbreakScorekeeper([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]), { a: 14, b: 1, c: 1 }), /between 1 and 13/);
assert.throws(() => submitCallbreakScorekeeperTricks({ ...offline3, status: 'score-entry' }, { a: 6, b: 6, c: 6 }), /exactly 13/);
for (const suit of ['clubs', 'diamonds', 'hearts', 'spades']) {
  const withRemovedSuit = createCallbreakScorekeeper([{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }, { id: 'z', name: 'Z' }], 0, suit);
  assert.equal(withRemovedSuit.removedSuit, suit);
  assert.equal(withRemovedSuit.tricksPerRound, 13);
}
assert.throws(() => createCallbreakScorekeeper([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], 0, 'invalid'), /four suits/);

// First-to-31 match termination is applied after the final round score is recorded.
let target = createCallbreakScorekeeper([
  { id: 'a', name: 'Ace' }, { id: 'b', name: 'Bee' },
  { id: 'c', name: 'Cee' }, { id: 'd', name: 'Dee' },
]);
target = { ...target, players: target.players.map((player, index) => ({ ...player, scoreTenths: index === 0 ? 300 : 0 })) };
target = submitCallbreakScorekeeperBids(target, { a: 1, b: 1, c: 1, d: 1 });
target = submitCallbreakScorekeeperTricks(target, { a: 1, b: 4, c: 4, d: 4 });
assert.equal(target.status, 'complete');
assert.deepEqual(target.winnerIds, ['a']);
assert.equal(JSON.parse(JSON.stringify(target)).players[0].bestRoundTenths, 10);
console.log('PASS: Callbreak five-card score-ordered trump auction, 5/6 commitment sequence, full online deal/bidding/tricks/scoring, forced follow/overtake/trump/overtrump, 3P and 4P 13-trick offline scorekeeper, 0.1 overtricks, dealer rotation, and first-to-31 finish');
