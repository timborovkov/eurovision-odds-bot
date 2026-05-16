import type { ConnectionState } from '../types';

const COLOR: Record<ConnectionState, string> = {
  CONNECTED: 'bg-buy',
  CONNECTING: 'bg-warn animate-pulse',
  DISCONNECTED: 'bg-sell',
  NOT_STARTED: 'bg-muted',
};

const LABEL: Record<ConnectionState, string> = {
  CONNECTED: 'live',
  CONNECTING: 'connecting',
  DISCONNECTED: 'offline',
  NOT_STARTED: 'idle',
};

export function ConnectionDot({ status }: { status: ConnectionState }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${COLOR[status]}`} />
      <span>{LABEL[status]}</span>
    </span>
  );
}
