'use client';

import { useState } from 'react';

import { polymarketEventUrl, truncateWallet } from '@/lib/url';

import type { FlaggedItem } from '../types';

const fmtUsd = (n: number): string => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

const fmtPrice = (n: number): string => n.toFixed(4);

const fmtSize = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

const timeAgo = (ms: number): string => {
  const diff = Date.now() - ms;
  if (diff < 1000) return 'now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};

export function TradeRow({ item, isNew }: { item: FlaggedItem; isNew: boolean }) {
  const [copied, setCopied] = useState(false);

  const sideClass = item.side === 'BUY' ? 'text-buy border-buy' : 'text-sell border-sell';
  const trader = item.name ?? item.pseudonym ?? truncateWallet(item.proxyWallet);
  const polymarketHref = polymarketEventUrl({
    eventSlug: item.eventSlug,
    conditionId: item.conditionId,
  });

  const copyDetails = async (): Promise<void> => {
    const summary =
      `${item.side} ${fmtSize(item.size)} @ ${fmtPrice(item.price)} ` +
      `(notional ${fmtUsd(item.notionalUsd)}) — ${item.outcome} — ${item.title}`;
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <article
      className={`relative rounded-lg border-l-4 bg-panel px-4 py-3 ${sideClass} ${
        item.severity === 'big' ? 'ring-1 ring-big/50' : ''
      } ${isNew ? 'animate-flashIn' : ''}`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-text">{item.title}</div>
          <div className="truncate text-xs text-muted">{item.outcome}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {item.reasons.includes('size') && <Badge color="warn">LARGE</Badge>}
          {item.severity === 'big' && <Badge color="big">BIG</Badge>}
          {item.reasons.includes('cluster') && (
            <Badge color="warn">CLUSTER {item.clusterSize ? `×${item.clusterSize}` : ''}</Badge>
          )}
        </div>
      </header>

      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm sm:grid-cols-4">
        <Cell
          label="Side"
          value={item.side}
          className={item.side === 'BUY' ? 'text-buy' : 'text-sell'}
        />
        <Cell label="Price" value={fmtPrice(item.price)} />
        <Cell label="Size" value={fmtSize(item.size)} />
        <Cell label="Notional" value={fmtUsd(item.notionalUsd)} className="font-semibold" />
      </div>

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
        <div className="text-muted">
          <span className="text-text/80">{trader}</span>
          <span className="ml-2 font-mono text-muted/80">{truncateWallet(item.proxyWallet)}</span>
          <span className="ml-3">{timeAgo(item.timestamp)}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void copyDetails()}
            className="rounded border border-line bg-panel2 px-2.5 py-1 text-xs text-muted transition hover:border-muted hover:text-text"
          >
            {copied ? 'Copied' : 'Copy details'}
          </button>
          <a
            href={polymarketHref}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded bg-warn/90 px-2.5 py-1 text-xs font-medium text-bg transition hover:bg-warn"
          >
            Open on Polymarket →
          </a>
        </div>
      </footer>
    </article>
  );
}

function Badge({ color, children }: { color: 'warn' | 'big'; children: React.ReactNode }) {
  const cls =
    color === 'big' ? 'bg-big/15 text-big border-big/40' : 'bg-warn/15 text-warn border-warn/40';
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${cls}`}>
      {children}
    </span>
  );
}

function Cell({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
      <span className={className ?? 'text-text'}>{value}</span>
    </div>
  );
}
