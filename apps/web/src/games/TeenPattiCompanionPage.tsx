import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, BadgeCheck, Check, ChevronLeft, ChevronRight, CircleDollarSign, Crown, Info, RotateCcw, ShieldCheck, Trophy, Undo2, Users, Volume2, VolumeX, Wallet, X } from "lucide-react";
import { createDeck, SUITS, type Card, type Suit } from "@cardroom/shared/cards";
import { teenPattiShowCost } from "@cardroom/shared/games/teenPatti";
import {
  teenPattiCompanionAct,
  teenPattiCompanionActionBounds,
  teenPattiCompanionBetBounds,
  teenPattiCompanionOpeningBetBounds,
  teenPattiCompanionPostOpeningBet,
  teenPattiCompanionRespondSideshow,
  teenPattiCompanionNextRound,
  teenPattiCompanionRankLabel,
  teenPattiCompanionSelectCard,
  type TeenPattiCompanionPlayer,
  type TeenPattiCompanionState,
} from "@cardroom/shared/games/teen-patti-companion";
import { Button } from "../components/Shared";
import { PlayingCard } from "../components/PlayingCard";
import { formatChips } from "../lib";
import { useTeenPattiCompanionStore, type TeenPattiRosterPlayer } from "../store/teenPattiCompanion";
import { useSessionStore } from "../store/session";
import { playUiSound } from "../sound";

const SUIT_SYMBOL: Record<Suit, string> = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" };
const SUIT_LABEL: Record<Suit, string> = { spades: "Spades", hearts: "Hearts", diamonds: "Diamonds", clubs: "Clubs" };
const cards = createDeck().filter((card): card is Card => !card.joker);

function newDraft(index: number): TeenPattiRosterPlayer {
  return { id: `tp-local-${index + 1}`, name: `Player ${index + 1}`, wallet: 10_000, stats: { roundsPlayed: 0, wins: 0, losses: 0, netChips: 0 } };
}
function chips(amount: number): string { return `${formatChips(amount)} chips`; }
function signed(amount: number): string { return `${amount > 0 ? "+" : amount < 0 ? "−" : ""}${formatChips(Math.abs(amount))}`; }
function playerOutcomeClass(player: TeenPattiCompanionPlayer): string { return player.outcome === "winner" || player.outcome === "shared" ? "winner" : "lost"; }

export function TeenPattiCompanionPage() {
  const state = useTeenPattiCompanionStore(store => store.state);
  const roster = useTeenPattiCompanionStore(store => store.roster);
  const settings = useTeenPattiCompanionStore(store => store.settings);
  const setSettings = useTeenPattiCompanionStore(store => store.setSettings);
  const start = useTeenPattiCompanionStore(store => store.start);
  const setRoster = useTeenPattiCompanionStore(store => store.setRoster);
  const update = useTeenPattiCompanionStore(store => store.update);
  const nextRound = useTeenPattiCompanionStore(store => store.nextRound);
  const undo = useTeenPattiCompanionStore(store => store.undo);
  const editTable = useTeenPattiCompanionStore(store => store.editTable);
  const canUndo = useTeenPattiCompanionStore(store => store.undoStack.length > 0);
  const preferences = useSessionStore(store => store.preferences);
  const setPreferences = useSessionStore(store => store.setPreferences);
  const [playerCount, setPlayerCount] = useState(Math.max(2, Math.min(6, roster.length || 4)));
  const [drafts, setDrafts] = useState<TeenPattiRosterPlayer[]>(() => roster.length ? roster : Array.from({ length: 4 }, (_, index) => newDraft(index)));
  const [bootAmount, setBootAmount] = useState(() => String(settings.bootAmount));
  const [maxPot, setMaxPot] = useState(() => String(settings.maxPot));
  const [customBet, setCustomBet] = useState("100");
  const [openingSeen, setOpeningSeen] = useState(false);
  const [activeSuit, setActiveSuit] = useState<Suit>("spades");
  const [error, setError] = useState("");
  const previousState = useRef<TeenPattiCompanionState | null>(null);

  useEffect(() => { if (!state && roster.length) setDrafts(roster); }, [roster, state]);
  useEffect(() => {
    const minimumPot = Number(bootAmount) * playerCount * 2;
    if (Number.isSafeInteger(minimumPot) && minimumPot > 0 && (Number(maxPot) || 0) < minimumPot) setMaxPot(String(minimumPot));
  }, [bootAmount, playerCount]);
  useEffect(() => {
    const previous = previousState.current;
    if (state && previous) {
      const previousCardCount = previous.players.reduce((sum, player) => sum + player.cards.length, 0);
      const currentCardCount = state.players.reduce((sum, player) => sum + player.cards.length, 0);
      if (currentCardCount > previousCardCount) playUiSound("deal");
      if (previous.stage !== "complete" && state.stage === "complete") {
        playUiSound("reveal");
        state.players.forEach((player, index) => playUiSound(player.outcome === "winner" ? "win" : player.outcome === "shared" ? "push" : "loss", 0.32 + index * 0.33));
      }
      if (previous.stage === "opening" && state.stage === "playing") playUiSound("shuffle");
      if (previous.stage === "playing" && state.stage === "dealing") playUiSound("reveal");
    }
    previousState.current = state;
  }, [state]);

  const execute = (operation: () => TeenPattiCompanionState, sound?: Parameters<typeof playUiSound>[0]) => {
    try { setError(""); update(operation()); if (sound) playUiSound(sound); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "That action could not be completed."); playUiSound("error"); }
  };
  const changeDraft = (index: number, key: "name" | "wallet", value: string) => {
    setDrafts(current => current.map((player, item) => item === index ? { ...player, [key]: key === "name" ? value : (value === "" ? 0 : Number(value)) } : player));
  };
  const changeCount = (value: number) => {
    const count = Math.max(2, Math.min(6, value));
    setPlayerCount(count);
    setDrafts(current => Array.from({ length: count }, (_, index) => current[index] ?? newDraft(index)));
    setMaxPot(current => String(Math.max(Number(current) || 0, (Number(bootAmount) || 1) * count * 2)));
  };
  const beginSession = () => {
    try {
      const chosen = drafts.slice(0, playerCount).map(player => ({ ...player, name: player.name.trim() }));
      const boot = Number(bootAmount); const cap = Number(maxPot);
      start(chosen, { bootAmount: boot, maxPot: cap });
      setRoster(chosen);
      setSettings({ bootAmount: boot, maxPot: cap });
      setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Check the player details and table limits."); }
  };

  useEffect(() => {
    setOpeningSeen(false);
  }, [state?.bettingIndex]);

  useEffect(() => {
    if (state?.stage === "opening") {
      const active = state.players[state.bettingIndex];
      if (active) setCustomBet(String(state.currentStake * (openingSeen ? 2 : 1)));
    } else if (state?.stage === "playing") {
      const active = state.players[state.turnIndex];
      if (active) setCustomBet(String(active.seen ? state.currentStake * 2 : state.currentStake));
    }
  }, [state?.stage, state?.bettingIndex, state?.turnIndex, state?.currentStake, state?.players, openingSeen]);

  if (!state) return <SetupStage drafts={drafts} playerCount={playerCount} bootAmount={bootAmount} maxPot={maxPot} onCount={changeCount} onDraft={changeDraft} onBoot={value => { setBootAmount(value); setMaxPot(current => String(Math.max(Number(current) || 0, (Number(value) || 1) * playerCount * 2))); }} onMaxPot={setMaxPot} onStart={beginSession} error={error}/>;

  const currentOpeningPlayer = state.players[state.bettingIndex];
  const currentDealPlayer = state.players[state.dealingPlayerIndex];
  const currentTurnPlayer = state.players[state.turnIndex];
  const activePlayers = state.players.filter(player => !player.folded);
  const pendingSideshowTarget = state.pendingSideshow ? state.players.find(player => player.id === state.pendingSideshow!.targetId) : undefined;
  const pendingSideshowRequester = state.pendingSideshow ? state.players.find(player => player.id === state.pendingSideshow!.requesterId) : undefined;
  const openingBounds = currentOpeningPlayer ? teenPattiCompanionOpeningBetBounds(state, currentOpeningPlayer.id, openingSeen) : { min: 0, max: 0, canAct: false };
  const wagerBounds = currentTurnPlayer ? teenPattiCompanionBetBounds(state, currentTurnPlayer.id) : { min: 0, max: 0, canAct: false, seen: false };
  const blindBounds = currentTurnPlayer ? teenPattiCompanionActionBounds(state, currentTurnPlayer.id, false) : { min: 0, max: 0, canAct: false };
  const seenBounds = currentTurnPlayer ? teenPattiCompanionActionBounds(state, currentTurnPlayer.id, true) : { min: 0, max: 0, canAct: false };
  const blindMin = blindBounds.min;
  const blindMax = blindBounds.max;
  const seenMin = seenBounds.min;
  const seenMax = seenBounds.max;
  const sideshowCost = state.currentStake * 2;
  const previousBettor = state.players.find(player => player.id === state.lastActionPlayerId && !player.folded && player.seen);
  const canSideshow = Boolean(currentTurnPlayer?.seen && activePlayers.length >= 3 && activePlayers.every(player => player.seen) && previousBettor && previousBettor.id !== currentTurnPlayer.id && (currentTurnPlayer.wallet >= sideshowCost) && (state.pot + sideshowCost <= state.maxPot));
  const showOpponent = activePlayers.length === 2 ? activePlayers.find(player => player.id !== currentTurnPlayer?.id) : undefined;
  const showCost = currentTurnPlayer && showOpponent ? teenPattiShowCost(state.currentStake, currentTurnPlayer.seen, showOpponent.seen) : null;
  const canUndoMove = canUndo;
  return <main className="page-container tp-companion-page">
    <div className="tp-topbar">
      <div><span className="eyebrow">CARDROOM · PHYSICAL TABLE COMPANION</span><h1>Teen Patti <em>home table.</em></h1><p>Round {state.roundNumber} · {state.players.length} players · Physical deck</p></div>
      <div className="tp-top-actions"><span className="tp-saved-pill"><i/> Saved on this device</span><button type="button" className={`blackjack-sound-toggle ${preferences.sound ? "enabled" : ""}`} aria-pressed={preferences.sound} onClick={() => { const enabled = !preferences.sound; setPreferences({ sound: enabled }); if (enabled) playUiSound("tap"); }}><span>{preferences.sound ? <Volume2 size={14}/> : <VolumeX size={14}/>}</span>{preferences.sound ? "Sound on" : "Sound off"}</button>{canUndoMove && <Button variant="outline" onClick={() => { setError(""); undo(); playUiSound("tap"); }}><Undo2 size={15}/> Undo</Button>}<Button variant="ghost" onClick={editTable}><X size={15}/> Edit table</Button></div>
    </div>
    <div className="tp-progress" aria-label="Game progress"><Step active={state.stage === "opening"} done={state.stage !== "opening"} number="01" label="Opening bets"/><i/><Step active={state.stage === "playing"} done={state.stage === "dealing" || state.stage === "complete"} number="02" label="Betting rounds"/><i/><Step active={state.stage === "dealing"} done={state.stage === "complete"} number="03" label="Private cards"/><i/><Step active={state.stage === "complete"} done={false} number="04" label="Results"/></div>

    <AnimatePresence mode="wait">
      {state.stage === "opening" && currentOpeningPlayer && <motion.section key="opening" className="tp-stage-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
        <StepHeader step="01" title="Opening wager" description={`Pass the device to ${currentOpeningPlayer.name}. Choose blind or seen using your real cards, then post the boot and opening wager. This is only the opening wager; further betting turns continue after all players have posted.`}/>
        <div className="tp-betting-layout">
          <div className="tp-bet-main">
            <div className="tp-bet-player-head"><span className="tp-avatar">{currentOpeningPlayer.name.slice(0, 1).toUpperCase()}</span><div><small>PLAYER {state.bettingIndex + 1} OF {state.players.length}</small><h3>{currentOpeningPlayer.name}</h3></div><span className="tp-your-turn">Your opening bet</span></div>
            <div className="tp-boot-callout"><span className="tp-boot-chip">♠</span><div><small>MANDATORY BOOT / ANTE</small><strong>{chips(state.bootAmount)}</strong><p>Paid with your first wager. Card values stay locked until the betting phase ends at the max pot or a show.</p></div></div>
            <div className="tp-wallet-row"><div><small>Available wallet</small><b>{chips(currentOpeningPlayer.wallet)}</b></div><div><small>Pot so far</small><b className="gold-text">{chips(state.pot)}</b></div></div>
            <div className="tp-opening-choice" role="group" aria-label="Choose opening play style">
              <button type="button" className={!openingSeen ? "selected" : ""} aria-pressed={!openingSeen} onClick={() => { setOpeningSeen(false); setCustomBet(String(state.currentStake)); }}><b>Blind</b><span>1×–2× stake</span><small>Keep your cards unseen</small></button>
              <button type="button" className={openingSeen ? "selected" : ""} aria-pressed={openingSeen} onClick={() => { setOpeningSeen(true); setCustomBet(String(state.currentStake * 2)); }}><b>Seen / Chaal</b><span>2×–4× stake</span><small>You have looked at your physical cards</small></button>
            </div>
            <div className="tp-wager-range"><div><small>{openingSeen ? "OPENING SEEN / CHAAL RANGE" : "OPENING BLIND RANGE"}</small><b>{chips(openingBounds.min)} – {chips(openingBounds.max)}</b></div><span>{openingSeen ? "2×–4× current stake · half becomes next stake" : "1×–2× current stake · full wager becomes next stake"}</span></div>
            <div className="tp-custom-bet tp-live-wager"><label htmlFor="tp-opening-bet">Choose your {openingSeen ? "seen chaal" : "blind"} wager</label><div><input id="tp-opening-bet" type="number" min={openingBounds.min} max={openingBounds.max} step={openingSeen ? 2 : 1} value={customBet} onChange={event => setCustomBet(event.target.value)}/><span className="tp-wager-unit">chips</span></div><div className="tp-wager-presets">{[openingBounds.min, openingBounds.max].filter((value, index, list) => value > 0 && list.indexOf(value) === index).map(value => <button type="button" key={value} onClick={() => setCustomBet(String(value))}>{formatChips(value)}</button>)}</div></div>
            <div className="tp-confirm-row"><div><small>Total debit · boot + wager</small><b>{chips(state.bootAmount + (Number(customBet) || 0))}</b></div><Button disabled={!openingBounds.canAct || !Number.isSafeInteger(Number(customBet)) || Number(customBet) < openingBounds.min || Number(customBet) > openingBounds.max || (openingSeen && Number(customBet) % 2 !== 0)} onClick={() => execute(() => teenPattiCompanionPostOpeningBet(state, currentOpeningPlayer.id, Number(customBet), openingSeen), "chip")}>Post boot + {openingSeen ? "seen chaal" : "blind bet"} <Check size={15}/></Button></div>
          </div>
          <aside className="tp-bet-sidebar"><div className="tp-summary-head"><div><small>ROUND {state.roundNumber}</small><h3>Opening bets</h3></div><b>{state.players.filter(player => player.betConfirmed).length}/{state.players.length} locked</b></div><div className="tp-pot-display"><small>OPENING POT</small><strong>{chips(state.pot)}</strong><span>Maximum {chips(state.maxPot)}</span></div><div className="tp-player-checklist">{state.players.map(player => <div className={player.id === currentOpeningPlayer.id ? "current" : player.betConfirmed ? "confirmed" : ""} key={player.id}><span className="tp-avatar small">{player.name.slice(0, 1).toUpperCase()}</span><div><b>{player.name}</b><small>{player.betConfirmed ? (player.seen ? "Seen opening chaal locked" : "Blind opening bet locked") : player.id === currentOpeningPlayer.id ? "Betting now" : "Waiting"}</small></div><strong>{player.betConfirmed ? formatChips(player.bet) : "—"}</strong></div>)}</div><div className="tp-rule-note"><ShieldCheck size={14}/><span>Players choose blind or seen using their physical cards. This is only the opening wager: after every player posts boot + opening wager, betting continues in repeated clockwise turns until the maximum pot, a show, or one remaining player ends the betting phase.</span></div></aside>
        </div>
        <div className="tp-stage-footer"><span><ShieldCheck size={14}/> Virtual chips only · No cash value</span><button type="button" className="tp-text-button" onClick={editTable}><ChevronLeft size={14}/> Edit players and table rules</button></div>
      </motion.section>}

      {state.stage === "dealing" && currentDealPlayer && <motion.section key="dealing" className="tp-stage-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
        <StepHeader step="03" title="Private card entry" description={`Betting is finished (${state.completionReason === "max-pot" ? "maximum pot reached" : "a show was called"}). Only ${currentDealPlayer.name} should use this screen to enter the three physical cards. The result table appears after every remaining player has entered their hand.`}/>
        <div className="tp-deal-board">
          <div className="tp-cap-closed-banner" role="status"><span className="tp-cap-closed-icon"><ShieldCheck size={17}/></span><div><b>{state.completionReason === "max-pot" ? "MAXIMUM POT REACHED · BETTING LOCKED" : "SHOW CALLED · BETTING LOCKED"}</b><span>{chips(state.pot)} is in the pot. No more chaal or raises are allowed. Enter the remaining physical hands below; the results table opens automatically after the last player is done.</span></div><strong>{chips(state.pot)} / {chips(state.maxPot)}</strong></div>
          <div className="tp-private-entry-banner"><ShieldCheck size={18}/><div><b>Private hand entry · pass the device</b><span>Ask everyone else to look away. Previously entered hands stay hidden; only {currentDealPlayer.name}'s cards appear here.</span></div></div>
          <div className="tp-deal-player-strip">{state.players.map((player, index) => <div key={player.id} className={`tp-deal-player ${player.id === currentDealPlayer.id ? "active" : player.folded || player.cards.length === 3 ? "done" : ""}`}><span className="tp-avatar">{player.name.slice(0, 1).toUpperCase()}</span><div><b>{player.name}</b><small>{player.folded ? "Packed · no hand entry" : player.id === currentDealPlayer.id ? `${player.cards.length}/3 cards selected` : player.cards.length === 3 ? "Cards entered" : "Waiting"}</small></div><span className="tp-card-count">{player.folded ? "OUT" : player.id === currentDealPlayer.id ? `${player.cards.length}/3` : player.cards.length === 3 ? <Check size={15}/> : "•••"}</span></div>)}</div>
          <div className="tp-current-hand"><div><span className="eyebrow">CARD ENTRY · {currentDealPlayer.name.toUpperCase()}</span><h3>{currentDealPlayer.cards.length === 0 ? "Select the first card" : currentDealPlayer.cards.length === 1 ? "Select the second card" : "Select the third card"}</h3><p>Tap the exact card from the physical deck. Used cards are disabled to prevent duplicates.</p></div><div className="tp-current-cards">{currentDealPlayer.cards.map((card, index) => <motion.div key={card.id} initial={{ opacity: 0, y: 10, rotate: -5 }} animate={{ opacity: 1, y: 0, rotate: 0 }}><PlayingCard card={card} index={index}/></motion.div>)}{Array.from({ length: 3 - currentDealPlayer.cards.length }, (_, index) => <div className="tp-empty-card" key={`empty-${index}`}><span>{currentDealPlayer.cards.length + index + 1}</span></div>)}</div></div>
          <CardSelector cards={cards} usedCardIds={state.usedCardIds} activeSuit={activeSuit} onSuit={setActiveSuit} onSelect={cardId => execute(() => teenPattiCompanionSelectCard(state, cardId), "card")}/>
          <div className="tp-deal-footnote"><Info size={14}/> Each card can only be entered once. Teen Patti uses all four suits because suit determines Color and Pure Sequence. Every physical card can only be entered once.</div>
        </div>
      </motion.section>}

      {state.stage === "playing" && currentTurnPlayer && <motion.section key="playing" className="tp-stage-card tp-live-betting-stage" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
        <StepHeader step="02" title="Teen Patti betting" description="Betting stays open for as many clockwise turns as needed. Players may raise with repeated blind bets or seen chaal, pack, request an eligible sideshow, or call show. Card identities remain completely outside the app until betting ends."/>
        <div className="tp-live-topline"><div className="tp-live-pot"><small>LIVE POT</small><strong>{chips(state.pot)}</strong><span>Maximum {chips(state.maxPot)}</span></div><div className="tp-live-stake"><small>CURRENT BLIND STAKE</small><strong>{chips(state.currentStake)}</strong><span>Repeated turns · blind 1×–2× · seen 2×–4×</span></div><div className="tp-live-count"><small>PLAYERS STILL IN</small><strong>{activePlayers.length} / {state.players.length}</strong><span>{state.players.length - activePlayers.length} packed</span></div></div>
        <div className="tp-live-player-grid">{state.players.map((player, index) => <div key={player.id} className={`tp-live-player ${player.id === currentTurnPlayer.id ? "current" : ""} ${player.folded ? "packed" : ""}`}><span className="tp-avatar">{player.name.slice(0, 1).toUpperCase()}</span><div><b>{player.name}</b><small>{player.folded ? "Packed" : player.seen ? "Seen" : "Blind"} · {chips(player.wallet)} left</small></div><strong>{player.folded ? "OUT" : formatChips(player.bet)}</strong></div>)}</div>
        {state.pendingSideshow ? <div className="tp-sideshow-prompt"><div><span className="eyebrow">SIDE SHOW · PHYSICAL COMPARISON</span><h3>{pendingSideshowRequester?.name} asks {pendingSideshowTarget?.name} to compare hands.</h3><p>{chips(state.currentStake * 2)} was already added to the pot. Compare the two real hands at the table, then record the weaker hand here. If they tie, the requester packs. No card identities are entered until all betting is finished.</p></div><div className="tp-sideshow-actions"><Button onClick={() => execute(() => teenPattiCompanionRespondSideshow(state, pendingSideshowTarget!.id, true, pendingSideshowRequester!.id), "loss")}>{pendingSideshowRequester?.name} is weaker</Button><Button onClick={() => execute(() => teenPattiCompanionRespondSideshow(state, pendingSideshowTarget!.id, true, pendingSideshowTarget!.id), "loss")}>{pendingSideshowTarget?.name} is weaker</Button><Button variant="outline" onClick={() => execute(() => teenPattiCompanionRespondSideshow(state, pendingSideshowTarget!.id, true, "tie"), "tap")}>Hands tie</Button><Button variant="ghost" onClick={() => execute(() => teenPattiCompanionRespondSideshow(state, pendingSideshowTarget!.id, false), "tap")}>Decline</Button></div></div> : <div className="tp-betting-layout">
          <div className="tp-bet-main">
            <div className="tp-bet-player-head"><span className="tp-avatar">{currentTurnPlayer.name.slice(0, 1).toUpperCase()}</span><div><small>PLAYER {state.turnIndex + 1} · {currentTurnPlayer.seen ? "SEEN HAND" : "BLIND HAND"}</small><h3>{currentTurnPlayer.name}</h3></div><span className="tp-your-turn">Your turn</span></div>
            <div className="tp-wallet-row"><div><small>Available wallet</small><b>{chips(currentTurnPlayer.wallet)}</b></div><div><small>Total contributed</small><b className="gold-text">{chips(currentTurnPlayer.bet)}</b></div></div>
            {currentTurnPlayer.seen
              ? <p className="tp-rule-hint"><ShieldCheck size={14}/> You are marked <b>seen</b> from your physical cards. Card identities are not entered in Cardroom yet, so no other player can inspect them on this shared screen.</p>
              : <p className="tp-rule-hint">You are currently playing <b>blind</b>. If you have looked at your physical cards, choose “See cards & chaal” to switch to seen. Once seen, you cannot switch back to blind.</p>}
            <div className="tp-wager-range"><div><small>{currentTurnPlayer.seen ? "CHAAL RANGE · SEEN" : "BLIND RANGE"}</small><b>{chips(currentTurnPlayer.seen ? seenMin : blindMin)} – {chips(currentTurnPlayer.seen ? seenMax : blindMax)}</b></div><span>{currentTurnPlayer.seen ? "2×–4× · next blind stake is half your wager" : "1×–2× · next blind stake is your wager"}</span></div>
            <div className="tp-custom-bet tp-live-wager"><label htmlFor="tp-custom-bet">Choose wager amount</label><div><input id="tp-custom-bet" type="number" min={currentTurnPlayer.seen ? seenMin : blindMin} max={currentTurnPlayer.seen ? seenMax : blindMax} step={currentTurnPlayer.seen ? 2 : 1} value={customBet} onChange={event => setCustomBet(event.target.value)}/><span className="tp-wager-unit">chips</span></div><div className="tp-wager-presets">{[currentTurnPlayer.seen ? seenMin : blindMin, currentTurnPlayer.seen ? seenMax : blindMax].filter((value, index, list) => value > 0 && list.indexOf(value) === index).map(value => <button type="button" key={value} onClick={() => setCustomBet(String(value))}>{formatChips(value)}</button>)}</div><p className="tp-cap-hint">{chips(state.maxPot - state.pot)} remaining before the maximum pot. Keep taking turns until the cap is reached.</p></div>
            <div className="tp-live-actions">
              {!currentTurnPlayer.seen && <Button variant="outline" disabled={!blindBounds.canAct || Number(customBet) < blindMin || Number(customBet) > blindMax} onClick={() => execute(() => teenPattiCompanionAct(state, currentTurnPlayer.id, "blind", Math.max(blindMin, Number(customBet) || blindMin)), "chip")}>Play blind</Button>}
              <Button disabled={!seenBounds.canAct || Number(customBet) < seenMin || Number(customBet) > seenMax || (Number(customBet) % 2 !== 0 && state.pot + Number(customBet) < state.maxPot)} onClick={() => execute(() => teenPattiCompanionAct(state, currentTurnPlayer.id, "chaal", Math.max(seenMin, Number(customBet) || seenMin)), "chip")}>{currentTurnPlayer.seen ? "Chaal · seen" : `See cards & chaal · min ${formatChips(seenMin)}`}</Button>
              <Button variant="outline" disabled={currentTurnPlayer.seen ? !seenBounds.canAct : !blindBounds.canAct} onClick={() => setCustomBet(String(currentTurnPlayer.seen ? seenMax : blindMax))}>Use max wager</Button>
              <Button variant="ghost" onClick={() => execute(() => teenPattiCompanionAct(state, currentTurnPlayer.id, "pack"), "loss")}>Pack</Button>
              {canSideshow && <Button variant="outline" onClick={() => execute(() => teenPattiCompanionAct(state, currentTurnPlayer.id, "sideshow"), "reveal")}>Side show · pay {chips(sideshowCost)}</Button>}
              {activePlayers.length === 2 && <Button variant="outline" disabled={showCost === null || currentTurnPlayer.wallet < (showCost ?? 0) || state.pot + (showCost ?? 0) > state.maxPot} onClick={() => execute(() => teenPattiCompanionAct(state, currentTurnPlayer.id, "show"), "reveal")}>{showCost === null ? "Show unavailable against blind" : `Show · ${chips(showCost)}`}</Button>}
            </div>
            {activePlayers.length >= 3 && !activePlayers.every(player => player.seen) && <p className="tp-rule-hint">Side show unlocks only when every remaining player is marked seen and the previous bettor is also seen. Compare real cards at the table; enter all card values only after betting closes.</p>}
            {!wagerBounds.canAct && <p className="tp-cannot-bet-note">This player cannot cover the minimum stake. Pack is available to leave the round.</p>}
          </div>
          <aside className="tp-bet-sidebar"><div className="tp-summary-head"><div><small>ROUND {state.roundNumber}</small><h3>Table status</h3></div><b>{activePlayers.length} active</b></div><div className="tp-pot-display"><small>POT</small><strong>{chips(state.pot)}</strong><span>Current stake {chips(state.currentStake)}</span></div><div className="tp-player-checklist">{state.players.map(player => <div className={player.id === currentTurnPlayer.id ? "current" : player.folded ? "packed" : player.seen ? "confirmed" : ""} key={player.id}><span className="tp-avatar small">{player.name.slice(0, 1).toUpperCase()}</span><div><b>{player.name}</b><small>{player.folded ? "Packed" : player.id === currentTurnPlayer.id ? "Acting now" : player.seen ? "Seen" : "Blind"}</small></div><strong>{formatChips(player.bet)}</strong></div>)}</div><div className="tp-history-panel"><b>Recent actions</b>{state.history.filter(item => item.type === "action" || item.type.startsWith("sideshow")).slice(-5).reverse().map((item, index) => <div key={`${item.type}-${index}`}><span>{state.players.find(player => player.id === item.playerId)?.name ?? "Player"}</span><strong>{item.action === "chaal" ? "Chaal (seen)" : item.action === "blind" ? "Blind" : item.action === "blind-opening" ? "Opening blind bet" : item.action === "seen-opening" ? "Opening seen chaal" : item.action === "pack" ? "Pack" : item.action ?? item.type}{item.amount ? ` · ${formatChips(item.amount)}` : ""}</strong></div>)}</div></aside>
        </div>}
        <div className="tp-stage-footer"><span><ShieldCheck size={14}/> Repeated blind/seen betting · Pack · Sideshow · Show · Max-pot close</span><span>Virtual chips only · No cash value</span></div>
      </motion.section>}

      {state.stage === "complete" && <motion.section key="results" className="tp-stage-card tp-results-stage" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
        <div className="tp-results-hero"><motion.div className="tp-results-trophy" initial={{ scale: .55, rotate: -14 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 230, damping: 15 }}><Trophy size={27}/></motion.div><span className="eyebrow">ROUND {state.roundNumber} · {state.completionReason === "max-pot" ? "MAXIMUM POT REACHED" : state.completionReason === "show" ? "SHOW CALLED" : "LAST PLAYER STANDING"}</span><h2>{state.winnerIds.length > 1 ? "A shared victory." : `${state.players.find(player => player.id === state.winnerIds[0])?.name ?? "Winner"} takes the pot.`}</h2><p>{chips(state.pot)} distributed · Every hand is ranked and every wallet is updated.</p></div>
        <div className="tp-results-grid">{state.players.map((player, index) => <motion.article key={player.id} className={`tp-result-card tp-result-${playerOutcomeClass(player)}`} initial={{ opacity: 0, y: 13 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .075 }}>
          <div className="tp-result-head"><span className="tp-avatar">{player.name.slice(0, 1).toUpperCase()}</span><div><b>{player.name}</b><small>{player.outcome === "shared" ? "Shared winner" : player.outcome === "winner" ? "Winner" : "Did not win"}</small></div><strong className={player.netChange! > 0 ? "positive" : player.netChange! < 0 ? "negative" : "neutral"}>{signed(player.netChange ?? 0)}</strong></div>
          <div className="tp-result-cards">{player.cards.map((card, cardIndex) => <PlayingCard key={card.id} card={card} index={cardIndex} dealIn/>)}</div>
          <div className="tp-result-rank"><small>HAND RANK</small><b>{player.rank ? teenPattiCompanionRankLabel(player.rank) : "—"}</b></div>
          <p className="tp-result-reason">{player.reason}</p>
          <div className="tp-result-finance"><span>Bet <b>{formatChips(player.bet)}</b></span><span>Payout <b>{formatChips(player.payout ?? 0)}</b></span><span>Wallet <b>{formatChips(player.wallet)}</b></span></div>
          <div className="tp-result-stats"><span>{player.stats.roundsPlayed} rounds</span><span>{player.stats.wins} wins</span><span>{player.stats.losses} losses</span></div>
        </motion.article>)}</div>
        <div className="tp-settlement-ledger"><div className="tp-ledger-heading"><div><span className="eyebrow">FULL ROUND BREAKDOWN</span><h3>Player winnings & losses</h3></div><span>All values in virtual chips</span></div><div className="tp-ledger-scroll"><table className="tp-settlement-table"><thead><tr><th>Player</th><th>Hand / status</th><th>Result</th><th>Reason</th><th>Put in</th><th>Won</th><th>Net</th><th>Final wallet</th></tr></thead><tbody>{state.players.map(player => <tr key={player.id} className={player.outcome === "winner" || player.outcome === "shared" ? "ledger-winner" : "ledger-loser"}><td><b>{player.name}</b></td><td>{player.rank ? teenPattiCompanionRankLabel(player.rank) : player.outcome === "folded" ? "Packed" : "—"}</td><td><span className={`tp-ledger-result ${player.outcome ?? "lost"}`}>{player.outcome === "shared" ? "Shared win" : player.outcome === "winner" ? "Winner" : player.outcome === "folded" ? "Packed" : "Lost"}</span></td><td>{player.reason}</td><td>{formatChips(player.bet)}</td><td>{formatChips(player.payout ?? 0)}</td><td className={(player.netChange ?? 0) > 0 ? "positive" : (player.netChange ?? 0) < 0 ? "negative" : "neutral"}>{signed(player.netChange ?? 0)}</td><td><b>{formatChips(player.wallet)}</b></td></tr>)}</tbody><tfoot><tr><td colSpan={4}>Round totals</td><td>{formatChips(state.players.reduce((sum, player) => sum + player.bet, 0))}</td><td>{formatChips(state.players.reduce((sum, player) => sum + (player.payout ?? 0), 0))}</td><td>{signed(state.players.reduce((sum, player) => sum + (player.netChange ?? 0), 0))}</td><td>—</td></tr></tfoot></table></div></div>
        <div className="tp-results-actions"><Button onClick={() => { try { nextRound(); setError(""); playUiSound("shuffle"); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to start next round"); } }}><RotateCcw size={15}/> Play next round</Button><Button variant="outline" onClick={editTable}>Edit players & rules</Button></div>
      </motion.section>}
    </AnimatePresence>
    {error && <div className="tp-error" role="alert"><Info size={15}/>{error}</div>}
  </main>;
}

function Step({ active, done, number, label }: { active: boolean; done: boolean; number: string; label: string }) {
  return <div className={`tp-progress-step ${active ? "active" : done ? "done" : ""}`}><span>{done ? <Check size={13}/> : number}</span><b>{label}</b></div>;
}
function StepHeader({ step, title, description }: { step: string; title: string; description: string }) {
  return <div className="tp-step-heading"><span className="tp-step-number">{step}</span><div><h2>{title}</h2><p>{description}</p></div></div>;
}

function SetupStage({ drafts, playerCount, bootAmount, maxPot, onCount, onDraft, onBoot, onMaxPot, onStart, error }: {
  drafts: TeenPattiRosterPlayer[]; playerCount: number; bootAmount: string; maxPot: string;
  onCount: (value: number) => void; onDraft: (index: number, key: "name" | "wallet", value: string) => void;
  onBoot: (value: string) => void; onMaxPot: (value: string) => void; onStart: () => void; error: string;
}) {
  return <main className="page-container tp-companion-page">
    <div className="tp-intro-line"><span className="eyebrow">♥ CARDROOM · PHYSICAL TABLE COMPANION</span><span className="tp-saved-pill"><i/> Offline · no internet required</span></div>
    <section className="tp-hero"><div><span className="eyebrow">TEEN PATTI · HOME TABLE</span><h1>Bring the table<br/><em>to your table.</em></h1><p>Sit with friends and deal from your own physical deck. Players choose blind or seen and post their opening bets, then keep taking clockwise betting turns. Card identities stay out of the app until the maximum pot is reached or a show closes betting; after private card entry, Cardroom ranks the hands and settles the pot.</p><div className="tp-hero-points"><span><BadgeCheck size={15}/> Real cards, entered by you</span><span><BadgeCheck size={15}/> No bots or simulated players</span><span><BadgeCheck size={15}/> Hand-by-hand results</span></div></div><div className="tp-hero-art" aria-hidden="true"><div className="tp-hero-card tp-hero-card-back">✦</div><div className="tp-hero-card tp-hero-ace"><small>A</small><b>♥</b><i>A</i></div><div className="tp-hero-chip-art"><span>TEEN PATTI</span><b>3 CARDS · 1 POT</b></div></div></section>
    <section className="tp-stage-card tp-setup-card">
      <StepHeader step="01" title="Set up your players" description="Choose who is playing, edit everyone's wallet, and set the boot and table pot limit."/>
      <div className="tp-count-row"><div><b>Players at the table</b><small>Teen Patti supports 2 to 6 players.</small></div><div className="tp-count-stepper"><button type="button" disabled={playerCount <= 2} onClick={() => onCount(playerCount - 1)} aria-label="Remove player">−</button><strong>{playerCount}</strong><button type="button" disabled={playerCount >= 6} onClick={() => onCount(playerCount + 1)} aria-label="Add player">+</button></div></div>
      <div className="tp-roster-grid">{drafts.slice(0, playerCount).map((player, index) => <motion.article className="tp-roster-player" key={player.id} layout><div className="tp-roster-player-top"><span className="tp-avatar">{player.name.slice(0, 1).toUpperCase() || String(index + 1)}</span><div><b>Player {index + 1}</b><small>{player.stats.roundsPlayed} rounds · {player.stats.wins} wins · {player.stats.losses} losses</small></div></div><label>Player name<input value={player.name} onChange={event => onDraft(index, "name", event.target.value)} maxLength={20} placeholder={`Player ${index + 1}`}/></label><label>Wallet balance<div className="tp-wallet-input"><input type="number" min={Math.max(1, Number(bootAmount) * 2)} max="1000000000" step="100" value={player.wallet} onChange={event => onDraft(index, "wallet", event.target.value)}/><span>chips</span></div></label><div className="tp-roster-stats"><span>Win rate <b>{player.stats.roundsPlayed ? `${Math.round(player.stats.wins / player.stats.roundsPlayed * 100)}%` : "—"}</b></span><span>Net <b className={player.stats.netChips > 0 ? "positive" : player.stats.netChips < 0 ? "negative" : "neutral"}>{signed(player.stats.netChips)}</b></span></div></motion.article>)}</div>
      <div className="tp-rules-config"><div><label htmlFor="tp-boot">Starting boot <small>Mandatory opening ante paid by every player</small></label><div className="tp-config-input"><input id="tp-boot" type="number" min="1" step="1" value={bootAmount} onChange={event => onBoot(event.target.value)}/><span>chips / player</span></div></div><div><label htmlFor="tp-max-pot">Maximum pot <small>Hard cap for the entire round</small></label><div className="tp-config-input"><input id="tp-max-pot" type="number" min={Math.max(2, Number(bootAmount) * playerCount * 2)} step="100" value={maxPot} onChange={event => onMaxPot(event.target.value)}/><span>chips total</span></div></div></div>
      <div className="tp-rule-note"><Info size={15}/><span>Offline privacy-first sequence: deal the physical cards first. Each player privately decides blind or seen and posts the boot plus opening wager. Then betting continues through repeated clockwise turns—players may chaal or raise as often as they like, pack, request eligible sideshows, or call a heads-up show. Card identities are not entered into the app during betting. When the maximum pot is reached (or a show closes betting), the remaining players enter their cards privately and the full result ledger is shown. If everyone but one player packs, that player wins immediately.</span></div>
      {error && <div className="tp-error" role="alert"><Info size={15}/>{error}</div>}
      <div className="tp-setup-footer"><span><Users size={15}/> {playerCount} seats · {chips(Number(maxPot) || 0)} max pot</span><Button onClick={onStart}>Start opening bets <ArrowRight size={16}/></Button></div>
    </section>
  </main>;
}

function CardSelector({ cards: allCards, usedCardIds, activeSuit, onSuit, onSelect }: {
  cards: Card[]; usedCardIds: string[]; activeSuit: Suit; onSuit: (suit: Suit) => void; onSelect: (id: string) => void;
}) {
  // Never reveal availability per card or per suit during pass-the-device entry.
  // All players see the same selector; the rules engine privately rejects an
  // accidental duplicate identity without exposing anyone else's selected hand.
  const suitCards = useMemo(() => allCards.filter(card => card.suit === activeSuit).sort((a, b) => b.rank - a.rank), [allCards, activeSuit]);
  const usedCount = usedCardIds.length;
  return <div className="tp-card-picker">
    <div className="tp-picker-heading"><div><span className="eyebrow">SELECT FROM THE PHYSICAL DECK</span><h3>Choose a card</h3></div><span className="tp-card-counter">{usedCount}/52 cards entered</span></div>
    <div className="tp-suit-tabs" role="tablist" aria-label="Card suits">{SUITS.map(suit => <button type="button" role="tab" aria-selected={activeSuit === suit} className={`${activeSuit === suit ? "selected" : ""} ${suit === "hearts" || suit === "diamonds" ? "red" : ""}`} key={suit} onClick={() => onSuit(suit)}><b>{SUIT_SYMBOL[suit]}</b>{SUIT_LABEL[suit]}</button>)}</div>
    <div className="tp-card-grid">{suitCards.map(card => <motion.div key={card.id} className="tp-card-choice" whileHover={{ y: -5 }} whileTap={{ scale: .96 }}><PlayingCard card={card} onClick={() => onSelect(card.id)} index={card.rank} soundOnSelect={false}/></motion.div>)}</div>
  </div>;
}
