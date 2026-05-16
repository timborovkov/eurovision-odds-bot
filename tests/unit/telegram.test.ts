import { describe, expect, it } from 'vitest';

import { buildTelegramMessage } from '@/lib/notify/telegram';
import type { FlaggedFeedItem } from '@/lib/watcher/broker';

const baseItem: FlaggedFeedItem = {
  id: '0xabc',
  tradeId: '0xabc',
  conditionId: '0xcond',
  eventSlug: 'eurovision-winner-2026',
  marketSlug: 'will-sweden-win-eurovision-2026',
  title: 'Eurovision Winner 2026',
  question: 'Will Sweden win Eurovision 2026?',
  outcome: 'Sweden',
  outcomeIndex: 0,
  side: 'BUY',
  price: 0.42,
  size: 1000,
  notionalUsd: 420,
  proxyWallet: '0x1234567890abcdef1234567890abcdef12345678',
  pseudonym: 'somebody',
  name: 'Somebody',
  timestamp: Date.now(),
  reasons: ['size'],
  severity: 'normal',
  clusterKey: null,
  clusterSize: null,
  transactionHash: '0xabc',
};

describe('buildTelegramMessage', () => {
  it('renders a normal-severity message with the deep link', () => {
    const msg = buildTelegramMessage(baseItem);
    expect(msg).toContain('⚡');
    expect(msg).toContain('SIZE');
    expect(msg).toContain('🟢 BUY');
    expect(msg).toContain('Eurovision Winner 2026');
    expect(msg).toContain('Sweden');
    expect(msg).toContain('0.4200');
    expect(msg).toContain('$420');
    expect(msg).toContain(
      'https://polymarket.com/event/eurovision-winner-2026?selectedMarketId=0xcond',
    );
    expect(msg).toContain('0x1234…5678'); // truncated wallet
  });

  it('escalates severity for big trades and includes cluster size', () => {
    const msg = buildTelegramMessage({
      ...baseItem,
      severity: 'big',
      reasons: ['size', 'cluster'],
      clusterSize: 7,
      side: 'SELL',
    });
    expect(msg).toContain('🚨🚨');
    expect(msg).toContain('SIZE + CLUSTER');
    expect(msg).toContain('🔴 SELL');
    expect(msg).toContain('Cluster size: <b>7</b>');
  });

  it('HTML-escapes title, outcome, and trader to block injection from Polymarket strings', () => {
    const msg = buildTelegramMessage({
      ...baseItem,
      title: '<img src=x onerror=alert(1)>',
      outcome: 'A & B',
      name: '"Bobby"',
      pseudonym: null,
    });
    expect(msg).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(msg).toContain('A &amp; B');
    expect(msg).toContain('&quot;Bobby&quot;');
    expect(msg).not.toContain('<img src=x');
  });

  it('falls back to truncated wallet when no name or pseudonym is set', () => {
    const msg = buildTelegramMessage({ ...baseItem, name: null, pseudonym: null });
    expect(msg).toContain('Trader: 0x1234…5678');
  });

  it('HTML-escapes the deep-link URL so a stray quote in a slug cannot break the href', () => {
    const msg = buildTelegramMessage({
      ...baseItem,
      eventSlug: 'eurovision-winner-2026" onclick=alert(1) x="',
      conditionId: '0xcond',
    });
    // The raw " must be escaped; the anchor tag must stay intact.
    expect(msg).toContain('&quot; onclick=alert(1) x=&quot;');
    expect(msg).not.toContain('" onclick=alert(1)');
    expect(msg).toMatch(/<a href="[^"]+">Open on Polymarket →<\/a>/);
  });
});
