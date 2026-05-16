'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ConnectionDot } from './components/ConnectionDot';
import { LiveTicker, type TickItem } from './components/LiveTicker';
import { MarketFilter, type MarketFilterValue } from './components/MarketFilter';
import { TradeRow } from './components/TradeRow';
import { useSoundController } from './components/SoundController';
import type { ConnectionState, FlaggedItem, ResolvedMarket } from './types';

const MAX_FEED_ITEMS = 250;
const MAX_TICKER_ITEMS = 12;
const TICKER_TTL_MS = 6000;
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'Eurovision Watch';

type RecentResponse = {
  flagged: Array<{
    id: string;
    tradeId: string;
    reason: string;
    severity: 'normal' | 'big';
    clusterKey: string | null;
    clusterSize: number | null;
    createdAt: string;
    trade: {
      id: string;
      conditionId: string;
      eventSlug: string;
      marketSlug: string;
      title: string;
      outcome: string;
      outcomeIndex: number;
      side: 'BUY' | 'SELL';
      price: number;
      size: number;
      notionalUsd: number;
      proxyWallet: string;
      pseudonym: string | null;
      name: string | null;
      timestamp: string;
    };
  }>;
};

type MarketsResponse = { markets: ResolvedMarket[] };

const parseReasons = (reason: string): ('size' | 'cluster')[] => {
  const parts = reason.split('+');
  const out: ('size' | 'cluster')[] = [];
  if (parts.includes('size')) out.push('size');
  if (parts.includes('cluster')) out.push('cluster');
  return out.length > 0 ? out : ['size'];
};

const mapRecent = (r: RecentResponse): FlaggedItem[] =>
  // `id` MUST equal `transactionHash` so it matches the SSE payload from
  // buildFeedItem — otherwise the same trade arriving via hydrate + SSE
  // (race on first paint) would render twice. row.tradeId is the FK to
  // Trade.id which is the transactionHash.
  r.flagged.map((row) => ({
    id: row.tradeId,
    tradeId: row.tradeId,
    conditionId: row.trade.conditionId,
    eventSlug: row.trade.eventSlug,
    marketSlug: row.trade.marketSlug,
    title: row.trade.title,
    question: row.trade.title,
    outcome: row.trade.outcome,
    outcomeIndex: row.trade.outcomeIndex,
    side: row.trade.side,
    price: row.trade.price,
    size: row.trade.size,
    notionalUsd: row.trade.notionalUsd,
    proxyWallet: row.trade.proxyWallet,
    pseudonym: row.trade.pseudonym,
    name: row.trade.name,
    timestamp: new Date(row.trade.timestamp).getTime(),
    reasons: parseReasons(row.reason),
    severity: row.severity,
    clusterKey: row.clusterKey,
    clusterSize: row.clusterSize,
    transactionHash: row.trade.id,
  }));

export default function Page() {
  const [status, setStatus] = useState<ConnectionState>('NOT_STARTED');
  const [items, setItems] = useState<FlaggedItem[]>([]);
  const [tickItems, setTickItems] = useState<TickItem[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [markets, setMarkets] = useState<ResolvedMarket[]>([]);
  const [selectedEvents, setSelectedEvents] = useState<MarketFilterValue>(new Set());
  const sound = useSoundController();
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const addItem = useCallback((item: FlaggedItem) => {
    setItems((prev) => {
      if (prev.some((p) => p.id === item.id)) return prev;
      const next = [item, ...prev].slice(0, MAX_FEED_ITEMS);
      return next;
    });
    setNewIds((prev) => {
      const next = new Set(prev);
      next.add(item.id);
      return next;
    });
    soundRef.current.play(item.severity);
    setTimeout(() => {
      setNewIds((prev) => {
        if (!prev.has(item.id)) return prev;
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }, 2000);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [recentRes, marketsRes] = await Promise.all([
          fetch('/api/trades/recent?limit=100'),
          fetch('/api/markets'),
        ]);
        if (cancelled) return;
        if (recentRes.ok) {
          const data = (await recentRes.json()) as RecentResponse;
          setItems(mapRecent(data));
        }
        if (marketsRes.ok) {
          const data = (await marketsRes.json()) as MarketsResponse;
          setMarkets(data.markets);
        }
      } catch (err) {
        console.warn('initial hydrate failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const es = new EventSource('/api/feed/stream');
    es.addEventListener('status', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent<string>).data) as {
          status: ConnectionState;
        };
        setStatus(data.status);
      } catch {
        // ignore
      }
    });
    es.addEventListener('flagged', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent<string>).data) as { data: FlaggedItem };
        addItem(data.data);
      } catch (err) {
        console.warn('bad flagged event', err);
      }
    });
    es.addEventListener('tick', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent<string>).data) as { data: TickItem };
        setTickItems((prev) => {
          if (prev.some((p) => p.id === data.data.id)) return prev;
          return [data.data, ...prev].slice(0, MAX_TICKER_ITEMS);
        });
        setTimeout(() => {
          setTickItems((prev) => prev.filter((p) => p.id !== data.data.id));
        }, TICKER_TTL_MS);
      } catch (err) {
        console.warn('bad tick event', err);
      }
    });
    es.onerror = () => {
      setStatus((prev) => (prev === 'CONNECTED' ? 'CONNECTING' : prev));
    };
    return () => es.close();
  }, [addItem]);

  const filtered = useMemo(() => {
    if (selectedEvents.size === 0) return items;
    return items.filter((i) => selectedEvents.has(i.eventSlug));
  }, [items, selectedEvents]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-muted">
            Live Polymarket Eurovision 2026 trade tape — large trades &amp; clusters only
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ConnectionDot status={status} />
          <button
            type="button"
            onClick={sound.toggle}
            className={`rounded border px-2.5 py-1 text-xs transition ${
              sound.enabled
                ? 'border-buy/60 bg-buy/15 text-buy'
                : 'border-line bg-panel2 text-muted hover:text-text'
            }`}
          >
            {sound.enabled ? '🔔 Sound on' : '🔕 Sound off'}
          </button>
        </div>
      </header>

      <section className="mb-3">
        <LiveTicker items={tickItems} selectedEvents={selectedEvents} />
      </section>

      <section className="mb-4">
        <MarketFilter markets={markets} selected={selectedEvents} onChange={setSelectedEvents} />
      </section>

      <section className="space-y-2">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-line bg-panel px-4 py-8 text-center text-sm text-muted">
            Waiting for flagged trades. Adjust thresholds in
            <code className="mx-1 rounded bg-panel2 px-1.5 py-0.5 text-xs">
              config/eurovision.config.ts
            </code>
            if nothing fires.
          </div>
        ) : (
          filtered.map((item) => <TradeRow key={item.id} item={item} isNew={newIds.has(item.id)} />)
        )}
      </section>

      <footer className="mt-8 border-t border-line pt-4 text-xs text-muted">
        Showing {filtered.length} of {items.length} flagged trades · markets: {markets.length}{' '}
        resolved
      </footer>
    </main>
  );
}
