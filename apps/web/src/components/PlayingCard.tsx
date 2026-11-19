import type { PlayingCard as PlayingCardType } from "@cardroom/shared/cards";
import { motion } from "framer-motion";
import { useSessionStore } from "../store/session";
import { playUiSound } from "../sound";

const suits = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" } as const;
const rank = (value: number) => value <= 10 ? String(value) : ({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[value];
interface Props { card?: PlayingCardType; hidden?: boolean; selected?: boolean; disabled?: boolean; onClick?: () => void; small?: boolean; index?: number; dealIn?: boolean; soundOnSelect?: boolean }
export function PlayingCard({ card, hidden, selected, disabled, onClick, small, index = 0, dealIn = false, soundOnSelect = true }: Props) {
  const style = useSessionStore(s => s.preferences.cardStyle);
  const reducedMotion = useSessionStore(s => s.preferences.reducedMotion);
  const dealInitial = dealIn && !reducedMotion ? { opacity: 0, y: -16, rotateY: 72, scale: 0.94 } : false;
  if (hidden || !card) return <motion.div className={`playing-card card-back ${small ? "small" : ""}`} aria-label="Face-down card" initial={dealInitial} animate={{ opacity: 1, y: 0, rotateY: 0, scale: 1 }} transition={{ duration: reducedMotion ? 0 : 0.36, delay: dealIn ? Math.min(index * .075, .38) : 0, ease: [0.22, 1, 0.36, 1] }}><div className="card-back-pattern"><span>✦</span></div></motion.div>;
  if (card.joker) return <motion.button type="button" className={`playing-card joker-card ${small ? "small" : ""} ${selected ? "selected" : ""}`} disabled={disabled} onClick={() => { if (soundOnSelect) playUiSound("card"); onClick?.(); }} aria-label="Joker" whileHover={!disabled && !reducedMotion ? { y: -5 } : undefined} initial={dealInitial} animate={{ opacity: 1, y: 0, rotateY: 0, scale: 1 }} transition={{ duration: reducedMotion ? 0 : dealIn ? .38 : .16, delay: dealIn ? Math.min(index * .075, .38) : 0, ease: [0.22, 1, 0.36, 1] }}><span>JOKER</span><b>✦</b></motion.button>;
  const red = card.suit === "hearts" || card.suit === "diamonds";
  return <motion.button type="button" className={`playing-card ${red ? "red" : "black"} ${selected ? "selected" : ""} ${disabled ? "disabled" : ""} ${small ? "small" : ""} ${style === "midnight" ? "midnight-card" : ""}`} onClick={() => { if (soundOnSelect) playUiSound("card"); onClick?.(); }} disabled={disabled || !onClick} aria-label={`${rank(card.rank)} of ${card.suit}`} whileHover={onClick && !disabled && !reducedMotion ? { y: -7, rotate: (index % 2 ? 1 : -1) * 1.5 } : undefined} whileTap={onClick && !disabled && !reducedMotion ? { scale: 0.955, y: -2 } : undefined} initial={dealInitial} animate={{ opacity: 1, y: 0, rotateY: 0, scale: 1 }} transition={{ duration: reducedMotion ? 0 : dealIn ? .38 : .16, delay: dealIn ? Math.min(index * .075, .38) : 0, ease: [0.22, 1, 0.36, 1] }}>
    <span className="card-corner"><b>{rank(card.rank)}</b><i>{suits[card.suit]}</i></span>
    <span className="card-center">{suits[card.suit]}</span>
    <span className="card-corner bottom"><b>{rank(card.rank)}</b><i>{suits[card.suit]}</i></span>
  </motion.button>;
}
