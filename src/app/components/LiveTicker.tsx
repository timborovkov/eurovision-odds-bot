'use client';

import { polymarketEventUrl, truncateWallet } from '@/lib/url';

import type { MarketFilterValue } from './MarketFilter';

export type TickItem = {
  id: string;
  conditionId: string;
  eventSlug: string;
  marketSlug: string;
  title: string;
  outcome: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  notionalUsd: number;
  proxyWallet: string;
  pseudonym: string | null;
  name: string | null;
  timestamp: number;
};

const fmtUsd = (n: number): string => {
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return `$${n.toFixed(0)}`;
};

const TITLE_MAX = 38;
const TRADER_MAX = 16;
const shortTitle = (s: string): string =>
  s.length > TITLE_MAX ? `${s.slice(0, TITLE_MAX - 1)}…` : s;
const shortTrader = (item: TickItem): string => {
  const named = item.name ?? item.pseudonym;
  if (named && named.length <= TRADER_MAX) return named;
  return truncateWallet(item.proxyWallet);
};

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
            <a
              key={t.id}
              href={polymarketEventUrl({ eventSlug: t.eventSlug, conditionId: t.conditionId })}
              target="_blank"
              rel="noreferrer noopener"
              title={`${t.title}\n${t.outcome} @ ${t.price.toFixed(4)}\n${shortTrader(t)}`}
              className="inline-flex animate-tickerIn flex-col items-start gap-0.5 rounded border border-line bg-panel2 px-2 py-1 font-mono transition hover:border-warn/70 hover:bg-panel"
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={
                    t.side === 'BUY' ? 'font-semibold text-buy' : 'font-semibold text-sell'
                  }
                >
                  {t.side}
                </span>
                <span className="text-text">{fmtUsd(t.notionalUsd)}</span>
                <span className="text-muted/80">·</span>
                <span className="text-text">{t.outcome}</span>
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-muted">
                <span>{shortTitle(t.title)}</span>
                <span className="text-muted/60">·</span>
                <span>{shortTrader(t)}</span>
              </span>
            </a>
          ))
        )}
      </div>
    </div>
  );
}
