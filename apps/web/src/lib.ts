import type { GameId, RoomSummary } from "@cardroom/shared/contracts";
import { useSessionStore } from "./store/session";

export const API_URL = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:4000");
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = useSessionStore.getState().session?.token;
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error?.message ?? `Request failed (${response.status})`);
  return result as T;
}
export async function ensureGuest(displayName: string): Promise<void> {
  const current = useSessionStore.getState().session;
  if (current) return;
  const response = await api<{ player: { id: string; displayName: string; avatar: string }; token: string }>("/api/guest", { method: "POST", body: JSON.stringify({ displayName }) });
  useSessionStore.getState().setSession({ ...response.player, token: response.token });
}
export function getGameTitle(gameId: GameId): string {
  return ({ blackjack: "Blackjack", holdem: "Texas Hold’em", "teen-patti": "Teen Patti", callbreak: "Callbreak", "rummy-13": "13-card Rummy", "rummy-10": "10-card Rummy" })[gameId];
}
export function inviteUrl(room: RoomSummary): string { return `${window.location.origin}/join/${room.code}`; }
export function formatChips(value: number): string { return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value); }
export function messageFrom(error: unknown): string { return error instanceof Error ? error.message : "Something went wrong. Please try again."; }
