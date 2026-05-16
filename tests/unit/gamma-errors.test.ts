import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveEvent } from '@/lib/polymarket/gamma';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('resolveEvent error paths', () => {
  it('returns null when Gamma returns an empty event array', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
    ) as unknown as typeof fetch;
    const result = await resolveEvent('does-not-exist');
    expect(result).toBeNull();
  });

  it('returns null when Gamma returns an unexpected shape', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response('{"not":"an array"}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    const result = await resolveEvent('weird-shape');
    expect(result).toBeNull();
  });

  it('throws on a 5xx response so the caller can log + retry on next boot', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('upstream down', { status: 503 }),
    ) as unknown as typeof fetch;
    await expect(resolveEvent('any-slug')).rejects.toThrow(/Gamma .* 503/);
  });

  it('throws on a 404 (caller decides whether to skip the slug)', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('not found', { status: 404 }),
    ) as unknown as typeof fetch;
    await expect(resolveEvent('missing')).rejects.toThrow(/Gamma .* 404/);
  });

  it('separates open vs closed markets in the result', async () => {
    const payload = [
      {
        slug: 'mock-event',
        title: 'Mock Event',
        markets: [
          {
            conditionId: '0x' + 'a'.repeat(64),
            question: 'Open one?',
            slug: 'open-one',
            outcomes: '["Yes","No"]',
            clobTokenIds: '["1","2"]',
            closed: false,
          },
          {
            conditionId: '0x' + 'b'.repeat(64),
            question: 'Closed one?',
            slug: 'closed-one',
            outcomes: '["Yes","No"]',
            clobTokenIds: '["3","4"]',
            closed: true,
          },
        ],
      },
    ];
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    const result = await resolveEvent('mock-event');
    expect(result).not.toBeNull();
    expect(result!.allMarkets).toHaveLength(2);
    expect(result!.markets).toHaveLength(1);
    expect(result!.markets[0]!.marketSlug).toBe('open-one');
  });
});
