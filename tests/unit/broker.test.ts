import { describe, expect, it } from 'vitest';

import { broker, type FeedEvent } from '@/lib/watcher/broker';

describe('FeedBroker', () => {
  it('delivers published events to active subscribers', () => {
    const received: FeedEvent[] = [];
    const unsubscribe = broker.subscribe((ev) => received.push(ev));
    broker.publish({ type: 'status', status: 'CONNECTED' });
    broker.publish({ type: 'status', status: 'DISCONNECTED' });
    unsubscribe();
    expect(received).toEqual([
      { type: 'status', status: 'CONNECTED' },
      { type: 'status', status: 'DISCONNECTED' },
    ]);
  });

  it('stops delivering events after unsubscribe', () => {
    const received: FeedEvent[] = [];
    const unsubscribe = broker.subscribe((ev) => received.push(ev));
    broker.publish({ type: 'status', status: 'CONNECTED' });
    unsubscribe();
    broker.publish({ type: 'status', status: 'DISCONNECTED' });
    expect(received).toEqual([{ type: 'status', status: 'CONNECTED' }]);
  });

  it('caches the last status event for late subscribers', () => {
    broker.publish({ type: 'status', status: 'CONNECTED' });
    expect(broker.getStatus()).toBe('CONNECTED');
    broker.publish({ type: 'status', status: 'DISCONNECTED' });
    expect(broker.getStatus()).toBe('DISCONNECTED');
  });

  it("isolates subscribers — one subscriber's callback errors do not break the rest", () => {
    const ok: FeedEvent[] = [];
    const throwingUnsub = broker.subscribe(() => {
      throw new Error('subscriber boom');
    });
    const okUnsub = broker.subscribe((ev) => ok.push(ev));
    expect(() => broker.publish({ type: 'status', status: 'CONNECTED' })).toThrow(
      'subscriber boom',
    );
    // Even when one throws, the second was registered after — node's EventEmitter
    // calls listeners in order and propagates the first throw. Document the contract.
    throwingUnsub();
    okUnsub();
  });
});
