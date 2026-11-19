export * from "@cardroom/shared/cards";
export * from "@cardroom/shared/games/blackjack";
export * from "@cardroom/shared/games/holdem";
export * from "@cardroom/shared/games/teenPatti";
export * from "@cardroom/shared/games/callbreak";
export * from "@cardroom/shared/games/rummy";

import type { GameId } from "@cardroom/shared/contracts";

export const GAME_CATALOG: Array<{ id: GameId; name: string; players: string; complexity: string; summary: string }> = [
  { id: "blackjack", name: "Blackjack", players: "1–9", complexity: "Easy to learn", summary: "Beat the dealer without going over 21." },
  { id: "holdem", name: "Texas Hold’em", players: "2–9", complexity: "Strategic", summary: "Build the best five-card hand and manage the pot." },
  { id: "teen-patti", name: "Teen Patti", players: "2–6", complexity: "Easy to learn", summary: "Three-card ranking with blind and seen play." },
  { id: "callbreak", name: "Callbreak", players: "4", complexity: "Strategic", summary: "Bid tricks, follow suit, and use spades as trump." },
  { id: "rummy-13", name: "13-card Rummy", players: "2–6", complexity: "Strategic", summary: "Arrange 13 cards into sequences and sets." },
  { id: "rummy-10", name: "10-card Rummy · 3-3-4", players: "2–6", complexity: "Variant", summary: "Form exactly three same-rank sets sized 3, 3, and 4." },
];
export * from "./bots.js";
export * from "@cardroom/shared/games/blackjack-companion";
export * from "@cardroom/shared/games/teen-patti-companion";
export * from "@cardroom/shared/games/callbreak-companion";
