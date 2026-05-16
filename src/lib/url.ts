/**
 * Single source of truth for the Polymarket base URL. Read from
 * `NEXT_PUBLIC_POLYMARKET_BASE` so Next.js inlines the value into both the
 * server and the client bundle — this keeps the UI deep link and the Telegram
 * deep link pointed at the same host.
 */
export const POLYMARKET_BASE_URL =
  process.env.NEXT_PUBLIC_POLYMARKET_BASE ?? 'https://polymarket.com';

export type DeepLinkArgs = {
  eventSlug: string;
  conditionId: string;
};

export const polymarketEventUrl = ({ eventSlug, conditionId }: DeepLinkArgs): string =>
  `${POLYMARKET_BASE_URL}/event/${eventSlug}?selectedMarketId=${conditionId}`;

export const truncateWallet = (addr: string): string =>
  addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
