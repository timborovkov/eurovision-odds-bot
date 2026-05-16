import { describe, expect, it } from 'vitest';

import { Flagger } from '@/lib/watcher/flagger';
import type { RtdsTrade } from '@/lib/watcher/rtds';

// Tests use explicit small thresholds so the suite stays valid when
// production thresholds in config/eurovision.config.ts are tuned for
// real Polymarket volume. The shape mirrors FLAG_THRESHOLDS.
const TEST_THRESHOLDS = {
  singleTradeUsd: 1_000,
  singleTradeShares: 5_000,
  bigTradeUsd: 10_000,
  cluster: {
    windowMs: 10 * 60_000,
    minTrades: 4,
    minTotalUsd: 1_500,
    sameBuyerWeight: 3,
  },
  spree: {
    windowMs: 10 * 60_000,
    minTrades: 3,
    minTotalUsd: 1_500,
  },
} as const;

const makeFlagger = (): Flagger => new Flagger(TEST_THRESHOLDS);

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
    const flagger = makeFlagger();
    const result = flagger.ingest(trade({ txSuffix: 'small', price: 0.5, size: 10 }));
    expect(result).toBeNull();
  });

  it('flags a single trade above singleTradeUsd', () => {
    const flagger = makeFlagger();
    // notional = 0.6 * 2000 = $1,200 > default singleTradeUsd $1,000
    const result = flagger.ingest(trade({ txSuffix: 'large', price: 0.6, size: 2000 }));
    expect(result).not.toBeNull();
    expect(result!.reasons).toContain('size');
    expect(result!.severity).toBe('normal');
  });

  it('flags a single trade above bigTradeUsd as "big" severity', () => {
    const flagger = makeFlagger();
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
    const flagger = makeFlagger();
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
    const flagger = makeFlagger();
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
    const flagger = makeFlagger();
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

  it('escalates to "big" when cluster total crosses bigTradeUsd, even if size also fired', () => {
    // A single $2k trade trips `size` (≥$1k) but is below `bigTradeUsd` ($10k).
    // Stacked behind three prior $4.5k trades from distinct buyers, the cluster
    // total is $15.5k > $10k. The combined flag must surface severity "big",
    // not "normal".
    const flagger = makeFlagger();
    const now = Date.now();
    const seed = [
      trade({ txSuffix: 'p1', price: 0.5, size: 9000, proxyWallet: '0xa', timestamp: now - 4000 }),
      trade({ txSuffix: 'p2', price: 0.5, size: 9000, proxyWallet: '0xb', timestamp: now - 3000 }),
      trade({ txSuffix: 'p3', price: 0.5, size: 9000, proxyWallet: '0xc', timestamp: now - 2000 }),
    ];
    // Each seed: notional = $4,500 (fires size, not big). 3 distinct buyers +
    // the final trade trips weighted count >=4 and total >= minTotalUsd.
    for (const t of seed) flagger.ingest(t);

    const final = flagger.ingest(
      trade({
        txSuffix: 'final',
        price: 0.5,
        size: 4000, // notional $2,000 → fires size, NOT big on its own
        proxyWallet: '0xd',
        timestamp: now - 1000,
      }),
    );

    expect(final).not.toBeNull();
    expect(final!.reasons).toEqual(expect.arrayContaining(['size', 'cluster']));
    expect(final!.severity).toBe('big');
  });

  it('cluster flag carries the summed notional of trades in the window', () => {
    const flagger = makeFlagger();
    const now = Date.now();
    const ts = (offset: number) => now - offset;
    const inputs = [
      trade({ txSuffix: 'ct1', price: 0.5, size: 1000, proxyWallet: '0xa', timestamp: ts(4000) }),
      trade({ txSuffix: 'ct2', price: 0.5, size: 1000, proxyWallet: '0xb', timestamp: ts(3000) }),
      trade({ txSuffix: 'ct3', price: 0.5, size: 1000, proxyWallet: '0xc', timestamp: ts(2000) }),
      trade({ txSuffix: 'ct4', price: 0.5, size: 1000, proxyWallet: '0xd', timestamp: ts(1000) }),
    ];
    let last = null;
    for (const t of inputs) last = flagger.ingest(t);
    expect(last).not.toBeNull();
    expect(last!.reasons).toContain('cluster');
    expect(last!.clusterTotalUsd).toBeCloseTo(2000, 2);
    expect(last!.clusterSize).toBe(4);
  });

  it('spree fires for 3 same-wallet trades on the same outcome above minTotalUsd', () => {
    const flagger = makeFlagger();
    const now = Date.now();
    const inputs = [
      trade({
        txSuffix: 'sp1',
        price: 0.5,
        size: 1100,
        proxyWallet: '0xwhale',
        timestamp: now - 3000,
      }),
      trade({
        txSuffix: 'sp2',
        price: 0.5,
        size: 1100,
        proxyWallet: '0xwhale',
        timestamp: now - 2000,
      }),
      trade({
        txSuffix: 'sp3',
        price: 0.5,
        size: 1100,
        proxyWallet: '0xwhale',
        timestamp: now - 1000,
      }),
    ];
    let last = null;
    for (const t of inputs) last = flagger.ingest(t);
    expect(last).not.toBeNull();
    expect(last!.reasons).toContain('spree');
    expect(last!.spreeSize).toBe(3);
    expect(last!.spreeTotalUsd).toBeCloseTo(1650, 0);
    expect(last!.spreeFirstTimestampMs).toBe(now - 3000);
  });

  it('spree does NOT fire across different outcomes for the same wallet', () => {
    const flagger = makeFlagger();
    const now = Date.now();
    flagger.ingest(
      trade({
        txSuffix: 'd1',
        price: 0.5,
        size: 1100,
        proxyWallet: '0xwhale',
        outcomeIndex: 0,
        timestamp: now - 3000,
      }),
    );
    flagger.ingest(
      trade({
        txSuffix: 'd2',
        price: 0.5,
        size: 1100,
        proxyWallet: '0xwhale',
        outcomeIndex: 1,
        timestamp: now - 2000,
      }),
    );
    const last = flagger.ingest(
      trade({
        txSuffix: 'd3',
        price: 0.5,
        size: 1100,
        proxyWallet: '0xwhale',
        outcomeIndex: 2,
        timestamp: now - 1000,
      }),
    );
    expect(last?.reasons.includes('spree') ?? false).toBe(false);
  });

  it('spree does NOT fire when same wallet flips between BUY and SELL', () => {
    const flagger = makeFlagger();
    const now = Date.now();
    flagger.ingest(
      trade({
        txSuffix: 'm1',
        price: 0.5,
        size: 1100,
        proxyWallet: '0xflip',
        side: 'BUY',
        timestamp: now - 3000,
      }),
    );
    flagger.ingest(
      trade({
        txSuffix: 'm2',
        price: 0.5,
        size: 1100,
        proxyWallet: '0xflip',
        side: 'SELL',
        timestamp: now - 2000,
      }),
    );
    const last = flagger.ingest(
      trade({
        txSuffix: 'm3',
        price: 0.5,
        size: 1100,
        proxyWallet: '0xflip',
        side: 'BUY',
        timestamp: now - 1000,
      }),
    );
    expect(last?.reasons.includes('spree') ?? false).toBe(false);
  });

  it('a single big trade can surface BOTH cluster and spree when conditions align', () => {
    const flagger = makeFlagger();
    const now = Date.now();
    // 4 trades from 4 distinct buyers trips cluster on the last (4-buyer rule).
    // The 3 trades from 0xwhale also trip spree on the 3rd whale trade.
    // To get BOTH on the SAME triggering trade, interleave so the 4th cluster
    // trade is also the 3rd spree trade from 0xwhale.
    flagger.ingest(
      trade({
        txSuffix: 'b1',
        price: 0.5,
        size: 1100,
        proxyWallet: '0xwhale',
        timestamp: now - 5000,
      }),
    );
    flagger.ingest(
      trade({ txSuffix: 'b2', price: 0.5, size: 1100, proxyWallet: '0xb', timestamp: now - 4000 }),
    );
    flagger.ingest(
      trade({
        txSuffix: 'b3',
        price: 0.5,
        size: 1100,
        proxyWallet: '0xwhale',
        timestamp: now - 3000,
      }),
    );
    flagger.ingest(
      trade({ txSuffix: 'b4', price: 0.5, size: 1100, proxyWallet: '0xc', timestamp: now - 2000 }),
    );
    const last = flagger.ingest(
      trade({
        txSuffix: 'b5',
        price: 0.5,
        size: 1100,
        proxyWallet: '0xwhale',
        timestamp: now - 1000,
      }),
    );
    expect(last).not.toBeNull();
    expect(last!.reasons).toEqual(expect.arrayContaining(['cluster', 'spree']));
    expect(last!.spreeSize).toBe(3);
  });

  it('spree does not re-emit on the immediately following same-wallet trade (dedup)', () => {
    const flagger = makeFlagger();
    const now = Date.now();
    flagger.ingest(
      trade({
        txSuffix: 'r1',
        price: 0.5,
        size: 1100,
        proxyWallet: '0xwhale',
        timestamp: now - 3000,
      }),
    );
    flagger.ingest(
      trade({
        txSuffix: 'r2',
        price: 0.5,
        size: 1100,
        proxyWallet: '0xwhale',
        timestamp: now - 2000,
      }),
    );
    const first = flagger.ingest(
      trade({
        txSuffix: 'r3',
        price: 0.5,
        size: 1100,
        proxyWallet: '0xwhale',
        timestamp: now - 1000,
      }),
    );
    expect(first!.reasons).toContain('spree');
    const second = flagger.ingest(
      trade({
        txSuffix: 'r4',
        price: 0.5,
        size: 1100,
        proxyWallet: '0xwhale',
        timestamp: now - 500,
      }),
    );
    expect(second?.reasons.includes('spree') ?? false).toBe(false);
  });

  it('ignores duplicate transactionHash within the same window (RTDS replay safety)', () => {
    const flagger = makeFlagger();
    const big = trade({ txSuffix: 'dup', price: 0.5, size: 25_000 });
    const first = flagger.ingest(big);
    expect(first).not.toBeNull();
    expect(first!.severity).toBe('big');
    // Second ingest of the same transactionHash must be a no-op — no double flag,
    // no double-count in the cluster window.
    const second = flagger.ingest(big);
    expect(second).toBeNull();
  });

  it('prunes the cluster window using the trade payload clock, not local time', () => {
    // Simulate a Polymarket "now" that's a full day behind the local clock.
    // If the prune logic used Date.now() the seed trades would all be
    // pruned before the fresh trade arrives and no cluster would form;
    // using the trade's own timestamp keeps the window intact.
    const flagger = makeFlagger();
    const pmNow = Date.now() - 24 * 60 * 60_000;
    const seedTimes = [pmNow - 6000, pmNow - 4000, pmNow - 2000];
    for (let i = 0; i < seedTimes.length; i++) {
      flagger.ingest(
        trade({
          txSuffix: `clock-${i}`,
          price: 0.4,
          size: 1000,
          proxyWallet: `0xseed-${i}`,
          timestamp: seedTimes[i]!,
        }),
      );
    }
    const final = flagger.ingest(
      trade({
        txSuffix: 'clock-final',
        price: 0.4,
        size: 1000,
        proxyWallet: '0xseed-final',
        timestamp: pmNow,
      }),
    );
    expect(final).not.toBeNull();
    expect(final!.reasons).toContain('cluster');
  });

  it('hydrate seeds the cluster window from past records', () => {
    const flagger = makeFlagger();
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
