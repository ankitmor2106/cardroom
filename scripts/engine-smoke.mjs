import assert from 'node:assert/strict';
import { createDeck, shuffle } from '../.check-build/packages/shared/src/cards.js';
import { createBlackjackGame, blackjackAction, blackjackValue } from '../.check-build/packages/shared/src/games/blackjack.js';
import { createHoldemGame, holdemAction, evaluateFive, evaluateBestHand } from '../.check-build/packages/shared/src/games/holdem.js';
import { createTeenPattiGame, teenPattiAction, evaluateTeenPatti, compareTeenPatti } from '../.check-build/packages/shared/src/games/teenPatti.js';
import { createCallbreakRound, callbreakChooseTrump, callbreakBid, callbreakPlay, getLegalCallbreakCardIds } from '../.check-build/packages/shared/src/games/callbreak.js';
import { createRummyGame, drawRummyCard, discardRummyCard, validateRummy10Declaration } from '../.check-build/packages/shared/src/games/rummy.js';
import { findRummyDeclaration, chooseTeenPattiBotAction } from '../.check-build/packages/game-engines/src/bots.js';
const deterministic = () => 0.37;
assert.equal(createDeck().length, 52);
assert.equal(new Set(shuffle(createDeck(), deterministic).map(c => c.id)).size, 52);
assert.equal(blackjackValue([{id:'a',suit:'spades',rank:14},{id:'6',suit:'clubs',rank:6}]).total, 17);
let bj = createBlackjackGame([{id:'p1',chips:1000,bet:20}], {}, deterministic);
let bjGuard = 0;
while (bj.status === 'player-turn' && bjGuard++ < 8) bj = blackjackAction(bj, 'p1', 'stand');
assert.equal(bj.status, 'complete');
assert.equal(bj.players[0].chips >= 0, true);
let poker = createHoldemGame([{id:'p1',chips:1000},{id:'p2',chips:1000}], {}, deterministic);
let pokerGuard = 0;
while (poker.status === 'betting' && pokerGuard++ < 10) poker = holdemAction(poker, poker.players[poker.actingIndex].id, {type:'fold'});
assert.equal(poker.status, 'complete');
assert.equal(poker.players.reduce((s,p)=>s+p.chips,0), 2000);
const wheel = evaluateFive([{id:'a',suit:'spades',rank:14},{id:'2',suit:'clubs',rank:2},{id:'3',suit:'hearts',rank:3},{id:'4',suit:'diamonds',rank:4},{id:'5',suit:'spades',rank:5}]);
assert.deepEqual(wheel.rank, [4,5]);
assert.equal(evaluateBestHand([{id:'a',suit:'spades',rank:14},{id:'k',suit:'spades',rank:13},{id:'q',suit:'spades',rank:12},{id:'j',suit:'spades',rank:11},{id:'t',suit:'spades',rank:10},{id:'2',suit:'clubs',rank:2},{id:'3',suit:'hearts',rank:3}]).category,'straight-flush');
let tp = createTeenPattiGame([{id:'p1',chips:500},{id:'p2',chips:500},{id:'p3',chips:500}], 10, deterministic);
tp = teenPattiAction(tp, 'p1', 'fold'); tp = teenPattiAction(tp, 'p2', 'fold');
assert.equal(tp.status, 'complete'); assert.equal(tp.winnerId, 'p3');
let cb = createCallbreakRound([{id:'p1'},{id:'p2'},{id:'p3'},{id:'p4'}], 1, deterministic);
assert.deepEqual(cb.players.map(p => p.hand.length), [5,5,5,5]);
for (const id of cb.trumpOrder) cb = callbreakChooseTrump(cb, id, null);
assert.equal(cb.status, 'bidding'); assert.deepEqual(cb.players.map(p => p.hand.length), [13,13,13,13]);
for (let i=0; i<4; i++) cb = callbreakBid(cb, cb.players[cb.currentIndex].id, 1);
let cbGuard = 0;
while (cb.status === 'playing' && cbGuard++ < 60) { const id = cb.players[cb.currentIndex].id; cb = callbreakPlay(cb, id, getLegalCallbreakCardIds(cb, id)[0]); }
assert.equal(cb.status, 'round-complete'); assert.equal(cb.players.reduce((s,p)=>s+p.tricksWon,0), 13);
let scored = { gameId:'callbreak',status:'playing',round:5,players:[
{id:'p0',hand:[{id:'s2',suit:'spades',rank:2}],bid:1,tricksWon:1,scoreTenths:0},
{id:'p1',hand:[{id:'s3',suit:'spades',rank:3}],bid:2,tricksWon:1,scoreTenths:0},
{id:'p2',hand:[{id:'hA',suit:'hearts',rank:14}],bid:1,tricksWon:0,scoreTenths:0},
{id:'p3',hand:[{id:'sK',suit:'spades',rank:13}],bid:1,tricksWon:0,scoreTenths:0}],currentIndex:0,leaderIndex:0,trick:[],trickNumber:12,history:[]};
for (const [id,card] of [['p0','s2'],['p1','s3'],['p2','hA'],['p3','sK']]) scored = callbreakPlay(scored,id,card);
assert.deepEqual(scored.roundScores,{p0:10,p1:-20,p2:-10,p3:10}); assert.equal(scored.status,'round-complete');
let r13 = createRummyGame('rummy-13',['p1','p2'],deterministic);
assert.equal(r13.players[0].hand.length,13); r13 = drawRummyCard(r13,'p1','stock'); r13 = discardRummyCard(r13,'p1',r13.players[0].hand[0].id); assert.equal(r13.currentIndex,1);
let r10 = createRummyGame('rummy-10',['p1','p2'],deterministic); assert.equal(r10.players[0].hand.length,10);
const cards = [{id:'5s',suit:'spades',rank:5},{id:'5h',suit:'hearts',rank:5},{id:'5c',suit:'clubs',rank:5},{id:'8s',suit:'spades',rank:8},{id:'8h',suit:'hearts',rank:8},{id:'8d',suit:'diamonds',rank:8},{id:'qs',suit:'spades',rank:12},{id:'qh',suit:'hearts',rank:12},{id:'qc',suit:'clubs',rank:12},{id:'qd',suit:'diamonds',rank:12}];
const groups = findRummyDeclaration({gameId:'rummy-10',status:'draw',players:[{id:'bot',hand:cards,points:0,dropped:false}],drawPile:[],discardPile:[],wildRank:2,currentIndex:0,handSize:10,history:[]}, 'bot');
assert.deepEqual(groups?.map(g=>g.cardIds.length).sort(), [3,3,4]);
console.log('PASS: six rule-engine smoke scenarios, Callbreak scoring, and offline bot 3-3-4 declaration search');
// Regression: multiway post-flop action starts immediately left of dealer.
let order = createHoldemGame([{id:'p0',chips:100},{id:'p1',chips:100},{id:'p2',chips:100}], {smallBlind:5,bigBlind:10,dealerIndex:1}, deterministic);
order = holdemAction(order, order.players[order.actingIndex].id, {type:'call'});
order = holdemAction(order, order.players[order.actingIndex].id, {type:'call'});
order = holdemAction(order, order.players[order.actingIndex].id, {type:'check'});
assert.equal(order.street, 'flop'); assert.equal(order.players[order.actingIndex].id, 'p2');
// Regression: all-in tiers are retained as side pots and chip supply is conserved.
let tiers = createHoldemGame([{id:'a',chips:100},{id:'b',chips:50},{id:'c',chips:25}], {smallBlind:5,bigBlind:10}, deterministic);
tiers = holdemAction(tiers, 'a', {type:'raise',amount:100});
tiers = holdemAction(tiers, 'b', {type:'all-in'});
tiers = holdemAction(tiers, 'c', {type:'all-in'});
assert.equal(tiers.status, 'complete'); assert.deepEqual(tiers.pots.map(p=>p.amount), [75,50,50]);
assert.equal(tiers.players.reduce((sum,p)=>sum+p.chips,0), 175);
// Regression: a short all-in increase does not reopen raising for prior actors.
let short = createHoldemGame([{id:'p0',chips:300},{id:'p1',chips:300},{id:'p2',chips:65}], {smallBlind:5,bigBlind:10,dealerIndex:2}, deterministic);
short = holdemAction(short,'p2',{type:'call'}); short = holdemAction(short,'p0',{type:'call'}); short = holdemAction(short,'p1',{type:'check'});
short = holdemAction(short,'p0',{type:'bet',amount:50}); short = holdemAction(short,'p1',{type:'call'}); short = holdemAction(short,'p2',{type:'all-in'}); short = holdemAction(short,'p0',{type:'call'});
assert.equal(short.players[short.actingIndex].id, 'p1');
assert.throws(()=>holdemAction(short,'p1',{type:'raise',amount:100}), /not reopened/);
// Regression: an empty stock recycles every discard except the visible top card.
let rec = createRummyGame('rummy-13',['p1','p2'],deterministic);
const [picked,...oldStock] = rec.drawPile;
const moved = rec.players[1].hand.slice(0,2); const visible = [...rec.discardPile];
const expanded = [...rec.players[0].hand,picked];
rec = {...rec,status:'discard',players:rec.players.map((p,i)=>i===0?{...p,hand:expanded}:i===1?{...p,hand:p.hand.slice(2)}:p),drawPile:[],discardPile:[...visible,...oldStock,...moved]};
rec = discardRummyCard(rec,'p1',expanded[0].id,deterministic);
const accounted = [...rec.players.flatMap(p=>p.hand),...rec.drawPile,...rec.discardPile,...(rec.wildIndicator ? [rec.wildIndicator] : [])];
assert.equal(accounted.length,54); assert.equal(new Set(accounted.map(c=>c.id)).size,54);
console.log('PASS: poker seat order, side-pot conservation, short-all-in reopen rule, and Rummy stock recycle regressions');
// Teen Patti: A-2-3 outranks A-K-Q and a tied show makes the caller lose.
const akq = evaluateTeenPatti([{id:'a',suit:'clubs',rank:14},{id:'k',suit:'hearts',rank:13},{id:'q',suit:'spades',rank:12}]);
const a23 = evaluateTeenPatti([{id:'a2',suit:'clubs',rank:14},{id:'2',suit:'hearts',rank:2},{id:'3',suit:'spades',rank:3}]);
assert.ok(compareTeenPatti(a23, akq) > 0);
let tied = createTeenPattiGame([{id:'p1',chips:500},{id:'p2',chips:500}],10,deterministic);
tied = {...tied,players:tied.players.map((p,i)=>({...p,seen:true,cards:i===0?[{id:'a',suit:'spades',rank:14},{id:'k',suit:'spades',rank:13},{id:'q',suit:'hearts',rank:12}]:[{id:'a2',suit:'clubs',rank:14},{id:'k2',suit:'clubs',rank:13},{id:'q2',suit:'diamonds',rank:12}]}))};
tied = teenPattiAction(tied,'p1','show');
assert.deepEqual(tied.winnerIds,['p2']); assert.equal(tied.settlement.find(row=>row.playerId==='p1').reason.includes('called the show loses the tie'), true); assert.equal(tied.players.reduce((sum,p)=>sum+p.chips,0),1000);
let brokeTeen = createTeenPattiGame([{id:'bot',chips:1000},{id:'other',chips:1000}],10,deterministic); brokeTeen.players[0].chips = 0; assert.equal(chooseTeenPattiBotAction(brokeTeen,'bot','hard'),'pack');
// Rummy: exact integer point values, invalid-declaration penalty, and full deck conservation on recycle.
import { rummyCardPoints, calculateRummyPenalty, declareRummy } from '../.check-build/packages/shared/src/games/rummy.js';
assert.equal(rummyCardPoints({id:'joker',suit:null,rank:0,joker:true}),0);
assert.equal(calculateRummyPenalty([{id:'a',suit:'spades',rank:14},{id:'9',suit:'hearts',rank:9},{id:'k',suit:'clubs',rank:13}], 'rummy-13'),29);
let invalidHand = createRummyGame('rummy-13',['p1','p2'],deterministic);
invalidHand = drawRummyCard(invalidHand,'p1','stock');
assert.equal(declareRummy(invalidHand,'p1',[]).players[0].points,80);
console.log('PASS: Teen Patti tie/rank, bot chip safety, and Rummy penalty regressions');
// Bot declaration after drawing: find a valid N-card partition and leave one discard card.
const tenSetCards = [
  {id:'5s',suit:'spades',rank:5},{id:'5h',suit:'hearts',rank:5},{id:'5c',suit:'clubs',rank:5},
  {id:'8s',suit:'spades',rank:8},{id:'8h',suit:'hearts',rank:8},{id:'8d',suit:'diamonds',rank:8},
  {id:'qs',suit:'spades',rank:12},{id:'qh',suit:'hearts',rank:12},{id:'qc',suit:'clubs',rank:12},{id:'qd',suit:'diamonds',rank:12},
];
let botDeclarationState = createRummyGame('rummy-10',['bot-1','p2'],deterministic);
botDeclarationState = {...botDeclarationState,status:'discard',players:botDeclarationState.players.map((p,i)=>i===0?{...p,hand:[...tenSetCards,{id:'discard-me',suit:'clubs',rank:2}]}:p)};
const botGroups = findRummyDeclaration(botDeclarationState,'bot-1');
assert.ok(botGroups);
const botDeclared = declareRummy(botDeclarationState,'bot-1',botGroups);
assert.equal(botDeclared.status,'complete'); assert.equal(botDeclared.winnerId,'bot-1');
const rummy13Groups = [{cardIds:['s2','s3','s4']},{cardIds:['h5','h7','joker-1']},{cardIds:['kC','kD','kH']},{cardIds:['6C','6D','6H','6S']}];
const rummy13Hand = [
{id:'s2',suit:'spades',rank:2},{id:'s3',suit:'spades',rank:3},{id:'s4',suit:'spades',rank:4},
{id:'h5',suit:'hearts',rank:5},{id:'h7',suit:'hearts',rank:7},{id:'joker-1',suit:null,rank:0,joker:true},
{id:'kC',suit:'clubs',rank:13},{id:'kD',suit:'diamonds',rank:13},{id:'kH',suit:'hearts',rank:13},
{id:'6C',suit:'clubs',rank:6},{id:'6D',suit:'diamonds',rank:6},{id:'6H',suit:'hearts',rank:6},{id:'6S',suit:'spades',rank:6},
{id:'final-discard',suit:'clubs',rank:2}];
const rummy13State={gameId:'rummy-13',status:'discard',players:[{id:'p1',hand:rummy13Hand,points:0,dropped:false},{id:'p2',hand:[],points:0,dropped:false}],drawPile:[],discardPile:[],wildRank:11,currentIndex:0,handSize:13,history:[]};
const rummy13Declared=declareRummy(rummy13State,'p1',rummy13Groups);
assert.equal(rummy13Declared.status,'complete'); assert.equal(rummy13Declared.winnerId,'p1'); assert.equal(rummy13Declared.discardPile.at(-1).id,'final-discard');
console.log('PASS: offline Rummy bot declares a valid 3-3-4 hand; 13-card declaration leaves one final discard');

