# Eurovision 2026 Polymarket Trade Watcher

A live dashboard for large and suspicious trades on Polymarket's Eurovision 2026 markets. Subscribes to Polymarket's real-time data stream, flags noteworthy fills as they happen, and broadcasts them to a browser dashboard and (optionally) Telegram.

## What it does

- Subscribes to Polymarket's RTDS WebSocket for ~13 Eurovision 2026 event slugs — Grand Final, jury/televote, top-3/5/10, placements, semi-finals, and a couple of prop markets. The full list lives in [config/eurovision.config.ts](config/eurovision.config.ts).
- Flags every incoming trade against three rules:
  - **Size** — single trade ≥ $5,000 notional **or** ≥ 25,000 shares.
  - **Cluster** — ≥ 4 trades on the same `(conditionId, outcomeIndex, side)` inside a rolling 10-minute window, totaling ≥ $7,500. A crowd signal.
  - **Spree** — one wallet making ≥ 3 trades on the same position inside 10 minutes, totaling ≥ $5,000. A conviction signal.
- Persists trades and flags to SQLite via Prisma; streams them live to the dashboard over Server-Sent Events.
- Optional Telegram alerts and in-browser sound for `big` (≥ $50k) trades.

## Architecture

| Path | Role |
| --- | --- |
| [src/instrumentation.ts](src/instrumentation.ts) | Boots the watcher when Next.js starts. |
| [src/lib/watcher/rtds.ts](src/lib/watcher/rtds.ts) | WebSocket client for Polymarket RTDS. |
| [src/lib/watcher/flagger.ts](src/lib/watcher/flagger.ts) | Size / cluster / spree rules. |
| [src/lib/watcher/broker.ts](src/lib/watcher/broker.ts) | In-memory pub/sub feeding the SSE stream. |
| [src/lib/watcher/index.ts](src/lib/watcher/index.ts) | Orchestrator: Gamma lookup, hydration, ingest, persist, alert. |
| [src/app/api/feed/stream/route.ts](src/app/api/feed/stream/route.ts) | SSE endpoint the dashboard subscribes to. |
| [src/app/page.tsx](src/app/page.tsx) | Dashboard UI — live ticker + flagged-trade list. |
| [prisma/schema.prisma](prisma/schema.prisma) | `Market`, `Trade`, `FlaggedTrade` models. |
| [config/eurovision.config.ts](config/eurovision.config.ts) | Event slugs, `FLAG_THRESHOLDS`, ticker settings. |

## Tech stack

- Next.js 15 (App Router) + React 19 + TypeScript 5.7
- Prisma 5 + SQLite
- `@polymarket/real-time-data-client` 1.4
- Tailwind 3, Zod 3, Vitest 2
- pnpm 10.33

## Prerequisites

- Node.js 18 or newer
- pnpm — easiest via Corepack:
  ```bash
  corepack enable
  corepack prepare pnpm@10.33.0 --activate
  ```

## Quick start

```bash
pnpm install
cp .env.example .env.local
pnpm db:push
pnpm dev
```

Then open <http://localhost:3000>. Watcher stats are at <http://localhost:3000/api/health>.

## Environment variables

All variables are validated by [src/env.ts](src/env.ts). Only `DATABASE_URL` needs to be set for local dev (and `.env.example` already does that); everything else has a sensible default.

| Variable | Purpose | Default |
| --- | --- | --- |
| `DATABASE_URL` | SQLite location. On Railway, use `file:/data/app.db` so the DB lives on the mounted volume. | `file:./dev.db` |
| `TELEGRAM_BOT_TOKEN` | Bot token from [@BotFather](https://t.me/BotFather). Enables Telegram alerts when set. | — |
| `TELEGRAM_CHAT_ID` | Recipient chat ID from [@userinfobot](https://t.me/userinfobot). Required if `TELEGRAM_BOT_TOKEN` is set. | — |
| `RTDS_HOST` | Polymarket RTDS WebSocket host. | `wss://ws-live-data.polymarket.com` |
| `GAMMA_BASE` | Polymarket Gamma API base URL (for market metadata). | `https://gamma-api.polymarket.com` |
| `NEXT_PUBLIC_POLYMARKET_BASE` | Polymarket web URL used for "open trade" links in the UI. | `https://polymarket.com` |
| `NEXT_PUBLIC_APP_NAME` | Dashboard title. | `Eurovision Watch` |
| `PORT` | HTTP port. | `3000` |

## Tuning

All tunables live in [config/eurovision.config.ts](config/eurovision.config.ts):

- **Which markets are watched** — edit `EUROVISION_MARKETS`. One RTDS subscription is opened per event slug; every child market and outcome inside that event streams through it.
- **Flag thresholds** — `FLAG_THRESHOLDS.singleTradeUsd`, `singleTradeShares`, `bigTradeUsd`, and the `cluster` / `spree` sub-objects (window, min trades, min total USD).
- **Live ticker** — `TICKER.minNotionalUsd`, `pillTtlMs`, `maxPills` control the pill strip at the top of the dashboard.

Restart `pnpm dev` after editing — the config is imported at boot.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Next.js dev server. |
| `pnpm build` | `prisma generate && next build`. |
| `pnpm start` | Run the built app on `$PORT` (defaults to 3000). |
| `pnpm db:push` | Push the Prisma schema to the SQLite file (dev workflow). |
| `pnpm db:studio` | Open Prisma Studio. |
| `pnpm lint` / `pnpm lint:fix` | ESLint. |
| `pnpm format` / `pnpm format:check` | Prettier. |
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm test` / `pnpm test:watch` | Vitest. |

## Deploying to Railway

The repo ships with [railway.json](railway.json) so a Railway service auto-detects build and start commands (NIXPACKS builder).

1. Create the service from this repo.
2. Add a **persistent volume** mounted at `/data`.
3. Set environment variables on the service:
   - `DATABASE_URL=file:/data/app.db`
   - `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` if you want alerts.
4. Deploy. Healthcheck is `/api/health` (30s timeout).

**Schema-change caveat:** the start command runs `prisma db push --accept-data-loss`. That's fine here because the cluster/spree windows re-hydrate from RTDS within ~10 minutes, but if you ever rename or drop a column in `schema.prisma`, the data on `/data` will silently drop. Switch to `prisma migrate deploy` before storing anything you can't afford to lose.

## Troubleshooting

- **Dashboard is empty / no trades.** Hit `/api/health` and confirm `rtdsConnected: true` and that the `messages` counter is climbing. If not, check that outbound WebSocket traffic to `RTDS_HOST` is allowed by your network.
- **No Telegram messages.** Both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` must be set. You also need to have messaged the bot at least once so it can DM you back.
- **DB locked or schema mismatch in dev.** Easiest reset: `rm dev.db && pnpm db:push`.

## License

No license file is included — treat the code as all-rights-reserved until one is added.
