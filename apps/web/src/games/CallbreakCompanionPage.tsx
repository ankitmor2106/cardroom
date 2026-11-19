import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Crown, History, RotateCcw, Spade, Trophy, Users, Target } from "lucide-react";
import { Button } from "../components/Shared";
import { useCallbreakCompanionStore } from "../store/callbreakCompanion";
import { useSessionStore } from "../store/session";
import { playUiSound } from "../sound";
import { CALLBREAK_SCOREKEEPER_MAX_BID, formatCallbreakScore } from "@cardroom/shared/games/callbreak-companion";
import { SUITS, type Suit } from "@cardroom/shared/cards";

const defaultNames = ["Player 1", "Player 2", "Player 3", "Player 4"];
const suitNames: Record<Suit, string> = { clubs: "Clubs ♣", diamonds: "Diamonds ♦", hearts: "Hearts ♥", spades: "Spades ♠" };

export function CallbreakCompanionPage() {
  const match = useCallbreakCompanionStore(state => state.match);
  const start = useCallbreakCompanionStore(state => state.start);
  const submitBids = useCallbreakCompanionStore(state => state.submitBids);
  const submitTricks = useCallbreakCompanionStore(state => state.submitTricks);
  const nextRound = useCallbreakCompanionStore(state => state.nextRound);
  const clear = useCallbreakCompanionStore(state => state.clear);
  const reducedMotion = useSessionStore(state => state.preferences.reducedMotion);
  const [playerCount, setPlayerCount] = useState<3 | 4>(4);
  const [removedSuit, setRemovedSuit] = useState<Suit>("clubs");
  const [names, setNames] = useState(defaultNames);
  const [bids, setBids] = useState<Record<string, number>>({});
  const [tricks, setTricks] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const animation = reducedMotion ? { duration: 0 } : { duration: 0.28, ease: "easeOut" as const };

  const enteredTricks = useMemo(() => Object.values(tricks).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0), [tricks]);
  const canSubmitTricks = Boolean(match && match.players.every(player => Number.isInteger(tricks[player.id]) && tricks[player.id]! >= 0 && tricks[player.id]! <= match.tricksPerRound) && enteredTricks === match.tricksPerRound);

  const begin = () => {
    const selected = names.slice(0, playerCount).map((name, index) => name.trim() || `Player ${index + 1}`);
    if (selected.some(name => name.length > 20)) { setError("Player names must be 20 characters or fewer."); return; }
    setError(""); start(selected, playerCount === 3 ? removedSuit : undefined); setBids({}); setTricks({}); playUiSound("shuffle");
  };

  const confirmBids = () => {
    if (!match) return;
    try {
      setError("");
      submitBids(Object.fromEntries(match.players.map(player => [player.id, Number(bids[player.id])])))
      setTricks(Object.fromEntries(match.players.map(player => [player.id, 0])));
      playUiSound("success");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Please check every call."); playUiSound("error"); }
  };

  const calculateRound = () => {
    if (!match) return;
    try { setError(""); submitTricks(Object.fromEntries(match.players.map(player => [player.id, Number(tricks[player.id])]))) ; playUiSound("reveal"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Please check the trick totals."); playUiSound("error"); }
  };

  const reset = () => { clear(); setError(""); setBids({}); setTricks({}); };

  return <div className="page-container callbreak-companion-page">
    <div className="callbreak-companion-topbar">
      <div><span className="eyebrow">OFFLINE · PHYSICAL DECK SCOREKEEPER</span><h1>Callbreak <em>scorekeeper.</em></h1><p>Play with your real cards. Cardroom keeps the calls, round scores and race to 31.</p></div>
      <div className="callbreak-companion-mark"><Spade size={30}/><span>{match?.players.length === 3 && match.removedSuit === "spades" ? "NO SPADES · NO TRUMP" : "SPADES ARE TRUMP"}</span></div>
    </div>

    {!match && <motion.section className="callbreak-panel callbreak-setup-panel" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={animation}>
      <div className="callbreak-panel-heading"><span className="step-circle">01</span><div><span className="eyebrow">FIRST WINDOW</span><h2>Who's at the table?</h2><p>Set the player names before you deal your physical cards.</p></div></div>
      <div className="callbreak-player-count" role="group" aria-label="Number of players">
        <button type="button" className={playerCount === 3 ? "active" : ""} onClick={() => setPlayerCount(3)}><Users size={17}/> 3 players</button>
        <button type="button" className={playerCount === 4 ? "active" : ""} onClick={() => setPlayerCount(4)}><Users size={17}/> 4 players</button>
      </div>
      <div className="callbreak-setup-grid">{names.slice(0, playerCount).map((name, index) => <label className="callbreak-player-field" key={index}><span><i>{index + 1}</i> Player {index + 1}</span><input value={name} maxLength={20} onChange={event => setNames(previous => previous.map((value, i) => i === index ? event.target.value : value))} placeholder={`Player ${index + 1}`}/></label>)}</div>
      {playerCount === 3 && <label className="callbreak-player-field callbreak-removed-suit"><span>Suit to remove from the physical deck</span><select aria-label="Suit to remove" value={removedSuit} onChange={event => setRemovedSuit(event.target.value as Suit)}>{SUITS.map(suit => <option key={suit} value={suit}>{suitNames[suit]}</option>)}</select><small>Remove all 13 cards of this suit. The remaining 39 cards are dealt 13 to each player.</small></label>}
      <div className="callbreak-info-strip"><div><Target size={17}/><span><b>First to 31 points</b><small>Match ends after the round in which a player reaches 31.</small></span></div><div><Spade size={17}/><span><b>{playerCount === 3 && removedSuit === "spades" ? "No spades in this deck" : "Spades are permanent trump"}</b><small>{playerCount === 3 && removedSuit === "spades" ? "Agree that this house round has no spade trump." : "Every player scores individually. No teams."}</small></span></div></div>
      <div className="callbreak-deal-instructions"><h3>Before each round</h3><p><b>4 players:</b> Use a standard 52-card deck and deal 13 cards to each player.</p><p><b>3 players:</b> Remove all 13 cards of the selected suit. Deal the remaining 39 cards so each player receives exactly 13 cards. The round has exactly 13 tricks.</p><p>Cardroom does not deal or inspect offline cards. It records calls and the number of tricks each person wins.</p></div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <Button onClick={begin} className="callbreak-primary-action">Start scorekeeping <ArrowRight size={16}/></Button>
    </motion.section>}

    {match && <AnimatePresence mode="wait">
      {match.status === "bidding" && <motion.section key={`bids-${match.round}`} className="callbreak-panel" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={animation}>
        <div className="callbreak-panel-heading"><span className="step-circle">02</span><div><span className="eyebrow">ROUND {match.round} · BIDDING</span><h2>How many tricks will each player make?</h2><p>Enter each player's call after they inspect their physical hand. Calls are between 1 and {CALLBREAK_SCOREKEEPER_MAX_BID}. Three-player rounds use 13 cards and 13 tricks as well.</p></div></div>
        <div className="callbreak-round-meta"><span><Spade size={15}/> {match.tricksPerRound} tricks this round</span>{match.removedSuit && <span>Removed suit: {suitNames[match.removedSuit]}</span>}<span>Dealer: {match.players[match.dealerIndex]?.name}</span><span>First to lead: {match.players[(match.dealerIndex + 1) % match.players.length]?.name}</span></div>
        <div className="callbreak-entry-grid">{match.players.map((player, index) => <motion.label key={player.id} className="callbreak-entry-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reducedMotion ? 0 : index * .055 }}><span className="callbreak-entry-avatar">{player.name.slice(0, 1).toUpperCase()}</span><b>{player.name}</b><small>Current total · {formatCallbreakScore(player.scoreTenths)}</small><span className="callbreak-input-label">Calls / bids</span><select aria-label={`${player.name} call`} value={bids[player.id] ?? ""} onChange={event => setBids(previous => ({ ...previous, [player.id]: Number(event.target.value) }))}><option value="" disabled>Choose tricks</option>{Array.from({ length: CALLBREAK_SCOREKEEPER_MAX_BID }, (_, i) => i + 1).map(value => <option value={value} key={value}>{value} {value === 1 ? "trick" : "tricks"}</option>)}</select></motion.label>)}</div>
        <div className="callbreak-submit-row"><p>Every player must make a call. Calls are independent; they do not need to add up to the number of tricks in the round.</p><Button onClick={confirmBids} disabled={!match.players.every(player => Number.isInteger(bids[player.id]) && bids[player.id]! >= 1 && bids[player.id]! <= CALLBREAK_SCOREKEEPER_MAX_BID)}>Confirm all calls <Check size={16}/></Button></div>
        <StandingTable players={match.players}/>
        {error && <div className="form-error" role="alert">{error}</div>}
      </motion.section>}

      {match.status === "score-entry" && <motion.section key={`scores-${match.round}`} className="callbreak-panel" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={animation}>
        <div className="callbreak-panel-heading"><span className="step-circle">03</span><div><span className="eyebrow">ROUND {match.round} · PHYSICAL GAME FINISHED</span><h2>How many tricks did everyone win?</h2><p>Enter the final trick count from your table. The scorecard unlocks when all {match.tricksPerRound} tricks are accounted for.</p></div></div>
        <div className="callbreak-trick-total"><div><span>Tricks recorded</span><b>{enteredTricks} <small>/ {match.tricksPerRound}</small></b></div><div className="callbreak-progress"><i style={{ width: `${Math.min(100, enteredTricks / match.tricksPerRound * 100)}%` }}/></div><span className={enteredTricks === match.tricksPerRound ? "complete" : "pending"}>{enteredTricks === match.tricksPerRound ? "All tricks accounted for" : `${match.tricksPerRound - enteredTricks} tricks remaining`}</span></div>
        <div className="callbreak-score-entry-list">{match.players.map((player, index) => <label key={player.id} className="callbreak-score-entry"><span className="callbreak-entry-avatar">{player.name.slice(0, 1).toUpperCase()}</span><span className="callbreak-score-entry-name"><b>{player.name}</b><small>Call: {match.bids?.[player.id]} · Total: {formatCallbreakScore(player.scoreTenths)}</small></span><span className="callbreak-number-stepper"><button type="button" aria-label={`Decrease tricks for ${player.name}`} onClick={() => setTricks(previous => ({ ...previous, [player.id]: Math.max(0, (previous[player.id] ?? 0) - 1) }))}>−</button><input type="number" min={0} max={match.tricksPerRound} inputMode="numeric" aria-label={`${player.name} tricks won`} value={tricks[player.id] ?? 0} onChange={event => setTricks(previous => ({ ...previous, [player.id]: event.target.value === "" ? 0 : Number(event.target.value) }))}/><button type="button" aria-label={`Increase tricks for ${player.name}`} onClick={() => setTricks(previous => ({ ...previous, [player.id]: Math.min(match.tricksPerRound, (previous[player.id] ?? 0) + 1) }))}>+</button></span></label>)}</div>
        <div className="callbreak-submit-row"><p>Trick counts must total exactly {match.tricksPerRound}. A player may win zero tricks.</p><Button onClick={calculateRound} disabled={!canSubmitTricks}>Calculate scorecard <ArrowRight size={16}/></Button></div>
        {error && <div className="form-error" role="alert">{error}</div>}
      </motion.section>}

      {(match.status === "round-results" || match.status === "complete") && <motion.section key={`results-${match.round}`} className="callbreak-panel callbreak-results-panel" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={animation}>
        <div className="callbreak-results-hero">
          <span className="eyebrow">{match.status === "complete" ? "MATCH COMPLETE" : `ROUND ${match.round} COMPLETE`}</span>
          {match.status === "complete" ? <><Trophy size={32}/><h2>{match.winnerIds.map(id => match.players.find(player => player.id === id)?.name).join(" & ")} {match.winnerIds.length > 1 ? "share the win" : "wins the match"}!</h2><p>First to {match.targetScoreTenths / 10} points. The final round has been scored.</p></> : <><Check size={30}/><h2>Round scorecard</h2><p>Calls checked against tricks won. Your match totals carry forward.</p></>}
        </div>
        {match.roundLedger && <div className="callbreak-ledger-scroll"><table className="callbreak-ledger"><thead><tr><th>Player</th><th>Call</th><th>Tricks won</th><th>Contract</th><th>Round points</th><th>Match total</th></tr></thead><tbody>{[...match.roundLedger].sort((a, b) => b.totalScoreTenths - a.totalScoreTenths).map(row => <tr key={row.playerId} className={match.winnerIds.includes(row.playerId) ? "match-winner-row" : ""}><td><b>{row.name}</b>{match.winnerIds.includes(row.playerId) && <small>WINNER</small>}</td><td>{row.bid}</td><td>{row.tricksWon}</td><td><span className={`callbreak-contract ${row.madeCall ? "made" : "missed"}`}>{row.madeCall ? "Made" : "Missed"}</span><small>{row.madeCall ? row.tricksWon > row.bid ? `${row.tricksWon - row.bid} overtrick${row.tricksWon - row.bid > 1 ? "s" : ""}` : "Exact call" : `Short by ${row.bid - row.tricksWon}`}</small></td><td className={row.scoreTenths >= 0 ? "positive" : "negative"}>{formatCallbreakScore(row.scoreTenths)}</td><td><b>{formatCallbreakScore(row.totalScoreTenths)}</b></td></tr>)}</tbody></table></div>}
        <StandingTable players={match.players}/>
        {match.status === "round-results" ? <div className="callbreak-results-actions"><Button onClick={() => { nextRound(); setBids({}); setTricks({}); playUiSound("tap"); }}>Start round {match.round + 1} <ArrowRight size={16}/></Button><Button variant="outline" onClick={reset}>New table</Button></div> : <div className="callbreak-results-actions"><Button onClick={reset}><RotateCcw size={16}/> New match</Button></div>}
        <RoundHistory history={match.history}/>
      </motion.section>}
    </AnimatePresence>}
  </div>;
}

function StandingTable({ players }: { players: Array<{ id: string; name: string; scoreTenths: number; roundsPlayed: number; callsMade: number }> }) {
  return <div className="callbreak-standing"><div className="callbreak-subheading"><div><span className="eyebrow">MATCH TRACKER</span><h3>Current standings</h3></div><span>Target · 31.0 pts</span></div><div className="callbreak-standing-list">{[...players].sort((a, b) => b.scoreTenths - a.scoreTenths).map((player, index) => <div className="callbreak-standing-row" key={player.id}><span className="standing-rank">{index === 0 ? <Crown size={15}/> : index + 1}</span><b>{player.name}</b><span>{player.callsMade}/{player.roundsPlayed} calls made</span><strong>{formatCallbreakScore(player.scoreTenths)}</strong><div className="callbreak-standing-track"><i style={{ width: `${Math.min(100, Math.max(0, player.scoreTenths / 310 * 100))}%` }}/></div></div>)}</div></div>;
}

function RoundHistory({ history }: { history: Array<Array<{ playerId: string; name: string; bid: number; tricksWon: number; scoreTenths: number; totalScoreTenths: number; madeCall: boolean }>> }) {
  if (history.length < 2) return null;
  return <details className="callbreak-history"><summary><History size={16}/> Previous rounds ({history.length - 1})</summary>{history.slice(0, -1).map((round, index) => <div key={index} className="callbreak-history-round"><b>Round {index + 1}</b>{round.map(row => <span key={row.playerId}>{row.name}: {row.bid}/{row.tricksWon} · {formatCallbreakScore(row.scoreTenths)}</span>)}</div>)}</details>;
}
