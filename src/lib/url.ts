export const POLYMARKET_BASE_URL = 'https://polymarket.com';

export type DeepLinkArgs = {
  eventSlug: string;
  conditionId: string;
};

export const polymarketEventUrl = ({ eventSlug, conditionId }: DeepLinkArgs): string =>
  `${POLYMARKET_BASE_URL}/event/${eventSlug}?selectedMarketId=${conditionId}`;

export const truncateWallet = (addr: string): string =>
  addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
