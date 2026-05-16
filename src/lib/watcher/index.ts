import { EUROVISION_MARKETS, TICKER } from '@config/eurovision.config';

import { prisma } from '@/lib/db';
import { sendTelegram } from '@/lib/notify/telegram';
import { resolveEvent } from '@/lib/polymarket/gamma';

import { broker, type FlaggedFeedItem } from './broker';
import { Flagger, type TradeRecord } from './flagger';
import { RtdsWatcher, type RtdsTrade } from './rtds';

type WatcherState = {
  started: boolean;
  watcher: RtdsWatcher | null;
  flagger: Flagger | null;
  subscribedSlugs: string[];
  conditionContext: Map<
    string,
    { eventSlug: string; marketSlug: string; question: string; title: string }
  >;
};

const globalForWatcher = globalThis as unknown as { __watcherState?: WatcherState };

const state: WatcherState =
  globalForWatcher.__watcherState ??
  (globalForWatcher.__watcherState = {
    started: false,
    watcher: null,
    flagger: null,
    subscribedSlugs: [],
    conditionContext: new Map(),
  });

const { conditionContext } = state;

async function bootstrapMarkets(): Promise<string[]> {
  // Phase 1: fan out all Gamma fetches in parallel. With 13 slugs at ~200ms
  // each that's the difference between ~2.6s and ~250ms on boot — meaningful
  // against Railway's 30s healthcheck budget.
  const resolutions = await Promise.allSettled(
    EUROVISION_MARKETS.map((ref) => resolveEvent(ref.eventSlug)),
  );

  // Phase 2: write per-event in series so SQLite doesn't see overlapping
  // write batches from different events. Upserts WITHIN an event still run
  // in parallel — Prisma's connection pool serializes them on the SQLite
  // side, but the request fan-out is fine.
  const slugs: string[] = [];
  for (let i = 0; i < resolutions.length; i++) {
    const ref = EUROVISION_MARKETS[i]!;
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
    proxyWallet: r.proxyWallet,
    notionalUsd: r.notionalUsd,
    timestampMs: r.timestamp.getTime(),
  }));
  target.hydrate(records);
  if (records.length > 0) {
    console.log(`[watcher] hydrated flagger with ${records.length} recent trade(s)`);
  }
}

const buildFeedItem = (
  trade: RtdsTrade,
  flag: NonNullable<ReturnType<Flagger['ingest']>>,
): FlaggedFeedItem => ({
  id: trade.transactionHash,
  tradeId: trade.transactionHash,
  conditionId: trade.conditionId,
  eventSlug: trade.eventSlug,
  marketSlug: trade.slug,
  title: trade.title,
  question: conditionContext.get(trade.conditionId)?.question ?? trade.title,
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
  transactionHash: trade.transactionHash,
});

async function handleTrade(trade: RtdsTrade): Promise<void> {
  if (!state.flagger) return;
  // Some Eurovision events stream child markets we may not have catalogued (new sub-markets
  // appearing late). We still process them — Gamma will fill in metadata next boot.
  const ctx = conditionContext.get(trade.conditionId);
  const notional = trade.price * trade.size;
  const ts = new Date(trade.timestamp);

  try {
    await prisma.trade.upsert({
      where: { id: trade.transactionHash },
      create: {
        id: trade.transactionHash,
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
    console.warn('[watcher] trade upsert failed', err);
    return;
  }

  if (notional >= TICKER.minNotionalUsd) {
    broker.publish({
      type: 'tick',
      data: {
        id: trade.transactionHash,
        eventSlug: trade.eventSlug,
        outcome: trade.outcome,
        side: trade.side,
        price: trade.price,
        size: trade.size,
        notionalUsd: notional,
        timestamp: trade.timestamp,
      },
    });
  }

  const flag = state.flagger.ingest(trade);
  if (!flag) return;

  const item = buildFeedItem(trade, flag);

  try {
    await prisma.flaggedTrade.upsert({
      where: { tradeId: trade.transactionHash },
      create: {
        tradeId: trade.transactionHash,
        reason: flag.reasons.join('+'),
        severity: flag.severity,
        clusterKey: flag.clusterKey ?? null,
        clusterSize: flag.clusterSize ?? null,
      },
      update: {
        reason: flag.reasons.join('+'),
        severity: flag.severity,
        clusterKey: flag.clusterKey ?? null,
        clusterSize: flag.clusterSize ?? null,
      },
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
};

export function getWatcherStats(): WatcherStats {
  return {
    running: state.started,
    status: state.watcher?.getStatus() ?? 'NOT_STARTED',
    marketsResolved: conditionContext.size,
    subscribedSlugs: state.subscribedSlugs,
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
    console.warn('[watcher] no event slugs resolved; check config/eurovision.config.ts');
    return;
  }

  state.watcher = new RtdsWatcher(slugs, {
    onTrade: handleTrade,
    onStatusChange: (status) => broker.publish({ type: 'status', status }),
  });
  state.watcher.start();

  setInterval(() => {
    broker.publish({ type: 'heartbeat', ts: Date.now() });
  }, 15_000).unref();
}
