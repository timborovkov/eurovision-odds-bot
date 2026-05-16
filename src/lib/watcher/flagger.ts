import { FLAG_THRESHOLDS } from '@config/eurovision.config';

import type { RtdsTrade } from './rtds';

export type TradeRecord = {
  id: string;
  conditionId: string;
  outcomeIndex: number;
  proxyWallet: string;
  notionalUsd: number;
  timestampMs: number;
};

export type FlagResult = {
  reasons: ('size' | 'cluster')[];
  severity: 'normal' | 'big';
  clusterKey?: string;
  clusterSize?: number;
};

export const tradeToRecord = (t: RtdsTrade): TradeRecord => ({
  id: t.transactionHash,
  conditionId: t.conditionId,
  outcomeIndex: t.outcomeIndex,
  proxyWallet: t.proxyWallet,
  notionalUsd: t.price * t.size,
  timestampMs: t.timestamp,
});

const clusterKeyOf = (r: TradeRecord): string => `${r.conditionId}:${r.outcomeIndex}`;

export class Flagger {
  private readonly windows = new Map<string, TradeRecord[]>();
  private readonly emittedClusterAt = new Map<string, number>();

  constructor(private readonly thresholds = FLAG_THRESHOLDS) {}

  /**
   * Pre-populate cluster windows from persisted trades after a restart so the
   * detector doesn't go blind for the first windowMs after boot.
   *
   * Uses the latest record's timestamp (Polymarket clock) as the "now" reference
   * — keeps the cluster window in the same clock domain as the trade payloads.
   */
  public hydrate(records: TradeRecord[]): void {
    if (records.length === 0) return;
    const latestMs = records.reduce((max, r) => (r.timestampMs > max ? r.timestampMs : max), 0);
    const cutoff = latestMs - this.thresholds.cluster.windowMs;
    for (const r of records) {
      if (r.timestampMs < cutoff) continue;
      const key = clusterKeyOf(r);
      const list = this.windows.get(key) ?? [];
      if (list.some((existing) => existing.id === r.id)) continue;
      list.push(r);
      this.windows.set(key, list);
    }
  }

  public ingest(trade: RtdsTrade): FlagResult | null {
    const record = tradeToRecord(trade);
    const key = clusterKeyOf(record);
    // Use the trade's own payload timestamp as the "now" reference for the
    // cluster window. Previously prune used Date.now() (local clock) while
    // entries carried Polymarket's clock — under skew the window pruned
    // either too aggressively or too late.
    const nowMs = record.timestampMs;

    const list = this.prune(key, nowMs);
    // RTDS can replay a transactionHash on reconnect or initial snapshot —
    // don't double-count the same trade in the cluster window. Persist the
    // pruned list either way so expired entries don't linger across dup floods.
    if (list.some((r) => r.id === record.id)) {
      this.windows.set(key, list);
      return null;
    }
    list.push(record);
    this.windows.set(key, list);

    const reasons: ('size' | 'cluster')[] = [];
    let severity: 'normal' | 'big' = 'normal';

    if (
      record.notionalUsd >= this.thresholds.singleTradeUsd ||
      trade.size >= this.thresholds.singleTradeShares
    ) {
      reasons.push('size');
      if (record.notionalUsd >= this.thresholds.bigTradeUsd) severity = 'big';
    }

    const cluster = this.evaluateCluster(key, list, record, nowMs);
    if (cluster) {
      reasons.push('cluster');
      // Severity is the OR of the two big-trade signals: either the individual
      // trade ≥ bigTradeUsd (already evaluated above) OR the cluster total
      // ≥ bigTradeUsd. We must evaluate this even when `size` also fired,
      // otherwise a $2k trade inside a $15k cluster stays at severity:"normal".
      if (severity !== 'big') {
        const totalUsd = list.reduce((sum, r) => sum + r.notionalUsd, 0);
        if (totalUsd >= this.thresholds.bigTradeUsd) severity = 'big';
      }
      return { reasons, severity, clusterKey: key, clusterSize: cluster.size };
    }

    if (reasons.length === 0) return null;
    return { reasons, severity };
  }

  private prune(key: string, nowMs: number): TradeRecord[] {
    const cutoff = nowMs - this.thresholds.cluster.windowMs;
    const list = (this.windows.get(key) ?? []).filter((r) => r.timestampMs >= cutoff);
    return list;
  }

  private evaluateCluster(
    key: string,
    list: TradeRecord[],
    newest: TradeRecord,
    nowMs: number,
  ): { size: number } | null {
    const { minTrades, minTotalUsd, sameBuyerWeight, windowMs } = this.thresholds.cluster;

    const buyerCounts = new Map<string, number>();
    let totalUsd = 0;
    for (const r of list) {
      totalUsd += r.notionalUsd;
      buyerCounts.set(r.proxyWallet, (buyerCounts.get(r.proxyWallet) ?? 0) + 1);
    }

    let weighted = 0;
    for (const [, count] of buyerCounts) {
      if (count >= 2) {
        weighted += count * sameBuyerWeight;
      } else {
        weighted += count;
      }
    }

    if (weighted < minTrades || totalUsd < minTotalUsd) return null;

    const lastEmitted = this.emittedClusterAt.get(key) ?? 0;
    const sameBuyerExisting = (buyerCounts.get(newest.proxyWallet) ?? 0) >= 2;
    const windowFresh = nowMs - lastEmitted >= windowMs;

    if (!windowFresh && !sameBuyerExisting) return null;

    this.emittedClusterAt.set(key, nowMs);
    return { size: list.length };
  }
}
