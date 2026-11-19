export const SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;
export type Suit = (typeof SUITS)[number];
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
export type Card = Readonly<{ id: string; suit: Suit; rank: Rank; joker?: false }>;
export type JokerCard = Readonly<{ id: string; suit: null; rank: 0; joker: true }>;
export type PlayingCard = Card | JokerCard;
export type RandomSource = () => number;

export function createDeck(options: { jokers?: number; decks?: number } = {}): PlayingCard[] {
  const decks = Math.max(1, Math.floor(options.decks ?? 1));
  const cards: PlayingCard[] = [];
  for (let deck = 0; deck < decks; deck += 1) {
    for (const suit of SUITS) {
      for (let value = 2; value <= 14; value += 1) {
        const rank = value as Rank;
        cards.push({ id: `${deck}-${suit}-${rank}`, suit, rank });
      }
    }
    for (let joker = 0; joker < (options.jokers ?? 0); joker += 1) {
      cards.push({ id: `${deck}-joker-${joker}`, suit: null, rank: 0, joker: true });
    }
  }
  return cards;
}

export function shuffle<T>(items: readonly T[], random: RandomSource = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new RangeError("Random source must return values in [0, 1)");
    const j = Math.floor(sample * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

export function secureRandom(): number {
  const bytes = new Uint32Array(1);
  globalThis.crypto.getRandomValues(bytes);
  return bytes[0]! / 0x1_0000_0000;
}

export function draw<T>(deck: readonly T[], count = 1): { drawn: T[]; remaining: T[] } {
  if (!Number.isInteger(count) || count < 0 || count > deck.length) throw new RangeError("Invalid draw count");
  return { drawn: deck.slice(0, count), remaining: deck.slice(count) };
}

export function cardLabel(card: PlayingCard): string {
  if (card.joker) return "Joker";
  const rank = card.rank <= 10 ? String(card.rank) : ({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[card.rank];
  return `${rank}${({ clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" } as const)[card.suit]}`;
}

export function compareCards(a: Card, b: Card): number {
  return a.rank - b.rank || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
}
