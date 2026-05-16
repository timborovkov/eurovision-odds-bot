import { z } from 'zod';

import { env } from '@/env';

const GammaMarket = z
  .object({
    conditionId: z.string(),
    question: z.string(),
    slug: z.string(),
    outcomes: z.string().optional(),
    clobTokenIds: z.string().optional(),
    active: z.boolean().optional(),
    closed: z.boolean().optional(),
  })
  .passthrough();

const GammaEvent = z
  .object({
    slug: z.string(),
    title: z.string().optional(),
    markets: z.array(GammaMarket).optional(),
  })
  .passthrough();

const GammaEventsArray = z.array(GammaEvent);

export type ResolvedMarket = {
  conditionId: string;
  question: string;
  marketSlug: string;
  outcomes: string[];
  clobTokenIds: string[];
  closed: boolean;
};

export type ResolvedEvent = {
  eventSlug: string;
  title: string;
  /** Markets the bot will subscribe to / display (open only). */
  markets: ResolvedMarket[];
  /** All markets returned by Gamma, including closed/settled ones. Useful for tests. */
  allMarkets: ResolvedMarket[];
};

const safeJsonArray = (raw: string | undefined): string[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
};

export async function resolveEvent(eventSlug: string): Promise<ResolvedEvent | null> {
  const url = `${env.GAMMA_BASE}/events?slug=${encodeURIComponent(eventSlug)}`;
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Gamma /events failed for ${eventSlug}: HTTP ${res.status}`);
  }
  const body: unknown = await res.json();
  const events = GammaEventsArray.safeParse(body);
  if (!events.success || events.data.length === 0) return null;

  const event = events.data[0];
  if (!event) return null;

  const allMarkets: ResolvedMarket[] = (event.markets ?? []).map((m) => ({
    conditionId: m.conditionId,
    question: m.question,
    marketSlug: m.slug,
    outcomes: safeJsonArray(m.outcomes),
    clobTokenIds: safeJsonArray(m.clobTokenIds),
    closed: m.closed === true,
  }));

  return {
    eventSlug: event.slug,
    title: event.title ?? event.slug,
    markets: allMarkets.filter((m) => !m.closed),
    allMarkets,
  };
}
