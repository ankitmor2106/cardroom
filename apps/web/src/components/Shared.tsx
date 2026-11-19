import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, ChevronDown, CircleHelp, Copy, Crown, Gamepad2, Menu, Settings, Share2, ShieldCheck, Sparkles, X } from "lucide-react";
import { useSessionStore } from "../store/session";
import { GAME_CATALOG } from "@cardroom/game-engines";
import { inviteUrl } from "../lib";
import type { RoomSummary } from "@cardroom/shared/contracts";
import { playUiSound } from "../sound";

export function Header() {
  const [open, setOpen] = useState(false);
  const session = useSessionStore(s => s.session);
  return <header className="site-header">
    <div className="header-inner">
      <Link to="/" className="brand"><span className="brand-mark">✦</span><span>cardroom<span className="brand-dot">.</span></span></Link>
      <nav className="desktop-nav" aria-label="Main navigation">
        <NavLink to="/games">Games</NavLink><NavLink to="/rules">How to play</NavLink><NavLink to="/about">About</NavLink>
      </nav>
      <div className="header-actions"><Link to="/join" className="text-link hide-mobile">Join a room</Link><Link to="/create" className="button button-gold button-small">Create room <ArrowRight size={15}/></Link><Link to="/profile" className="avatar-mini" aria-label="Profile">{session?.displayName?.slice(0, 1).toUpperCase() ?? "G"}</Link>
        <button className="icon-button mobile-menu" onClick={() => setOpen(v => !v)} aria-label={open ? "Close menu" : "Open menu"}>{open ? <X/> : <Menu/>}</button>
      </div>
    </div>
    <AnimatePresence>{open && <motion.nav className="mobile-nav" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}><NavLink to="/games" onClick={() => setOpen(false)}>Games</NavLink><NavLink to="/rules" onClick={() => setOpen(false)}>How to play</NavLink><NavLink to="/join" onClick={() => setOpen(false)}>Join a room</NavLink><NavLink to="/settings" onClick={() => setOpen(false)}>Settings</NavLink></motion.nav>}</AnimatePresence>
  </header>;
}

export function Footer() { return <footer className="site-footer"><div className="footer-main"><Link to="/" className="brand"><span className="brand-mark">✦</span><span>cardroom<span className="brand-dot">.</span></span></Link><p>Good games. Great company.</p><div className="footer-links"><Link to="/rules">Game rules</Link><Link to="/settings">Settings</Link><Link to="/privacy">Privacy</Link></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Cardroom</span><span>Virtual chips only · No real-money play</span></div></footer>; }

export function PageShell({ children }: { children: ReactNode }) { return <><Header/><main className="page-main">{children}</main><Footer/></>; }

export function SectionTitle({ eyebrow, title, text, action }: { eyebrow?: string; title: string; text?: string; action?: ReactNode }) { return <div className="section-title"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2>{text && <p>{text}</p>}</div>{action}</div>; }

export function Button({ children, variant = "gold", className = "", disabled, type = "button", onClick }: { children: ReactNode; variant?: "gold" | "outline" | "ghost" | "danger"; className?: string; disabled?: boolean; type?: "button" | "submit"; onClick?: () => void }) { return <button type={type} className={`button button-${variant} ${className}`} disabled={disabled} onClick={() => { if (!disabled) { playUiSound("tap"); onClick?.(); } }}>{children}</button>; }

export function Toast({ message, onClose }: { message: string; onClose: () => void }) { useEffect(() => { const t = window.setTimeout(onClose, 3600); return () => window.clearTimeout(t); }, [message, onClose]); return <div className="toast" role="status"><span>{message}</span><button className="icon-button" onClick={onClose} aria-label="Dismiss notification"><X size={16}/></button></div>; }

export function CopyShare({ room }: { room: RoomSummary }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(inviteUrl(room)); setCopied(true); window.setTimeout(() => setCopied(false), 1500); };
  const share = async () => { const url = inviteUrl(room); if (navigator.share) await navigator.share({ title: `Join ${room.name} on Cardroom`, text: `Come play ${room.name} with me.`, url }); else await copy(); };
  return <div className="inline-actions"><Button variant="outline" onClick={() => void copy()}>{copied ? <Check size={15}/> : <Copy size={15}/>} {copied ? "Copied" : "Copy invite"}</Button><Button variant="ghost" onClick={() => void share()}><Share2 size={15}/> Share</Button></div>;
}

export function GameIcon({ id, size = "large" }: { id: string; size?: "small" | "large" }) { const icons: Record<string, string> = { blackjack: "♠", holdem: "♣", "teen-patti": "♥", callbreak: "♠", "rummy-13": "♦", "rummy-10": "✦" }; return <div className={`game-icon game-icon-${id} ${size}`}>{icons[id] ?? "✦"}</div>; }

export function GameCard({ game, featured = false }: { game: (typeof GAME_CATALOG)[number]; featured?: boolean }) { const onlineOnly = game.id === "rummy-13" || game.id === "rummy-10"; return <article className={`game-card ${featured ? "featured" : ""}`}><div className="game-card-top"><GameIcon id={game.id}/><div className="game-card-labels"><span className="complexity-pill">{game.complexity}</span>{onlineOnly && <span className="complexity-pill online-only-pill">Online only</span>}</div></div><div className="game-card-content"><h3>{game.name}</h3><p>{game.summary}</p><div className="game-card-meta"><span>{game.players} players</span><Link to={`/games/${game.id}`} className="arrow-link" aria-label={`Explore ${game.name}`}><ArrowRight size={18}/></Link></div></div></article>; }

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) { return <div className="empty-state"><div className="empty-icon"><CircleHelp size={23}/></div><h3>{title}</h3><p>{text}</p>{action}</div>; }

export function InfoStrip() { return <div className="info-strip"><span><ShieldCheck size={16}/> Virtual chips only</span><span><Sparkles size={16}/> Six classic games</span><span><Gamepad2 size={16}/> Play solo or with friends</span></div>; }
