import { env, telegramConfigured } from '@/env';
import { polymarketEventUrl, truncateWallet } from '@/lib/url';

import type { FlaggedFeedItem } from '../watcher/broker';

const escapeHtml = (raw: string): string =>
  raw.replace(/[&<>"]/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return c;
    }
  });

const fmtUsd = (n: number): string => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

const fmtUsdRounded = (n: number): string =>
  `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export function buildTelegramMessage(item: FlaggedFeedItem): string {
  const sideEmoji = item.side === 'BUY' ? '🟢' : '🔴';
  const sevEmoji = item.severity === 'big' ? '🚨🚨' : '⚡';
  const reasonLabels = item.reasons.map((r) => r.toUpperCase()).join(' + ');
  const trader = item.name ?? item.pseudonym ?? truncateWallet(item.proxyWallet);
  const url = polymarketEventUrl({
    eventSlug: item.eventSlug,
    conditionId: item.conditionId,
  });

  const lines: string[] = [
    `${sevEmoji} <b>${reasonLabels}</b> ${sideEmoji} ${item.side}`,
    `${escapeHtml(item.title)}`,
    `<i>${escapeHtml(item.outcome)}</i> @ <b>${item.price.toFixed(4)}</b>`,
    `Size: ${item.size} · Notional: <b>${fmtUsd(item.notionalUsd)}</b>`,
  ];

  if (item.clusterSize != null) {
    const total = item.clusterTotalUsd != null ? ` · ${fmtUsdRounded(item.clusterTotalUsd)}` : '';
    lines.push(`Cluster: <b>${item.clusterSize} trades${total}</b>`);
  }

  if (item.spreeSize != null && item.spreeSize > 1) {
    const total = item.spreeTotalUsd != null ? ` · ${fmtUsdRounded(item.spreeTotalUsd)}` : '';
    const window =
      item.spreeFirstTimestamp != null
        ? ` in ${Math.max(1, Math.round((item.timestamp - item.spreeFirstTimestamp) / 60_000))}m`
        : '';
    lines.push(`🎯 Spree: <b>${item.spreeSize} trades${total}</b> from this wallet${window}`);
  }

  lines.push(
    `Trader: ${escapeHtml(trader)} (<code>${truncateWallet(item.proxyWallet)}</code>)`,
    `<a href="${escapeHtml(url)}">Open on Polymarket →</a>`,
  );

  return lines.join('\n');
}

export async function sendTelegram(item: FlaggedFeedItem): Promise<void> {
  if (!telegramConfigured) return;
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const text = buildTelegramMessage(item);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[telegram] sendMessage failed: ${res.status} ${body}`);
    }
  } catch (err) {
    console.warn('[telegram] sendMessage error', err);
  }
}
