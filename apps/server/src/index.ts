import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { Server as SocketServer } from "socket.io";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  createBlackjackBettingGame, blackjackSetBet, blackjackConfirmBet, blackjackSitOut, blackjackStartDeal, blackjackDecideInsurance, blackjackNextRound, blackjackAction, createHoldemGame, holdemAction,
  createTeenPattiGame, teenPattiAction, teenPattiNextRound, createCallbreakRound, callbreakChooseTrump, callbreakBid, callbreakPlay, secureRandom,
  startNextCallbreakRound, createRummyGame, drawRummyCard, discardRummyCard, declareRummy,
} from "@cardroom/game-engines";
import { createRoomSchema, joinRoomSchema, actionEnvelopeSchema, chatSchema, gameIdSchema } from "@cardroom/validation";
import type { GameId, PlayerId, PlayerSummary, RoomSummary, TeenPattiRoomOptions } from "@cardroom/shared/contracts";
import type { BlackjackState } from "@cardroom/shared/games/blackjack";
import type { HoldemState } from "@cardroom/shared/games/holdem";
import type { TeenPattiState } from "@cardroom/shared/games/teenPatti";
import type { CallbreakState } from "@cardroom/shared/games/callbreak";
import type { RummyState } from "@cardroom/shared/games/rummy";

const NODE_ENV = process.env.NODE_ENV ?? "development";
const PORT = Number(process.env.PORT ?? 4000);
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";
const SESSION_SECRET = process.env.SESSION_SECRET ?? "dev-only-session-secret-replace-before-production-2026";
if (NODE_ENV === "production" && (!process.env.SESSION_SECRET || SESSION_SECRET.length < 32 || /replace-with|dev-only|development-only|change-me|example/i.test(SESSION_SECRET))) throw new Error("Set a unique high-entropy SESSION_SECRET (at least 32 characters, not an example value) in production");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDistDir = process.env.WEB_DIST_PATH ?? path.resolve(__dirname, "../../web/dist");

interface Player { id: PlayerId; displayName: string; avatar: string; ready: boolean; connection: "connected" | "disconnected"; socketIds: Set<string> }
interface Room {
  id: string; code: string; name: string; gameId: GameId; visibility: "public" | "private"; status: "waiting" | "playing" | "finished";
  hostId: PlayerId; maxPlayers: number; createdAt: string; passwordHash?: string; players: Map<PlayerId, Player>;
  gameOptions?: { teenPatti?: TeenPattiRoomOptions }; state?: unknown; seq: number; lastSeqByPlayer: Map<PlayerId, number>; idempotency: Set<string>; queue: Promise<void>; chat: Array<{ id: string; playerId: string; displayName: string; text: string; createdAt: string }>;
}
interface AuthUser { sub: string; displayName: string }

declare module "@fastify/jwt" {
  interface FastifyJWT { user: AuthUser }
}
const prisma = process.env.DATABASE_URL ? new PrismaClient() : null;
const rooms = new Map<string, Room>();
const roomByCode = new Map<string, string>();
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const guestSchema = z.object({ displayName: z.string().trim().min(2).max(20).regex(/^[\p{L}\p{N} _.-]+$/u) });

function hashRoomPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}.${scryptSync(password, salt, 64).toString("hex")}`;
}
function verifyRoomPassword(password: string, encoded: string): boolean {
  const [saltHex, hashHex] = encoded.split("."); if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex"); const actual = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function makeCode(): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const bytes = randomBytes(6); const code = [...bytes].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    if (!roomByCode.has(code)) return code;
  }
  throw new Error("Unable to allocate a room code");
}
function roomSummary(room: Room): RoomSummary {
  const players: PlayerSummary[] = [...room.players.values()].map(p => ({ id: p.id, displayName: p.displayName, avatar: p.avatar, isHost: p.id === room.hostId, ready: p.ready, connection: p.connection }));
  return { id: room.id, code: room.code, name: room.name, gameId: room.gameId, visibility: room.visibility, status: room.status, hostId: room.hostId, players, maxPlayers: room.maxPlayers, createdAt: room.createdAt, ...(room.gameOptions ? { gameOptions: room.gameOptions } : {}) };
}
function getRoomByCode(code: string): Room | undefined { const id = roomByCode.get(code.toUpperCase()); return id ? rooms.get(id) : undefined; }
function roomPlayer(room: Room, playerId: PlayerId): Player {
  const p = room.players.get(playerId); if (!p) throw new Error("Player is not a member of this room"); return p;
}
function queueRoom<T>(room: Room, action: () => Promise<T> | T): Promise<T> {
  const result = room.queue.then(action, action);
  room.queue = result.then(() => undefined, () => undefined);
  return result;
}
function publicGameState(room: Room, viewerId: PlayerId): unknown {
  if (!room.state) return null;
  const state = structuredClone(room.state) as Record<string, unknown>;
  const hide = (list: unknown, key: string) => {
    if (!Array.isArray(list)) return;
    for (const item of list as Array<Record<string, unknown>>) {
      if (item.id !== viewerId && Array.isArray(item[key])) { item[`${key}Count`] = item[key].length; item[key] = []; }
    }
  };
  switch (room.gameId) {
    case "blackjack": {
      const s = state as unknown as BlackjackState;
      if (s.status !== "complete" && s.dealer.length > 1) { (state.dealer as unknown[]).splice(1); state.dealerHidden = 1; }
      // Blackjack player hands are face-up at the table. Only the dealer hole card
      // and the undealt deck remain private while a round is in progress.
      delete state.deck; break;
    }
    case "holdem": {
      const poker = state as unknown as HoldemState;
      if (poker.status !== "complete") hide(state.players, "hole");
      else {
        for (const player of poker.players) if (player.folded) {
          const cards = player.hole;
          (player as unknown as { hole: unknown[]; holeCount?: number }).holeCount = cards.length;
          (player as unknown as { hole: unknown[] }).hole = [];
        }
      }
      delete state.deck; break;
    }
    case "teen-patti": {
      const teen = state as unknown as TeenPattiState;
      if (!teen.result) hide(state.players, "cards");
      else {
        for (const player of teen.players) if (player.folded) {
          const cards = player.cards;
          (player as unknown as { cards: unknown[]; cardsCount?: number }).cardsCount = cards.length;
          (player as unknown as { cards: unknown[] }).cards = [];
        }
      }
      delete state.deck; break;
    }
    case "callbreak": {
      const callbreak = state as unknown as CallbreakState;
      hide(state.players, "hand");
      // During the auction each client receives only their own first five cards.
      // The remaining eight cards do not exist in any client snapshot until trump is locked.
      delete state.deck;
      if (callbreak.status === "trump-selection") {
        for (const player of state.players as Array<Record<string, unknown>>) {
          if (player.id === viewerId && Array.isArray(player.hand)) player.hand = player.hand.slice(0, 5);
        }
      }
      break;
    }
    case "rummy-13": case "rummy-10":
      if ((state as unknown as RummyState).status !== "complete") hide(state.players, "hand");
      state.drawPileCount = Array.isArray(state.drawPile) ? state.drawPile.length : 0;
      delete state.drawPile;
      if (Array.isArray(state.history)) state.history = (state.history as Array<Record<string, unknown>>).map(event => event.playerId === viewerId || event.action !== "draw-stock" ? event : { ...event, cardId: undefined });
      break;
  }
  return state;
}
function gamePlayers(room: Room) { return [...room.players.values()].map(p => ({ id: p.id, chips: 1000 })); }
function startEngine(room: Room): unknown {
  const players = gamePlayers(room);
  switch (room.gameId) {
    case "blackjack": return createBlackjackBettingGame(players.map(p => ({ id: p.id, chips: 10_000 })), {}, secureRandom);
    case "holdem": return createHoldemGame(players, { smallBlind: 5, bigBlind: 10 }, secureRandom);
    case "teen-patti": {
      const options = room.gameOptions?.teenPatti ?? { startingStack: 1_000, bootAmount: 10, maxPot: 1_000 };
      const configuredPlayers = players.map(player => ({ ...player, chips: options.startingStack }));
      return createTeenPattiGame(configuredPlayers, options.bootAmount, secureRandom, options.maxPot);
    }
    case "callbreak": return createCallbreakRound(players.map(p => ({ id: p.id })), 1, secureRandom);
    case "rummy-13": return createRummyGame("rummy-13", players.map(p => p.id), secureRandom);
    case "rummy-10": return createRummyGame("rummy-10", players.map(p => p.id), secureRandom);
  }
}
function dispatchAction(room: Room, actorId: PlayerId, action: string, payload: Record<string, unknown>): unknown {
  if (!room.state) throw new Error("Game has not started");
  switch (room.gameId) {
    case "blackjack": {
      const game = room.state as BlackjackState;
      if (action === "set-bet" && Number.isSafeInteger(payload.amount)) return blackjackSetBet(game, actorId, Number(payload.amount));
      if (action === "confirm-bet") return blackjackConfirmBet(game, actorId);
      if (action === "sit-out") return blackjackSitOut(game, actorId);
      if (action === "start-deal") {
        if (room.hostId !== actorId) throw new Error("Only the host can start the deal");
        return blackjackStartDeal(game);
      }
      if (action === "next-round") {
        if (room.hostId !== actorId) throw new Error("Only the host can start the next round");
        return blackjackNextRound(game, secureRandom);
      }
      if (action === "insurance") return blackjackDecideInsurance(game, actorId, true);
      if (action === "decline-insurance") return blackjackDecideInsurance(game, actorId, false);
      if (!( ["hit", "stand", "double", "split", "surrender"] as string[]).includes(action)) throw new Error("Unsupported blackjack action");
      return blackjackAction(game, actorId, action as "hit" | "stand" | "double" | "split" | "surrender");
    }
    case "holdem": {
      const simple = ["fold", "check", "call", "all-in"];
      if (simple.includes(action)) return holdemAction(room.state as HoldemState, actorId, { type: action as "fold" | "check" | "call" | "all-in" });
      if ((action === "bet" || action === "raise") && Number.isSafeInteger(payload.amount)) return holdemAction(room.state as HoldemState, actorId, { type: action, amount: Number(payload.amount) });
      throw new Error("Unsupported or malformed Hold'em action");
    }
    case "teen-patti": {
      if (action === "next-round") {
        if (room.hostId !== actorId) throw new Error("Only the host can start the next round");
        return teenPattiNextRound(room.state as TeenPattiState, secureRandom);
      }
      const teenActions = ["blind", "chaal", "fold", "pack", "show", "sideshow", "sideshow-accept", "sideshow-decline"] as const;
      if (!(teenActions as readonly string[]).includes(action)) throw new Error("Unsupported Teen Patti action");
      const amount = payload.amount === undefined ? undefined : Number(payload.amount);
      if (amount !== undefined && !Number.isSafeInteger(amount)) throw new Error("Teen Patti wager must be a whole number of chips");
      return teenPattiAction(room.state as TeenPattiState, actorId, action as typeof teenActions[number], amount);
    }
    case "callbreak": {
      if (action === "choose-trump" && typeof payload.suit === "string") return callbreakChooseTrump(room.state as CallbreakState, actorId, payload.suit as "clubs" | "diamonds" | "hearts" | "spades");
      if (action === "pass-trump") return callbreakChooseTrump(room.state as CallbreakState, actorId, null);
      if (action === "bid" && Number.isSafeInteger(payload.bid)) return callbreakBid(room.state as CallbreakState, actorId, Number(payload.bid));
      if (action === "play" && typeof payload.cardId === "string") return callbreakPlay(room.state as CallbreakState, actorId, payload.cardId);
      if (action === "next-round" && room.hostId === actorId) return startNextCallbreakRound(room.state as CallbreakState, secureRandom);
      throw new Error("Unsupported or malformed Callbreak action");
    }
    case "rummy-13": case "rummy-10": {
      const state = room.state as RummyState;
      if (action === "draw-stock" || action === "draw-discard") return drawRummyCard(state, actorId, action === "draw-stock" ? "stock" : "discard");
      if (action === "discard" && typeof payload.cardId === "string") return discardRummyCard(state, actorId, payload.cardId, secureRandom);
      if (action === "declare") {
        const groups = z.array(z.object({ cardIds: z.array(z.string().min(1).max(64)).min(3).max(13) })).max(13).safeParse(payload.groups);
        if (groups.success) return declareRummy(state, actorId, groups.data);
      }
      throw new Error("Unsupported or malformed Rummy action");
    }
  }
}

function buildResultRows(room: Room): Array<{ roomId: string; playerId: string; gameId: string; placement: number; won: boolean; score: number }> {
  const scoreByPlayer = new Map<string, number>();
  let winnerIds: string[] = [];
  if (room.gameId === "holdem") {
    const state = room.state as HoldemState;
    for (const player of state.players) scoreByPlayer.set(player.id, player.chips - 1000);
    winnerIds = [...new Set(state.winners.map(winner => winner.playerId))];
  } else if (room.gameId === "blackjack") {
    const state = room.state as BlackjackState;
    for (const player of state.players) scoreByPlayer.set(player.id, player.chips - 10_000);
    const best = Math.max(...scoreByPlayer.values());
    if (best > 0) winnerIds = [...scoreByPlayer].filter(([, score]) => score === best).map(([id]) => id);
  } else if (room.gameId === "teen-patti") {
    const state = room.state as TeenPattiState;
    for (const player of state.players) {
      const settlement = state.settlement?.find(row => row.playerId === player.id);
      scoreByPlayer.set(player.id, settlement?.net ?? player.chips - 1000);
    }
    winnerIds = state.winnerIds ?? (state.winnerId ? [state.winnerId] : []);
  } else if (room.gameId === "callbreak") {
    const state = room.state as CallbreakState;
    for (const player of state.players) scoreByPlayer.set(player.id, player.scoreTenths);
    winnerIds = state.winnerIds ?? [];
  } else {
    const state = room.state as RummyState;
    for (const player of state.players) scoreByPlayer.set(player.id, -player.points);
    if (state.winnerId) winnerIds = [state.winnerId];
  }
  const sortedScores = [...scoreByPlayer.values()].sort((a, b) => b - a);
  return [...room.players.values()].map(player => {
    const score = scoreByPlayer.get(player.id) ?? 0;
    const placement = winnerIds.includes(player.id) ? 1 : sortedScores.findIndex(value => value === score) + 1;
    return { roomId: room.id, playerId: player.id, gameId: room.gameId, placement: Math.max(1, placement), won: winnerIds.includes(player.id), score };
  });
}

const app = Fastify({ logger: true, bodyLimit: 16 * 1024, trustProxy: false });
await app.register(helmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false });
const allowedOrigins = WEB_ORIGIN === "*" ? true : WEB_ORIGIN.split(",").map(s => s.trim());
await app.register(cors, { origin: allowedOrigins, credentials: true });
await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
await app.register(jwt, { secret: SESSION_SECRET });

if (fs.existsSync(webDistDir)) {
  await app.register(fastifyStatic, {
    root: webDistDir,
    prefix: "/",
    wildcard: false,
  });
  app.setNotFoundHandler(async (request, reply) => {
    if (request.raw.url?.startsWith("/api") || request.raw.url?.startsWith("/socket.io")) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found" } });
    }
    return reply.sendFile("index.html");
  });
}

app.get("/health", async () => ({ status: "ok", service: "cardroom-api", persistence: prisma ? (process.env.DATABASE_URL?.startsWith("file:") ? "sqlite" : "postgres-configured") : "memory-only", uptimeSeconds: Math.floor(process.uptime()) }));
app.post("/api/guest", async (request, reply) => {
  const parsed = guestSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION", message: "Choose a display name between 2 and 20 characters." } });
  const id = randomUUID(); const displayName = parsed.data.displayName;
  const token = app.jwt.sign({ sub: id, displayName }, { expiresIn: "30d" });
  if (prisma) await prisma.player.upsert({ where: { id }, create: { id, displayName }, update: { displayName } });
  return reply.code(201).send({ player: { id, displayName, avatar: "avatar-01" }, token });
});

app.addHook("preHandler", async (request, reply) => {
  if (!request.url.startsWith("/api") || request.url === "/api/guest") return;
  try { await request.jwtVerify(); } catch { return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "A valid guest session is required." } }); }
});

app.post("/api/rooms", async (request, reply) => {
  const parsed = createRoomSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Invalid room options." } });
  const owner = request.user as AuthUser;
  const data = parsed.data; const id = randomUUID(); const code = makeCode();
  const player: Player = { id: owner.sub, displayName: data.displayName, avatar: "avatar-01", ready: true, connection: "connected", socketIds: new Set() };
  const gameOptions = data.gameOptions as Room["gameOptions"];
  const room: Room = { id, code, name: data.name, gameId: data.gameId, visibility: data.visibility, status: "waiting", hostId: owner.sub, maxPlayers: data.maxPlayers, createdAt: new Date().toISOString(), ...(data.password ? { passwordHash: hashRoomPassword(data.password) } : {}), ...(gameOptions ? { gameOptions } : {}), players: new Map([[owner.sub, player]]), seq: 0, lastSeqByPlayer: new Map(), idempotency: new Set(), queue: Promise.resolve(), chat: [] };
  rooms.set(id, room); roomByCode.set(code, id);
  if (prisma) {
    await prisma.player.upsert({ where: { id: owner.sub }, create: { id: owner.sub, displayName: data.displayName }, update: { displayName: data.displayName } });
    await prisma.room.create({ data: { id, code, name: data.name, gameId: data.gameId, visibility: data.visibility, hostId: owner.sub, maxPlayers: data.maxPlayers, ...(room.passwordHash ? { passwordHash: room.passwordHash } : {}), ...(room.gameOptions ? { settingsJson: room.gameOptions as unknown as Prisma.InputJsonValue } : {}), players: { create: { playerId: owner.sub, isHost: true, ready: true, connection: "connected" } } } });
  }
  return reply.code(201).send({ room: roomSummary(room) });
});

app.get("/api/rooms/public", async (request, reply) => {
  const parsed = z.object({ gameId: gameIdSchema.optional() }).safeParse(request.query);
  if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION", message: "Invalid game filter." } });
  const publicRooms = [...rooms.values()]
    .filter(room => room.visibility === "public" && room.status === "waiting" && room.players.size < room.maxPlayers && (!parsed.data.gameId || room.gameId === parsed.data.gameId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50)
    .map(roomSummary);
  return { rooms: publicRooms };
});

app.get("/api/rooms/:code", async (request, reply) => {
  const code = (request.params as { code: string }).code.toUpperCase(); const room = getRoomByCode(code);
  if (!room || (room.visibility === "private" && !room.players.has((request.user as AuthUser).sub))) return reply.code(404).send({ error: { code: "ROOM_NOT_FOUND", message: "Room not found." } });
  return { room: roomSummary(room) };
});

app.post("/api/rooms/:code/join", async (request, reply) => {
  const code = (request.params as { code: string }).code.toUpperCase(); const room = getRoomByCode(code);
  if (!room) return reply.code(404).send({ error: { code: "ROOM_NOT_FOUND", message: "That room code does not exist." } });
  const parsed = joinRoomSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Invalid join details." } });
  const user = request.user as AuthUser;
  if (room.status !== "waiting") return reply.code(409).send({ error: { code: "ROOM_STARTED", message: "This game has already started." } });
  if (room.players.has(user.sub)) return { room: roomSummary(room) };
  if (room.players.size >= room.maxPlayers) return reply.code(409).send({ error: { code: "ROOM_FULL", message: "This room is full." } });
  if (room.visibility === "private" && room.passwordHash && (!parsed.data.password || !verifyRoomPassword(parsed.data.password, room.passwordHash))) return reply.code(403).send({ error: { code: "INVALID_PASSWORD", message: "The room password is incorrect." } });
  const player: Player = { id: user.sub, displayName: parsed.data.displayName, avatar: "avatar-01", ready: false, connection: "connected", socketIds: new Set() };
  room.players.set(user.sub, player);
  if (prisma) {
    await prisma.player.upsert({ where: { id: user.sub }, create: { id: user.sub, displayName: parsed.data.displayName }, update: { displayName: parsed.data.displayName } });
    await prisma.roomPlayer.create({ data: { roomId: room.id, playerId: user.sub, ready: false, connection: "connected" } });
  }
  io.to(room.id).emit("room:updated", roomSummary(room));
  return { room: roomSummary(room) };
});

app.post("/api/rooms/:code/remove-player", async (request, reply) => {
  const code = (request.params as { code: string }).code.toUpperCase();
  const room = getRoomByCode(code);
  if (!room) return reply.code(404).send({ error: { code: "ROOM_NOT_FOUND", message: "That room code does not exist." } });
  const parsed = z.object({ playerId: z.string().uuid() }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: { code: "VALIDATION", message: "Choose a player to remove." } });
  const user = request.user as AuthUser;
  if (room.hostId !== user.sub) return reply.code(403).send({ error: { code: "HOST_ONLY", message: "Only the host can remove players." } });
  if (room.status !== "waiting") return reply.code(409).send({ error: { code: "ROOM_STARTED", message: "Players can only be removed before the game starts." } });
  if (parsed.data.playerId === room.hostId) return reply.code(400).send({ error: { code: "HOST_CANNOT_BE_REMOVED", message: "The host cannot remove themselves." } });
  const player = room.players.get(parsed.data.playerId);
  if (!player) return reply.code(404).send({ error: { code: "PLAYER_NOT_FOUND", message: "That player is no longer in the room." } });

  if (prisma) await prisma.roomPlayer.deleteMany({ where: { roomId: room.id, playerId: player.id } });
  room.players.delete(player.id);
  for (const socketId of player.socketIds) {
    const playerSocket = io.sockets.sockets.get(socketId);
    if (playerSocket) {
      playerSocket.emit("room:removed", { code: room.code, message: "The host removed you from the room." });
      await playerSocket.leave(room.id);
    }
  }
  io.to(room.id).emit("room:updated", roomSummary(room));
  return { room: roomSummary(room) };
});

app.get("/api/profile", async request => {
  const user = request.user as AuthUser;
  const player = prisma ? await prisma.player.findUnique({ where: { id: user.sub }, include: { results: true } }) : null;
  return { player: { id: user.sub, displayName: player?.displayName ?? user.displayName, avatar: player?.avatar ?? "avatar-01" }, stats: { gamesPlayed: player?.results.length ?? 0, wins: player?.results.filter(r => r.won).length ?? 0 } };
});

app.get("/api/rooms/:code/results", async (request, reply) => {
  const code = (request.params as { code: string }).code.toUpperCase();
  const room = getRoomByCode(code); const user = request.user as AuthUser;
  if (!room || !room.players.has(user.sub)) return reply.code(404).send({ error: { code: "ROOM_NOT_FOUND", message: "Room not found." } });
  if (room.status !== "finished") return reply.code(409).send({ error: { code: "RESULTS_PENDING", message: "This game has not finished yet." } });
  if (prisma) {
    const rows = await prisma.gameResult.findMany({ where: { roomId: room.id }, include: { player: true }, orderBy: [{ createdAt: "desc" }, { placement: "asc" }, { score: "desc" }] });
    const latest = new Map<string, typeof rows[number]>();
    for (const row of rows) if (!latest.has(row.playerId)) latest.set(row.playerId, row);
    const results = [...latest.values()].sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99) || b.score - a.score);
    return { room: roomSummary(room), results: results.map(r => ({ playerId: r.playerId, displayName: r.player.displayName, placement: r.placement ?? 99, won: r.won, score: r.score })) };
  }
  const names = new Map([...room.players.values()].map(p => [p.id, p.displayName]));
  return { room: roomSummary(room), results: buildResultRows(room).map(r => ({ ...r, displayName: names.get(r.playerId) ?? "Player" })) };
});

const allowedOriginSet = new Set(Array.isArray(allowedOrigins) ? allowedOrigins : []);
const io = new SocketServer(app.server, {
  cors: { origin: allowedOrigins === true ? true : [...allowedOriginSet], credentials: true }, maxHttpBufferSize: 16 * 1024,
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    callback(null, !origin || allowedOrigins === true || allowedOriginSet.has(origin));
  },
});
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (typeof token !== "string" || token.length > 4096) return next(new Error("Unauthorized"));
  try { const user = app.jwt.verify<AuthUser>(token); socket.data.user = user; next(); }
  catch { next(new Error("Unauthorized")); }
});

io.on("connection", socket => {
  const user = socket.data.user as AuthUser;
  const actionTimes: number[] = [];
  socket.on("room:subscribe", async (raw: unknown, ack?: (value: unknown) => void) => {
    const parsed = z.object({ code: z.string().regex(/^[A-Z0-9]{6}$/i) }).safeParse(raw);
    if (!parsed.success) return ack?.({ ok: false, error: "Invalid room code" });
    const room = getRoomByCode(parsed.data.code);
    if (!room || !room.players.has(user.sub)) return ack?.({ ok: false, error: "Room not found or access denied" });
    roomPlayer(room, user.sub).socketIds.add(socket.id); roomPlayer(room, user.sub).connection = "connected";
    if (prisma) await prisma.roomPlayer.updateMany({ where: { roomId: room.id, playerId: user.sub }, data: { connection: "connected" } });
    await socket.join(room.id);
    socket.emit("room:updated", roomSummary(room));
    socket.emit("game:state", { seq: room.seq, state: publicGameState(room, user.sub) });
    io.to(room.id).emit("room:updated", roomSummary(room));
    ack?.({ ok: true });
  });
  socket.on("room:ready", async (raw: unknown, ack?: (value: unknown) => void) => {
    const parsed = z.object({ ready: z.boolean() }).safeParse(raw); if (!parsed.success) return ack?.({ ok: false, error: "Invalid ready status" });
    const room = [...rooms.values()].find(r => r.players.has(user.sub) && r.players.get(user.sub)!.socketIds.has(socket.id));
    if (!room || room.status !== "waiting") return ack?.({ ok: false, error: "Room is unavailable" });
    roomPlayer(room, user.sub).ready = parsed.data.ready;
    if (prisma) await prisma.roomPlayer.update({ where: { roomId_playerId: { roomId: room.id, playerId: user.sub } }, data: { ready: parsed.data.ready, connection: "connected" } });
    io.to(room.id).emit("room:updated", roomSummary(room)); ack?.({ ok: true });
  });
  socket.on("room:start", async (_raw: unknown, ack?: (value: unknown) => void) => {
    const room = [...rooms.values()].find(r => r.players.has(user.sub) && r.players.get(user.sub)!.socketIds.has(socket.id));
    if (!room) return ack?.({ ok: false, error: "Room is unavailable" });
    try {
      await queueRoom(room, async () => {
        if (room.hostId !== user.sub) throw new Error("Only the host can start the game");
        if (room.status !== "waiting") throw new Error("Game has already started");
        const minPlayers = room.gameId === "blackjack" ? 1 : room.gameId === "callbreak" ? 4 : 2;
        if (room.players.size < minPlayers) throw new Error(`This game requires at least ${minPlayers} players`);
        if ([...room.players.values()].some(p => !p.ready)) throw new Error("Every player must be ready");
        const previousState = room.state; const previousStatus = room.status; const previousSeq = room.seq;
        room.state = startEngine(room);
        room.status = (room.state as { status?: string }).status === "complete" ? "finished" : "playing";
        room.seq += 1;
        try {
          if (prisma) await prisma.$transaction(async tx => {
            await tx.room.update({ where: { id: room.id }, data: { status: room.status, seq: room.seq, stateJson: JSON.parse(JSON.stringify(room.state)) } });
            if (room.status === "finished") await tx.gameResult.createMany({ data: buildResultRows(room) });
          });
        } catch (error) {
          room.state = previousState; room.status = previousStatus; room.seq = previousSeq; throw error;
        }
        broadcastGameState(room);
      });
      ack?.({ ok: true });
    } catch (error) { ack?.({ ok: false, error: error instanceof Error ? error.message : "Unable to start game" }); }
  });
  socket.on("game:action", async (raw: unknown, ack?: (value: unknown) => void) => {
    const now = Date.now();
    while (actionTimes.length && now - actionTimes[0]! > 10_000) actionTimes.shift();
    if (actionTimes.length >= 30) return ack?.({ ok: false, error: "Action rate limit reached" });
    actionTimes.push(now);
    const parsed = actionEnvelopeSchema.safeParse(raw);
    if (!parsed.success) return ack?.({ ok: false, error: "Malformed game action" });
    const room = [...rooms.values()].find(r => r.players.has(user.sub) && r.players.get(user.sub)!.socketIds.has(socket.id));
    if (!room) return ack?.({ ok: false, error: "Room is unavailable" });
    try {
      const result = await queueRoom(room, async () => {
        const isBlackjackNextRound = room.gameId === "blackjack" && room.status === "finished" && parsed.data.action === "next-round";
        const isTeenPattiNextRound = room.gameId === "teen-patti" && room.status === "finished" && parsed.data.action === "next-round";
        if (room.status !== "playing" && !isBlackjackNextRound && !isTeenPattiNextRound) throw new Error("Game is not active");
        if (room.idempotency.has(parsed.data.idempotencyKey)) return { duplicate: true, seq: room.seq };
        const previousSeq = room.lastSeqByPlayer.get(user.sub) ?? -1;
        if (parsed.data.seq <= previousSeq) throw new Error("Stale action sequence");
        const before = room.state; const previousStatus = room.status; const previousRoomSeq = room.seq;
        const previousActorSeq = room.lastSeqByPlayer.get(user.sub);
        room.state = dispatchAction(room, user.sub, parsed.data.action, parsed.data.payload);
        room.seq += 1; room.lastSeqByPlayer.set(user.sub, parsed.data.seq); room.idempotency.add(parsed.data.idempotencyKey);
        const state = room.state as { status?: string };
        if (state.status === "complete") room.status = "finished";
        else if ((room.gameId === "blackjack" && state.status === "betting") || isTeenPattiNextRound) room.status = "playing";
        try {
          if (prisma) {
            const eventPayload = { ...parsed.data.payload, _idempotencyKey: parsed.data.idempotencyKey, _actorSeq: parsed.data.seq } as Prisma.InputJsonValue;
            await prisma.$transaction(async tx => {
              await tx.room.update({ where: { id: room.id }, data: { status: room.status, seq: room.seq, stateJson: JSON.parse(JSON.stringify(room.state)) } });
              await tx.gameEvent.create({ data: { roomId: room.id, seq: room.seq, actorId: user.sub, type: parsed.data.action, payload: eventPayload } });
              if (room.status === "finished") await tx.gameResult.createMany({ data: buildResultRows(room) });
            });
          }
        } catch (error) {
          room.state = before; room.status = previousStatus; room.seq = previousRoomSeq; room.idempotency.delete(parsed.data.idempotencyKey);
          if (previousActorSeq === undefined) room.lastSeqByPlayer.delete(user.sub); else room.lastSeqByPlayer.set(user.sub, previousActorSeq);
          throw error;
        }
        broadcastGameState(room);
        return { duplicate: false, seq: room.seq, previousStatus: (before as { status?: string } | undefined)?.status };
      });
      ack?.({ ok: true, ...result });
    } catch (error) { ack?.({ ok: false, error: error instanceof Error ? error.message : "Action rejected" }); }
  });
  socket.on("room:chat", (raw: unknown, ack?: (value: unknown) => void) => {
    const parsed = chatSchema.safeParse(raw); if (!parsed.success) return ack?.({ ok: false, error: "Message must be 1–300 characters" });
    const room = [...rooms.values()].find(r => r.players.has(user.sub) && r.players.get(user.sub)!.socketIds.has(socket.id));
    if (!room) return ack?.({ ok: false, error: "Room is unavailable" });
    if (room.chat.filter(m => m.playerId === user.sub && Date.now() - new Date(m.createdAt).getTime() < 10_000).length >= 8) return ack?.({ ok: false, error: "Chat rate limit reached" });
    const message = { id: randomUUID(), playerId: user.sub, displayName: roomPlayer(room, user.sub).displayName, text: parsed.data.text, createdAt: new Date().toISOString() };
    room.chat.push(message); if (room.chat.length > 100) room.chat.shift(); io.to(room.id).emit("room:chat", message); ack?.({ ok: true });
  });
  socket.on("room:leave", async (ack?: (value: unknown) => void) => {
    const room = [...rooms.values()].find(r => r.players.has(user.sub) && r.players.get(user.sub)!.socketIds.has(socket.id));
    if (!room) return ack?.({ ok: true });
    const player = roomPlayer(room, user.sub); player.socketIds.delete(socket.id);
    if (player.socketIds.size === 0 && room.status !== "playing") {
      room.players.delete(user.sub);
      const hostChanged = room.hostId === user.sub;
      if (hostChanged) room.hostId = room.players.keys().next().value ?? "";
      if (prisma) {
        await prisma.roomPlayer.deleteMany({ where: { roomId: room.id, playerId: user.sub } });
        if (hostChanged && room.hostId) await prisma.$transaction([
          prisma.room.update({ where: { id: room.id }, data: { hostId: room.hostId } }),
          prisma.roomPlayer.updateMany({ where: { roomId: room.id }, data: { isHost: false } }),
          prisma.roomPlayer.updateMany({ where: { roomId: room.id, playerId: room.hostId }, data: { isHost: true } }),
        ]);
      }
      if (room.players.size === 0) { rooms.delete(room.id); roomByCode.delete(room.code); if (prisma) await prisma.room.delete({ where: { id: room.id } }); }
    } else if (player.socketIds.size === 0) {
      player.connection = "disconnected";
      if (prisma) await prisma.roomPlayer.updateMany({ where: { roomId: room.id, playerId: user.sub }, data: { connection: "disconnected" } });
    }
    await socket.leave(room.id); io.to(room.id).emit("room:updated", roomSummary(room)); ack?.({ ok: true });
  });
  socket.on("disconnect", () => {
    for (const room of rooms.values()) {
      const player = room.players.get(user.sub); if (!player) continue;
      player.socketIds.delete(socket.id);
      if (player.socketIds.size === 0) {
        player.connection = "disconnected";
        if (prisma) void prisma.roomPlayer.updateMany({ where: { roomId: room.id, playerId: user.sub }, data: { connection: "disconnected" } }).catch(error => app.log.warn({ error }, "Unable to persist disconnect state"));
      }
      io.to(room.id).emit("room:updated", roomSummary(room));
    }
  });
});

function broadcastGameState(room: Room): void {
  io.to(room.id).emit("room:updated", roomSummary(room));
  for (const [playerId, player] of room.players) for (const socketId of player.socketIds) io.to(socketId).emit("game:state", { seq: room.seq, state: publicGameState(room, playerId) });
}
async function restorePersistedRooms(): Promise<void> {
  if (!prisma) return;
  const saved = await prisma.room.findMany({ include: { players: { include: { player: true } } } }) as unknown as Array<Prisma.RoomGetPayload<{ include: { players: { include: { player: true } } } }> & { settingsJson: Prisma.JsonValue | null }>;
  for (const row of saved) {
    const players = new Map<PlayerId, Player>();
    for (const membership of row.players) players.set(membership.playerId, {
      id: membership.playerId, displayName: membership.player.displayName, avatar: membership.player.avatar,
      ready: membership.ready, connection: "disconnected", socketIds: new Set(),
    });
    const events = await prisma.gameEvent.findMany({ where: { roomId: row.id }, orderBy: { seq: "desc" }, take: 2000 });
    const lastSeqByPlayer = new Map<PlayerId, number>();
    const idempotency = new Set<string>();
    for (const event of events) {
      const payload = event.payload as { _idempotencyKey?: unknown; _actorSeq?: unknown };
      if (typeof payload._idempotencyKey === "string") idempotency.add(payload._idempotencyKey);
      if (typeof payload._actorSeq === "number" && Number.isSafeInteger(payload._actorSeq)) {
        lastSeqByPlayer.set(event.actorId, Math.max(lastSeqByPlayer.get(event.actorId) ?? -1, payload._actorSeq));
      }
    }
    const room: Room = {
      id: row.id, code: row.code, name: row.name, gameId: row.gameId as GameId,
      visibility: row.visibility as "public" | "private", status: row.status as Room["status"],
      hostId: row.hostId, maxPlayers: row.maxPlayers, createdAt: row.createdAt.toISOString(),
      ...(row.passwordHash ? { passwordHash: row.passwordHash } : {}),
      ...(row.settingsJson ? { gameOptions: row.settingsJson as unknown as NonNullable<Room["gameOptions"]> } : {}), players,
      ...(row.stateJson ? { state: row.stateJson } : {}), seq: row.seq,
      lastSeqByPlayer, idempotency, queue: Promise.resolve(), chat: [],
    };
    rooms.set(room.id, room); roomByCode.set(room.code, room.id);
  }
  app.log.info({ recoveredRooms: saved.length }, "Persisted rooms loaded");
}

const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - 4 * 60 * 60 * 1000;
  for (const room of rooms.values()) {
    if (room.status === "waiting" && room.players.size === 0 && new Date(room.createdAt).getTime() < cutoff) {
      rooms.delete(room.id); roomByCode.delete(room.code);
      if (prisma) void prisma.room.deleteMany({ where: { id: room.id } });
    }
  }
}, 15 * 60 * 1000);
cleanupTimer.unref();
const close = async () => { clearInterval(cleanupTimer); await io.close(); await app.close(); if (prisma) await prisma.$disconnect(); };
process.on("SIGINT", () => { void close().then(() => process.exit(0)); });
process.on("SIGTERM", () => { void close().then(() => process.exit(0)); });

if (prisma) await prisma.$connect();
await restorePersistedRooms();
await app.listen({ port: PORT, host: "0.0.0.0" });
app.log.info(`Cardroom API listening on ${PORT}`);
