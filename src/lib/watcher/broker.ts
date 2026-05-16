import { EventEmitter } from 'node:events';

import type { ConnectionState } from './rtds';

export type FlaggedFeedItem = {
  id: string;
  tradeId: string;
  conditionId: string;
  eventSlug: string;
  marketSlug: string;
  title: string;
  question: string;
  outcome: string;
  outcomeIndex: number;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  notionalUsd: number;
  proxyWallet: string;
  pseudonym: string | null;
  name: string | null;
  timestamp: number;
  reasons: ('size' | 'cluster')[];
  severity: 'normal' | 'big';
  clusterKey: string | null;
  clusterSize: number | null;
  transactionHash: string;
};

export type FeedEvent =
  | { type: 'flagged'; data: FlaggedFeedItem }
  | { type: 'status'; status: ConnectionState }
  | { type: 'heartbeat'; ts: number };

class FeedBroker extends EventEmitter {
  private lastStatus: ConnectionState = 'DISCONNECTED';

  public publish(event: FeedEvent): void {
    if (event.type === 'status') this.lastStatus = event.status;
    this.emit('event', event);
  }

  public getStatus(): ConnectionState {
    return this.lastStatus;
  }

  public subscribe(handler: (event: FeedEvent) => void): () => void {
    this.on('event', handler);
    return () => this.off('event', handler);
  }
}

const globalForBroker = globalThis as unknown as { __feedBroker?: FeedBroker };

export const broker: FeedBroker =
  globalForBroker.__feedBroker ?? (globalForBroker.__feedBroker = new FeedBroker());

broker.setMaxListeners(100);
