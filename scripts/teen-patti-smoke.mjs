import assert from 'node:assert/strict';
import { createTeenPattiGame, teenPattiAction, teenPattiNextRound, teenPattiWagerBounds } from '../.check-build/packages/shared/src/games/teenPatti.js';
import { chooseTeenPattiBotAction } from '../.check-build/packages/game-engines/src/bots.js';
import {
  createTeenPattiCompanion,
  teenPattiCompanionOpeningBetBounds,
  teenPattiCompanionActionBounds,
  teenPattiCompanionPostOpeningBet,
  teenPattiCompanionSelectCard,
  teenPattiCompanionAct,
  teenPattiCompanionRespondSideshow,
} from '../.check-build/packages/shared/src/games/teen-patti-companion.js';

const card = (id, suit, rank) => ({ id, suit, rank });
const hands = {
  trail: [card('0-spades-14','spades',14),card('0-hearts-14','hearts',14),card('0-diamonds-14','diamonds',14)],
  pairK: [card('0-clubs-13','clubs',13),card('0-spades-13','spades',13),card('0-hearts-9','hearts',9)],
  pairQ: [card('0-diamonds-12','diamonds',12),card('0-clubs-12','clubs',12),card('0-spades-8','spades',8)],
  high: [card('0-clubs-11','clubs',11),card('0-diamonds-8','diamonds',8),card('0-hearts-5','hearts',5)],
};

// Offline physical-table flow: all blind/seen bets happen before any card IDs are entered.
let preDeal = createTeenPattiCompanion([
  {id:'pre1',name:'Player 1',wallet:1000},
  {id:'pre2',name:'Player 2',wallet:1000},
], {bootAmount:10,maxPot:160});
assert.equal(preDeal.stage,'opening');
assert.throws(()=>teenPattiCompanionSelectCard(preDeal,'0-spades-14'),/only after betting is finished/i);
assert.throws(()=>teenPattiCompanionAct(preDeal,'pre1','blind',10),/betting is not open/i);
assert.throws(()=>teenPattiCompanionPostOpeningBet(preDeal,'pre2',10),/Pass the device to Player 1/);
assert.deepEqual(teenPattiCompanionOpeningBetBounds(preDeal,'pre1'),{min:10,max:20,canAct:true});
preDeal = teenPattiCompanionPostOpeningBet(preDeal,'pre1',10);
preDeal = teenPattiCompanionPostOpeningBet(preDeal,'pre2',10);
assert.equal(preDeal.stage,'playing');
assert.equal(preDeal.pot,40); // Each player paid 10 boot + 10 opening wager.
assert.ok(preDeal.players.every(p=>p.cards.length===0));
assert.throws(()=>teenPattiCompanionSelectCard(preDeal,'0-spades-14'),/only after betting is finished/i);
// Multiple clockwise chaal/raise turns are accepted; the max pot ends betting.
preDeal = teenPattiCompanionAct(preDeal,'pre1','blind',20);
preDeal = teenPattiCompanionAct(preDeal,'pre2','chaal',40);
preDeal = teenPattiCompanionAct(preDeal,'pre1','blind',20);
assert.equal(preDeal.stage,'playing');
preDeal = teenPattiCompanionAct(preDeal,'pre2','chaal',40);
assert.equal(preDeal.pot,160);
assert.equal(preDeal.stage,'dealing');
assert.equal(preDeal.completionReason,'max-pot');
assert.throws(()=>teenPattiCompanionAct(preDeal,'pre1','blind',10),/betting is not open/i);
for (const id of ['0-spades-14','0-hearts-14','0-diamonds-14','0-clubs-13','0-spades-13','0-hearts-13']) preDeal = teenPattiCompanionSelectCard(preDeal,id);
assert.equal(preDeal.stage,'complete');
assert.equal(preDeal.players.reduce((sum,p)=>sum+p.netChange,0),0);
console.log('PASS: offline repeat betting rounds complete before private card entry; max pot locks betting and card selection settles results');

// Three seats each get a second/third turn: a player is never limited to one chaal.
const cyclePlayers = [
  {id:'cycle1',name:'Cycle 1',wallet:1000},
  {id:'cycle2',name:'Cycle 2',wallet:1000},
  {id:'cycle3',name:'Cycle 3',wallet:1000},
];
let cycles = createTeenPattiCompanion(cyclePlayers, {bootAmount:10,maxPot:250});
for (const player of cyclePlayers) cycles = teenPattiCompanionPostOpeningBet(cycles,player.id,10);
const turnSequence = [
  ['cycle1',20],['cycle2',20],['cycle3',20],
  ['cycle1',20],['cycle2',20],['cycle3',20],
  ['cycle1',20],['cycle2',20],['cycle3',20],
  ['cycle1',10], // Exact remaining amount caps the pot even though it is below the normal blind minimum.
];
for (const [playerId,wager] of turnSequence) cycles = teenPattiCompanionAct(cycles,playerId,'blind',wager);
assert.equal(cycles.pot,250);
assert.equal(cycles.stage,'dealing');
for (const id of ['0-spades-14','0-hearts-14','0-diamonds-14','0-clubs-13','0-spades-13','0-hearts-13','0-clubs-12','0-diamonds-12','0-spades-8']) cycles = teenPattiCompanionSelectCard(cycles,id);
assert.equal(cycles.stage,'complete');
for (const player of cyclePlayers) {
  const wagers = cycles.history.filter(event => event.type === 'action' && event.playerId === player.id && event.action === 'blind');
  assert.ok(wagers.length >= 2, `${player.name} should get repeated betting turns`);
}
assert.equal(cycles.players.reduce((sum,p)=>sum+p.netChange,0),0);
console.log('PASS: three-player betting cycles allow repeated chaals for every active player and settle only after exact max pot plus private card entry');

// Opening seen status is remembered. A seen player cannot return to blind.
let seenOpening = createTeenPattiCompanion([
  {id:'seen1',name:'Seen Player',wallet:1000},
  {id:'seen2',name:'Blind Player',wallet:1000},
], {bootAmount:10,maxPot:500});
assert.deepEqual(teenPattiCompanionOpeningBetBounds(seenOpening,'seen1',true),{min:20,max:40,canAct:true});
seenOpening = teenPattiCompanionPostOpeningBet(seenOpening,'seen1',20,true);
assert.equal(seenOpening.players[0].seen,true);
assert.equal(seenOpening.currentStake,10);
seenOpening = teenPattiCompanionPostOpeningBet(seenOpening,'seen2',10,false);
assert.equal(seenOpening.stage,'playing');
assert.equal(teenPattiCompanionActionBounds(seenOpening,'seen1',false).canAct,false);
assert.equal(teenPattiCompanionActionBounds(seenOpening,'seen1',true).min,20);
seenOpening = teenPattiCompanionAct(seenOpening,'seen1','chaal',20);
assert.equal(seenOpening.currentStake,10);
console.log('PASS: seen opening and repeated seen chaal preserve half-stake carry-forward and cannot switch back blind');

// A short final wager may exactly fill a small remainder and trigger private entry.
let cap = createTeenPattiCompanion([
  {id:'cap1',name:'Cap Player 1',wallet:1000},
  {id:'cap2',name:'Cap Player 2',wallet:1000},
], {bootAmount:10,maxPot:45});
cap = teenPattiCompanionPostOpeningBet(cap,'cap1',10);
cap = teenPattiCompanionPostOpeningBet(cap,'cap2',10);
assert.deepEqual(teenPattiCompanionActionBounds(cap,'cap1',false),{min:5,max:5,canAct:true});
cap = teenPattiCompanionAct(cap,'cap1','blind',5);
assert.equal(cap.stage,'dealing');
assert.equal(cap.pot,45);
for (const id of ['0-spades-14','0-hearts-14','0-diamonds-14','0-clubs-13','0-spades-13','0-hearts-13']) cap = teenPattiCompanionSelectCard(cap,id);
assert.equal(cap.stage,'complete');
console.log('PASS: final short wager reaches exact max pot; all betting closes before private card entry');

let seenCap = createTeenPattiCompanion([
  {id:'seenCap1',name:'Seen Cap 1',wallet:1000},
  {id:'seenCap2',name:'Seen Cap 2',wallet:1000},
], {bootAmount:10,maxPot:95});
seenCap = teenPattiCompanionPostOpeningBet(seenCap,'seenCap1',10,false);
seenCap = teenPattiCompanionPostOpeningBet(seenCap,'seenCap2',10,false);
seenCap = teenPattiCompanionAct(seenCap,'seenCap1','blind',20);
assert.deepEqual(teenPattiCompanionActionBounds(seenCap,'seenCap2',true),{min:35,max:35,canAct:true});
seenCap = teenPattiCompanionAct(seenCap,'seenCap2','chaal',35);
assert.equal(seenCap.pot,95);
assert.equal(seenCap.stage,'dealing');
console.log('PASS: odd final seen chaal is enabled only when it exactly reaches the maximum pot');

// A heads-up show closes betting first; card identities are entered afterward.
let headsUp = createTeenPattiCompanion([
  {id:'show1',name:'Show Caller',wallet:1000},
  {id:'show2',name:'Opponent',wallet:1000},
], {bootAmount:10,maxPot:500});
headsUp = teenPattiCompanionPostOpeningBet(headsUp,'show1',10,false);
headsUp = teenPattiCompanionPostOpeningBet(headsUp,'show2',20,true);
headsUp = teenPattiCompanionAct(headsUp,'show1','show');
assert.equal(headsUp.stage,'dealing');
assert.equal(headsUp.completionReason,'show');
for (const id of ['0-spades-14','0-hearts-13','0-clubs-12','0-clubs-14','0-diamonds-13','0-hearts-12']) headsUp = teenPattiCompanionSelectCard(headsUp,id);
assert.equal(headsUp.stage,'complete');
assert.equal(headsUp.players.reduce((n,p)=>n+p.netChange,0),0);
console.log('PASS: heads-up show ends betting; private card entry computes and settles the hand afterward');

// Sideshow is resolved from the physical cards at the table; the app records the outcome without asking for card IDs mid-bet.
let side = createTeenPattiCompanion([
  {id:'s1',name:'Side 1',wallet:1000}, {id:'s2',name:'Side 2',wallet:1000}, {id:'s3',name:'Side 3',wallet:1000},
], {bootAmount:10,maxPot:1000});
for (const id of ['s1','s2','s3']) side = teenPattiCompanionPostOpeningBet(side,id,10,false);
for (const id of ['s1','s2','s3']) side = teenPattiCompanionAct(side,id,'chaal',20);
side = teenPattiCompanionAct(side,'s1','sideshow');
assert.equal(side.pendingSideshow?.targetId,'s3');
assert.throws(()=>teenPattiCompanionRespondSideshow(side,'s3',true),/select who has the weaker hand/i);
side = teenPattiCompanionRespondSideshow(side,'s3',true,'s3');
assert.equal(side.players.find(p=>p.id==='s3').folded,true);
assert.equal(side.players.every(p=>p.cards.length===0),true);
console.log('PASS: sideshow accepts a physical comparison decision without entering card identities before betting ends');

// Online state: blind stake, seen half-stake, show accounting and next round.
let online = createTeenPattiGame([{id:'p1',chips:1000},{id:'p2',chips:1000}],10,()=>.37);
online = teenPattiAction(online,'p1','blind',20);
assert.equal(online.currentStake,20);
online = teenPattiAction(online,'p2','chaal',40);
assert.equal(online.currentStake,20);
assert.equal(online.players[1].seen,true);
online = teenPattiAction(online,'p1','show');
assert.equal(online.status,'complete');
assert.equal(online.settlement.reduce((n,row)=>n+row.net,0),0);
const next = teenPattiNextRound(online,()=>.21);
assert.equal(next.status,'playing');
assert.equal(next.players.every(p=>p.cards.length===3),true);
console.log('PASS: online blind/seen stake engine, server-dealt cards, show settlement and next round');

// Online show restriction: seen player cannot call show against a blind opponent.
let restricted = createTeenPattiGame([{id:'p1',chips:100},{id:'p2',chips:100}],10,()=>.37);
restricted = {...restricted,players:restricted.players.map((p,i)=>({...p,seen:i===0}))};
assert.throws(()=>teenPattiAction(restricted,'p1','show'),/cannot request a show/);
assert.equal(teenPattiWagerBounds(10,true,99).max,40);
console.log('PASS: online show eligibility and even seen-wager bounds');

// Online sideshow: request is charged immediately and target can accept; AI target uses legal response.
let onlineSide = createTeenPattiGame([{id:'p1',chips:1000},{id:'p2',chips:1000},{id:'p3',chips:1000}],10,()=>.37);
onlineSide = {...onlineSide,players:onlineSide.players.map((p)=>({...p,seen:true,cards:p.id==='p1'
  ? [card('os1','spades',2),card('os2','hearts',2),card('os3','clubs',4)]
  : p.id==='p3' ? hands.trail : hands.pairK}))};
for (const id of ['p1','p2','p3']) onlineSide = teenPattiAction(onlineSide,id,'chaal',20);
const onlinePotBeforeSideshow = onlineSide.pot;
onlineSide = teenPattiAction(onlineSide,'p1','sideshow');
assert.equal(onlineSide.pendingSideshow?.targetId,'p3');
assert.equal(onlineSide.pot-onlinePotBeforeSideshow,20);
const botReply = chooseTeenPattiBotAction(onlineSide,'p3','hard');
assert.equal(botReply,'sideshow-accept');
onlineSide = teenPattiAction(onlineSide,'p3',botReply);
assert.equal(onlineSide.players.find(player=>player.id==='p1').folded,true);
assert.match(onlineSide.players.find(player=>player.id==='p1').foldReason,/weaker hand/i);
console.log('PASS: online sideshow charge, private compare, valid bot response and precise fold reason');

let onlineBlind = createTeenPattiGame([{id:'p1',chips:1000},{id:'p2',chips:1000},{id:'p3',chips:1000}],10,()=>.37);
onlineBlind = {...onlineBlind,players:onlineBlind.players.map((p,i)=>({...p,seen:i!==1}))};
onlineBlind = teenPattiAction(onlineBlind,'p1','chaal',20);
onlineBlind = teenPattiAction(onlineBlind,'p2','blind',10);
onlineBlind = teenPattiAction(onlineBlind,'p3','chaal',20);
assert.throws(()=>teenPattiAction(onlineBlind,'p1','sideshow'),/every active player has seen/i);
console.log('PASS: online sideshow eligibility requires every active player to be seen');
