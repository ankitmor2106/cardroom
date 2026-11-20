import type { PlayingCard } from "./cards.js";

export type GameId = "blackjack" | "holdem" | "teen-patti" | "callbreak" | "rummy-13" | "rummy-10";
export type PlayerId = string;
export type RoomVisibility = "public" | "private";
export type RoomStatus = "waiting" | "playing" | "finished";
export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

export interface TeenPattiRoomOptions {
  /** Chips issued to each player when the first round starts. */
  startingStack: number;
  /** Mandatory boot / opening blind stake for each round. */
  bootAmount: number;
  /** Hard cap for the total pot in one round. */
  maxPot: number;
}

export interface PlayerSummary {
  id: PlayerId;
  displayName: string;
  avatar: string;
  isHost: boolean;
  ready: boolean;
  connection: ConnectionStatus;
}

export interface RoomSummary {
  id: string;
  code: string;
  name: string;
  gameId: GameId;
  visibility: RoomVisibility;
  status: RoomStatus;
  hostId: PlayerId;
  players: PlayerSummary[];
  maxPlayers: number;
  createdAt: string;
  gameOptions?: { teenPatti?: TeenPattiRoomOptions };
}

export interface PublicPlayerState {
  id: PlayerId;
  displayName: string;
  avatar: string;
  chips: number;
  status?: string;
}

export interface GameEvent<TPayload = unknown> {
  id: string;
  seq: number;
  type: string;
  actorId: PlayerId;
  payload: TPayload;
  createdAt: string;
}

export interface ActionEnvelope<TPayload = unknown> {
  roomId: string;
  playerId: PlayerId;
  seq: number;
  idempotencyKey: string;
  action: string;
  payload: TPayload;
}

export interface GameSnapshot<TState = unknown> {
  roomId: string;
  gameId: GameId;
  seq: number;
  state: TState;
  yourHand?: PlayingCard[];
  players: PublicPlayerState[];
}

export interface ApiError {
  error: { code: string; message: string };
}
