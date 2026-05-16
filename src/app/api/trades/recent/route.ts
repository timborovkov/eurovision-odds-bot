import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get('limit') ?? '100');
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 100;

  const rows = await prisma.flaggedTrade.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { trade: true },
  });

  return NextResponse.json({
    flagged: rows.map((r) => ({
      id: r.id,
      tradeId: r.tradeId,
      reason: r.reason,
      severity: r.severity,
      clusterKey: r.clusterKey,
      clusterSize: r.clusterSize,
      createdAt: r.createdAt.toISOString(),
      trade: {
        id: r.trade.id,
        conditionId: r.trade.conditionId,
        eventSlug: r.trade.eventSlug,
        marketSlug: r.trade.marketSlug,
        title: r.trade.title,
        outcome: r.trade.outcome,
        outcomeIndex: r.trade.outcomeIndex,
        side: r.trade.side,
        price: r.trade.price,
        size: r.trade.size,
        notionalUsd: r.trade.notionalUsd,
        proxyWallet: r.trade.proxyWallet,
        pseudonym: r.trade.pseudonym,
        name: r.trade.name,
        timestamp: r.trade.timestamp.toISOString(),
      },
    })),
  });
}
