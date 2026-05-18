import { describe, expect, it } from 'vitest';

import { WATCHED_MARKETS } from '@config/markets.config';
import { resolveEvent } from '@/lib/polymarket/gamma';
import { RtdsTradePayload } from '@/lib/watcher/rtds';

/**
 * The RTDS WebSocket trade payload uses the same shape as the data-api `/trades`
 * endpoint. Validating real historical trades through our zod schema proves the
 * schema is accurate without depending on whether a live trade happens to fire
 * during the test window.
 */
describe('RtdsTradePayload schema vs live data-api', () => {
  it('parses recent trades for a resolved configured market', async () => {
    let chosenConditionId: string | null = null;

    // Prefer open markets (likely to have recent trades) but fall back to any
    // configured market — even settled markets retain historical trade rows.
    outer: for (const ref of WATCHED_MARKETS) {
      const event = await resolveEvent(ref.eventSlug);
      if (!event) continue;
      const candidates = [...event.markets, ...event.allMarkets.filter((m) => m.closed)];
      for (const market of candidates) {
        const probe = await fetch(
          `https://data-api.polymarket.com/trades?market=${market.conditionId}&limit=1`,
          { headers: { accept: 'application/json' } },
        );
        if (!probe.ok) continue;
        const probeBody = (await probe.json()) as unknown[];
        if (Array.isArray(probeBody) && probeBody.length > 0) {
          chosenConditionId = market.conditionId;
          break outer;
        }
      }
    }

    expect(
      chosenConditionId,
      'no configured market conditionId resolvable for schema test',
    ).not.toBeNull();

    const url = `https://data-api.polymarket.com/trades?market=${chosenConditionId}&limit=20`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    expect(res.ok, `data-api returned ${res.status} for ${url}`).toBe(true);

    const body = (await res.json()) as unknown;
    expect(Array.isArray(body), 'data-api /trades should return an array').toBe(true);
    const rows = body as unknown[];

    // Configured markets may be quiet; if there's literally no history, fall back to a
    // known high-volume condition (Polymarket's "BTC up or down today" daily market style
    // changes too often to hardcode — we just skip if no rows).
    if (rows.length === 0) {
      console.warn(`[trade-schema] no historical trades for ${chosenConditionId}; skipping`);
      return;
    }

    for (const row of rows) {
      // Coerce timestamp string → number if needed (data-api occasionally returns string).
      const normalized =
        typeof (row as Record<string, unknown>).timestamp === 'string'
          ? { ...(row as object), timestamp: Number((row as Record<string, unknown>).timestamp) }
          : row;
      const parsed = RtdsTradePayload.safeParse(normalized);
      if (!parsed.success) {
        // Print the first offender for debugging
        console.error('[trade-schema] failed parse:', parsed.error.flatten(), row);
      }
      expect(parsed.success, 'RtdsTradePayload must parse a real /trades row').toBe(true);
    }
  }, 30_000);
});
