import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, BadgeCheck, Check, ChevronRight, CircleDollarSign, Crown, Info, Plus, RotateCcw, ShieldCheck, Spade, Undo2, Users, Wallet, Volume2, VolumeX, X } from "lucide-react";
import type { Card, Suit } from "@cardroom/shared/cards";
import { createDeck } from "@cardroom/shared/cards";
import {
  companionConfirmBet,
  companionCurrentDealTarget,
  companionCurrentPendingTarget,
  companionDealerHit,
  companionDealerStand,
  companionDecideInsurance,
  companionHandValue,
  companionNextRound,
  companionPlayerAction,
  companionSelectBettingPlayer,
  companionSelectCard,
  companionSetBet,
  companionSitOut,
  companionStartDeal,
  companionTopUpWallet,
  type BlackjackCompanionState,
  type CompanionHand,
  type CompanionPlayer,
} from "@cardroom/shared/games/blackjack-companion";
import { Button } from "../components/Shared";
import { PlayingCard } from "../components/PlayingCard";
import { formatChips } from "../lib";
import { useBlackjackCompanionStore } from "../store/blackjackCompanion";
import { useSessionStore } from "../store/session";
import { playUiSound } from "../sound";

const CHIP_VALUES = [100, 500, 1_000, 2_000, 5_000, 10_000];
const ALL_CARDS = createDeck().filter((card): card is Card => !card.joker);
const CARD_RANKS = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
const rankName = (rank: number) => rank <= 10 ? String(rank) : ({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[rank] ?? String(rank);
const totalLabel = (cards: readonly Card[]) => {
  const value = companionHandValue(cards);
  return `${value.total}${value.soft && value.total <= 21 ? " soft" : ""}`;
};

function formatPlayerChips(value: number) { return `${formatChips(value)} chips`; }
function activePlayer(state: BlackjackCompanionState) { return state.players[state.activePlayerIndex]; }
function activeHand(state: BlackjackCompanionState) { return activePlayer(state)?.hands[state.activeHandIndex]; }
function isDealerTarget(state: BlackjackCompanionState) {
  if (state.stage === "dealing") return companionCurrentDealTarget(state)?.kind === "dealer";
  return companionCurrentPendingTarget(state)?.kind === "dealer";
}
function pickerPrompt(state: BlackjackCompanionState): string {
  if (state.stage === "dealing") return companionCurrentDealTarget(state)?.label ?? "Select the next physical card";
  const target = companionCurrentPendingTarget(state);
  if (!target) return "Select the card that was dealt";
  if (target.kind === "dealer") return state.dealer.length === 1 ? "Dealer · reveal the hole card" : "Dealer · next card";
  const player = state.players.find(item => item.id === target.playerId);
  if (target.action === "split") return `${player?.name ?? "Player"} · split hand ${Number(target.handIndex) + 1}`;
  return `${player?.name ?? "Player"} · ${target.action === "double" ? "double-down card" : "hit card"}`;
}
function currentTargetPlayerId(state: BlackjackCompanionState): string | undefined {
  if (state.stage === "dealing") return companionCurrentDealTarget(state)?.playerId;
  return companionCurrentPendingTarget(state)?.playerId;
}

export function BlackjackCompanionPage() {
  const state = useBlackjackCompanionStore(s => s.state);
  const start = useBlackjackCompanionStore(s => s.start);
  const update = useBlackjackCompanionStore(s => s.update);
  const undo = useBlackjackCompanionStore(s => s.undo);
  const canUndo = useBlackjackCompanionStore(s => s.undoStack.length > 0);
  const clear = useBlackjackCompanionStore(s => s.clear);
  const [setupCount, setSetupCount] = useState(4);
  const [drafts, setDrafts] = useState(() => Array.from({ length: 9 }, (_, index) => ({ name: `Player ${index + 1}`, balance: "10000" })));
  const [customBet, setCustomBet] = useState("1000");
  const [customTopUp, setCustomTopUp] = useState("1000");
  const [error, setError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const preferences = useSessionStore(s => s.preferences);
  const setPreferences = useSessionStore(s => s.setPreferences);
  const previousState = useRef<BlackjackCompanionState | null>(null);

  useEffect(() => {
    const previous = previousState.current;
    if (!state) {
      previousState.current = null;
      return;
    }
    if (previous && previous.roundNumber === state.roundNumber) {
      const previousBusts = previous.players.reduce((count, player) => count + player.hands.filter(hand => hand.status === "busted" || hand.outcome === "bust").length, 0) + (previous.dealerOutcome === "bust" ? 1 : 0);
      const currentBusts = state.players.reduce((count, player) => count + player.hands.filter(hand => hand.status === "busted" || hand.outcome === "bust").length, 0) + (state.dealerOutcome === "bust" ? 1 : 0);
      if (previous.stage !== "complete" && state.stage === "complete") {
        if (!previous.dealerRevealed && state.dealerRevealed) playUiSound("reveal");
        state.players.forEach((player, index) => {
          if (!player.hands.length) return;
          const outcomes = player.hands.map(hand => hand.outcome).filter(Boolean);
          const cue = outcomes.includes("blackjack") ? "blackjack"
            : outcomes.includes("win") ? "win"
            : outcomes.length > 0 && outcomes.every(outcome => outcome === "push") ? "push"
            : outcomes.length > 0 && outcomes.every(outcome => outcome === "bust") ? "bust"
            : "loss";
          playUiSound(cue, 0.22 + index * 0.36);
        });
        if (state.dealerOutcome === "bust") playUiSound("bust", state.players.length * 0.34);
      } else if (currentBusts > previousBusts) playUiSound("bust");
      else if (!previous.dealerRevealed && state.dealerRevealed) playUiSound("reveal");
    } else if (previous && state.roundNumber > previous.roundNumber) {
      playUiSound("shuffle");
    }
    previousState.current = state;
  }, [state]);

  const execute = (operation: () => BlackjackCompanionState) => {
    try { setError(""); update(operation()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "That action could not be completed."); }
  };
  const beginSession = () => {
    try {
      setError("");
      start(drafts.slice(0, setupCount).map(player => ({ name: player.name, balance: Number(player.balance) })));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Check the player details and try again."); }
  };
  const changeDraft = (index: number, key: "name" | "balance", value: string) => {
    setDrafts(previous => previous.map((item, i) => i === index ? { ...item, [key]: value } : item));
  };

  if (!state) return <div className="page-container blackjack-companion-page">
    <div className="blackjack-intro-line"><span className="eyebrow"><Spade size={14}/> PHYSICAL TABLE COMPANION</span><span className="offline-label"><i/> Local play · no internet needed</span></div>
    <section className="blackjack-setup-hero">
      <div className="blackjack-hero-copy"><div className="eyebrow">BLACKJACK · HOME TABLE</div><h1>Bring the table<br/><em>to your table.</em></h1><p>Play with friends sitting together. Deal real cards from your own deck, enter each card here, and let Cardroom track hands, bets, and chip balances.</p><div className="blackjack-hero-points"><span><BadgeCheck size={16}/> You deal physical cards</span><span><BadgeCheck size={16}/> No bots or simulated players</span><span><BadgeCheck size={16}/> Duplicate cards are blocked</span></div></div>
      <div className="blackjack-hero-art" aria-hidden="true"><div className="hero-chip-ring"/><div className="hero-playing-card hero-card-back-design">✦</div><div className="hero-playing-card hero-ace-card"><small>A</small><b>♠</b><i>A</i></div><div className="blackjack-hero-caption"><span>YOUR HOUSE RULES</span><b>21, together.</b></div></div>
    </section>
    <section className="blackjack-step-card">
      <StepHeader step={1} title="Set up your players" description="Choose who's at the table and give everyone a starting chip wallet."/>
      <div className="blackjack-count-select"><div><b>How many players?</b><small>Choose between 2 and 9 people.</small></div><div className="count-stepper"><button type="button" aria-label="Remove one player" disabled={setupCount <= 2} onClick={() => setSetupCount(value => Math.max(2, value - 1))}>−</button><strong>{setupCount}</strong><button type="button" aria-label="Add one player" disabled={setupCount >= 9} onClick={() => setSetupCount(value => Math.min(9, value + 1))}>+</button></div></div>
      <div className="blackjack-player-drafts">{drafts.slice(0, setupCount).map((player, index) => <div className="blackjack-player-draft" key={index}><div className="draft-player-number">{String(index + 1).padStart(2, "0")}</div><label><span>Player name</span><input value={player.name} onChange={event => changeDraft(index, "name", event.target.value)} maxLength={20} placeholder={`Player ${index + 1}`} required/></label><label><span>Starting wallet</span><div className="wallet-input"><input type="number" min="100" max="1000000000" step="100" value={player.balance} onChange={event => changeDraft(index, "balance", event.target.value)} required/><span>chips</span></div></label></div>)}</div>
      <div className="blackjack-setup-note"><Info size={16}/><span>Each person plays their own hand against one shared dealer. Virtual chips are only a scorekeeping aid and have no cash value.</span></div>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="blackjack-step-footer"><span><Users size={15}/> {setupCount} seats ready to configure</span><Button onClick={beginSession}>Continue to betting <ArrowRight size={16}/></Button></div>
    </section>
  </div>;

  return <div className="page-container blackjack-companion-page">
    <div className="blackjack-page-topbar"><div><div className="eyebrow"><Spade size={14}/> CARDROOM · BLACKJACK COMPANION</div><h1>Blackjack <em>home table.</em></h1><p>Round {state.roundNumber} · {state.players.length} players · Physical cards</p></div><div className="blackjack-top-actions"><span className="offline-label"><i/> Saved on this device</span><button type="button" className={`blackjack-sound-toggle ${preferences.sound ? "enabled" : ""}`} aria-pressed={preferences.sound} title="Toggle gentle game sound effects. Adjust volume in Settings." onClick={() => { const enabled = !preferences.sound; setPreferences({ sound: enabled }); if (enabled) playUiSound("tap"); }}><span>{preferences.sound ? <Volume2 size={14}/> : <VolumeX size={14}/>}</span>{preferences.sound ? "Sound on" : "Sound off"}</button>{canUndo && <Button variant="outline" onClick={() => { setError(""); undo(); playUiSound("tap"); }}><Undo2 size={15}/> Undo last move</Button>}<Button variant="ghost" onClick={() => setConfirmReset(true)}><X size={15}/> End table</Button></div></div>
    <div className="blackjack-progress"><div className={state.stage === "betting" ? "current" : "done"}><span>01</span><b>Players & bets</b></div><i/><div className={state.stage === "dealing" || state.stage === "insurance" ? "current" : ["playing", "dealer", "complete"].includes(state.stage) ? "done" : ""}><span>02</span><b>Deal cards</b></div><i/><div className={state.stage === "playing" || state.stage === "dealer" ? "current" : state.stage === "complete" ? "done" : ""}><span>03</span><b>Play hands</b></div><i/><div className={state.stage === "complete" ? "current" : ""}><span>04</span><b>Results</b></div></div>
    {state.stage === "betting" ? <BettingStage state={state} customBet={customBet} setCustomBet={setCustomBet} customTopUp={customTopUp} setCustomTopUp={setCustomTopUp} onChangeBet={(id, amount) => execute(() => companionSetBet(state, id, amount))} onTopUp={(id, amount) => execute(() => companionTopUpWallet(state, id, amount))} onSelectPlayer={id => execute(() => companionSelectBettingPlayer(state, id))} onConfirm={id => execute(() => companionConfirmBet(state, id))} onSitOut={id => execute(() => companionSitOut(state, id))} onStartDeal={() => execute(() => companionStartDeal(state))} onReset={() => setConfirmReset(true)}/> : <TableStage state={state} onSelectCard={card => execute(() => companionSelectCard(state, card.id))} onInsurance={(id, take) => { execute(() => companionDecideInsurance(state, id, take)); playUiSound(take ? "insurance" : "tap"); }} onPlayerAction={(id, action) => { execute(() => companionPlayerAction(state, id, action)); playUiSound(action === "split" ? "split" : action === "double" ? "double" : action === "surrender" ? "loss" : "tap"); }} onDealerHit={() => { execute(() => companionDealerHit(state)); playUiSound("deal"); }} onDealerStand={() => { execute(() => companionDealerStand(state)); playUiSound("success"); }} onNextRound={() => execute(() => companionNextRound(state))} onReset={() => setConfirmReset(true)}/>}
    {error && <ErrorMessage>{error}</ErrorMessage>}
    {confirmReset && <div className="blackjack-confirm-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setConfirmReset(false); }}><div className="blackjack-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="end-table-title"><span className="eyebrow">END CURRENT SESSION</span><h2 id="end-table-title">Leave this table?</h2><p>This clears the saved table session from this device and returns you to player setup.</p><div><Button variant="outline" onClick={() => setConfirmReset(false)}>Stay here</Button><Button variant="danger" onClick={() => { clear(); setConfirmReset(false); }}>End table</Button></div></div></div>}
  </div>;
}

function StepHeader({ step, title, description }: { step: number; title: string; description: string }) {
  return <div className="blackjack-step-heading"><span className="blackjack-step-number" aria-label={`Step ${step}`}>{String(step).padStart(2, "0")}</span><div><h2>{title}</h2><p>{description}</p></div></div>;
}
function ErrorMessage({ children }: { children: string }) { return <div className="blackjack-error" role="alert"><Info size={15}/>{children}</div>; }

function BettingStage({ state, customBet, setCustomBet, customTopUp, setCustomTopUp, onChangeBet, onTopUp, onSelectPlayer, onConfirm, onSitOut, onStartDeal, onReset }: {
  state: BlackjackCompanionState;
  customBet: string;
  setCustomBet: (value: string) => void;
  customTopUp: string;
  setCustomTopUp: (value: string) => void;
  onChangeBet: (playerId: string, amount: number) => void;
  onTopUp: (playerId: string, amount: number) => void;
  onSelectPlayer: (playerId: string) => void;
  onConfirm: (playerId: string) => void;
  onSitOut: (playerId: string) => void;
  onStartDeal: () => void;
  onReset: () => void;
}) {
  const current = state.players[state.bettingIndex];
  const readyPlayers = state.players.filter(player => player.betConfirmed);
  const playersSummary = state.players;
  const customAmount = Number(customBet);
  const topUpAmount = Number(customTopUp);
  const setCurrentBet = (amount: number) => { if (current) onChangeBet(current.id, amount); };
  const addWalletChips = (amount: number) => { if (current) onTopUp(current.id, amount); };
  return <section className="blackjack-stage-card">
    <StepHeader step={2} title="Place your bets" description="Choose who bets first, then pass the device around. Each player locks their own wager before the deal."/>
    <div className="betting-stage-layout">
      <div className="betting-main-panel">
        {current ? <>
          <div className="betting-current-player"><div className="blackjack-avatar">{current.name.slice(0, 1).toUpperCase()}</div><div><span className="eyebrow">PLAYER {state.bettingIndex + 1} OF {state.players.length}</span><h3>{current.name}</h3></div><span className="betting-turn-tag">Selected to bet</span></div>
          <div className="bet-wallet-row"><div><small>Available wallet</small><strong>{formatPlayerChips(current.balance)}</strong></div><div className="bet-current-value"><small>Current wager</small><strong>{formatPlayerChips(current.bet)}</strong></div></div>
          <div className="wallet-topup-box">
            <div className="wallet-topup-heading"><div><b><Wallet size={14}/> Top up wallet</b><small>Add virtual chips before placing this round's bet.</small></div><span>PLAY CHIPS</span></div>
            <div className="wallet-topup-chips">{[500, 1_000, 5_000].map(value => <button key={value} type="button" disabled={current.balance + value > 1_000_000_000} onClick={() => addWalletChips(value)}><Plus size={13}/>{formatChips(value)}</button>)}</div>
            <div className="wallet-topup-custom"><label><span>Custom top-up</span><input type="number" min="100" max={1_000_000_000 - current.balance} step="100" value={customTopUp} onChange={event => setCustomTopUp(event.target.value)} aria-label="Custom wallet top-up"/></label><Button variant="outline" disabled={!Number.isSafeInteger(topUpAmount) || topUpAmount < 100 || topUpAmount % 100 !== 0 || current.balance + topUpAmount > 1_000_000_000} onClick={() => addWalletChips(topUpAmount)}>Add chips</Button></div>
          </div>
          <div className="chip-selector-heading"><b>Add chips to wager</b><small>Select a denomination, or enter a custom amount.</small></div>
          <div className="chip-denominations">{CHIP_VALUES.map(value => <button key={value} type="button" disabled={current.bet + value > current.balance} onClick={() => setCurrentBet(current.bet + value)}><span className={`chip-coin chip-${value >= 5000 ? "large" : value >= 1000 ? "medium" : "small"}`}/><b>{formatChips(value)}</b></button>)}</div>
          <div className="bet-custom-row"><label><span>Custom amount</span><input type="number" min="100" max={current.balance} step="100" value={customBet} onChange={event => setCustomBet(event.target.value)} aria-label="Custom bet amount"/></label><Button variant="outline" disabled={!Number.isSafeInteger(customAmount) || customAmount < 100 || customAmount % 100 !== 0 || current.bet + customAmount > current.balance} onClick={() => setCurrentBet(current.bet + customAmount)}>Add custom</Button></div>
          <div className="bet-utility-actions"><Button variant="outline" onClick={() => setCurrentBet(0)}><RotateCcw size={14}/> Clear bet</Button><Button variant="ghost" disabled={current.balance < 100} onClick={() => setCurrentBet(Math.floor(current.balance / 100) * 100)}><Wallet size={14}/> All in</Button></div>
          <div className="betting-confirm-row"><div><small>Minimum bet</small><b>100 chips</b></div><Button onClick={() => onConfirm(current.id)} disabled={current.bet < 100}>Confirm {current.bet ? `${formatChips(current.bet)} chips` : "bet"} <Check size={16}/></Button></div>
          <button type="button" className="sit-out-button" onClick={() => onSitOut(current.id)}>Sit out this round</button>
        </> : <div className="all-bets-ready"><div className="ready-medallion"><Check size={24}/></div><h3>All bets are locked.</h3><p>Every player has confirmed a wager or chosen to sit out. The table is ready for the opening deal.</p><Button onClick={onStartDeal}>Begin the deal <ArrowRight size={16}/></Button></div>}
      </div>
      <aside className="betting-summary-panel"><div className="betting-summary-title"><div><span className="eyebrow">ROUND {state.roundNumber}</span><h3>Table wagers</h3><small>Choose any waiting player to set the betting order.</small></div><span>{readyPlayers.length}/{playersSummary.length} ready</span></div><div className="betting-player-summary">{playersSummary.map((player, index) => <button type="button" className={`betting-player-select ${player.betConfirmed ? "confirmed" : index === state.bettingIndex ? "on-turn" : ""}`} key={player.id} disabled={player.betConfirmed} onClick={() => onSelectPlayer(player.id)} aria-pressed={!player.betConfirmed && index === state.bettingIndex}><span className="summary-avatar">{player.name.slice(0, 1).toUpperCase()}</span><span className="summary-player-name"><b>{player.name}</b><small>{player.betConfirmed ? player.sittingOut ? "Sitting out" : "Bet confirmed" : index === state.bettingIndex ? "Selected · placing bet" : "Select to bet next"}</small></span><strong>{player.bet ? formatChips(player.bet) : "—"}</strong>{player.betConfirmed && <Check size={14}/>}</button>)}</div><div className="betting-summary-footer"><span>Total table action</span><b>{formatPlayerChips(playersSummary.reduce((sum, player) => sum + player.bet, 0))}</b></div><button type="button" className="text-link betting-reset" onClick={onReset}><ArrowLeft size={14}/> Change players / end table</button></aside>
    </div>
  </section>;
}

function TableStage({ state, onSelectCard, onInsurance, onPlayerAction, onDealerHit, onDealerStand, onNextRound, onReset }: {
  state: BlackjackCompanionState;
  onSelectCard: (card: Card) => void;
  onInsurance: (playerId: string, take: boolean) => void;
  onPlayerAction: (playerId: string, action: "hit" | "stand" | "double" | "split" | "surrender") => void;
  onDealerHit: () => void;
  onDealerStand: () => void;
  onNextRound: () => void;
  onReset: () => void;
}) {
  const targetPlayerId = currentTargetPlayerId(state);
  const dealTarget = state.stage === "dealing" ? companionCurrentDealTarget(state) : null;
  const pendingTarget = companionCurrentPendingTarget(state);
  const active = activePlayer(state);
  const hand = activeHand(state);
  const currentIsDealer = isDealerTarget(state);
  const reducedMotion = useSessionStore(s => s.preferences.reducedMotion);
  const nextCardPrompt = state.stage === "dealing" || state.pendingCards.length > 0;
  const availableCards = useMemo(() => ALL_CARDS.filter(card => !state.usedCardIds.includes(card.id)), [state.usedCardIds]);
  const dealerValue = state.dealer.length ? companionHandValue(state.dealer) : null;
  const activePlayerForInsurance = state.players[state.insuranceIndex];
  const canDouble = Boolean(active && hand && hand.cards.length === 2 && !hand.doubled && active.balance >= hand.bet);
  const canSplit = Boolean(active && hand && hand.cards.length === 2 && hand.cards[0]?.rank === hand.cards[1]?.rank && active.hands.length < state.rules.maxHands && active.balance >= hand.bet);
  const canSurrender = Boolean(active && hand && hand.cards.length === 2 && !hand.doubled && active.hands.length === 1 && state.rules.allowSurrender);
  const mustDealerHit = state.stage === "dealer" && dealerValue !== null && (dealerValue.total < 17 || (dealerValue.total === 17 && dealerValue.soft && state.rules.dealerHitsSoft17));
  const select = (card: Card) => { playUiSound("deal"); onSelectCard(card); };
  const targetText = state.stage === "dealing" ? dealTarget?.label : pendingTarget ? pickerPrompt(state) : "";
  const showCardPicker = nextCardPrompt;

  return <section className="blackjack-stage-card blackjack-table-stage">
    <div className="blackjack-table-toolbar"><div><span className="eyebrow">ROUND {state.roundNumber} · PHYSICAL DECK</span><h2>{state.stage === "complete" ? "Round complete" : state.stage === "betting" ? "Betting" : state.stage === "dealing" ? "Opening deal" : state.stage === "insurance" ? "Insurance decision" : state.stage === "dealer" && state.pendingCards.length ? "Reveal dealer's hole card" : state.stage === "dealer" ? "Dealer's turn" : "Players' turns"}</h2></div><div className="table-toolbar-actions"><span className="table-deck-status"><Spade size={13}/>{52 - state.usedCardIds.length} cards available</span><button type="button" className="table-reset-link" onClick={onReset}><X size={14}/> End table</button></div></div>
    <div className="blackjack-felt-table">
      <div className="blackjack-felt-ring"/>
      <div className={`blackjack-dealer-zone ${state.dealerOutcome === "bust" ? "dealer-busted" : ""}`}>
        <div className="blackjack-dealer-label"><span className="dealer-crown"><Crown size={14}/></span><div><b>DEALER</b><small>{state.dealerRevealed ? dealerValue ? `${dealerValue.total}${dealerValue.soft ? " soft" : ""}` : "No cards" : "Hole card hidden"}</small></div></div>
        <div className="blackjack-dealer-cards">{state.dealer.map((card, index) => <motion.div key={`${card.id}-${index === 1 && !state.dealerRevealed ? "hidden" : "shown"}`} className="blackjack-table-card" initial={reducedMotion ? false : index === 1 && state.dealerRevealed ? { opacity: 0.4, rotateY: 88, y: -7 } : { opacity: 0, y: -10, scale: 0.94 }} animate={{ opacity: 1, rotateY: 0, y: 0, scale: 1 }} transition={{ duration: reducedMotion ? 0 : 0.42, ease: [0.22, 1, 0.36, 1] }}>{index === 1 && !state.dealerRevealed ? <PlayingCard hidden/> : <PlayingCard card={card} small={false} dealIn={index !== 1}/>}</motion.div>)}{state.dealer.length === 1 && <PlayingCard hidden/>}</div>
        {state.dealerOutcome === "bust" && <motion.div className="blackjack-bust-banner" initial={reducedMotion ? false : { opacity: 0, scale: 0.82, y: -5 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : 0.28 }}><X size={13}/> DEALER BUST</motion.div>}
        {state.stage === "dealer" && dealerValue && <span className={`dealer-rule-pill ${mustDealerHit ? "must-hit" : "must-stand"}`}>{mustDealerHit ? "Dealer must hit" : "Dealer must stand"}</span>}
      </div>
      <div className="blackjack-table-divider"><span>♠</span><i/><span>♥</span><i/><span>♦</span><i/><span>♣</span></div>
      <div className="blackjack-player-grid" style={{ "--blackjack-player-count": state.players.length } as CSSProperties}>
        {state.players.map((player, index) => <PlayerSeat key={player.id} player={player} index={index} active={state.stage === "playing" && player.id === active?.id} target={player.id === targetPlayerId} busted={player.hands.some(item => item.status === "busted" || item.outcome === "bust")} showResult={state.stage === "complete"} tableState={state} currentHandIndex={player.id === active?.id ? state.activeHandIndex : -1}/>)}
      </div>
    </div>

    {showCardPicker && <CardPicker cards={availableCards} prompt={targetText || "Select the card dealt"} targetName={currentIsDealer ? "Dealer" : targetPlayerId ? state.players.find(p => p.id === targetPlayerId)?.name ?? "Player" : "Player"} onSelect={select}/>}

    {state.stage === "insurance" && activePlayerForInsurance && <div className="blackjack-action-panel insurance-panel"><div className="blackjack-action-intro"><span className="eyebrow">DEALER SHOWING AN ACE</span><h3>{activePlayerForInsurance.name}, insurance?</h3><p>Insurance costs half your original bet and pays 2:1 if the dealer has Blackjack.</p></div><div className="blackjack-action-buttons"><Button variant="outline" onClick={() => onInsurance(activePlayerForInsurance.id, false)}>No insurance</Button><Button disabled={activePlayerForInsurance.balance < Math.floor(activePlayerForInsurance.bet / 2)} onClick={() => onInsurance(activePlayerForInsurance.id, true)}>Take insurance · {formatChips(Math.floor(activePlayerForInsurance.bet / 2))}</Button></div></div>}

    {state.stage === "playing" && active && hand && !showCardPicker && <div className="blackjack-action-panel"><div className="blackjack-action-intro"><span className="eyebrow">PLAYER {state.activePlayerIndex + 1} · HAND {state.activeHandIndex + 1}</span><h3>{active.name}'s move</h3><p>{totalLabel(hand.cards)} points · {formatChips(hand.bet)} chips at risk</p></div><div className="blackjack-action-buttons"><Button onClick={() => onPlayerAction(active.id, "hit")}>Hit</Button><Button variant="outline" onClick={() => onPlayerAction(active.id, "stand")}>Stand</Button><Button variant="outline" disabled={!canDouble} onClick={() => onPlayerAction(active.id, "double")}><CircleDollarSign size={15}/> Double down</Button><Button variant="ghost" disabled={!canSplit} onClick={() => onPlayerAction(active.id, "split")}><span className="split-icon">Ⅱ</span> Split</Button><Button variant="ghost" disabled={!canSurrender} onClick={() => onPlayerAction(active.id, "surrender")}><X size={14}/> Surrender</Button></div></div>}

    {state.stage === "dealer" && !showCardPicker && dealerValue && <div className="blackjack-action-panel"><div className="blackjack-action-intro"><span className="eyebrow">DEALER'S TURN</span><h3>{mustDealerHit ? "Dealer must draw a card" : "Dealer stands"}</h3><p>Dealer total: {dealerValue.total}{dealerValue.soft ? " soft" : ""} · House stands on soft 17.</p></div><div className="blackjack-action-buttons">{mustDealerHit ? <Button onClick={onDealerHit}>Add dealer card <ChevronRight size={15}/></Button> : <Button onClick={onDealerStand}>Stand & settle <Check size={15}/></Button>}</div></div>}

    {state.stage === "complete" && <RoundResults state={state} onNextRound={onNextRound} onReset={onReset}/>}
    <p className="blackjack-footnote"><ShieldCheck size={14}/> Real cards are entered by your group. Cardroom only tracks the hand and virtual chips; it does not shuffle or deal in offline mode.</p>
  </section>;
}

function companionPlayerOutcome(player: CompanionPlayer): string {
  const outcomes = player.hands.map(hand => hand.outcome).filter((outcome): outcome is NonNullable<CompanionHand["outcome"]> => Boolean(outcome));
  if (!outcomes.length) return player.sittingOut ? "Sitting out" : "In play";
  const unique = [...new Set(outcomes)];
  if (unique.length > 1) return "Mixed result";
  return ({ win: "Won", blackjack: "Blackjack!", push: "Push", loss: "Lost", bust: "Bust", surrender: "Surrender" } as Record<string, string>)[unique[0]!] ?? "Settled";
}

function companionPlayerNet(player: CompanionPlayer, state: BlackjackCompanionState): number {
  const handNet = player.hands.reduce((sum, hand) => sum + (hand.payout === undefined ? 0 : hand.payout - hand.bet), 0);
  const insuranceNet = player.insuranceBet > 0 ? state.dealerOutcome === "blackjack" ? player.insuranceBet * 2 : -player.insuranceBet : 0;
  return handNet + insuranceNet;
}

function PlayerSeat({ player, index, active, target, busted, showResult, tableState, currentHandIndex }: { player: CompanionPlayer; index: number; active: boolean; target: boolean; busted: boolean; showResult: boolean; tableState: BlackjackCompanionState; currentHandIndex: number }) {
  const outcome = companionPlayerOutcome(player);
  const outcomeClass = showResult ? outcome.toLowerCase().replace(/[^a-z]+/g, "-") : "";
  return <motion.article layout className={`blackjack-player-seat ${active ? "active" : ""} ${target ? "card-target" : ""} ${busted ? "busted" : ""} ${player.sittingOut ? "sitting-out" : ""} ${showResult ? `result-${outcomeClass}` : ""}`}>
    <div className="blackjack-seat-top"><span className="blackjack-seat-avatar">{player.name.slice(0, 1).toUpperCase()}</span><span className="blackjack-seat-name"><b>{player.name}</b><small>{player.hands.length ? player.hands.length > 1 ? `${player.hands.length} hands` : player.hands[0]?.status === "blackjack" ? "Blackjack!" : active ? "At the table" : "Playing" : player.sittingOut ? "Sitting out" : "Waiting for deal"}</small></span>{showResult && <span className={`blackjack-outcome-pill outcome-${outcomeClass}`}>{outcome}</span>}<span className="blackjack-seat-index">{String(index + 1).padStart(2, "0")}</span></div>
    <div className="blackjack-seat-hands">{player.hands.length ? player.hands.map((hand, handIndex) => <HandDisplay hand={hand} key={hand.id} active={active && currentHandIndex === handIndex}/> ) : <span className="blackjack-no-hand">No hand this round</span>}</div>
    <div className="blackjack-seat-bottom"><span><Wallet size={12}/> {formatChips(player.balance)}</span><span><CircleDollarSign size={12}/> {player.bet ? formatChips(player.bet) : "No bet"}</span>{showResult && player.hands.length > 0 && <strong className={`blackjack-net ${companionPlayerNet(player, tableState) > 0 ? "positive" : companionPlayerNet(player, tableState) < 0 ? "negative" : "neutral"}`}>{companionPlayerNet(player, tableState) > 0 ? "+" : companionPlayerNet(player, tableState) < 0 ? "−" : "±"}{formatChips(Math.abs(companionPlayerNet(player, tableState)))}</strong>}</div>
  </motion.article>;
}

function HandDisplay({ hand, active }: { hand: CompanionHand; active: boolean }) {
  const value = companionHandValue(hand.cards);
  const statusText = hand.outcome ? ({ win: "Won", blackjack: "Blackjack", push: "Push", loss: "Lost", bust: "Bust", surrender: "Surrender" } as Record<string, string>)[hand.outcome] : ({ awaiting: "Waiting for card", playing: "Playing", stood: "Stand", busted: "Bust", blackjack: "Blackjack", surrendered: "Surrender" } as Record<string, string>)[hand.status];
  const outcomeClass = hand.outcome ?? (hand.status === "busted" ? "bust" : "playing");
  const net = hand.payout === undefined ? undefined : hand.payout - hand.bet;
  return <motion.div layout className={`blackjack-hand-block ${active ? "active" : ""} ${hand.status === "busted" || hand.outcome === "bust" ? "busted" : ""} ${hand.outcome ? `hand-${outcomeClass}` : ""}`}>
    <div className="blackjack-hand-header"><span>HAND · {formatChips(hand.bet)}</span><b>{hand.cards.length ? `${value.total}${value.soft ? " soft" : ""}` : "—"}</b></div>
    <div className="blackjack-hand-cards">{hand.cards.map(card => <PlayingCard key={card.id} card={card} small dealIn/>)}</div>
    <div className="blackjack-hand-status">{statusText}{hand.doubled ? " · Doubled" : ""}</div>
    {hand.outcome && <div className={`blackjack-hand-result result-${outcomeClass}`}><b>{statusText}</b><strong>{net !== undefined ? `${net > 0 ? "+" : net < 0 ? "−" : ""}${formatChips(Math.abs(net))}` : "—"}</strong></div>}
  </motion.div>;
}

function CardPicker({ cards, prompt, targetName, onSelect }: { cards: Card[]; prompt: string; targetName: string; onSelect: (card: Card) => void }) {
  const cardsByRank = useMemo(() => {
    const grouped = new Map<number, Card[]>();
    for (const rank of CARD_RANKS) grouped.set(rank, cards.filter(card => card.rank === rank));
    return grouped;
  }, [cards]);
  return <div className="blackjack-card-picker">
    <div className="blackjack-picker-heading"><div><span className="eyebrow">CARD ENTRY · {targetName.toUpperCase()}</span><h3>{prompt}</h3><p>Choose the card value from your physical deck. Suits are ignored; each rank can be selected up to four times.</p></div><span className="picker-prompt-badge"><Spade size={14}/> 13 spade ranks · 52 cards</span></div>
    <div className="blackjack-picker-grid" role="group" aria-label="Choose a card value">
      {CARD_RANKS.map(rank => {
        const candidates = cardsByRank.get(rank) ?? [];
        const selectedPhysicalCard = candidates.find(card => card.suit === "spades") ?? candidates[0];
        const displayCard = selectedPhysicalCard ? { ...selectedPhysicalCard, id: `picker-spades-${rank}`, suit: "spades" as const } : undefined;
        const used = !selectedPhysicalCard;
        return <div className={`blackjack-picker-cell ${used ? "used" : ""}`} key={rank}>
          {selectedPhysicalCard && displayCard ? <div className="blackjack-rank-choice"><PlayingCard card={displayCard} soundOnSelect={false} onClick={() => { if (selectedPhysicalCard) onSelect(selectedPhysicalCard); }} /><span className="blackjack-rank-remaining" aria-label={`${candidates.length} copies remaining`}>{candidates.length} left</span></div> : <div className="blackjack-used-card" aria-label={`${rankName(rank)} already used four times`}><span>{rankName(rank)}</span><b>♠</b><small>Used</small></div>}
        </div>;
      })}
    </div>
    <p className="blackjack-picker-note"><ShieldCheck size={13}/> Only rank matters in Blackjack. Cardroom assigns an unused suit in the background so a standard 52-card deck is tracked correctly.</p>
  </div>;
}

function RoundResults({ state, onNextRound, onReset }: { state: BlackjackCompanionState; onNextRound: () => void; onReset: () => void }) {
  const winners = state.players.filter(player => player.hands.some(hand => hand.outcome === "win" || hand.outcome === "blackjack"));
  const dealerLabel = state.dealerOutcome === "blackjack" ? "Dealer blackjack" : state.dealerOutcome === "bust" ? "Dealer bust" : state.dealerOutcome === "no-live-hands" ? "Dealer did not need to draw" : `Dealer stood on ${totalLabel(state.dealer)}`;
  const activeOutcomes = state.players.flatMap(player => player.hands.map(hand => hand.outcome).filter(Boolean));
  const allPush = activeOutcomes.length > 0 && activeOutcomes.every(outcome => outcome === "push");
  const hasPush = activeOutcomes.some(outcome => outcome === "push");
  const headline = winners.length ? `${winners.length === 1 ? winners[0]!.name : `${winners.length} players`} beat the dealer` : allPush ? "Every hand pushed" : hasPush ? "Some hands pushed" : "The dealer takes this round";
  return <motion.div className="blackjack-round-results" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}>
    <div className="round-result-heading"><span className="result-crown"><Crown size={22}/></span><div><span className="eyebrow">ROUND {state.roundNumber} SETTLED</span><h2>{headline}</h2><p>{dealerLabel} · {state.dealer.map(card => `${rankName(card.rank)}${({ spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" } as Record<Suit, string>)[card.suit]}`).join("  ")}</p></div></div>
    <div className="round-result-players">{state.players.map((player, index) => {
      const net = companionPlayerNet(player, state);
      const outcome = companionPlayerOutcome(player);
      const kind = outcome.toLowerCase().replace(/[^a-z]+/g, "-");
      const handDescription = [player.hands.length ? player.hands.map((hand, handIndex) => `Hand ${handIndex + 1}: ${hand.outcome ?? hand.status}`).join(" · ") : "Sat out this round", player.insuranceBet > 0 ? `Insurance: ${state.dealerOutcome === "blackjack" ? "paid" : "lost"}` : ""].filter(Boolean).join(" · ");
      return <motion.div key={player.id} className={`round-result-player result-${kind}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.065, duration: 0.28 }}>
        <span className="result-player-avatar">{player.name.slice(0, 1).toUpperCase()}</span>
        <span className="result-player-name"><b>{player.name}</b><small>{handDescription}</small><em>{outcome}</em></span>
        <strong className={net > 0 ? "positive" : net < 0 ? "negative" : "neutral"}>{net > 0 ? "+" : net < 0 ? "−" : "±"}{formatChips(Math.abs(net))}<small>net chips</small></strong>
      </motion.div>;
    })}</div>
    <div className="blackjack-result-actions"><Button onClick={onNextRound}><RotateCcw size={15}/> Play next round</Button><Button variant="outline" onClick={onReset}>End table</Button></div>
  </motion.div>;
}
