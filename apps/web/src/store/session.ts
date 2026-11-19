import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface GuestSession { id: string; displayName: string; avatar: string; token: string }
export interface Preferences { sound: boolean; effectsVolume: number; reducedMotion: boolean; cardStyle: "classic" | "midnight"; theme: "dark" | "light" }
interface SessionStore {
  session: GuestSession | null;
  preferences: Preferences;
  setSession: (session: GuestSession) => void;
  setPreferences: (preferences: Partial<Preferences>) => void;
  clearSession: () => void;
}
const defaults: Preferences = { sound: false, effectsVolume: 55, reducedMotion: false, cardStyle: "classic", theme: "dark" };
export const useSessionStore = create<SessionStore>()(persist((set) => ({
  session: null, preferences: defaults,
  setSession: (session) => set({ session }),
  setPreferences: (preferences) => set(state => ({ preferences: { ...state.preferences, ...preferences } })),
  clearSession: () => set({ session: null }),
}), { name: "cardroom-session", storage: createJSONStorage(() => localStorage), partialize: state => ({ session: state.session, preferences: state.preferences }) }));
