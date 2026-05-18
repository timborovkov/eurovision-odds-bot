import { describe, expect, it } from 'vitest';

import { WATCHED_MARKETS } from '@config/markets.config';
import { resolveEvent } from '@/lib/polymarket/gamma';

describe('Gamma market resolution', () => {
  it.each(WATCHED_MARKETS.map((m) => m.eventSlug))(
    'event slug %s exists on Gamma with at least one child market',
    async (slug) => {
      const event = await resolveEvent(slug);

      expect(event, `Gamma returned null for slug "${slug}" — slug is wrong`).not.toBeNull();
      const resolved = event!;
      expect(resolved.eventSlug).toBe(slug);
      expect(
        resolved.allMarkets.length,
        `slug "${slug}" exists but has no child markets at all`,
      ).toBeGreaterThan(0);

      for (const market of resolved.allMarkets) {
        expect(market.conditionId).toMatch(/^0x[0-9a-fA-F]{64}$/);
        expect(market.question).toBeTypeOf('string');
        expect(market.question.length).toBeGreaterThan(0);
        expect(market.marketSlug.length).toBeGreaterThan(0);
        expect(market.outcomes.length).toBeGreaterThanOrEqual(2);
      }

      if (resolved.markets.length === 0) {
        console.warn(
          `[gamma-test] slug "${slug}" resolves but every child market is closed/settled — ` +
            `nothing to subscribe to. Remove from config or wait for new markets.`,
        );
      } else {
        console.log(
          `[gamma-test] slug "${slug}" → ${resolved.markets.length} open / ` +
            `${resolved.allMarkets.length} total markets`,
        );
      }
    },
    30_000,
  );

  it('at least one configured slug has open markets to subscribe to', async () => {
    let openTotal = 0;
    for (const ref of WATCHED_MARKETS) {
      const event = await resolveEvent(ref.eventSlug);
      if (event) openTotal += event.markets.length;
    }
    expect(
      openTotal,
      'no configured event has any open markets — the bot would have nothing to do',
    ).toBeGreaterThan(0);
  }, 30_000);
});
