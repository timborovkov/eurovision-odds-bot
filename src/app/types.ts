import { type FlagReason } from '@/lib/flagReason';

export type { FlagReason };

export type FlaggedItem = {
  id: string;
  tradeId: string;
  conditionId: string;
  eventSlug: string;
  marketSlug: string;
  title: string;
  question: string;
  outcome: string;
  outcomeIndex: number;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  notionalUsd: number;
  proxyWallet: string;
  pseudonym: string | null;
  name: string | null;
  timestamp: number;
  reasons: FlagReason[];
  severity: 'normal' | 'big';
  clusterKey: string | null;
  clusterSize: number | null;
  clusterTotalUsd: number | null;
  spreeSize: number | null;
  spreeTotalUsd: number | null;
  spreeFirstTimestamp: number | null;
  transactionHash: string;
};

export type ConnectionState = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'NOT_STARTED';

export type ResolvedMarket = {
  conditionId: string;
  eventSlug: string;
  marketSlug: string;
  question: string;
  outcomes: string[];
};
