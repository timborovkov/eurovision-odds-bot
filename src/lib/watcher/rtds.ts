import { RealTimeDataClient } from '@polymarket/real-time-data-client';
import type { Message } from '@polymarket/real-time-data-client';
import { z } from 'zod';

import { env } from '@/env';

export const RtdsTradePayload = z.object({
  asset: z.string(),
  conditionId: z.string(),
  eventSlug: z.string(),
  slug: z.string(),
  title: z.string(),
  outcome: z.string(),
  outcomeIndex: z.number().int(),
  side: z.enum(['BUY', 'SELL']),
  price: z.number(),
  size: z.number(),
  timestamp: z.number(),
  transactionHash: z.string(),
  proxyWallet: z.string(),
  pseudonym: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  bio: z.string().optional().nullable(),
});

export type RtdsTrade = z.infer<typeof RtdsTradePayload>;

export type ConnectionState = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED';

export type WatcherCallbacks = {
  onTrade: (trade: RtdsTrade) => void | Promise<void>;
  onStatusChange?: (status: ConnectionState) => void;
};

export class RtdsWatcher {
  private client: RealTimeDataClient | null = null;
  private readonly eventSlugs: string[];
  private status: ConnectionState = 'DISCONNECTED';

  constructor(
    eventSlugs: string[],
    private readonly callbacks: WatcherCallbacks,
  ) {
    this.eventSlugs = [...new Set(eventSlugs)];
  }

  public getStatus(): ConnectionState {
    return this.status;
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
    for (const slug of this.eventSlugs) {
      client.subscribe({
        subscriptions: [
          {
            topic: 'activity',
            type: 'trades',
            filters: JSON.stringify({ event_slug: slug }),
          },
        ],
      });
    }
    console.log(`[rtds] connected, subscribed to ${this.eventSlugs.length} event slug(s)`);
  }

  private handleMessage(message: Message): void {
    if (message.topic !== 'activity' || message.type !== 'trades') return;
    const parsed = RtdsTradePayload.safeParse(message.payload);
    if (!parsed.success) {
      console.warn('[rtds] dropped malformed trade payload', parsed.error.flatten());
      return;
    }
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
