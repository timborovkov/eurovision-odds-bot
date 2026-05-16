import { describe, expect, it } from 'vitest';

import { Flagger } from '@/lib/watcher/flagger';
import type { RtdsTrade } from '@/lib/watcher/rtds';

const baseTrade: RtdsTrade = {
  asset: 'asset-1',
  conditionId: '0xabc',
  eventSlug: 'eurovision-winner-2026',
  slug: 'will-x-win',
  title: 'Eurovision Winner 2026',
  outcome: 'Sweden',
  outcomeIndex: 0,
  side: 'BUY',
  price: 0.5,
  size: 100,
  timestamp: Date.now(),
  transactionHash: '0xtx0',
  proxyWallet: '0xwallet0',
  pseudonym: 'somebody',
  name: 'somebody',
  bio: null,
};

const trade = (overrides: Partial<RtdsTrade> & { txSuffix: string }): RtdsTrade => ({
  ...baseTrade,
  ...overrides,
  transactionHash: `0xtx-${overrides.txSuffix}`,
});

describe('Flagger', () => {
  it('ignores small trades', () => {
    const flagger = new Flagger();
    const result = flagger.ingest(trade({ txSuffix: 'small', price: 0.5, size: 10 }));
    expect(result).toBeNull();
  });

  it('flags a single trade above singleTradeUsd', () => {
    const flagger = new Flagger();
    // notional = 0.6 * 2000 = $1,200 > default singleTradeUsd $1,000
    const result = flagger.ingest(trade({ txSuffix: 'large', price: 0.6, size: 2000 }));
    expect(result).not.toBeNull();
    expect(result!.reasons).toContain('size');
    expect(result!.severity).toBe('normal');
  });

  it('flags a single trade above bigTradeUsd as "big" severity', () => {
    const flagger = new Flagger();
    // notional = 0.5 * 25000 = $12,500 > default bigTradeUsd $10,000
    const result = flagger.ingest(trade({ txSuffix: 'big', price: 0.5, size: 25_000 }));
    expect(result).not.toBeNull();
    expect(result!.reasons).toContain('size');
    expect(result!.severity).toBe('big');
  });

  it('flags a cluster of 4 distinct buyers below single-trade thresholds', () => {
    // Per-trade notional well below $1,000 single-trade threshold but the cluster
    // total ($2,000) exceeds the cluster minTotalUsd ($1,500), and weighted count
    // (4 distinct buyers @ weight 1 each) meets minTrades=4.
    const flagger = new Flagger();
    const now = Date.now();
    const trades = [
      trade({ txSuffix: 'c1', price: 0.5, size: 1000, proxyWallet: '0xa', timestamp: now - 4000 }),
      trade({ txSuffix: 'c2', price: 0.5, size: 1000, proxyWallet: '0xb', timestamp: now - 3000 }),
      trade({ txSuffix: 'c3', price: 0.5, size: 1000, proxyWallet: '0xc', timestamp: now - 2000 }),
      trade({ txSuffix: 'c4', price: 0.5, size: 1000, proxyWallet: '0xd', timestamp: now - 1000 }),
    ];
    // Each trade above is $500 notional → trips the size rule too. Adjust:
    // Use $400 each to stay under size threshold but together reach $1,600.
    const cheap = trades.map((t, i) => ({
      ...t,
      price: 0.4,
      size: 1000,
      transactionHash: `c-${i}`,
    }));
    let last = null;
    for (const t of cheap) last = flagger.ingest(t);
    expect(last).not.toBeNull();
    expect(last!.reasons).toContain('cluster');
  });

  it('weights same-buyer trades heavily so 2 trades from same wallet trip the cluster rule', () => {
    // 2 trades from same wallet × sameBuyerWeight(3) = 6 weighted >= minTrades(4).
    // Two trades of $800 each = $1,600 total > minTotalUsd $1,500.
    const flagger = new Flagger();
    const now = Date.now();
    const t1 = trade({
      txSuffix: 'sb1',
      price: 0.4,
      size: 2000,
      proxyWallet: '0xrepeat',
      timestamp: now - 2000,
    });
    const t2 = trade({
      txSuffix: 'sb2',
      price: 0.4,
      size: 2000,
      proxyWallet: '0xrepeat',
      timestamp: now - 1000,
    });
    flagger.ingest(t1);
    const result = flagger.ingest(t2);
    expect(result).not.toBeNull();
    expect(result!.reasons).toContain('cluster');
  });

  it('does NOT cluster trades on a different outcome', () => {
    const flagger = new Flagger();
    const now = Date.now();
    flagger.ingest(
      trade({
        txSuffix: 'o0a',
        price: 0.4,
        size: 1000,
        outcomeIndex: 0,
        proxyWallet: '0xa',
        timestamp: now - 4000,
      }),
    );
    flagger.ingest(
      trade({
        txSuffix: 'o1a',
        price: 0.4,
        size: 1000,
        outcomeIndex: 1,
        proxyWallet: '0xb',
        timestamp: now - 3000,
      }),
    );
    const result = flagger.ingest(
      trade({
        txSuffix: 'o1b',
        price: 0.4,
        size: 1000,
        outcomeIndex: 1,
        proxyWallet: '0xc',
        timestamp: now - 2000,
      }),
    );
    expect(result).toBeNull();
  });

  it('ignores duplicate transactionHash within the same window (RTDS replay safety)', () => {
    const flagger = new Flagger();
    const big = trade({ txSuffix: 'dup', price: 0.5, size: 25_000 });
    const first = flagger.ingest(big);
    expect(first).not.toBeNull();
    expect(first!.severity).toBe('big');
    // Second ingest of the same transactionHash must be a no-op — no double flag,
    // no double-count in the cluster window.
    const second = flagger.ingest(big);
    expect(second).toBeNull();
  });

  it('hydrate seeds the cluster window from past records', () => {
    const flagger = new Flagger();
    const now = Date.now();
    flagger.hydrate([
      {
        id: 'h1',
        conditionId: '0xabc',
        outcomeIndex: 0,
        proxyWallet: '0xa',
        notionalUsd: 500,
        timestampMs: now - 5000,
      },
      {
        id: 'h2',
        conditionId: '0xabc',
        outcomeIndex: 0,
        proxyWallet: '0xb',
        notionalUsd: 500,
        timestampMs: now - 4000,
      },
      {
        id: 'h3',
        conditionId: '0xabc',
        outcomeIndex: 0,
        proxyWallet: '0xc',
        notionalUsd: 500,
        timestampMs: now - 3000,
      },
    ]);

    // One more fresh trade should now trip the cluster rule
    // (totals $2,000, 4 distinct buyers weighted = 4).
    const result = flagger.ingest(
      trade({
        txSuffix: 'fresh',
        price: 0.5,
        size: 1000,
        proxyWallet: '0xd',
        outcomeIndex: 0,
        timestamp: now - 1000,
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.reasons).toContain('cluster');
  });
});
