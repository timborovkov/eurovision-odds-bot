'use client';

import type { MarketFilterValue } from './MarketFilter';

export type TickItem = {
  id: string;
  eventSlug: string;
  outcome: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  notionalUsd: number;
  timestamp: number;
};

const fmtUsd = (n: number): string => {
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `$${n.toFixed(0)}`;
};

const shortOutcome = (s: string): string => (s.length > 18 ? `${s.slice(0, 17)}…` : s);

export function LiveTicker({
  items,
  selectedEvents,
}: {
  items: TickItem[];
  selectedEvents: MarketFilterValue;
}) {
  const filtered =
    selectedEvents.size === 0 ? items : items.filter((i) => selectedEvents.has(i.eventSlug));

  return (
    <div className="flex items-center gap-2 overflow-hidden rounded-lg border border-line bg-panel/60 px-3 py-2">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted">
        Live
      </span>
      <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-buy/70" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-buy" />
      </span>
      <div className="flex flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap text-xs">
        {filtered.length === 0 ? (
          <span className="text-muted/70">listening for trades…</span>
        ) : (
          filtered.map((t) => (
            <span
              key={t.id}
              className="inline-flex animate-tickerIn items-center gap-1.5 rounded border border-line bg-panel2 px-2 py-0.5 font-mono"
            >
              <span
                className={t.side === 'BUY' ? 'font-semibold text-buy' : 'font-semibold text-sell'}
              >
                {t.side}
              </span>
              <span className="text-text">{fmtUsd(t.notionalUsd)}</span>
              <span className="text-muted">{shortOutcome(t.outcome)}</span>
            </span>
          ))
        )}
      </div>
    </div>
  );
}
