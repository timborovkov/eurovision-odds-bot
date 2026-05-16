import { NextResponse } from 'next/server';

import { getWatcherStats } from '@/lib/watcher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  const stats = getWatcherStats();
  return NextResponse.json({ ok: true, ...stats });
}
