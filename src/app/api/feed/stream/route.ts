import type { NextRequest } from 'next/server';

import { broker, type FeedEvent } from '@/lib/watcher/broker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

const formatSse = (event: FeedEvent): string => {
  const payload = JSON.stringify(event);
  return `event: ${event.type}\ndata: ${payload}\n\n`;
};

export function GET(request: NextRequest): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string): void => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // controller closed; subscription cleanup will run from abort handler
        }
      };

      send(`retry: 3000\n\n`);
      send(formatSse({ type: 'status', status: broker.getStatus() }));

      const unsubscribe = broker.subscribe((event) => send(formatSse(event)));

      const keepalive = setInterval(() => send(`: keep-alive\n\n`), 20_000);

      request.signal.addEventListener('abort', () => {
        clearInterval(keepalive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
