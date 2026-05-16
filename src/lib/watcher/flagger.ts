import { FLAG_THRESHOLDS } from '@config/eurovision.config';

import type { RtdsTrade } from './rtds';

export type TradeRecord = {
  id: string;
  conditionId: string;
  outcomeIndex: number;
  side: 'BUY' | 'SELL';
  proxyWallet: string;
  notionalUsd: number;
  timestampMs: number;
};

export type FlagReason = 'size' | 'cluster' | 'spree';

export type FlagResult = {
  reasons: FlagReason[];
  severity: 'normal' | 'big';
  clusterKey?: string;
  clusterSize?: number;
  clusterTotalUsd?: number;
  spreeKey?: string;
  spreeSize?: number;
  spreeTotalUsd?: number;
  spreeFirstTimestampMs?: number;
};

export const tradeToRecord = (t: RtdsTrade): TradeRecord => ({
  id: t.transactionHash,
  conditionId: t.conditionId,
  outcomeIndex: t.outcomeIndex,
  side: t.side,
  proxyWallet: t.proxyWallet,
  notionalUsd: t.price * t.size,
  timestampMs: t.timestamp,
});

const clusterKeyOf = (r: TradeRecord): string => `${r.conditionId}:${r.outcomeIndex}`;
const spreeKeyOf = (r: TradeRecord): string =>
  `${r.proxyWallet}:${r.conditionId}:${r.outcomeIndex}:${r.side}`;

export class Flagger {
  /** (conditionId, outcomeIndex) → recent trades for cluster detection. */
  private readonly windows = new Map<string, TradeRecord[]>();
  /** (wallet, conditionId, outcomeIndex, side) → recent trades for spree detection. */
  private readonly spreeWindows = new Map<string, TradeRecord[]>();
  private readonly emittedClusterAt = new Map<string, number>();
  private readonly emittedSpreeAt = new Map<string, number>();

  constructor(private readonly thresholds = FLAG_THRESHOLDS) {}

  /**
   * Pre-populate cluster + spree windows from persisted trades after a restart
   * so the detectors don't go blind for the first windowMs after boot.
   *
   * Uses the latest record's timestamp (Polymarket clock) as the "now" reference
   * — keeps both windows in the same clock domain as the trade payloads.
   */
  public hydrate(records: TradeRecord[]): void {
    if (records.length === 0) return;
    const latestMs = records.reduce((max, r) => (r.timestampMs > max ? r.timestampMs : max), 0);
    const clusterCutoff = latestMs - this.thresholds.cluster.windowMs;
    const spreeCutoff = latestMs - this.thresholds.spree.windowMs;
    for (const r of records) {
      if (r.timestampMs >= clusterCutoff) {
        const cKey = clusterKeyOf(r);
        const cList = this.windows.get(cKey) ?? [];
        if (!cList.some((existing) => existing.id === r.id)) {
          cList.push(r);
          this.windows.set(cKey, cList);
        }
      }
      if (r.timestampMs >= spreeCutoff) {
        const sKey = spreeKeyOf(r);
        const sList = this.spreeWindows.get(sKey) ?? [];
        if (!sList.some((existing) => existing.id === r.id)) {
          sList.push(r);
          this.spreeWindows.set(sKey, sList);
        }
      }
    }
  }

  public ingest(trade: RtdsTrade): FlagResult | null {
    const record = tradeToRecord(trade);
    const cKey = clusterKeyOf(record);
    const sKey = spreeKeyOf(record);
    // Use the trade's own payload timestamp as the "now" reference. Previously
    // prune used Date.now() (local clock) while entries carried Polymarket's
    // clock — under skew the window pruned too aggressively or too late.
    const nowMs = record.timestampMs;

    const cList = this.pruneFrom(this.windows, cKey, nowMs, this.thresholds.cluster.windowMs);
    // RTDS can replay a transactionHash on reconnect or initial snapshot —
    // don't double-count the same trade. Persist the pruned list either way so
    // expired entries don't linger across dup floods.
    if (cList.some((r) => r.id === record.id)) {
      this.windows.set(cKey, cList);
      return null;
    }
    cList.push(record);
    this.windows.set(cKey, cList);

    const sList = this.pruneFrom(this.spreeWindows, sKey, nowMs, this.thresholds.spree.windowMs);
    // The cluster dedup above already returned null for replays, so we never
    // reach here with a duplicate. But defend the spree window too in case
    // hydrate seeded a tx that then arrives live.
    if (!sList.some((r) => r.id === record.id)) {
      sList.push(record);
      this.spreeWindows.set(sKey, sList);
    }

    const reasons: FlagReason[] = [];
    let severity: 'normal' | 'big' = 'normal';

    if (
      record.notionalUsd >= this.thresholds.singleTradeUsd ||
      trade.size >= this.thresholds.singleTradeShares
    ) {
      reasons.push('size');
      if (record.notionalUsd >= this.thresholds.bigTradeUsd) severity = 'big';
    }

    const result: FlagResult = { reasons, severity };

    const cluster = this.evaluateCluster(cKey, cList, record, nowMs);
    if (cluster) {
      reasons.push('cluster');
      result.clusterKey = cKey;
      result.clusterSize = cluster.size;
      result.clusterTotalUsd = cluster.totalUsd;
      if (severity !== 'big' && cluster.totalUsd >= this.thresholds.bigTradeUsd) {
        severity = 'big';
      }
    }

    const spree = this.evaluateSpree(sKey, sList, record, nowMs);
    if (spree) {
      reasons.push('spree');
      result.spreeKey = sKey;
      result.spreeSize = spree.size;
      result.spreeTotalUsd = spree.totalUsd;
      result.spreeFirstTimestampMs = spree.firstTimestampMs;
      if (severity !== 'big' && spree.totalUsd >= this.thresholds.bigTradeUsd) {
        severity = 'big';
      }
    }

    if (reasons.length === 0) return null;
    result.severity = severity;
    return result;
  }

  private pruneFrom(
    map: Map<string, TradeRecord[]>,
    key: string,
    nowMs: number,
    windowMs: number,
  ): TradeRecord[] {
    const cutoff = nowMs - windowMs;
    return (map.get(key) ?? []).filter((r) => r.timestampMs >= cutoff);
  }

  private evaluateCluster(
    key: string,
    list: TradeRecord[],
    newest: TradeRecord,
    nowMs: number,
  ): { size: number; totalUsd: number } | null {
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
    return { size: list.length, totalUsd };
  }

  private evaluateSpree(
    key: string,
    list: TradeRecord[],
    _newest: TradeRecord,
    nowMs: number,
  ): { size: number; totalUsd: number; firstTimestampMs: number } | null {
    const { minTrades, minTotalUsd, windowMs } = this.thresholds.spree;

    if (list.length < minTrades) return null;
    let totalUsd = 0;
    let firstTimestampMs = Number.POSITIVE_INFINITY;
    for (const r of list) {
      totalUsd += r.notionalUsd;
      if (r.timestampMs < firstTimestampMs) firstTimestampMs = r.timestampMs;
    }
    if (totalUsd < minTotalUsd) return null;

    // Re-emit dedup: don't surface the same spree more than once per window —
    // every subsequent trade from the same wallet keeps adding to the streak
    // visually via spreeSize, but only emits a new flag once the window resets.
    const lastEmitted = this.emittedSpreeAt.get(key) ?? 0;
    if (nowMs - lastEmitted < windowMs) return null;

    this.emittedSpreeAt.set(key, nowMs);
    return { size: list.length, totalUsd, firstTimestampMs };
  }
}
