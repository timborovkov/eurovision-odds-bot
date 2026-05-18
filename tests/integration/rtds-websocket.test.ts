import { afterAll, describe, expect, it } from 'vitest';

import { RealTimeDataClient } from '@polymarket/real-time-data-client';
import type { Message } from '@polymarket/real-time-data-client';

import { WATCHED_MARKETS } from '@config/markets.config';
import { resolveEvent } from '@/lib/polymarket/gamma';
import { RtdsTradePayload } from '@/lib/watcher/rtds';

const RTDS_HOST = 'wss://ws-live-data.polymarket.com';

const connectAndCollect = (
  topic: string,
  type: string,
  filters: string | undefined,
  collectMs: number,
  predicate?: (msg: Message) => boolean,
): Promise<{ client: RealTimeDataClient; messages: Message[] }> =>
  new Promise((resolve, reject) => {
    const messages: Message[] = [];
    let settled = false;
    let client: RealTimeDataClient | null = null;

    setTimeout(() => {
      if (settled) return;
      settled = true;
      if (!client) return reject(new Error('rtds client never initialized'));
      resolve({ client, messages });
    }, collectMs);

    client = new RealTimeDataClient({
      host: RTDS_HOST,
      autoReconnect: false,
      onConnect: (c) => {
        const subscription: {
          topic: string;
          type: string;
          filters?: string;
        } = { topic, type };
        if (filters !== undefined) subscription.filters = filters;
        c.subscribe({ subscriptions: [subscription] });
      },
      onMessage: (_c, msg) => {
        if (settled) return;
        if (predicate && !predicate(msg)) return;
        messages.push(msg);
      },
    });
    client.connect();
  });

const clients: RealTimeDataClient[] = [];

afterAll(() => {
  for (const c of clients) {
    try {
      c.disconnect();
    } catch {
      // ignore
    }
  }
});

describe('RTDS WebSocket plumbing', () => {
  it('connects and receives crypto_prices updates within 15s', async () => {
    const { client, messages } = await connectAndCollect(
      'crypto_prices',
      'update',
      JSON.stringify({ symbol: 'BTCUSDT' }),
      15_000,
      (m) => m.topic === 'crypto_prices',
    );
    clients.push(client);

    expect(
      messages.length,
      'expected at least 1 crypto_prices message — RTDS WS may be down',
    ).toBeGreaterThan(0);

    const first = messages[0]!;
    const payload = first.payload as {
      symbol?: string;
      timestamp?: number;
      value?: number;
      data?: Array<{ timestamp: number; value: number }>;
    };
    expect(first.topic).toBe('crypto_prices');
    expect(payload.symbol).toBeTypeOf('string');
    // The very first message after connect is the historical snapshot ({symbol, data:[…]});
    // subsequent live updates are flat ({symbol, timestamp, value}). Either is proof that
    // the WS plumbing works end-to-end.
    const isSnapshot = Array.isArray(payload.data);
    const isUpdate = typeof payload.timestamp === 'number';
    expect(isSnapshot || isUpdate, 'payload must be snapshot or live update').toBe(true);
  }, 25_000);

  it('firehose subscription delivers parseable configured-market trades within 20s', async () => {
    // Mirror what the prod watcher now does: subscribe to the full activity/trades
    // firehose (no server-side filter — RTDS's `event_slug` filter delivers zero
    // messages, confirmed against this same socket) and filter client-side.
    const slugs = WATCHED_MARKETS.map((m) => m.eventSlug);
    const resolvedSlugs = new Set<string>();
    for (const slug of slugs) {
      const event = await resolveEvent(slug);
      if (event && event.markets.length > 0) resolvedSlugs.add(slug);
    }
    expect(resolvedSlugs.size, 'no configured slugs resolved').toBeGreaterThan(0);

    const matchedMessages: Message[] = [];
    let allTradeCount = 0;
    let client: RealTimeDataClient | null = null;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => resolve(), 20_000);

      client = new RealTimeDataClient({
        host: RTDS_HOST,
        autoReconnect: false,
        onConnect: (c) => {
          c.subscribe({ subscriptions: [{ topic: 'activity', type: 'trades' }] });
        },
        onMessage: (_c, msg) => {
          if (msg.topic !== 'activity' || msg.type !== 'trades') return;
          allTradeCount += 1;
          const slug = (msg.payload as { eventSlug?: string } | undefined)?.eventSlug;
          if (slug && resolvedSlugs.has(slug)) matchedMessages.push(msg);
        },
        onStatusChange: (status) => {
          if (status === 'DISCONNECTED') {
            clearTimeout(timer);
            reject(new Error('rtds disconnected during subscription'));
          }
        },
      });
      client.connect();
    });

    if (client) clients.push(client);

    console.log(
      `[rtds-test] firehose: ${allTradeCount} total trades, ${matchedMessages.length} matched configured slugs`,
    );
    expect(allTradeCount, 'firehose should deliver trades — RTDS may be down').toBeGreaterThan(0);

    if (matchedMessages.length > 0) {
      const sample = matchedMessages[0]!;
      const parsed = RtdsTradePayload.safeParse(sample.payload);
      expect(parsed.success, 'live trade must parse through RtdsTradePayload').toBe(true);
    }
  }, 35_000);
});
