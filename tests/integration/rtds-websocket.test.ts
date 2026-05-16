import { afterAll, describe, expect, it } from 'vitest';

import { RealTimeDataClient } from '@polymarket/real-time-data-client';
import type { Message } from '@polymarket/real-time-data-client';

import { EUROVISION_MARKETS } from '@config/eurovision.config';
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

  it('accepts subscriptions for every configured Eurovision event slug without error', async () => {
    // Verify the slugs we actually subscribe to in prod are accepted by the server.
    // We don't assert that trades arrive (Eurovision markets can be quiet for minutes);
    // we assert that the server doesn't drop the connection and that any trades we DO
    // receive parse cleanly through our schema.
    const slugs = EUROVISION_MARKETS.map((m) => m.eventSlug);
    const resolvedSlugs: string[] = [];
    for (const slug of slugs) {
      const event = await resolveEvent(slug);
      if (event && event.markets.length > 0) resolvedSlugs.push(slug);
    }
    expect(resolvedSlugs.length, 'no Eurovision slugs resolved').toBeGreaterThan(0);

    const messages: Message[] = [];
    let client: RealTimeDataClient | null = null;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => resolve(), 12_000);

      client = new RealTimeDataClient({
        host: RTDS_HOST,
        autoReconnect: false,
        onConnect: (c) => {
          for (const slug of resolvedSlugs) {
            c.subscribe({
              subscriptions: [
                {
                  topic: 'activity',
                  type: 'trades',
                  filters: JSON.stringify({ event_slug: slug }),
                },
              ],
            });
          }
        },
        onMessage: (_c, msg) => {
          if (msg.topic === 'activity' && msg.type === 'trades') {
            messages.push(msg);
          }
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

    if (messages.length > 0) {
      console.log(`[rtds-test] received ${messages.length} Eurovision trade(s) during window`);
      const sample = messages[0]!;
      const parsed = RtdsTradePayload.safeParse(sample.payload);
      expect(parsed.success, 'live Eurovision trade must parse through RtdsTradePayload').toBe(
        true,
      );
    } else {
      console.log('[rtds-test] no Eurovision trades arrived in window (markets likely quiet)');
    }
  }, 30_000);
});
