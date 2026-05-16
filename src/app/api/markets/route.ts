import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const markets = await prisma.market.findMany({
    orderBy: { eventSlug: 'asc' },
  });
  return NextResponse.json({
    markets: markets.map((m) => ({
      conditionId: m.conditionId,
      eventSlug: m.eventSlug,
      marketSlug: m.marketSlug,
      question: m.question,
      outcomes: safeParseArray(m.outcomes),
    })),
  });
}

function safeParseArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}
