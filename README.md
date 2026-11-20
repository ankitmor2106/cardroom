# Cardroom

Multiplayer card platform — Blackjack, Texas Hold'em, Teen Patti, Callbreak, 13-card Indian Rummy, and 10-card 3-3-4 Rummy.

Built with Node.js (Fastify + Socket.IO) + React (Vite PWA). The server serves the frontend directly — single process, single port, no Nginx required.

## Quick start (local dev)

```bash
cp .env.example .env
npm install
npm run db:generate
npm run db:push    # creates the SQLite database
npm run dev        # API + Vite at http://localhost:5173
```

> Leave `DATABASE_URL` unset in `.env` to run fully in-memory (no database needed).

## Deploy with Docker

```bash
cp .env.example .env
# Edit .env: set a strong SESSION_SECRET (32+ chars)
docker compose up -d --build
```

App is live at **http://localhost:4000**. Point a domain and reverse-proxy at that port.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SESSION_SECRET` | Yes (prod) | 32+ char random string — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DATABASE_URL` | No | `file:./data/cardroom.db` for SQLite. Omit for in-memory. |
| `PORT` | No | Defaults to `4000` |
| `WEB_ORIGIN` | No | CORS origin, defaults to `*` |
| `NODE_ENV` | No | Set to `production` in prod |

## Commands

```bash
npm run dev              # local dev (web + server in parallel)
npm run build            # build all workspaces
npm run typecheck        # TypeScript check across monorepo
npm run test:unit        # 60 game-engine unit tests
npm run test:engine-smoke # rule-engine smoke suite
npm run lint             # ESLint across apps and packages
npm run db:generate      # regenerate Prisma client
npm run db:push          # sync schema to SQLite (dev only)
npm run db:deploy        # apply migrations (production)
```

## Architecture

```
apps/web      React + Vite PWA (served by Fastify in production)
apps/server   Fastify API + Socket.IO room coordinator
packages/
  shared        Card primitives, game state types, game engines
  game-engines  Pure game rules, bots, deterministic tests
  validation    Shared Zod schemas
scripts/        Rule-engine smoke test runners
```

All game engines are pure TypeScript shared between client and server — no rewrite needed if the runtime changes.

## Table UI and Teen Patti room settings

The multiplayer table shows each chip game's player stack beside the seat and the live pot / table wagers in the center of the felt. Game actions (bets, bids, calls, card actions, and other controls) appear in a right-hand control rail on desktop and move below the table on smaller screens. Completed hands open a dedicated results view; Callbreak opens its scorecard after each round.

When creating an online Teen Patti room, the host can configure:

- **Starting chips per player** — each player's initial virtual-chip stack.
- **Boot / starting bid** — the mandatory contribution each round.
- **Maximum pot per round** — a server-enforced hard cap. If less than a normal minimum wager remains, the final wager may fill the exact remainder and the active hands go to showdown.

The selected table size is used to validate that the pot cap can cover every seat's boot and one minimum opening wager. These room settings are visible to all players in the lobby and carry into subsequent rounds.
