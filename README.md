# PolyTape

Watch any Polymarket event for whale trades in real time.

PolyTape subscribes to Polymarket's live data stream, flags every fill that matches your size or pattern thresholds, and streams them to a browser dashboard. Point it at any set of event slugs and it works — no code changes required.

> Originally built to track Eurovision 2026 prediction market activity.

---

## What it does

- **Watches any Polymarket events** — add event slugs to `config/markets.config.ts` and restart
- **Flags three patterns:**
  - **Size** — single trade ≥ $5,000 notional or ≥ 25,000 shares
  - **Cluster** — ≥ 4 trades on the same outcome and side in a 10-minute window, totaling ≥ $7,500 (crowd signal)
  - **Spree** — one wallet making ≥ 3 trades on the same position in 10 minutes, totaling ≥ $5,000 (conviction signal)
- **Persists to SQLite** via Prisma — the last 30 minutes hydrate the flagger on restart
- **Streams flagged trades live** to the browser dashboard over Server-Sent Events
- **Optional Telegram alerts** for any flagged trade; louder sound for "big" trades (≥ $50k notional)

---

## Finding market slugs

The slug is the last path segment of the event URL on Polymarket:

```
https://polymarket.com/event/eurovision-winner-2026
                              ^^^^^^^^^^^^^^^^^^^^^^
```

Add it to `WATCHED_MARKETS` in `config/markets.config.ts`.

---

## Quick start

```bash
pnpm install
cp .env.example .env.local
pnpm db:push
pnpm dev
```

Open http://localhost:3000. Watcher diagnostics are at `/api/health`.

---

## Configuration

All configuration lives in `config/markets.config.ts`.

### Which events to watch

```ts
export const WATCHED_MARKETS: MarketRef[] = [
  { eventSlug: 'your-event-slug-here' },
  { eventSlug: 'another-event-slug' },
];
```

One subscription is opened per slug. Every child market and outcome inside that event streams through automatically. Restart after editing.

### Filter chip labels

```ts
// Tokens stripped from slugs in filter chip labels (keeps chips short).
export const SLUG_NOISE_TOKENS: string[] = ['eurovision', '2026'];
```

Update to match the common prefix/suffix in your own slugs, or set to `[]` to show raw slugs.

### Flag thresholds

`FLAG_THRESHOLDS` in the same file controls what gets flagged:

| Setting | Default | What it does |
|---|---|---|
| `singleTradeUsd` | 5,000 | Minimum notional (price × size) for a Size flag |
| `singleTradeShares` | 25,000 | Minimum share count for a Size flag (either is sufficient) |
| `bigTradeUsd` | 50,000 | Above this, severity = "big" — louder sound, bold Telegram message |
| `cluster.windowMs` | 600,000 | Rolling window for cluster detection (10 minutes) |
| `cluster.minTrades` | 4 | Minimum trade count inside the window |
| `cluster.minTotalUsd` | 7,500 | Minimum summed notional inside the window |
| `spree.windowMs` | 600,000 | Rolling window for spree detection (10 minutes) |
| `spree.minTrades` | 3 | Minimum trade count from one wallet |
| `spree.minTotalUsd` | 5,000 | Minimum summed notional from one wallet |

### Live ticker

`TICKER` controls the pill strip at the top of the dashboard:

| Setting | Default | What it does |
|---|---|---|
| `minNotionalUsd` | 50 | Minimum notional to appear in the ticker at all |
| `pillTtlMs` | 30,000 | How long each pill stays before fading (30 seconds) |
| `maxPills` | 20 | Maximum pills visible; oldest fall off first |

---

## Environment variables

Only `DATABASE_URL` is required for local dev (`.env.example` sets it already).

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | SQLite file location. On Railway, use `file:/data/app.db`. | `file:./dev.db` |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather. Enables Telegram alerts. | — |
| `TELEGRAM_CHAT_ID` | Chat ID from @userinfobot. Required if token is set. | — |
| `NEXT_PUBLIC_APP_NAME` | Dashboard title. | `PolyTape` |
| `NEXT_PUBLIC_APP_SUBTITLE` | Subtitle shown in the dashboard header. | *(generic default)* |
| `RTDS_HOST` | Polymarket RTDS WebSocket host. | `wss://ws-live-data.polymarket.com` |
| `GAMMA_BASE` | Gamma API base URL for market metadata. | `https://gamma-api.polymarket.com` |
| `NEXT_PUBLIC_POLYMARKET_BASE` | Polymarket web URL for trade links. | `https://polymarket.com` |
| `PORT` | HTTP port. | `3000` |

---

## Architecture

```
Polymarket RTDS WebSocket
        │
        ▼
  RtdsWatcher          src/lib/watcher/rtds.ts
        │
        ▼
  Orchestrator         src/lib/watcher/index.ts
   ├─ Gamma API → market metadata → SQLite (Market)
   ├─ Persist fill → SQLite (Trade)
   ├─ Flagger (size / cluster / spree) → SQLite (FlaggedTrade)
   ├─ Broker pub/sub → SSE → Dashboard
   └─ Telegram alert (optional)
```

| Path | Role |
|---|---|
| `config/markets.config.ts` | Event slugs, flag thresholds, ticker settings |
| `src/instrumentation.ts` | Boots the watcher when Next.js starts |
| `src/lib/watcher/rtds.ts` | WebSocket client for Polymarket RTDS |
| `src/lib/watcher/flagger.ts` | Size / cluster / spree detection |
| `src/lib/watcher/broker.ts` | In-memory pub/sub feeding the SSE endpoint |
| `src/lib/watcher/index.ts` | Orchestrator: resolve, persist, flag, alert |
| `src/app/api/feed/stream/route.ts` | SSE endpoint the dashboard subscribes to |
| `src/app/page.tsx` | Dashboard — live ticker strip + flagged trade list |
| `prisma/schema.prisma` | `Market`, `Trade`, `FlaggedTrade` models |

---

## Tech stack

Next.js 15 · React 19 · TypeScript 5.7 · Prisma 5 · SQLite · `@polymarket/real-time-data-client` 1.4 · Tailwind 3 · Zod 3 · Vitest 2 · pnpm 10

---

## Prerequisites

- Node.js 18+
- pnpm (via Corepack):
  ```bash
  corepack enable && corepack prepare pnpm@10.33.0 --activate
  ```

---

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | `prisma generate && next build` |
| `pnpm start` | Run the built app on `$PORT` |
| `pnpm db:push` | Push Prisma schema to the SQLite file |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest |

---

## Deploying to Railway

The repo includes `railway.json` — Railway auto-detects build and start commands via NIXPACKS.

1. Create the service from this repo
2. Add a **persistent volume** mounted at `/data`
3. Set env vars: `DATABASE_URL=file:/data/app.db`, plus Telegram and app name vars if wanted
4. Deploy — healthcheck endpoint is `/api/health` (30s timeout)

**Note:** The start command runs `prisma db push --accept-data-loss`. Fine for development; switch to `prisma migrate deploy` before storing anything you can't afford to lose.

---

## Troubleshooting

**Dashboard is empty.** Check `/api/health` — confirm `rtdsConnected: true` and that `messages` is climbing. If not, check that outbound WebSocket traffic to `RTDS_HOST` is allowed.

**Wrong events / missing markets.** Each slug must exactly match the path segment in `polymarket.com/event/<slug>`. Copy it directly from the URL.

**No Telegram messages.** Both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` must be set. You also need to have sent the bot at least one message first.

**DB locked or schema mismatch in dev.** `rm dev.db && pnpm db:push`.
