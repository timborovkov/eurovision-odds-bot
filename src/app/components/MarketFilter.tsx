'use client';

import type { ResolvedMarket } from '../types';

export type MarketFilterValue = Set<string>;

type Props = {
  markets: ResolvedMarket[];
  selected: MarketFilterValue;
  onChange: (next: MarketFilterValue) => void;
};

export function MarketFilter({ markets, selected, onChange }: Props) {
  const eventGroups = new Map<string, ResolvedMarket[]>();
  for (const m of markets) {
    const list = eventGroups.get(m.eventSlug) ?? [];
    list.push(m);
    eventGroups.set(m.eventSlug, list);
  }
  const events = [...eventGroups.entries()];

  const toggleEvent = (slug: string): void => {
    const next = new Set(selected);
    if (next.has(slug)) {
      next.delete(slug);
    } else {
      next.add(slug);
    }
    onChange(next);
  };

  const isAll = selected.size === 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(new Set())}
        className={`rounded border px-2.5 py-1 text-xs transition ${
          isAll
            ? 'border-warn/60 bg-warn/15 text-warn'
            : 'border-line bg-panel2 text-muted hover:text-text'
        }`}
      >
        All events
      </button>
      {events.map(([slug, list]) => {
        const active = selected.has(slug);
        const label = humanizeSlug(slug);
        return (
          <button
            key={slug}
            type="button"
            onClick={() => toggleEvent(slug)}
            title={`${list.length} market(s)`}
            className={`rounded border px-2.5 py-1 text-xs transition ${
              active
                ? 'border-warn/60 bg-warn/15 text-warn'
                : 'border-line bg-panel2 text-muted hover:text-text'
            }`}
          >
            {label}
            <span className="ml-1.5 text-[10px] text-muted">×{list.length}</span>
          </button>
        );
      })}
    </div>
  );
}

function humanizeSlug(slug: string): string {
  return (
    slug
      .replace(/^eurovision-?2026-?/, '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim() || slug
  );
}
