import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import type { RoomSummary } from "@cardroom/shared/contracts";
import { GameTable, type AnyGameState } from "./GameTable";
import { useOfflineStore, applyOfflineAction, isOfflineGameSupported } from "../store/offline";
import { useSessionStore } from "../store/session";
import { API_URL, api, messageFrom } from "../lib";
import { EmptyState } from "../components/Shared";
import { Link } from "react-router-dom";
import { BlackjackCompanionPage } from "./BlackjackCompanionPage";
import { TeenPattiCompanionPage } from "./TeenPattiCompanionPage";
import { CallbreakCompanionPage } from "./CallbreakCompanionPage";

export function OfflineGamePage() {
  const { gameId = "blackjack" } = useParams(); const navigate = useNavigate(); const match = useOfflineStore(s => s.match); const start = useOfflineStore(s => s.start); const update = useOfflineStore(s => s.update); const [error, setError] = useState("");
  useEffect(() => { if (gameId === "holdem" && (!match || match.gameId !== gameId)) start("holdem"); }, [gameId, match?.gameId, start]);
  if (gameId === "rummy-13" || gameId === "rummy-10") return <Navigate to={`/games/${gameId}`} replace/>;
  if (!isOfflineGameSupported(gameId)) return <Navigate to="/games" replace/>;
  if (gameId === "blackjack") return <BlackjackCompanionPage/>;
  if (gameId === "teen-patti") return <TeenPattiCompanionPage/>;
  if (gameId === "callbreak") return <CallbreakCompanionPage/>;
  if (!match || match.gameId !== gameId) return <div className="page-loading"><span className="spinner"/> Dealing the cards…</div>;
  const handleAction = (action: string, payload?: Record<string, unknown>) => {
    try { setError(""); const next = applyOfflineAction(match, action, payload); update(next.state); }
    catch (e) { setError(messageFrom(e)); }
  };
  return <div className="page-container game-page-container">{error && <div className="form-error" role="alert">{error}</div>}<GameTable gameId={match.gameId} state={match.state} playerId={match.humanId} onAction={handleAction} onExit={() => navigate("/games")}/></div>;
}

export function OnlineGamePage() {
  const { code = "" } = useParams(); const navigate = useNavigate(); const session = useSessionStore(s => s.session); const [room, setRoom] = useState<RoomSummary | null>(null); const [state, setState] = useState<AnyGameState | null>(null); const [connection, setConnection] = useState("connecting"); const [error, setError] = useState(""); const socketRef = useRef<Socket | null>(null); const seq = useRef(Date.now() * 1_000); const lastStateSeq = useRef(0);
  useEffect(() => {
    let cancelled = false;
    if (!session?.token) { navigate(`/join/${code}`); return; }
    api<{ room: RoomSummary }>(`/api/rooms/${code}`).then(result => { if (!cancelled) setRoom(result.room); }).catch(err => { if (!cancelled) setError(messageFrom(err)); });
    const socket = io(API_URL, { auth: { token: session.token }, reconnection: true, reconnectionAttempts: Infinity, timeout: 8000 });
    socketRef.current = socket;
    socket.on("connect", () => { setConnection("connected"); socket.emit("room:subscribe", { code }, (res: { ok: boolean; error?: string }) => { if (!res.ok) setError(res.error ?? "Room access denied"); }); });
    socket.on("disconnect", () => setConnection("reconnecting"));
    socket.on("connect_error", () => { setConnection("reconnecting"); setError("Connection interrupted. Attempting to reconnect…"); });
    socket.on("room:updated", (next: RoomSummary) => { setRoom(next); setError(""); });
    socket.on("game:state", (payload: { seq: number; state: AnyGameState }) => { if (payload.state && payload.seq >= lastStateSeq.current) { lastStateSeq.current = payload.seq; setState(payload.state); } });
    return () => { cancelled = true; socket.disconnect(); socketRef.current = null; };
  }, [code, session?.token, navigate]);
  const action = (name: string, payload: Record<string, unknown> = {}) => {
    const socket = socketRef.current; if (!socket?.connected) { setError("You are reconnecting. Your move was not sent."); return; }
    seq.current += 1;
    socket.emit("game:action", { seq: seq.current, idempotencyKey: crypto.randomUUID(), action: name, payload }, (res: { ok: boolean; error?: string }) => { if (!res.ok) setError(res.error ?? "Move rejected by the table"); else setError(""); });
  };
  const exit = () => { socketRef.current?.emit("room:leave", () => navigate(`/room/${code}`)); if (!socketRef.current) navigate(`/games`); };
  if (error && !room) return <div className="page-container standard-page"><EmptyState title="Unable to open table" text={error} action={<Link className="button button-gold" to="/games">Back to games</Link>}/></div>;
  if (!room || !state || !session) return <div className="page-loading"><span className="spinner"/> {connection === "reconnecting" ? "Reconnecting to your table…" : "Taking your seat…"}</div>;
  if (room.status === "finished" && state.status === "complete") return <div className="page-container game-page-container"><GameTable gameId={room.gameId} state={state} playerId={session.id} online room={room} onAction={action} onExit={() => navigate(`/results/${code}`)}/></div>;
  return <div className="page-container game-page-container"><div className={`live-connection-banner ${connection}`}><span/> {connection === "connected" ? "Live table connected" : "Reconnecting — your seat is held"}{error && <small>{error}</small>}</div><GameTable gameId={room.gameId} state={state} playerId={session.id} online room={room} onAction={action} onExit={exit}/></div>;
}
