import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDownToLine, ArrowUpRight, Check, CircleDollarSign, Flag, Layers, Pause, Play, RotateCcw, Shield, Trophy, Volume2, VolumeX, X } from "lucide-react";
import type { GameId, RoomSummary } from "@cardroom/shared/contracts";
import { SUITS, type PlayingCard as CardData, type Suit } from "@cardroom/shared/cards";
import { blackjackValue, type BlackjackOutcome, type BlackjackState } from "@cardroom/shared/games/blackjack";
import type { HoldemState } from "@cardroom/shared/games/holdem";
import { teenPattiRankLabel, teenPattiShowCost, teenPattiWagerBounds, type TeenPattiState } from "@cardroom/shared/games/teenPatti";
import { getCallbreakMinimumBid, getLegalCallbreakCardIds, type CallbreakState } from "@cardroom/shared/games/callbreak";
import { formatCallbreakScore } from "@cardroom/shared/games/callbreak-companion";
import type { RummyState, RummyGroup } from "@cardroom/shared/games/rummy";
import { formatChips, getGameTitle } from "../lib";
import { getOfflineDisplayName } from "../store/offline";
import { useSessionStore } from "../store/session";
import { PlayingCard } from "../components/PlayingCard";
import { Button } from "../components/Shared";
import { playUiSound } from "../sound";

export type AnyGameState = BlackjackState | HoldemState | TeenPattiState | CallbreakState | RummyState;
interface Props { gameId: GameId; state: AnyGameState; playerId: string; online?: boolean; room?: RoomSummary; onAction: (action: string, payload?: Record<string, unknown>) => void; onExit: () => void }

const suitOrder = ["spades", "hearts", "clubs", "diamonds"];
function sortCards(cards: CardData[]): CardData[] { return [...cards].sort((a, b) => (a.joker ? 99 : a.rank) - (b.joker ? 99 : b.rank) || suitOrder.indexOf(a.suit ?? "") - suitOrder.indexOf(b.suit ?? "")); }
function playerName(id: string, room?: RoomSummary) { return room?.players.find(p => p.id === id)?.displayName ?? getOfflineDisplayName(id); }
function chipLabel(value: number) { return `${formatChips(value)} chips`; }

function ChipStack({ value, self = false }: { value: number; self?: boolean }) {
  return <div className={`player-chip-stack ${self ? "self" : ""} ${value <= 0 ? "empty" : ""}`} aria-label={`${formatChips(value)} chips remaining`}>
    <span className="player-chip-stack-art" aria-hidden="true"><i/><i/><i/><i/></span>
    <b>{formatChips(value)}</b>
  </div>;
}

function PotDisplay({ label, value }: { label: string; value: number }) {
  return <div className="table-pot-display">
    <div className="pot-coin-heap" aria-hidden="true"><i/><i/><i/><i/><i/><i/><i/></div>
    <div className="pot-label"><CircleDollarSign size={18}/> {label} <b>{chipLabel(value)}</b></div>
  </div>;
}

export function GameTable({ gameId, state, playerId, online = false, room, onAction, onExit }: Props) {
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string[]>([]);
  const [groups, setGroups] = useState<RummyGroup[]>([]);
  const [rummyMode, setRummyMode] = useState<"discard" | "groups">("discard");
  const [raise, setRaise] = useState(20);
  const [bid, setBid] = useState(2);
  const [error, setError] = useState("");
  const [showBlackjackDeal, setShowBlackjackDeal] = useState(false);
  const [showTeenPattiDeal, setShowTeenPattiDeal] = useState(false);
  const [showCallbreakDeal, setShowCallbreakDeal] = useState(false);
  const [callbreakDealPasses, setCallbreakDealPasses] = useState<5 | 8>(5);
  const teenPattiDealPlayed = useRef(false);
  const callbreakDealStage = useRef({ round: 0, stage: 0 as 0 | 1 | 2 });
  const callbreakHistoryLength = gameId === "callbreak" ? (state as CallbreakState).history.length : 0;
  const previousCallbreakHistoryLength = useRef(callbreakHistoryLength);
  const preferences = useSessionStore(s => s.preferences);
  const setPreferences = useSessionStore(s => s.setPreferences);
  const previousStatus = useRef(state.status);
  const blackjackCardCount = gameId === "blackjack"
    ? (state as BlackjackState).dealer.length + (state as BlackjackState).players.reduce((count, player) => count + player.hands.reduce((handCount, hand) => handCount + hand.cards.length, 0), 0)
    : 0;
  const previousBlackjackCardCount = useRef(blackjackCardCount);

  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = state.status;
    if (!online) return;
    if (gameId === "teen-patti" && previous !== "complete" && state.status === "complete") {
      const teen = state as TeenPattiState;
      playUiSound("reveal");
      teen.players.forEach((player, index) => {
        const outcome = teen.settlement?.find(row => row.playerId === player.id)?.outcome;
        playUiSound(outcome === "winner" ? "win" : outcome === "shared" ? "push" : "loss", .3 + index * .34);
      });
      return;
    }
    if (gameId !== "blackjack") return;

    if (previous !== "complete" && state.status === "complete") {
      const settled = state as BlackjackState;
      playUiSound("reveal");
      settled.players.forEach((player, index) => {
        if (!player.hands.length) return;
        const outcomes = player.hands.map(hand => hand.outcome).filter(Boolean);
        const cue = outcomes.includes("blackjack") ? "blackjack"
          : outcomes.includes("win") ? "win"
          : outcomes.length > 0 && outcomes.every(outcome => outcome === "push") ? "push"
          : outcomes.length > 0 && outcomes.every(outcome => outcome === "bust") ? "bust"
          : "loss";
        playUiSound(cue, 0.22 + index * 0.36);
      });
      return;
    }

    if (previous !== "betting" || state.status === "betting") return;
    setShowBlackjackDeal(true);
    playUiSound("shuffle");
    const dealTimers = [420, 760, 1_100, 1_440].map(delay => window.setTimeout(() => playUiSound("deal"), delay / 1_000));
    const playerCount = (state as BlackjackState).players.length;
    const flightCount = 2 * (playerCount + 1);
    const finalFlightEnd = 0.22 + (flightCount - 1) * 0.085 + 0.72;
    const hideTimer = window.setTimeout(() => setShowBlackjackDeal(false), Math.max(1_650, (finalFlightEnd + 0.25) * 1_000));
    return () => { dealTimers.forEach(window.clearTimeout); window.clearTimeout(hideTimer); };
  }, [gameId, online, state.status]);

  useEffect(() => {
    if (online && gameId === "blackjack" && previousBlackjackCardCount.current > 0 && blackjackCardCount > previousBlackjackCardCount.current) {
      if (previousStatus.current !== "betting") playUiSound("deal");
    }
    previousBlackjackCardCount.current = blackjackCardCount;
  }, [blackjackCardCount, gameId, online]);
  useEffect(() => {
    if (online && gameId === "teen-patti" && state.status === "complete") teenPattiDealPlayed.current = false;
  }, [gameId, online, state.status]);
  useEffect(() => {
    if (!online || gameId !== "teen-patti" || state.status !== "playing" || teenPattiDealPlayed.current) return;
    const teen = state as TeenPattiState;
    if (teen.turns !== 0 || teen.players.length < 2) return;
    teenPattiDealPlayed.current = true;
    setShowTeenPattiDeal(true);
    playUiSound("shuffle");
    const dealTimers = Array.from({ length: teen.players.length * 3 }, (_, index) => window.setTimeout(() => playUiSound("deal"), 0.32 + index * 0.105));
    const reducedMotion = useSessionStore.getState().preferences.reducedMotion;
    const duration = reducedMotion ? 420 : 520 + teen.players.length * 3 * 105 + 520;
    const hideTimer = window.setTimeout(() => setShowTeenPattiDeal(false), duration);
    return () => { dealTimers.forEach(window.clearTimeout); window.clearTimeout(hideTimer); };
  }, [gameId, online, state.status]);
  const callbreakRound = gameId === "callbreak" ? (state as CallbreakState).round : 0;
  useEffect(() => {
    if (!online || gameId !== "callbreak") return;
    const callbreak = state as CallbreakState;
    const tracked = callbreakDealStage.current;
    let passes: 5 | 8 | null = null;

    // Fresh round: show five cards per seat, then pause for the trump-choice auction.
    if (callbreak.status === "trump-selection" && tracked.round !== callbreak.round) {
      callbreakDealStage.current = { round: callbreak.round, stage: 1 };
      passes = 5;
    } else if (callbreak.status === "bidding" && tracked.round === callbreak.round && tracked.stage === 1) {
      // Only after all four choices are locked does the server deal the remaining eight.
      callbreakDealStage.current = { round: callbreak.round, stage: 2 };
      passes = 8;
    } else if (tracked.round !== callbreak.round) {
      // A reconnect during a later phase should not replay cards already dealt.
      callbreakDealStage.current = { round: callbreak.round, stage: 2 };
    }
    if (!passes) return;

    setCallbreakDealPasses(passes);
    setShowCallbreakDeal(true);
    playUiSound("shuffle");
    const reducedMotion = useSessionStore.getState().preferences.reducedMotion;
    const dealTimers = reducedMotion ? [] : Array.from({ length: passes }, (_, index) => window.setTimeout(() => playUiSound("deal"), 0.28 + index * 0.22));
    const hideTimer = window.setTimeout(() => setShowCallbreakDeal(false), reducedMotion ? 420 : passes === 5 ? 1_850 : 2_850);
    return () => { dealTimers.forEach(window.clearTimeout); window.clearTimeout(hideTimer); };
  }, [gameId, online, callbreakRound, state.status]);

  useEffect(() => {
    if (!online || gameId !== "callbreak") return;
    const previous = previousCallbreakHistoryLength.current;
    if (callbreakHistoryLength > previous) {
      const event = (state as CallbreakState).history.at(-1);
      if (event?.type === "bid" || event?.type === "trump-selected" || event?.type === "trump-passed") playUiSound("tap");
      else if (event?.type === "play") playUiSound("card");
      else if (event?.type === "trick-won") playUiSound("success");
    }
    previousCallbreakHistoryLength.current = callbreakHistoryLength;
  }, [callbreakHistoryLength, gameId, online, state]);

  const activeId = useMemo(() => {
    if (gameId === "blackjack") { const s = state as BlackjackState; return s.status === "betting" ? undefined : s.status === "insurance" ? s.players[s.insuranceIndex ?? -1]?.id : s.players[s.activePlayerIndex]?.id; }
    if (gameId === "holdem") return (state as HoldemState).players[(state as HoldemState).actingIndex]?.id;
    if (gameId === "teen-patti") return (state as TeenPattiState).players[(state as TeenPattiState).turnIndex]?.id;
    return (state as CallbreakState | RummyState).players[(state as CallbreakState | RummyState).currentIndex]?.id;
  }, [gameId, state]);
  const complete = state.status === "complete";
  const callbreakRoundComplete = gameId === "callbreak" && (state.status === "round-complete" || state.status === "complete");
  const isMyTurn = !callbreakRoundComplete && activeId === playerId;
  const soundForAction = (action: string) => {
    if (["blind", "chaal", "sideshow", "set-bet", "confirm-bet", "all-in", "call", "bet", "raise"].includes(action)) return "chip" as const;
    if (["show", "choose-trump", "start-deal", "next-round"].includes(action)) return "shuffle" as const;
    if (["pack", "fold", "surrender", "sit-out", "pass-trump"].includes(action)) return "loss" as const;
    if (["play", "hit", "draw-stock", "draw-discard", "discard"].includes(action)) return "card" as const;
    return "tap" as const;
  };
  const emit = (action: string, payload?: Record<string, unknown>) => {
    try {
      setError("");
      onAction(action, payload);
      if (gameId === "holdem" || gameId.startsWith("rummy")) playUiSound(soundForAction(action));
      if (gameId === "callbreak" && action === "play") setSelectedCard(null);
      if (gameId.startsWith("rummy") && (action === "discard" || action === "declare")) {
        setSelectedCard(null); setSelectedGroup([]); setGroups([]); setRummyMode("discard");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "That action is not available."); playUiSound("error"); }
  };
  const showRoundResults = complete || callbreakRoundComplete;
  if (showRoundResults) {
    const canHostNextRound = online && room?.hostId === playerId && (gameId === "blackjack" || gameId === "teen-patti");
    const canHostNextCallbreakRound = online && room?.hostId === playerId && gameId === "callbreak" && state.status === "round-complete";
    return <div className="gameplay-wrap round-results-page">
      <div className="gameplay-topbar"><div><span className="eyebrow">{room ? `ROOM ${room.code}` : "CARDROOM · GAME COMPLETE"}</span><h1>{getGameTitle(gameId)}</h1></div><div className="gameplay-top-actions"><div className={`connection-pill ${online ? "online" : "offline"}`}><span/>{online ? "Connected" : "Local game"}</div><Button variant="ghost" onClick={onExit}><X size={18}/> Exit</Button></div></div>
      <main className="round-results-content">
        <div className="round-results-intro"><span className="eyebrow">{gameId === "callbreak" && !complete ? `ROUND ${(state as CallbreakState).round} COMPLETE` : "ROUND COMPLETE"}</span><h2>Time for the results.</h2><p>Review the hand, each player's result, and the updated score or chip balance.</p></div>
        {gameId === "blackjack" && <OnlineBlackjackResults state={state as BlackjackState} room={room}/>}
        {gameId === "holdem" && <OnlineHoldemResults state={state as HoldemState} room={room}/>}
        {gameId === "teen-patti" && <OnlineTeenPattiResults state={state as TeenPattiState} room={room}/>}
        {gameId === "callbreak" && <OnlineCallbreakResults state={state as CallbreakState} room={room}/>}
        {(gameId === "rummy-13" || gameId === "rummy-10") && <OnlineRummyResults state={state as RummyState} room={room}/>}
        {error && <div className="game-error" role="alert">{error}</div>}
        <div className="round-results-actions">
          {canHostNextRound && <Button onClick={() => emit("next-round")}><RotateCcw size={18}/> Start next round</Button>}
          {canHostNextCallbreakRound && <Button onClick={() => emit("next-round")}><RotateCcw size={18}/> Deal round {(state as CallbreakState).round + 1}</Button>}
          {online && !canHostNextRound && !canHostNextCallbreakRound && (gameId === "blackjack" || gameId === "teen-patti" || (gameId === "callbreak" && state.status === "round-complete")) && <p className="round-results-waiting">Waiting for the host to start the next round.</p>}
          <Button variant="outline" onClick={onExit}>{online ? room?.status === "finished" ? "View final standings" : "Back to room" : "Back to games"} <ArrowUpRight size={17}/></Button>
        </div>
      </main>
      <div className="game-footnote"><Shield size={14}/> Virtual chips only. No real-money wagering or cash value.</div>
    </div>;
  }
  const seats = gameId === "blackjack" ? (state as BlackjackState).players : (state as HoldemState | TeenPattiState | CallbreakState | RummyState).players;
  const me = seats.find(p => p.id === playerId);
  const myCards: CardData[] = gameId === "blackjack" ? (state as BlackjackState).players.find(p => p.id === playerId)?.hands.flatMap(h => h.cards) ?? []
    : gameId === "holdem" ? (state as HoldemState).players.find(p => p.id === playerId)?.hole ?? []
    : gameId === "teen-patti" ? (state as TeenPattiState).players.find(p => p.id === playerId)?.cards ?? []
    : gameId === "callbreak" ? (state as CallbreakState).players.find(p => p.id === playerId)?.hand ?? []
    : (state as RummyState).players.find(p => p.id === playerId)?.hand ?? [];
  const sortedCards = sortCards(myCards);
  const legalCallbreakIds = gameId === "callbreak" && state.status === "playing" ? getLegalCallbreakCardIds(state as CallbreakState, playerId) : [];
  const myTeenPattiPlayer = gameId === "teen-patti" ? me as TeenPattiState["players"][number] | undefined : undefined;
  const hideMyTeenPattiCards = gameId === "teen-patti" && !myTeenPattiPlayer?.seen && !(state as TeenPattiState).result;

  const onCardClick = (card: CardData) => {
    // A selected card should feel physical even before it becomes a game action.
    if ((gameId === "callbreak" && legalCallbreakIds.includes(card.id)) || gameId === "rummy-13" || gameId === "rummy-10" || gameId === "blackjack" || gameId === "holdem" || gameId === "teen-patti") playUiSound("card");
    if (gameId === "callbreak" && legalCallbreakIds.includes(card.id)) setSelectedCard(selectedCard === card.id ? null : card.id);
    else if (gameId === "rummy-13" || gameId === "rummy-10") {
      if (rummyMode === "discard") setSelectedCard(selectedCard === card.id ? null : card.id);
      else if (!groups.some(group => group.cardIds.includes(card.id))) setSelectedGroup(prev => prev.includes(card.id) ? prev.filter(id => id !== card.id) : [...prev, card.id]);
    }
    else if (gameId === "blackjack" || gameId === "holdem" || gameId === "teen-patti") setSelectedCard(selectedCard === card.id ? null : card.id);
  };

  return <div className="gameplay-wrap">
    <div className="gameplay-topbar"><div><span className="eyebrow">{online ? (room?.visibility === "public" ? "PUBLIC TABLE" : "PRIVATE TABLE") : "OFFLINE PRACTICE"}</span><h1>{getGameTitle(gameId)}</h1></div><div className="gameplay-top-actions"><div className={`connection-pill ${online ? "online" : "offline"}`}><span/> {online ? "Connected" : "Local game"}</div>{room && <div className="room-code-mini">ROOM <b>{room.code}</b></div>}{(gameId === "blackjack" || gameId === "teen-patti" || gameId === "callbreak") && <button type="button" className={`blackjack-sound-toggle ${preferences.sound ? "enabled" : ""}`} aria-pressed={preferences.sound} title="Toggle gentle game sounds. Adjust volume in Settings." onClick={() => { const enabled = !preferences.sound; setPreferences({ sound: enabled }); if (enabled) playUiSound("tap"); }}><span>{preferences.sound ? <Volume2 size={14}/> : <VolumeX size={14}/>}</span>{preferences.sound ? "Sound on" : "Sound off"}</button>}<Button variant="ghost" onClick={onExit}><X size={16}/> Exit</Button></div></div>
    <div className="table-felt">
      <div className="table-ornament one"/><div className="table-ornament two"/>
      <div className="table-brand">CARDROOM <span>✦</span></div>
      <div className="table-status">{callbreakRoundComplete ? complete ? "MATCH COMPLETE" : "ROUND SCORED" : complete ? "ROUND COMPLETE" : gameId === "blackjack" && state.status === "betting" ? "BETTING OPEN" : isMyTurn ? "YOUR TURN" : `${playerName(activeId ?? "", room)}'S TURN`}</div>
      <div className="opponent-seats">
        {seats.filter(p => p.id !== playerId).map((p, index) => {
          const isActive = activeId === p.id;
          const typedPlayer = p as unknown as { hole?: CardData[]; cards?: CardData[]; hand?: CardData[]; hands?: Array<{ cards: CardData[] }>; hiddenCards?: number; hiddenCardsCount?: number; holeCount?: number; cardsCount?: number; handCount?: number; chips?: number };
          const cardsCount = typedPlayer.hiddenCardsCount ?? typedPlayer.hiddenCards ?? typedPlayer.holeCount ?? typedPlayer.cardsCount ?? typedPlayer.handCount ?? typedPlayer.hole?.length ?? typedPlayer.cards?.length ?? typedPlayer.hand?.length ?? typedPlayer.hands?.reduce((n, h) => n + h.cards.length, 0) ?? 0;
          const chips = (p as { chips?: number }).chips;
          const blackjackPlayer = gameId === "blackjack" ? p as BlackjackState["players"][number] : null;
          const blackjackSummary = blackjackPlayer ? getBlackjackPlayerSummary(blackjackPlayer, state as BlackjackState) : null;
          const teenPattiSettlement = gameId === "teen-patti" ? (state as TeenPattiState).settlement?.find(row => row.playerId === p.id) : undefined;
          const callbreakPlayer = gameId === "callbreak" ? p as CallbreakState["players"][number] : null;
          const callbreakScore = callbreakPlayer ? formatCallbreakScore(callbreakPlayer.scoreTenths) : null;
          const callbreakSeatMeta = callbreakPlayer ? `Call ${callbreakPlayer.bid ?? "—"} · ${callbreakPlayer.tricksWon} tricks · ${callbreakScore} pts` : null;
          return <motion.div key={p.id} className={`opponent-seat opponent-${index} ${isActive ? "active" : ""} ${gameId === "blackjack" && complete && blackjackSummary ? `blackjack-seat-result result-${blackjackSummary.kind}` : ""} ${gameId === "teen-patti" && complete && teenPattiSettlement ? `teen-patti-seat-result result-${teenPattiSettlement.outcome}` : ""}`} layout>
            <div className="seat-avatar">{playerName(p.id, room).slice(0, 1).toUpperCase()}{p.id === room?.hostId && <span className="host-crown"><Trophy size={10}/></span>}{gameId === "callbreak" && (seats as Array<{ id: string }>).indexOf(p) === (state as CallbreakState).dealerIndex && <span className="host-crown callbreak-dealer-badge" title="Dealer">D</span>}</div>
            <div className="seat-info"><b>{playerName(p.id, room)}</b><span>{chips !== undefined ? "Available stack" : callbreakSeatMeta ?? `${cardsCount} cards`}</span>{gameId === "blackjack" && complete && blackjackSummary && <span className={`online-blackjack-outcome outcome-${blackjackSummary.kind}`}>{blackjackSummary.label} · {blackjackSummary.net > 0 ? "+" : blackjackSummary.net < 0 ? "−" : ""}{formatChips(Math.abs(blackjackSummary.net))}</span>}{gameId === "teen-patti" && complete && teenPattiSettlement && <span className={`tp-online-seat-outcome tp-online-${teenPattiSettlement.outcome}`}>{teenPattiSettlement.outcome === "winner" ? "Winner" : teenPattiSettlement.outcome === "shared" ? "Shared pot" : teenPattiSettlement.outcome === "folded" ? "Packed" : "Lost"} · {teenPattiSettlement.net > 0 ? "+" : teenPattiSettlement.net < 0 ? "−" : ""}{formatChips(Math.abs(teenPattiSettlement.net))}</span>}</div>
            {chips !== undefined && <ChipStack value={chips}/>}
            <div className="seat-card-backs">{(() => {
              const exposed = gameId === "blackjack"
                ? (p as BlackjackState["players"][number]).hands.flatMap(hand => hand.cards)
                : gameId === "holdem" && (state as HoldemState).status === "complete" && !(p as HoldemState["players"][number]).folded
                ? (p as HoldemState["players"][number]).hole
                : gameId === "teen-patti" && Boolean((state as TeenPattiState).result) && !(p as TeenPattiState["players"][number]).folded
                  ? (p as TeenPattiState["players"][number]).cards
                  : (gameId === "rummy-13" || gameId === "rummy-10") && (state as RummyState).status === "complete"
                    ? (p as RummyState["players"][number]).hand
                    : [];
              return exposed.length ? exposed.slice(0, 4).map((card, cardIndex) => <PlayingCard key={card.id} card={card} index={cardIndex} dealIn={online && (gameId === "blackjack" || gameId === "teen-patti" || gameId === "callbreak")} small/>) : Array.from({ length: Math.min(cardsCount, 4) }, (_, i) => <PlayingCard key={i} hidden small dealIn={online && (gameId === "blackjack" || gameId === "teen-patti" || gameId === "callbreak")}/>);
            })()}</div>
            {isActive && <div className="active-pulse"/>}
          </motion.div>;
        })}
      </div>
      <div className="table-center">
        {gameId === "holdem" && <><PotDisplay label="MAIN POT" value={(state as HoldemState).players.reduce((n, p) => n + p.totalContribution, 0)}/><div className="community-cards">{(state as HoldemState).community.map((c, i) => <PlayingCard key={c.id} card={c} index={i}/>)}</div></>}
        {gameId === "blackjack" && <><PotDisplay label="TABLE WAGERS" value={(state as BlackjackState).players.reduce((total, player) => total + ((state as BlackjackState).status === "betting" ? (player.bet ?? 0) : (player.insuranceBet ?? 0) + player.hands.reduce((handTotal, hand) => handTotal + hand.bet, 0)), 0)}/><div className="dealer-status-label">DEALER · {state.status === "betting" ? "WAITING FOR BETS" : state.status === "complete" ? "REVEALED" : "SHOWING"}</div><div className="community-cards">{(state as BlackjackState).dealer.map((c, i) => <PlayingCard key={c.id} card={c} index={i} dealIn={online}/>)}{(state as BlackjackState & { dealerHidden?: number }).dealerHidden ? <PlayingCard hidden dealIn={online}/> : null}</div>{complete && <span className={`online-dealer-result ${blackjackValue((state as BlackjackState).dealer).total > 21 ? "dealer-bust" : "dealer-stands"}`}>{blackjackValue((state as BlackjackState).dealer).total > 21 ? "Dealer bust" : blackjackValue((state as BlackjackState).dealer).total === 21 && (state as BlackjackState).dealer.length === 2 ? "Dealer blackjack" : `Dealer stands on ${blackjackValue((state as BlackjackState).dealer).total}`}</span>}</>}
        {gameId === "teen-patti" && <><PotDisplay label="THE POT" value={(state as TeenPattiState).pot}/><div className="center-emblem">♥</div><p className="table-center-note">Three cards. One winning hand.</p></>}
        {gameId === "callbreak" && <><div className="pot-label">ROUND {(state as CallbreakState).round} <b>{state.status === "trump-selection" ? "TRUMP SELECTION · 5 CARDS" : state.status === "bidding" ? "BIDDING" : state.status === "playing" ? `TRICK ${(state as CallbreakState).trickNumber + 1} / 13` : state.status === "complete" ? "MATCH COMPLETE" : "ROUND SCORED"}</b></div><div className="trick-cards">{(state as CallbreakState).trick.map((p, i) => <motion.div key={p.card.id} className="trick-card" initial={{ opacity: 0, y: -12, scale: .88, rotate: i % 2 ? 3 : -3 }} animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }} transition={{ duration: .24, ease: "easeOut" }}><PlayingCard card={p.card}/><span>{playerName(p.playerId, room)}</span></motion.div>)}</div><p className="table-center-note">{(state as CallbreakState).status === "trump-selection" ? `Trump decision order: ${(state as CallbreakState).trumpOrder?.map(id => playerName(id, room)).join(" → ") ?? "Lowest score first"}` : `Trump: ${(state as CallbreakState).trumpSuit ?? "spades"} · ${state.status === "bidding" ? "Calls follow the trump choice" : ((state as CallbreakState).players[(state as CallbreakState).leaderIndex]?.id === playerId) ? "You lead this trick" : `Lead: ${playerName((state as CallbreakState).players[(state as CallbreakState).leaderIndex]?.id ?? "", room)}`}`}</p></>}
        {(gameId === "rummy-13" || gameId === "rummy-10") && <><div className="pot-label">WILD RANK <b>{({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[(state as RummyState).wildRank] ?? (state as RummyState).wildRank}</b></div><div className="rummy-piles"><div className="pile-card">{(state as RummyState).wildIndicator ? <PlayingCard card={(state as RummyState).wildIndicator} small/> : <span className="wild-indicator-fallback">WILD</span>}<span>WILD CARD</span></div><div className="pile-card"><PlayingCard hidden/><span>DRAW PILE</span></div><div className="pile-card"><PlayingCard card={(state as RummyState).discardPile[(state as RummyState).discardPile.length - 1]}/><span>DISCARD</span></div></div><p className="table-center-note">{gameId === "rummy-10" ? "3 sets · sizes 3–3–4 · no runs" : "2 sequences minimum · 1 pure sequence"}</p></>}
        {complete && <div className="winner-banner"><Trophy size={20}/><span>{winnerText(gameId, state, room)}</span></div>}
      </div>
      <div className="my-seat"><div className={`my-player-info ${isMyTurn ? "active" : ""} ${gameId === "blackjack" && complete && me ? `blackjack-seat-result result-${getBlackjackPlayerSummary(me as BlackjackState["players"][number], state as BlackjackState).kind}` : ""}`}><div className="seat-avatar self">{playerName(playerId, room).slice(0, 1).toUpperCase()}{gameId === "callbreak" && seats.findIndex(player => player.id === playerId) === (state as CallbreakState).dealerIndex && <span className="host-crown callbreak-dealer-badge" title="Dealer">D</span>}</div><div><b>{playerName(playerId, room)}</b><span>{me && "chips" in me ? "Available stack" : me && gameId === "callbreak" ? `Call ${(me as CallbreakState["players"][number]).bid ?? "—"} · ${(me as CallbreakState["players"][number]).tricksWon} tricks · ${formatCallbreakScore((me as CallbreakState["players"][number]).scoreTenths)} pts` : `${myCards.length} cards`}</span>{gameId === "blackjack" && complete && me && <span className={`online-blackjack-outcome outcome-${getBlackjackPlayerSummary(me as BlackjackState["players"][number], state as BlackjackState).kind}`}>{getBlackjackPlayerSummary(me as BlackjackState["players"][number], state as BlackjackState).label} · {getBlackjackPlayerSummary(me as BlackjackState["players"][number], state as BlackjackState).net > 0 ? "+" : getBlackjackPlayerSummary(me as BlackjackState["players"][number], state as BlackjackState).net < 0 ? "−" : ""}{formatChips(Math.abs(getBlackjackPlayerSummary(me as BlackjackState["players"][number], state as BlackjackState).net))}</span>}</div>{me && "chips" in me && <ChipStack value={me.chips} self/>}<span className="you-tag">YOU</span></div>
        <div className={`my-hand ${gameId.startsWith("rummy") ? "rummy-hand" : ""}`}>
          {hideMyTeenPattiCards
            ? Array.from({ length: Math.max(3, sortedCards.length) }, (_, index) => <PlayingCard key={`teen-patti-hidden-${index}`} hidden small dealIn={online}/>)
            : sortedCards.map((c, index) => <PlayingCard key={c.id} card={c} index={index} dealIn={online && (gameId === "blackjack" || gameId === "teen-patti" || gameId === "callbreak")} selected={gameId.startsWith("rummy") ? (rummyMode === "groups" ? selectedGroup.includes(c.id) : selectedCard === c.id) : selectedCard === c.id} onClick={() => onCardClick(c)} disabled={!isMyTurn || (gameId === "callbreak" && (!((state as CallbreakState).status === "playing") || !legalCallbreakIds.includes(c.id)))}/>)}
          {sortedCards.length === 0 && <span className="no-cards">Cards will appear here</span>}
        </div>
        {hideMyTeenPattiCards && <p className="tp-blind-note">Your cards stay face down while you play blind. Choose “See cards & chaal” to reveal your hand.</p>}
      </div>
      <AnimatePresence>
        {showBlackjackDeal && online && gameId === "blackjack" && <OnlineBlackjackDeal key={`deal-${(state as BlackjackState).history.length}`} playerCount={seats.length} mySeatIndex={Math.max(0, seats.findIndex(player => player.id === playerId))}/>}
        {showTeenPattiDeal && online && gameId === "teen-patti" && <OnlineTeenPattiDeal key="teen-patti-deal" playerCount={seats.length} mySeatIndex={Math.max(0, seats.findIndex(player => player.id === playerId))}/>}
        {showCallbreakDeal && online && gameId === "callbreak" && <OnlineCallbreakDeal key={`callbreak-deal-${(state as CallbreakState).round}-${callbreakDealPasses}`} playerCount={seats.length} dealerIndex={(state as CallbreakState).dealerIndex ?? 0} mySeatIndex={Math.max(0, seats.findIndex(player => player.id === playerId))} passCount={callbreakDealPasses}/> }
      </AnimatePresence>
    </div>

    {complete && gameId === "blackjack" && <OnlineBlackjackResults state={state as BlackjackState} room={room}/>}
    {complete && gameId === "teen-patti" && <OnlineTeenPattiResults state={state as TeenPattiState} room={room}/>}
    {callbreakRoundComplete && <OnlineCallbreakResults state={state as CallbreakState} room={room}/>}
    {error && <div className="game-error" role="alert">{error}</div>}
    <div className="game-action-panel">
      <div className="action-context"><span className={`turn-dot ${isMyTurn ? "active" : ""}`}/><div><b>{callbreakRoundComplete ? complete ? "Match complete" : "Round scored" : complete ? "Game complete" : gameId === "blackjack" && state.status === "betting" ? "Place your wager" : isMyTurn ? "Your move" : "Waiting for opponent"}</b><small>{contextText(gameId, state, activeId, playerId)}</small></div></div>
      <div className="action-buttons">
        {gameId === "blackjack" && <BlackjackControls state={state as BlackjackState} playerId={playerId} isMyTurn={isMyTurn} hostId={room?.hostId} room={room} onAction={emit}/>}
        {gameId === "holdem" && <HoldemControls state={state as HoldemState} playerId={playerId} isMyTurn={isMyTurn} raise={raise} setRaise={setRaise} onAction={emit}/>}
        {gameId === "teen-patti" && <TeenPattiControls state={state as TeenPattiState} playerId={playerId} isMyTurn={isMyTurn} dealing={showTeenPattiDeal} onAction={emit}/>}
        {gameId === "callbreak" && <CallbreakControls state={state as CallbreakState} playerId={playerId} isMyTurn={isMyTurn} dealing={showCallbreakDeal} canStart={!online || room?.hostId === playerId} selectedCard={selectedCard} setBid={setBid} bid={bid} onAction={emit}/> }
        {(gameId === "rummy-13" || gameId === "rummy-10") && <RummyControls state={state as RummyState} playerId={playerId} isMyTurn={isMyTurn} mode={rummyMode} setMode={setRummyMode} selectedGroup={selectedGroup} setSelectedGroup={setSelectedGroup} selectedCard={selectedCard} setSelectedCard={setSelectedCard} groups={groups} setGroups={setGroups} onAction={emit}/>}
        {complete && online && room?.hostId === playerId && (gameId === "blackjack" || gameId === "teen-patti") && <Button onClick={() => emit("next-round")}><RotateCcw size={15}/> Play next round</Button>}
        {complete && <Button variant="outline" onClick={onExit}>{online ? "View results" : "Back to games"} <ArrowUpRight size={16}/></Button>}
      </div>
    </div>
    <div className="game-footnote"><Shield size={13}/> Virtual chips only. No real-money wagering or cash value.</div>
  </div>;
}

type OnlineBlackjackResultKind = "win" | "blackjack" | "push" | "loss" | "bust" | "surrender" | "mixed" | "sitting-out";
function getBlackjackPlayerSummary(player: BlackjackState["players"][number], state: BlackjackState): { kind: OnlineBlackjackResultKind; label: string; net: number } {
  if (!player.hands.length) return { kind: "sitting-out", label: "Sat out", net: 0 };
  const outcomes = player.hands.map(hand => hand.outcome).filter((outcome): outcome is BlackjackOutcome => Boolean(outcome));
  const unique = [...new Set(outcomes)];
  const kind: OnlineBlackjackResultKind = unique.length > 1 ? "mixed"
    : unique[0] === "blackjack" ? "blackjack"
    : unique[0] === "win" ? "win"
    : unique[0] === "push" ? "push"
    : unique[0] === "bust" ? "bust"
    : unique[0] === "surrender" ? "surrender"
    : "loss";
  const labels: Record<OnlineBlackjackResultKind, string> = { win: "Won", blackjack: "Blackjack!", push: "Push", loss: "Lost", bust: "Bust", surrender: "Surrender", mixed: "Mixed result", "sitting-out": "Sat out" };
  return { kind, label: labels[kind], net: state.results[player.id] ?? player.hands.reduce((sum, hand) => sum + (hand.net ?? ((hand.payout ?? 0) - hand.bet)), 0) };
}

function OnlineBlackjackResults({ state, room }: { state: BlackjackState; room?: RoomSummary }) {
  return <motion.section className="online-blackjack-results" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.38 }} aria-live="polite">
    <div className="online-blackjack-results-heading"><span className="eyebrow">ROUND SETTLED</span><h2>Every seat, accounted for.</h2><p>Individual hand outcomes and net chip changes. Dealer: {blackjackValue(state.dealer).total > 21 ? "bust" : blackjackValue(state.dealer).total === 21 && state.dealer.length === 2 ? "Blackjack" : `stood on ${blackjackValue(state.dealer).total}`}.</p></div>
    <div className="online-blackjack-results-grid">{state.players.map((player, index) => {
      const result = getBlackjackPlayerSummary(player, state);
      return <motion.article key={player.id} className={`online-blackjack-result-card result-${result.kind}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.055 }}>
        <div className="online-blackjack-result-top"><span className="seat-avatar">{playerName(player.id, room).slice(0, 1).toUpperCase()}</span><div><b>{playerName(player.id, room)}</b><small>{result.label}</small></div><strong className={result.net > 0 ? "positive" : result.net < 0 ? "negative" : "neutral"}>{result.net > 0 ? "+" : result.net < 0 ? "−" : ""}{formatChips(Math.abs(result.net))}</strong></div>
        {player.hands.length > 0 && <div className="online-blackjack-result-hands">{player.hands.map((hand, handIndex) => <span key={`${player.id}-${handIndex}`} className={`hand-outcome outcome-${hand.outcome ?? "loss"}`}><b>Hand {handIndex + 1}</b>{hand.outcome ?? hand.status}<small>{hand.net === undefined ? "" : `${hand.net > 0 ? "+" : hand.net < 0 ? "−" : ""}${formatChips(Math.abs(hand.net))}`}</small></span>)}</div>}
        {(player.insuranceBet ?? 0) > 0 && <div className="online-blackjack-insurance-result">Insurance · {formatChips(player.insuranceBet ?? 0)} wager · {state.dealer.length === 2 && blackjackValue(state.dealer).total === 21 ? "paid" : "lost"}</div>}
      </motion.article>;
    })}</div>
  </motion.section>;
}

function OnlineBlackjackDeal({ playerCount, mySeatIndex }: { playerCount: number; mySeatIndex: number }) {
  const reducedMotion = useSessionStore(s => s.preferences.reducedMotion);
  const opponentCount = Math.max(1, playerCount - 1);
  const seatTarget = (index: number) => {
    if (index === mySeatIndex) return { left: "50%", top: "82%" };
    const opponentIndex = index < mySeatIndex ? index : index - 1;
    const left = opponentCount === 1 ? 24 : 18 + (opponentIndex / (opponentCount - 1)) * 64;
    return { left: `${left}%`, top: "18%" };
  };
  const flights: Array<{ left: string; top: string; key: string; tilt: number }> = [];
  for (let pass = 0; pass < 2; pass += 1) {
    for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
      const target = seatTarget(playerIndex);
      flights.push({ ...target, key: `p${playerIndex}-card${pass}`, tilt: (playerIndex % 2 ? 1 : -1) * (3 + pass * 2) });
    }
    flights.push({ left: "50%", top: "30%", key: `dealer-${pass}`, tilt: pass ? 5 : -5 });
  }

  return <motion.div className="online-blackjack-deal-overlay" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.22 }}>
    <motion.div className="online-blackjack-deal-label" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reducedMotion ? 0 : 0.12 }}><span className="deal-label-dot"/> SHUFFLING · DEALING</motion.div>
    {!reducedMotion && <motion.div className="online-blackjack-deck-stack" initial={{ opacity: 0, scale: .72, rotate: -12 }} animate={{ opacity: [0, 1, 1, 0], scale: [0.72, 1, 1, .96], rotate: [-12, 0, 2, 5] }} transition={{ duration: 2.1, ease: "easeInOut" }}><span>✦</span></motion.div>}
    {!reducedMotion && flights.map((flight, index) => <motion.div key={flight.key} className="online-blackjack-flight-card" initial={{ left: "50%", top: "51%", opacity: 0, scale: .78, rotate: 0 }} animate={{ left: flight.left, top: flight.top, opacity: [0, 1, 1, 0], scale: [.78, 1, .98], rotate: [0, flight.tilt, flight.tilt + 2] }} transition={{ delay: .22 + index * .085, duration: .72, ease: [0.22, 1, 0.36, 1] }}><span>✦</span></motion.div>)}
  </motion.div>;
}

function OnlineCallbreakDeal({ playerCount, dealerIndex, mySeatIndex, passCount }: { playerCount: number; dealerIndex: number; mySeatIndex: number; passCount: 5 | 8 }) {
  const reducedMotion = useSessionStore(s => s.preferences.reducedMotion);
  const seatTarget = (seatIndex: number) => {
    if (seatIndex === mySeatIndex) return { left: "50%", top: "82%" };
    const otherSeats = Math.max(1, playerCount - 1);
    const opponentIndex = seatIndex < mySeatIndex ? seatIndex : seatIndex - 1;
    const left = otherSeats === 1 ? 50 : 17 + opponentIndex / (otherSeats - 1) * 66;
    return { left: `${left}%`, top: "18%" };
  };
  const startPass = passCount === 5 ? 0 : 5;
  const flights: Array<{ left: string; top: string; key: string; tilt: number; pass: number }> = [];
  // First animation: five cards per seat. Second animation: the remaining eight.
  for (let pass = startPass; pass < startPass + passCount; pass += 1) {
    for (let offset = 1; offset <= 4; offset += 1) {
      const seat = (dealerIndex + offset) % 4;
      const target = seatTarget(seat);
      flights.push({ ...target, key: `cb-seat-${seat}-pass-${pass}`, tilt: (seat % 2 ? 1 : -1) * (2.5 + (pass % 3)), pass });
    }
  }
  const label = passCount === 5 ? "DEALING FIRST FIVE CARDS" : "TRUMP LOCKED · DEALING REMAINING EIGHT";
  return <motion.div className="online-blackjack-deal-overlay callbreak-online-deal" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : .22 }}>
    <motion.div className="online-blackjack-deal-label" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reducedMotion ? 0 : .12 }}><span className="deal-label-dot"/> {label}</motion.div>
    {!reducedMotion && <motion.div className="online-blackjack-deck-stack" initial={{ opacity: 0, scale: .72, rotate: -12 }} animate={{ opacity: [0, 1, 1, 0], scale: [.72, 1, 1, .95], rotate: [-12, 0, 2, 7] }} transition={{ duration: passCount === 5 ? 1.7 : 2.5, ease: "easeInOut" }}><span>♠</span></motion.div>}
    {!reducedMotion && flights.map((flight, index) => <motion.div key={flight.key} className="online-blackjack-flight-card" initial={{ left: "50%", top: "51%", opacity: 0, scale: .78, rotate: 0 }} animate={{ left: flight.left, top: flight.top, opacity: [0, 1, 1, 0], scale: [.78, 1, .98], rotate: [0, flight.tilt, flight.tilt + 2] }} transition={{ delay: .16 + index * .045, duration: .47, ease: [.22, 1, .36, 1] }}><span>♠</span></motion.div>)}
  </motion.div>;
}

function OnlineCallbreakResults({ state, room }: { state: CallbreakState; room?: RoomSummary }) {
  const rows = state.players.map(player => ({
    ...player,
    roundScore: state.roundScores?.[player.id] ?? 0,
    minimumCall: getCallbreakMinimumBid(state, player.id),
    made: player.bid !== null && player.tricksWon >= player.bid,
  })).sort((a, b) => b.scoreTenths - a.scoreTenths);
  const final = state.status === "complete";
  const nextDealerIndex = ((state.dealerIndex ?? (state.round - 1) % state.players.length) + 1) % state.players.length;
  const nextDealer = state.players[nextDealerIndex];
  const winners = (state.winnerIds ?? []).map(id => playerName(id, room));
  return <motion.section className="callbreak-online-scoreboard" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} aria-live="polite">
    <div className="callbreak-online-scoreboard-heading"><span className="eyebrow">{final ? "MATCH COMPLETE" : `ROUND ${state.round} SCORECARD`}</span><h2>{final ? `${winners.join(" & ")} ${winners.length === 1 ? "wins" : "share the win"}!` : "Round complete. Here’s the table."}</h2><p>{final ? "The first player to reach 31 points has been determined from the final round." : "Scores are calculated from each player's call and the tricks they won. The match continues until someone reaches 31 points."}</p></div>
    <div className="callbreak-auction-summary"><span>Final trump <b>{state.trumpSuit ?? "spades"}</b></span>{(state.trumpSelections ?? []).length ? (state.trumpSelections ?? []).map((choice, index) => <span key={`${choice.playerId}-${index}`}>{playerName(choice.playerId, room)} chose {choice.suit} · minimum call {choice.minimumTricks}</span>) : <span>All players passed · spades defaulted</span>}</div>
    <div className="callbreak-online-score-scroll"><table className="callbreak-online-score-table"><thead><tr><th>Player</th><th>Call</th><th>Tricks</th><th>Contract</th><th>Round score</th><th>Total points</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id} className={(state.winnerIds ?? []).includes(row.id) ? "winner-row" : ""}><td><span className="callbreak-online-rank">{index === 0 ? <Trophy size={14}/> : index + 1}</span><b>{playerName(row.id, room)}</b>{(state.winnerIds ?? []).includes(row.id) && <small>WINNER</small>}</td><td>{row.bid ?? "—"}{row.minimumCall > 1 && <small>Trump minimum {row.minimumCall}</small>}</td><td>{row.tricksWon}</td><td><span className={`callbreak-contract ${row.made ? "made" : "missed"}`}>{row.made ? "Made" : "Missed"}</span><small>{row.made ? `${row.tricksWon - (row.bid ?? 0)} overtrick${row.tricksWon - (row.bid ?? 0) === 1 ? "" : "s"}` : `Short by ${(row.bid ?? 0) - row.tricksWon}`}</small></td><td className={row.roundScore >= 0 ? "positive" : "negative"}>{formatCallbreakScore(row.roundScore)}</td><td><b>{formatCallbreakScore(row.scoreTenths)}</b></td></tr>)}</tbody></table></div>
    {!final && <div className="callbreak-online-next-note"><span><b>Next dealer</b>{nextDealer ? playerName(nextDealer.id, room) : "—"}</span><span>Next round is dealt by the host.</span></div>}
    {final && <div className="callbreak-online-champion"><Trophy size={20}/><strong>{winners.join(" & ")}</strong><span>31-point target reached</span></div>}
  </motion.section>;
}

function OnlineHoldemResults({ state, room }: { state: HoldemState; room?: RoomSummary }) {
  const totalPot = state.players.reduce((sum, player) => sum + player.totalContribution, 0);
  const payoutByPlayer = new Map<string, number>();
  for (const winner of state.winners) payoutByPlayer.set(winner.playerId, (payoutByPlayer.get(winner.playerId) ?? 0) + winner.amount);
  const winners = [...new Set(state.winners.map(winner => winner.playerId))];
  return <section className="unified-game-results holdem-round-results" aria-live="polite">
    <div className="unified-results-highlight"><span className="eyebrow">SHOWDOWN · {chipLabel(totalPot)}</span><h2>{winners.length ? winners.map(id => playerName(id, room)).join(" & ") : "Hand settled"} {winners.length === 1 ? "takes the pot." : winners.length > 1 ? "split the pot." : ""}</h2><p>Community cards and each player's final contribution are shown below.</p><div className="community-cards results-community-cards">{state.community.map((card, index) => <PlayingCard key={card.id} card={card} index={index}/>)}</div></div>
    <div className="unified-results-player-grid">{state.players.map(player => {
      const payout = payoutByPlayer.get(player.id) ?? 0;
      const net = payout - player.totalContribution;
      const winnerHand = state.winners.find(winner => winner.playerId === player.id)?.hand;
      const isWinner = winners.includes(player.id);
      return <article key={player.id} className={`unified-result-player ${isWinner ? "winner" : player.folded ? "folded" : ""}`}>
        <div className="unified-result-player-heading"><div><b>{playerName(player.id, room)}</b><small>{isWinner ? "Pot winner" : player.folded ? "Folded" : "Showdown"}</small></div><strong className={net > 0 ? "positive" : net < 0 ? "negative" : "neutral"}>{net > 0 ? "+" : net < 0 ? "−" : ""}{formatChips(Math.abs(net))}</strong></div>
        {!player.folded && <div className="unified-result-cards">{player.hole.map((card, index) => <PlayingCard key={card.id} card={card} index={index} small/>)}</div>}
        <div className="unified-result-stats"><span>Contribution <b>{formatChips(player.totalContribution)}</b></span><span>Payout <b>{formatChips(payout)}</b></span><span>Stack now <b>{formatChips(player.chips)}</b></span></div>
        {winnerHand && <small className="unified-result-hand-name">{winnerHand.category.replaceAll("-", " ")}</small>}
      </article>;
    })}</div>
  </section>;
}

function OnlineRummyResults({ state, room }: { state: RummyState; room?: RoomSummary }) {
  const winner = state.players.find(player => player.id === state.winnerId);
  const title = state.gameId === "rummy-10" ? "10-card 3–3–4 Rummy" : "13-card Indian Rummy";
  return <section className="unified-game-results rummy-round-results" aria-live="polite">
    <div className="unified-results-highlight"><span className="eyebrow">{title.toUpperCase()} · DECLARATION COMPLETE</span><h2>{winner ? `${playerName(winner.id, room)} wins the round.` : "Round complete."}</h2><p>{winner ? "The valid declaration was accepted. Lower penalty points are better for the remaining players." : "Review the points and remaining cards for every player."}</p></div>
    <div className="unified-results-player-grid">{state.players.slice().sort((a, b) => (a.id === state.winnerId ? -1 : b.id === state.winnerId ? 1 : a.points - b.points)).map(player => {
      const isWinner = player.id === state.winnerId;
      return <article key={player.id} className={`unified-result-player ${isWinner ? "winner" : ""}`}>
        <div className="unified-result-player-heading"><div><b>{playerName(player.id, room)}</b><small>{isWinner ? "Winner · valid declaration" : player.dropped ? "Dropped" : "Penalty points"}</small></div><strong className={isWinner ? "positive" : "neutral"}>{player.points} pts</strong></div>
        <div className="unified-result-cards">{player.hand.map((card, index) => <PlayingCard key={card.id} card={card} index={index} small/>)}</div>
      </article>;
    })}</div>
  </section>;
}

function OnlineTeenPattiDeal({ playerCount, mySeatIndex }: { playerCount: number; mySeatIndex: number }) {
  const reducedMotion = useSessionStore(s => s.preferences.reducedMotion);
  const opponentCount = Math.max(1, playerCount - 1);
  const seatTarget = (index: number) => {
    if (index === mySeatIndex) return { left: "50%", top: "81%" };
    const opponentIndex = index < mySeatIndex ? index : index - 1;
    const left = opponentCount === 1 ? 24 : 15 + (opponentIndex / (opponentCount - 1)) * 70;
    return { left: `${left}%`, top: "19%" };
  };
  const flights: Array<{ left: string; top: string; key: string; tilt: number }> = [];
  for (let pass = 0; pass < 3; pass += 1) {
    for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
      const target = seatTarget(playerIndex);
      flights.push({ ...target, key: `teen-p${playerIndex}-card${pass}`, tilt: (playerIndex % 2 ? 1 : -1) * (3 + pass * 1.5) });
    }
  }
  return <motion.div className="online-blackjack-deal-overlay tp-online-deal-overlay" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : .22 }}>
    <motion.div className="online-blackjack-deal-label" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reducedMotion ? 0 : .12 }}><span className="deal-label-dot"/> SHUFFLING · THREE-CARD DEAL</motion.div>
    {!reducedMotion && <motion.div className="online-blackjack-deck-stack" initial={{ opacity: 0, scale: .72, rotate: -12 }} animate={{ opacity: [0, 1, 1, 0], scale: [.72, 1, 1, .96], rotate: [-12, 0, 2, 5] }} transition={{ duration: 1.8, ease: "easeInOut" }}><span>✦</span></motion.div>}
    {!reducedMotion && flights.map((flight, index) => <motion.div key={flight.key} className="online-blackjack-flight-card" initial={{ left: "50%", top: "51%", opacity: 0, scale: .78, rotate: 0 }} animate={{ left: flight.left, top: flight.top, opacity: [0, 1, 1, 0], scale: [.78, 1, .98], rotate: [0, flight.tilt, flight.tilt + 2] }} transition={{ delay: .2 + index * .105, duration: .72, ease: [.22, 1, .36, 1] }}><span>✦</span></motion.div>)}
  </motion.div>;
}

function OnlineTeenPattiResults({ state, room }: { state: TeenPattiState; room?: RoomSummary }) {
  const winners = state.winnerIds ?? (state.winnerId ? [state.winnerId] : []);
  const winnerNames = winners.map(id => playerName(id, room));
  return <motion.section className="tp-online-results" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} aria-live="polite">
    <div className="tp-online-results-heading"><span className="eyebrow">ROUND SETTLED · {chipLabel(state.pot)}</span><h2>{winners.length > 1 ? `${winnerNames.join(" & ")} share the pot.` : `${winnerNames[0] ?? "The winner"} takes the pot.`}</h2><p>{state.result ? "Showdown completed. Active hands are ranked below." : "The winner was the last player remaining after everyone else packed."}</p></div>
    <div className="tp-online-results-grid">{state.players.map((player, index) => {
      const row = state.settlement?.find(item => item.playerId === player.id);
      const rank = row?.rank;
      const isWinner = row?.outcome === "winner" || row?.outcome === "shared" || winners.includes(player.id);
      const label = row?.outcome === "shared" ? "Shared winner" : row?.outcome === "winner" ? "Winner" : row?.outcome === "folded" ? "Packed" : "Lost";
      const otherWinnerNames = winners.filter(id => id !== player.id).map(id => playerName(id, room));
      const reason = row?.reason ?? (row?.outcome === "folded" ? "Packed before the hand ended and forfeited the contribution."
        : isWinner ? (winners.length > 1 ? `Shared the pot with ${otherWinnerNames.join(", ") || "another tied player"} on ${rank ? teenPattiRankLabel(rank) : "a tied top hand"}.` : `Won the pot${rank ? ` with ${teenPattiRankLabel(rank)}` : " as the last player remaining"}.`)
        : rank ? `Lost to ${winnerNames.join(" and ")} with ${teenPattiRankLabel(rank)}.` : `Lost the pot to ${winnerNames.join(" and ")}.`);
      const playerCards = player.cards ?? [];
      return <motion.article key={player.id} className={`tp-online-result-card ${isWinner ? "winner" : row?.outcome === "folded" ? "folded" : "lost"}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .06 }}>
        <div className="tp-online-result-head"><div><b>{playerName(player.id, room)}</b><small>{label}</small></div><strong className={(row?.net ?? 0) > 0 ? "positive" : (row?.net ?? 0) < 0 ? "negative" : "neutral"}>{row ? `${row.net > 0 ? "+" : row.net < 0 ? "−" : ""}${formatChips(Math.abs(row.net))}` : "—"}</strong></div>
        {playerCards.length > 0 ? <div className="tp-online-result-cards">{playerCards.map((card, cardIndex) => <PlayingCard key={card.id} card={card} index={cardIndex} dealIn/>)}</div> : <div className="tp-online-folded-hand">Cards remain concealed after packing.</div>}
        <b className="tp-online-rank">{rank ? teenPattiRankLabel(rank) : row?.outcome === "folded" ? "Folded before showdown" : "Showdown not revealed"}</b>
        <p>{reason}</p>
        <div><span>Contribution <b>{formatChips(player.contribution)}</b></span><span>Payout <b>{formatChips(row?.payout ?? 0)}</b></span><span>Stack <b>{formatChips(player.chips)}</b></span></div>
      </motion.article>;
    })}</div>
    <div className="tp-online-ledger"><div className="tp-ledger-heading"><div><span className="eyebrow">ROUND ACCOUNTING</span><h3>Winnings & losses</h3></div><span>Virtual chips</span></div><div className="tp-ledger-scroll"><table className="tp-settlement-table"><thead><tr><th>Player</th><th>Result / hand</th><th>Reason</th><th>Contribution</th><th>Payout</th><th>Net</th><th>Final stack</th></tr></thead><tbody>{state.players.map(player => { const row = state.settlement?.find(item => item.playerId === player.id); return <tr key={player.id}><td><b>{playerName(player.id, room)}</b></td><td>{row?.rank ? teenPattiRankLabel(row.rank) : row?.outcome === "folded" ? "Packed" : "—"}</td><td>{row?.reason ?? "—"}</td><td>{formatChips(player.contribution)}</td><td>{formatChips(row?.payout ?? 0)}</td><td className={(row?.net ?? 0) > 0 ? "positive" : (row?.net ?? 0) < 0 ? "negative" : "neutral"}>{row ? `${row.net > 0 ? "+" : row.net < 0 ? "−" : ""}${formatChips(Math.abs(row.net))}` : "—"}</td><td><b>{formatChips(player.chips)}</b></td></tr>; })}</tbody><tfoot><tr><td colSpan={3}>Table totals</td><td>{formatChips(state.players.reduce((sum, player) => sum + player.contribution, 0))}</td><td>{formatChips(state.settlement?.reduce((sum, row) => sum + row.payout, 0) ?? 0)}</td><td>{formatChips(state.settlement?.reduce((sum, row) => sum + row.net, 0) ?? 0)}</td><td>—</td></tr></tfoot></table></div></div>
  </motion.section>;
}

function winnerText(gameId: GameId, state: AnyGameState, room?: RoomSummary): string {
  if (gameId === "teen-patti") { const winners = (state as TeenPattiState).winnerIds ?? [(state as TeenPattiState).winnerId ?? ""]; return winners.length > 1 ? `${winners.map(id => playerName(id, room)).join(" and ")} split the pot` : `${playerName(winners[0] ?? "", room)} wins the pot`; }
  if (gameId === "rummy-13" || gameId === "rummy-10") return `${playerName((state as RummyState).winnerId ?? "", room)} declared a valid hand`;
  if (gameId === "callbreak") return ((state as CallbreakState).winnerIds ?? []).map(id => playerName(id, room)).join(", ") + " wins";
  if (gameId === "holdem") return ((state as HoldemState).winners.map(w => playerName(w.playerId, room))).filter((v, i, a) => a.indexOf(v) === i).join(", ") + " takes the pot";
  return "Dealer has settled the round";
}
function contextText(gameId: GameId, state: AnyGameState, active?: string, player?: string): string {
  if (state.status === "complete") return "The result is final.";
  if (gameId === "callbreak" && state.status === "round-complete") return "Round scored. The host can start the next deal.";
  if (gameId === "blackjack" && state.status === "betting") return "Choose your wager. The host can start the deal when every player has confirmed or sat out.";
  if (gameId === "blackjack" && state.status === "insurance") return active === player ? "The dealer is showing an ace. Decide whether to take insurance." : "Waiting for the other players to decide on insurance.";
  if (active !== player) return "The table will update when the action is complete.";
  if (gameId === "blackjack") return "Choose hit, stand, double down, split, or surrender.";
  if (gameId === "holdem") return "Choose how to respond to the current bet.";
  if (gameId === "teen-patti") return "Choose a blind wager or seen chaal, pack, and request a sideshow when eligible. Show is available with two players left.";
  if (gameId === "callbreak") return (state as CallbreakState).status === "bidding" ? "Set your trick bid for this round." : "Follow suit, beat when possible, and trump or overtrump when void.";
  return (state as RummyState).status === "draw" ? "Draw from the stock or take the top discard." : "Discard one card to end your turn.";
}

function BlackjackControls({ state, playerId, isMyTurn, hostId, room, onAction }: { state: BlackjackState; playerId: string; isMyTurn: boolean; hostId?: string; room?: RoomSummary; onAction: Props["onAction"] }) {
  const [customBet, setCustomBet] = useState("500");
  const player = state.players.find(p => p.id === playerId);
  if (!player || state.status === "complete") return null;
  if (state.status === "betting") {
    const bet = player.bet ?? 0;
    const readyCount = state.players.filter(item => item.betConfirmed).length;
    const allConfirmed = readyCount === state.players.length;
    const hasWager = state.players.some(item => (item.bet ?? 0) > 0 && !item.sittingOut);
    const add = (amount: number) => { onAction("set-bet", { amount: bet + amount }); playUiSound("chip"); };
    const custom = Number(customBet);
    return <div className="online-blackjack-betting">
      <div className="online-blackjack-wallet"><span>YOUR WALLET</span><strong>{formatChips(player.chips)} chips</strong><small>{player.betConfirmed ? player.sittingOut ? "Sitting out this round" : `Wager locked: ${formatChips(bet)} chips` : `Current wager: ${formatChips(bet)} chips`}</small></div>
      {!player.betConfirmed && <><div className="online-blackjack-chip-row">{[100,500,1000,2000,5000].map(value => <Button key={value} variant="outline" disabled={bet + value > player.chips} onClick={() => add(value)}>+{formatChips(value)}</Button>)}</div><div className="online-blackjack-custom"><label>Custom chips<input type="number" min="100" step="100" max={player.chips} value={customBet} onChange={event => setCustomBet(event.target.value)}/></label><Button variant="outline" disabled={!Number.isSafeInteger(custom) || custom < 100 || custom % 100 !== 0 || bet + custom > player.chips} onClick={() => add(custom)}>Add</Button></div><div className="online-blackjack-bet-actions"><Button variant="ghost" onClick={() => { onAction("set-bet", { amount: 0 }); playUiSound("tap"); }}>Clear bet</Button><Button variant="ghost" disabled={player.chips < 100} onClick={() => { onAction("set-bet", { amount: Math.floor(player.chips / 100) * 100 }); playUiSound("chip"); }}>All in</Button><Button variant="outline" disabled={bet < 100} onClick={() => { onAction("confirm-bet"); playUiSound("chip"); }}>Confirm wager</Button><Button variant="ghost" onClick={() => { onAction("sit-out"); playUiSound("tap"); }}>Sit out</Button></div></>}
      <div className="online-blackjack-ready-list"><div className="online-blackjack-ready-heading"><b>Table wagers</b><span>{readyCount}/{state.players.length} confirmed</span></div>{state.players.map(item => <div key={item.id}><span>{item.id === playerId ? "You" : playerName(item.id)} </span><strong>{item.betConfirmed ? item.sittingOut ? "Sitting out" : `${formatChips(item.bet ?? 0)} chips` : "Choosing wager"}</strong></div>)}</div>
      {player.betConfirmed && <div className="online-blackjack-confirmed" role="status">Your wager is confirmed. Waiting for the other seats.</div>}
      {hostId === playerId && <Button disabled={!allConfirmed || !hasWager} onClick={() => { onAction("start-deal"); playUiSound("shuffle"); }}>Start deal <Play size={15}/></Button>}
    </div>;
  }
  if (state.status === "insurance") {
    const insurancePlayer = state.players[state.insuranceIndex ?? -1];
    if (!insurancePlayer || insurancePlayer.id !== playerId) return <span className="online-blackjack-confirmed">Waiting for {insurancePlayer ? playerName(insurancePlayer.id, room) : "the table"} to decide on insurance.</span>;
    const insuranceCost = Math.floor((insurancePlayer.hands[0]?.bet ?? 0) / 2);
    return <div className="online-blackjack-insurance"><div><b>{playerName(playerId)} · Insurance</b><small>Costs half your original wager and pays 2:1 if the dealer has Blackjack.</small></div><Button variant="outline" onClick={() => { onAction("decline-insurance"); playUiSound("tap"); }}>No insurance</Button><Button disabled={insurancePlayer.chips < insuranceCost || insuranceCost < 1} onClick={() => { onAction("insurance"); playUiSound("insurance"); }}>Take insurance · {formatChips(insuranceCost)}</Button></div>;
  }
  const hand = player.hands[state.activeHandIndex];
  const canDouble = Boolean(hand && hand.cards.length === 2 && player.chips >= hand.bet && state.rules.allowDouble);
  const canSplit = Boolean(hand && hand.cards.length === 2 && hand.cards[0]!.rank === hand.cards[1]!.rank && player.hands.length < state.rules.maxHands && player.chips >= hand.bet && state.rules.allowSplit);
  const canSurrender = Boolean(hand && hand.cards.length === 2 && !hand.doubled && player.hands.length === 1 && hand.status === "playing");
  return <><Button disabled={!isMyTurn || state.status !== "player-turn"} onClick={() => onAction("hit")}><ArrowDownToLine size={15}/> Hit</Button><Button variant="outline" disabled={!isMyTurn || state.status !== "player-turn"} onClick={() => { onAction("stand"); playUiSound("tap"); }}><Pause size={15}/> Stand</Button><Button variant="outline" disabled={!isMyTurn || !canDouble} onClick={() => { onAction("double"); playUiSound("double"); }}><CircleDollarSign size={15}/> Double down</Button><Button variant="ghost" disabled={!isMyTurn || !canSplit} onClick={() => { onAction("split"); playUiSound("split"); }}><Layers size={15}/> Split</Button><Button variant="ghost" disabled={!isMyTurn || !canSurrender} onClick={() => { onAction("surrender"); playUiSound("loss"); }}><Flag size={15}/> Surrender</Button></>;
}
function HoldemControls({ state, playerId, isMyTurn, raise, setRaise, onAction }: { state: HoldemState; playerId: string; isMyTurn: boolean; raise: number; setRaise: (v: number) => void; onAction: Props["onAction"] }) {
  const p = state.players.find(p => p.id === playerId)!; const toCall = Math.max(0, state.currentBet - p.streetContribution);
  const nextAction = state.currentBet ? "raise" : "bet";
  return <><Button variant="outline" disabled={!isMyTurn} onClick={() => onAction("fold")}><X size={15}/> Fold</Button>{toCall === 0 ? <Button disabled={!isMyTurn} onClick={() => onAction("check")}><Check size={15}/> Check</Button> : <Button disabled={!isMyTurn || p.chips === 0} onClick={() => onAction("call")}><CircleDollarSign size={15}/> Call {toCall}</Button>}<label className="raise-control"><span>{nextAction === "bet" ? "Bet" : "Raise to"}</span><input type="number" min={state.currentBet + state.minRaise} max={p.chips + p.streetContribution} value={raise} onChange={e => setRaise(Number(e.target.value))} aria-label="Bet amount"/></label><Button disabled={!isMyTurn || p.chips === 0 || raise < state.currentBet + state.minRaise} onClick={() => onAction(nextAction, { amount: raise })}>{nextAction === "bet" ? "Bet" : "Raise"}</Button><Button variant="ghost" disabled={!isMyTurn || p.chips <= 0} onClick={() => onAction("all-in")}>All in</Button></>;
}
function TeenPattiControls({ state, playerId, isMyTurn, dealing, onAction }: { state: TeenPattiState; playerId: string; isMyTurn: boolean; dealing: boolean; onAction: Props["onAction"] }) {
  const player = state.players.find(p => p.id === playerId)!;
  const live = state.players.filter(p => !p.folded);
  const [wager, setWager] = useState("10");
  const disabled = dealing || !isMyTurn || state.status !== "playing";
  const remainingPot = Math.max(0, state.maxPot - state.pot);
  const available = Math.min(player.chips, remainingPot);
  const blindBounds = teenPattiWagerBounds(state.currentStake, false, available);
  const seenBounds = teenPattiWagerBounds(state.currentStake, true, available);
  const min = player.seen ? seenBounds.min : blindBounds.min;
  const max = player.seen ? seenBounds.max : blindBounds.max;
  const amount = Number(wager);
  const selectedSeen = Math.max(seenBounds.min, Number.isFinite(amount) ? amount : seenBounds.min);
  const finalOddCapContribution = available === remainingPot && remainingPot > 0 && remainingPot < state.currentStake * 2 && seenBounds.min === remainingPot;
  const seenWager = finalOddCapContribution ? remainingPot : selectedSeen + (selectedSeen % 2);
  const lastActor = state.players.find(p => p.id === state.lastActionPlayerId);
  const sideshowCost = state.currentStake * 2;
  const canSideshow = Boolean(player.seen && live.length >= 3 && live.every(active => active.seen) && lastActor && lastActor.seen && !lastActor.folded && lastActor.id !== player.id && player.chips >= sideshowCost && sideshowCost <= remainingPot);
  const opponent = live.length === 2 ? live.find(item => item.id !== playerId) : undefined;
  const showCost = opponent ? teenPattiShowCost(state.currentStake, player.seen, opponent.seen) : null;
  useEffect(() => { setWager(String(min)); }, [playerId, state.turnIndex, state.currentStake, player.seen]);
  const act = (action: string, payload?: Record<string, unknown>) => {
    onAction(action, payload);
    playUiSound(action === "blind" || action === "chaal" || action === "sideshow" ? "chip" : action === "pack" || action === "fold" ? "loss" : "reveal");
  };
  if (state.pendingSideshow) {
    if (state.pendingSideshow.targetId !== playerId) {
      return <div className="tp-online-sideshow-wait" role="status">Waiting for {playerName(state.pendingSideshow.targetId)} to answer {playerName(state.pendingSideshow.requesterId)}’s sideshow request.</div>;
    }
    return <div className="tp-online-sideshow-prompt"><div><b>{playerName(state.pendingSideshow.requesterId)} requested a sideshow.</b><small>The requester has already paid 2× the current stake into the pot. Accept to compare privately: the weaker hand packs; if tied, the requester packs. Declining leaves the wager in the pot and continues play after the requester.</small></div><Button onClick={() => act("sideshow-accept")}>Accept</Button><Button variant="outline" onClick={() => act("sideshow-decline")}>Decline</Button></div>;
  }
  if (disabled) return <span className="online-blackjack-confirmed">Waiting for the current player to act.</span>;
  return <div className="tp-online-controls">
    <div className="tp-online-current-bet"><span>Current blind stake <b>{formatChips(state.currentStake)}</b></span><span>Your status <b>{player.seen ? "Seen" : "Blind"}</b></span><span>Pot <b>{formatChips(state.pot)} / {formatChips(state.maxPot)}</b></span></div>
    <label className="raise-control tp-online-wager"><span>{player.seen ? "Seen chaal amount (2×–4×, even chips)" : "Blind wager amount (1×–2×)"}<input aria-label="Teen Patti wager amount" type="number" min={min} max={max} step={player.seen ? 2 : 1} value={wager} onChange={event => setWager(event.target.value)}/></span></label>
    <div className="tp-online-range-note">Blind: {formatChips(blindBounds.min)}–{formatChips(blindBounds.max)} · Seen: {formatChips(seenBounds.min)}–{formatChips(seenBounds.max)}. A seen wager sets the next blind stake to half the amount paid.</div>
    <div className="tp-online-action-buttons">
      {!player.seen && <Button variant="outline" disabled={disabled || !Number.isSafeInteger(amount) || blindBounds.max < blindBounds.min || amount < blindBounds.min || amount > blindBounds.max} onClick={() => act("blind", { amount })}>Play blind</Button>}
      <Button disabled={disabled || seenBounds.max < seenBounds.min || seenWager > seenBounds.max} onClick={() => act("chaal", { amount: seenWager })}>{player.seen ? "Chaal · seen" : `See cards & chaal · min ${formatChips(seenBounds.min)}`}</Button>
      <Button variant="ghost" disabled={disabled} onClick={() => act("pack")}>Pack</Button>
      {canSideshow && <Button variant="outline" disabled={disabled} onClick={() => act("sideshow")}>Side show · pay {formatChips(sideshowCost)}</Button>}
      {live.length === 2 && <Button variant="outline" disabled={showCost === null || player.chips < (showCost ?? 0) || (showCost ?? 0) > remainingPot} onClick={() => act("show")}>{showCost === null ? "Show unavailable against blind" : `Show · ${formatChips(showCost)}`}</Button>}
    </div>
    {live.length >= 3 && !live.every(active => active.seen) && <p className="tp-rule-hint">Side show unlocks after every active player has seen their cards.</p>}
  </div>;
}
function CallbreakControls({ state, playerId, isMyTurn, dealing, canStart, selectedCard, setBid, bid, onAction }: { state: CallbreakState; playerId: string; isMyTurn: boolean; dealing: boolean; canStart: boolean; selectedCard: string | null; setBid: (v: number) => void; bid: number; onAction: Props["onAction"] }) {
  const [selectedTrump, setSelectedTrump] = useState<Suit>("spades");
  useEffect(() => { setSelectedTrump(state.trumpSuit ?? "spades"); }, [state.round]);
  if (state.status === "complete") return <span className="online-blackjack-confirmed" role="status">The match is complete. See the final scorecard above.</span>;
  if (state.status === "round-complete") return canStart ? <Button onClick={() => onAction("next-round")}><RotateCcw size={15}/> Deal round {state.round + 1}</Button> : <span className="online-blackjack-confirmed" role="status">Waiting for the host to deal the next round.</span>;
  if (state.status === "trump-selection") {
    const activePlayer = state.players[state.currentIndex];
    const selections = state.trumpSelections ?? [];
    return <div className="callbreak-trump-controls">
      <div className="callbreak-trump-heading"><b>{isMyTurn ? "Your five-card trump decision" : `Waiting for ${activePlayer?.id === playerId ? "you" : activePlayer ? playerName(activePlayer.id) : "the next player"}`}</b><small>Choices are made from lowest cumulative score to highest. Choose a suit to set/change trump, or pass.</small></div>
      {isMyTurn && <><label className="raise-control"><span>Select trump suit</span><select aria-label="Select trump suit" value={selectedTrump} disabled={dealing} onChange={event => setSelectedTrump(event.target.value as Suit)}>{SUITS.map(suit => <option value={suit} key={suit}>{({ clubs: "Clubs ♣", diamonds: "Diamonds ♦", hearts: "Hearts ♥", spades: "Spades ♠" } as Record<Suit, string>)[suit]}</option>)}</select></label><div className="callbreak-trump-actions"><Button disabled={dealing} onClick={() => onAction("choose-trump", { suit: selectedTrump })}>Choose {selectedTrump}</Button><Button variant="outline" disabled={dealing} onClick={() => onAction("pass-trump")}>Pass</Button></div></>}
      <div className="callbreak-trump-selections"><b>Trump choices so far</b>{selections.length ? selections.map((choice, index) => <span key={`${choice.playerId}-${index}`}>{playerName(choice.playerId)} chose {choice.suit} · must call at least {choice.minimumTricks}</span>) : <span>No suit selected yet. Spades will be trump if everyone passes.</span>}</div>
    </div>;
  }
  if (state.status === "bidding") {
    const minimumBid = getCallbreakMinimumBid(state, playerId);
    const effectiveBid = Math.max(minimumBid, bid);
    return <><label className="raise-control"><span>Your call {minimumBid > 1 ? `(minimum ${minimumBid} — your trump commitment)` : ""}</span><select aria-label="Your Callbreak bid" value={effectiveBid} disabled={!isMyTurn || dealing} onChange={event => setBid(Number(event.target.value))}>{Array.from({ length: 14 - minimumBid }, (_, index) => <option key={index + minimumBid} value={index + minimumBid}>{index + minimumBid} {(index + minimumBid) === 1 ? "trick" : "tricks"}</option>)}</select></label><Button disabled={!isMyTurn || dealing} onClick={() => onAction("bid", { bid: effectiveBid })}>Confirm call</Button>{minimumBid > 1 && <span className="callbreak-rule-reminder">You selected trump in the auction and must bid at least {minimumBid} tricks.</span>}</>;
  }
  return <><span className="callbreak-rule-reminder">{state.trick.length === 0 ? "Lead any card." : `Follow suit. Beat the highest card when possible; if void, play ${state.trumpSuit ?? "spades"} or overtrump when possible.`}</span><Button disabled={!isMyTurn || dealing || !selectedCard} onClick={() => onAction("play", { cardId: selectedCard })}><Play size={15}/> Play selected card</Button></>;
}

function RummyControls({ state, playerId, isMyTurn, mode, setMode, selectedGroup, setSelectedGroup, selectedCard, setSelectedCard, groups, setGroups, onAction }: { state: RummyState; playerId: string; isMyTurn: boolean; mode: "discard" | "groups"; setMode: (v: "discard" | "groups") => void; selectedGroup: string[]; setSelectedGroup: (v: string[]) => void; selectedCard: string | null; setSelectedCard: (v: string | null) => void; groups: RummyGroup[]; setGroups: (v: RummyGroup[]) => void; onAction: Props["onAction"] }) {
  const handCount = state.players.find(p => p.id === playerId)?.hand.length ?? 0;
  const stockCount = state.drawPileCount ?? state.drawPile?.length ?? 0;
  const groupedCount = groups.reduce((sum, group) => sum + group.cardIds.length, 0);
  const addGroup = () => {
    if (selectedGroup.length < 3 || (state.gameId === "rummy-10" && selectedGroup.length > 4) || groupedCount + selectedGroup.length > state.handSize) return;
    setGroups([...groups, { cardIds: selectedGroup }]); setSelectedGroup([]);
  };
  const clearGroups = () => { setGroups([]); setSelectedGroup([]); };
  return <>
    {state.status === "draw" && <><Button disabled={!isMyTurn || stockCount === 0} onClick={() => onAction("draw-stock")}><ArrowDownToLine size={15}/> Draw stock</Button><Button variant="outline" disabled={!isMyTurn || !state.discardPile.length} onClick={() => onAction("draw-discard")}>Take discard</Button></>}
    <Button variant={mode === "groups" ? "outline" : "ghost"} disabled={!isMyTurn} onClick={() => { setMode(mode === "groups" ? "discard" : "groups"); setSelectedCard(null); setSelectedGroup([]); }}>{mode === "groups" ? "Finish grouping" : "Build declaration"}</Button>
    {mode === "groups" ? <><Button variant="ghost" disabled={!isMyTurn || selectedGroup.length < 3 || (state.gameId === "rummy-10" && selectedGroup.length > 4) || groupedCount + selectedGroup.length > state.handSize} onClick={addGroup}>Add group ({selectedGroup.length})</Button><Button variant="ghost" disabled={!isMyTurn || (!groups.length && !selectedGroup.length)} onClick={clearGroups}>Clear groups</Button><Button disabled={!isMyTurn || state.status !== "discard" || handCount !== state.handSize + 1 || groupedCount !== state.handSize || selectedGroup.length > 0} onClick={() => onAction("declare", { groups })}>Declare hand</Button></> : <Button disabled={!isMyTurn || state.status !== "discard" || !selectedCard || handCount !== state.handSize + 1} onClick={() => onAction("discard", { cardId: selectedCard })}>Discard selected</Button>}
    {groups.length > 0 && <span className="groups-count">{groupedCount}/{state.handSize} cards grouped · {groups.length} groups</span>}
    {state.lastDeclaration && !state.lastDeclaration.valid && <span className="groups-count" role="status">Declaration not valid: {state.lastDeclaration.errors[0] ?? "Check your groups."}</span>}
  </>;
}
