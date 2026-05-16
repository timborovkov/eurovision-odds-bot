import { RealTimeDataClient } from '@polymarket/real-time-data-client';
import type { Message } from '@polymarket/real-time-data-client';
import { z } from 'zod';

import { env } from '@/env';

// Permissive on purpose. During a live event we'd rather coerce / default a
// weird field than silently drop every trade because Polymarket flipped a type
// or added a field. Hard requirements are only the ones handleTrade actually
// needs to dedupe, persist, and route.
export const RtdsTradePayload = z
  .object({
    asset: z.string(),
    conditionId: z.string(),
    eventSlug: z.string(),
    slug: z.string(),
    title: z.string().default(''),
    outcome: z.string().default(''),
    outcomeIndex: z.coerce.number().int().default(0),
    side: z.enum(['BUY', 'SELL']),
    price: z.coerce.number(),
    size: z.coerce.number(),
    timestamp: z.coerce.number(),
    transactionHash: z.string(),
    proxyWallet: z.string(),
    pseudonym: z.string().nullish(),
    name: z.string().nullish(),
    bio: z.string().nullish(),
  })
  .passthrough();

export type RtdsTrade = z.infer<typeof RtdsTradePayload>;

export type ConnectionState = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED';

export type WatcherCallbacks = {
  onTrade: (trade: RtdsTrade) => void | Promise<void>;
  onStatusChange?: (status: ConnectionState) => void;
};

export type RtdsCounters = {
  rawMessages: number;
  tradeMessages: number;
  /** Trades whose eventSlug isn't in our subscribed set — we discard these. */
  filteredOut: number;
  dropped: number;
  lastRawAt: number | null;
  lastTradeAt: number | null;
  recentDrops: { reason: string; sample: string }[];
};

const MAX_DROP_SAMPLES = 3;
const SAMPLE_CHARS = 1024;
const FULL_LOG_LIMIT = 5;

export class RtdsWatcher {
  private client: RealTimeDataClient | null = null;
  private readonly eventSlugs: string[];
  private status: ConnectionState = 'DISCONNECTED';

  private rawMessages = 0;
  private tradeMessages = 0;
  private filteredOut = 0;
  private dropped = 0;
  private lastRawAt: number | null = null;
  private lastTradeAt: number | null = null;
  private recentDrops: { reason: string; sample: string }[] = [];
  private fullLogsEmitted = 0;

  private readonly slugSet: Set<string>;

  constructor(
    eventSlugs: string[],
    private readonly callbacks: WatcherCallbacks,
  ) {
    this.eventSlugs = [...new Set(eventSlugs)];
    this.slugSet = new Set(this.eventSlugs);
  }

  public getStatus(): ConnectionState {
    return this.status;
  }

  public getCounters(): RtdsCounters {
    return {
      rawMessages: this.rawMessages,
      tradeMessages: this.tradeMessages,
      filteredOut: this.filteredOut,
      dropped: this.dropped,
      lastRawAt: this.lastRawAt,
      lastTradeAt: this.lastTradeAt,
      recentDrops: this.recentDrops.slice(),
    };
  }

  public start(): void {
    if (this.client) return;
    this.client = new RealTimeDataClient({
      host: env.RTDS_HOST,
      autoReconnect: true,
      onConnect: (client) => this.handleConnect(client),
      onMessage: (_client, message) => this.handleMessage(message),
      onStatusChange: (status) => this.handleStatusChange(status as ConnectionState),
    });
    this.client.connect();
  }

  public stop(): void {
    this.client?.disconnect();
    this.client = null;
    this.setStatus('DISCONNECTED');
  }

  private handleConnect(client: RealTimeDataClient): void {
    this.setStatus('CONNECTED');
    // The server-side `event_slug` filter on `activity/trades` is broken — subscribing
    // with the filter results in ZERO messages even for high-volume Eurovision slugs
    // that we can confirm are trading via the data-api. Subscribe to the whole firehose
    // and filter client-side against this.slugSet. Volume is ~50 trades/sec across all
    // of Polymarket, which is trivial to filter in process.
    client.subscribe({
      subscriptions: [{ topic: 'activity', type: 'trades' }],
    });
    console.log(
      `[rtds] connected, subscribed to activity/trades firehose (client-side filtering ${this.eventSlugs.length} slug(s))`,
    );
  }

  private handleMessage(message: Message): void {
    this.rawMessages += 1;
    this.lastRawAt = Date.now();
    if (message.topic !== 'activity' || message.type !== 'trades') return;
    this.tradeMessages += 1;
    const parsed = RtdsTradePayload.safeParse(message.payload);
    if (!parsed.success) {
      this.dropped += 1;
      const reason = JSON.stringify(parsed.error.flatten());
      const sample = JSON.stringify(message.payload).slice(0, SAMPLE_CHARS);
      if (this.recentDrops.length < MAX_DROP_SAMPLES) {
        this.recentDrops.push({ reason, sample });
      }
      if (this.fullLogsEmitted < FULL_LOG_LIMIT) {
        this.fullLogsEmitted += 1;
        console.warn('[rtds] dropped malformed trade payload', { reason, sample });
      }
      return;
    }
    // Server-side event_slug filter is broken (see handleConnect); gate here.
    if (!this.slugSet.has(parsed.data.eventSlug)) {
      this.filteredOut += 1;
      return;
    }
    this.lastTradeAt = Date.now();
    void this.callbacks.onTrade(parsed.data);
  }

  private handleStatusChange(status: ConnectionState): void {
    this.setStatus(status);
  }

  private setStatus(next: ConnectionState): void {
    if (this.status === next) return;
    this.status = next;
    console.log(`[rtds] status=${next}`);
    this.callbacks.onStatusChange?.(next);
  }
}
