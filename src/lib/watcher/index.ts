import { WATCHED_MARKETS, TICKER } from '@config/markets.config';

import { prisma } from '@/lib/db';
import { sendTelegram } from '@/lib/notify/telegram';
import { resolveEvent } from '@/lib/polymarket/gamma';

import { broker, type FlaggedFeedItem } from './broker';
import { Flagger, type TradeRecord } from './flagger';
import { RtdsWatcher, type RtdsCounters, type RtdsTrade } from './rtds';

type WatcherState = {
  started: boolean;
  watcher: RtdsWatcher | null;
  flagger: Flagger | null;
  subscribedSlugs: string[];
  conditionContext: Map<
    string,
    { eventSlug: string; marketSlug: string; question: string; title: string }
  >;
  /**
   * Bounded ring of transactionHashes we've already emitted to the ticker.
   * Used to suppress duplicate ticker pills when RTDS replays the same
   * trade (reconnect / snapshot) beyond the client-side 6s TTL.
   */
  seenTickerTx: Set<string>;
};

const TICKER_DEDUP_CAP = 4096;
const globalForWatcher = globalThis as unknown as { __watcherState?: WatcherState };

const state: WatcherState =
  globalForWatcher.__watcherState ??
  (globalForWatcher.__watcherState = {
    started: false,
    watcher: null,
    flagger: null,
    subscribedSlugs: [],
    conditionContext: new Map(),
    seenTickerTx: new Set(),
  });

const { conditionContext } = state;

const markTickerSeen = (txHash: string): boolean => {
  if (state.seenTickerTx.has(txHash)) return false;
  state.seenTickerTx.add(txHash);
  // Drop oldest half once the ring fills — Set preserves insertion order, so
  // the earliest hashes are the oldest. This is cheaper than tracking ages.
  if (state.seenTickerTx.size > TICKER_DEDUP_CAP) {
    const drop = Math.floor(TICKER_DEDUP_CAP / 2);
    const iter = state.seenTickerTx.values();
    for (let i = 0; i < drop; i++) state.seenTickerTx.delete(iter.next().value as string);
  }
  return true;
};

async function bootstrapMarkets(): Promise<string[]> {
  // Phase 1: fan out all Gamma fetches in parallel. With 13 slugs at ~200ms
  // each that's the difference between ~2.6s and ~250ms on boot — meaningful
  // against Railway's 30s healthcheck budget.
  const resolutions = await Promise.allSettled(
    WATCHED_MARKETS.map((ref) => resolveEvent(ref.eventSlug)),
  );

  // Phase 2: write per-event in series so SQLite doesn't see overlapping
  // write batches from different events. Upserts WITHIN an event still run
  // in parallel — Prisma's connection pool serializes them on the SQLite
  // side, but the request fan-out is fine.
  const slugs: string[] = [];
  for (let i = 0; i < resolutions.length; i++) {
    const ref = WATCHED_MARKETS[i]!;
    const result = resolutions[i]!;
    if (result.status === 'rejected') {
      console.warn(`[watcher] failed to resolve ${ref.eventSlug}`, result.reason);
      continue;
    }
    const event = result.value;
    if (!event) {
      console.warn(`[watcher] event not found on Gamma: ${ref.eventSlug}`);
      continue;
    }
    slugs.push(event.eventSlug);
    for (const market of event.markets) {
      conditionContext.set(market.conditionId, {
        eventSlug: event.eventSlug,
        marketSlug: market.marketSlug,
        question: market.question,
        title: event.title,
      });
    }
    await Promise.all(
      event.markets.map((market) =>
        prisma.market.upsert({
          where: { conditionId: market.conditionId },
          create: {
            conditionId: market.conditionId,
            eventSlug: event.eventSlug,
            marketSlug: market.marketSlug,
            question: market.question,
            outcomes: JSON.stringify(market.outcomes),
          },
          update: {
            eventSlug: event.eventSlug,
            marketSlug: market.marketSlug,
            question: market.question,
            outcomes: JSON.stringify(market.outcomes),
          },
        }),
      ),
    );
    console.log(`[watcher] resolved ${ref.eventSlug} → ${event.markets.length} market(s)`);
  }
  return slugs;
}

async function hydrateFlagger(target: Flagger): Promise<void> {
  const since = new Date(Date.now() - 30 * 60_000);
  const recent = await prisma.trade.findMany({
    where: { timestamp: { gte: since } },
    select: {
      id: true,
      conditionId: true,
      outcomeIndex: true,
      side: true,
      proxyWallet: true,
      notionalUsd: true,
      timestamp: true,
    },
    orderBy: { timestamp: 'asc' },
  });
  const records: TradeRecord[] = recent.map((r) => ({
    id: r.id,
    conditionId: r.conditionId,
    outcomeIndex: r.outcomeIndex,
    side: r.side === 'SELL' ? 'SELL' : 'BUY',
    proxyWallet: r.proxyWallet,
    notionalUsd: r.notionalUsd,
    timestampMs: r.timestamp.getTime(),
  }));
  target.hydrate(records);
  if (records.length > 0) {
    console.log(`[watcher] hydrated flagger with ${records.length} recent trade(s)`);
  }
}

/**
 * A single Polymarket on-chain tx can fill against multiple makers — different
 * outcomes (asset), sides, prices, and sizes. RTDS emits one event per fill.
 * The canonical per-fill identity is the tx hash plus the dimensions Polymarket
 * actually varies between sibling fills.
 */
const fillIdFor = (trade: RtdsTrade): string =>
  `${trade.transactionHash}:${trade.asset}:${trade.side}:${trade.price}:${trade.size}`;

const buildFeedItem = (
  trade: RtdsTrade,
  flag: NonNullable<ReturnType<Flagger['ingest']>>,
): FlaggedFeedItem => {
  const ctx = conditionContext.get(trade.conditionId);
  return {
    id: fillIdFor(trade),
    tradeId: fillIdFor(trade),
    conditionId: trade.conditionId,
    eventSlug: trade.eventSlug,
    marketSlug: trade.slug,
    // Prefer Gamma's resolved event title — matches what the DB upsert persists
    // (`ctx?.title ?? trade.title`). Without this, SSE-streamed items could show
    // the raw RTDS title (which defaults to '' per the zod schema) while the
    // same trade hydrated from the DB shows the real Gamma title.
    title: ctx?.title ?? trade.title,
    question: ctx?.question ?? trade.title,
    outcome: trade.outcome,
    outcomeIndex: trade.outcomeIndex,
    side: trade.side,
    price: trade.price,
    size: trade.size,
    notionalUsd: trade.price * trade.size,
    proxyWallet: trade.proxyWallet,
    pseudonym: trade.pseudonym ?? null,
    name: trade.name ?? null,
    timestamp: trade.timestamp,
    reasons: flag.reasons,
    severity: flag.severity,
    clusterKey: flag.clusterKey ?? null,
    clusterSize: flag.clusterSize ?? null,
    clusterTotalUsd: flag.clusterTotalUsd ?? null,
    spreeSize: flag.spreeSize ?? null,
    spreeTotalUsd: flag.spreeTotalUsd ?? null,
    spreeFirstTimestamp: flag.spreeFirstTimestampMs ?? null,
    transactionHash: trade.transactionHash,
  };
};

async function handleTrade(trade: RtdsTrade): Promise<void> {
  // Outer guard: rtds.ts void-calls this. Any unhandled rejection here would
  // be a process-level UnhandledPromiseRejection on Node 15+ (default policy
  // is throw). Catch everything so one bad trade can never take the watcher
  // down — log the offender's tx hash for follow-up.
  try {
    await handleTradeInner(trade);
  } catch (err) {
    console.warn(`[watcher] handleTrade crashed tx=${trade.transactionHash.slice(0, 10)}`, err);
  }
}

async function handleTradeInner(trade: RtdsTrade): Promise<void> {
  if (!state.flagger) return;
  // Some events stream child markets that were not catalogued at boot (e.g. new sub-markets
  // added after startup). We still process them — Gamma will fill in metadata next boot.
  const ctx = conditionContext.get(trade.conditionId);
  const notional = trade.price * trade.size;
  const ts = new Date(trade.timestamp);
  const fillId = fillIdFor(trade);
  const shortTx = trade.transactionHash.slice(0, 10);

  try {
    await prisma.trade.upsert({
      where: { id: fillId },
      create: {
        id: fillId,
        transactionHash: trade.transactionHash,
        conditionId: trade.conditionId,
        assetId: trade.asset,
        outcomeIndex: trade.outcomeIndex,
        outcome: trade.outcome,
        side: trade.side,
        price: trade.price,
        size: trade.size,
        notionalUsd: notional,
        proxyWallet: trade.proxyWallet,
        pseudonym: trade.pseudonym ?? null,
        name: trade.name ?? null,
        eventSlug: trade.eventSlug,
        marketSlug: trade.slug,
        title: ctx?.title ?? trade.title,
        timestamp: ts,
      },
      update: {},
    });
  } catch (err) {
    console.warn(`[watcher] trade upsert failed tx=${shortTx}`, err);
    return;
  }

  // Dedupe ticker emits across RTDS replays. The flagger has its own dedup
  // for the cluster window; the ticker needs its own because it fires before
  // the flagger sees the trade and has no cluster window to reference.
  if (notional >= TICKER.minNotionalUsd && markTickerSeen(fillId)) {
    broker.publish({
      type: 'tick',
      data: {
        id: fillId,
        conditionId: trade.conditionId,
        eventSlug: trade.eventSlug,
        marketSlug: trade.slug,
        title: ctx?.title ?? trade.title,
        outcome: trade.outcome,
        side: trade.side,
        price: trade.price,
        size: trade.size,
        notionalUsd: notional,
        proxyWallet: trade.proxyWallet,
        pseudonym: trade.pseudonym ?? null,
        name: trade.name ?? null,
        timestamp: trade.timestamp,
      },
    });
  }

  const flag = state.flagger.ingest(trade);
  if (!flag) return;

  const item = buildFeedItem(trade, flag);

  const flaggedFields = {
    reason: flag.reasons.join('+'),
    severity: flag.severity,
    clusterKey: flag.clusterKey ?? null,
    clusterSize: flag.clusterSize ?? null,
    clusterTotalUsd: flag.clusterTotalUsd ?? null,
    spreeSize: flag.spreeSize ?? null,
    spreeTotalUsd: flag.spreeTotalUsd ?? null,
    spreeFirstTimestamp: flag.spreeFirstTimestampMs ? new Date(flag.spreeFirstTimestampMs) : null,
  };
  try {
    await prisma.flaggedTrade.upsert({
      where: { tradeId: fillId },
      create: { tradeId: fillId, ...flaggedFields },
      update: flaggedFields,
    });
  } catch (err) {
    console.warn('[watcher] flagged upsert failed', err);
  }

  console.log(
    `[flagger] ${flag.reasons.join('+')} (${flag.severity}) ` +
      `${trade.side} ${trade.size}@${trade.price} = $${notional.toFixed(2)} :: ${trade.outcome}`,
  );

  broker.publish({ type: 'flagged', data: item });
  void sendTelegram(item);
}

export type WatcherStats = {
  running: boolean;
  status: ReturnType<RtdsWatcher['getStatus']> | 'NOT_STARTED';
  marketsResolved: number;
  subscribedSlugs: string[];
  counters: RtdsCounters;
};

const EMPTY_COUNTERS: RtdsCounters = {
  rawMessages: 0,
  tradeMessages: 0,
  filteredOut: 0,
  dropped: 0,
  lastRawAt: null,
  lastTradeAt: null,
  recentDrops: [],
};

export function getWatcherStats(): WatcherStats {
  return {
    running: state.started,
    status: state.watcher?.getStatus() ?? 'NOT_STARTED',
    marketsResolved: conditionContext.size,
    subscribedSlugs: state.subscribedSlugs,
    counters: state.watcher?.getCounters() ?? EMPTY_COUNTERS,
  };
}

export async function startWatcher(): Promise<void> {
  if (state.started) return;
  state.started = true;
  console.log('[watcher] starting…');

  state.flagger = new Flagger();
  await hydrateFlagger(state.flagger);

  const slugs = await bootstrapMarkets();
  state.subscribedSlugs = slugs;
  if (slugs.length === 0) {
    console.warn('[watcher] no event slugs resolved; check config/markets.config.ts');
    return;
  }

  state.watcher = new RtdsWatcher(slugs, {
    onTrade: handleTrade,
    onStatusChange: (status) => broker.publish({ type: 'status', status }),
  });
  state.watcher.start();
  // Connection keep-alive is handled by the SSE route's `: keep-alive` comment
  // every 20s — no client listens for broker heartbeats and forwarding them
  // would just burn bandwidth per connected tab.
}
