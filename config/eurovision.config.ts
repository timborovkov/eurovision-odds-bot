export type MarketRef = {
  /**
   * The event slug as it appears in a polymarket.com/event/<slug> URL.
   * One RTDS subscription is opened per event slug; every child market and
   * outcome inside that event will stream through it.
   */
  eventSlug: string;
  /** Optional override for the label shown in the UI filter chip. */
  label?: string;
};

export const EUROVISION_MARKETS: MarketRef[] = [
  // Grand Final outcome markets (most volume, primary signal)
  { eventSlug: 'eurovision-winner-2026' }, // 40 open · ~$179M volume
  { eventSlug: 'eurovision-2026-top-3' }, // 25 open
  { eventSlug: 'eurovision-2026-top-5' }, // 25 open
  { eventSlug: 'eurovision-2026-top-10' }, // 25 open

  // Voting-segment markets — jury and televote are independent, often diverge,
  // and tend to attract the biggest single bets right before the show.
  { eventSlug: 'eurovision-2026-jury-winner' }, // 50 open
  { eventSlug: 'eurovision-2026-televote-winner' }, // 50 open

  // Placement markets (each country binary YES/NO at that place)
  { eventSlug: 'eurovision-2nd-place-2026' }, // 50 open
  { eventSlug: 'eurovision-3rd-place-2026' }, // 50 open
  { eventSlug: 'eurovision-last-place-2026' }, // 40 open · inverse signal

  // Prop markets that still correlate with outcome sentiment
  { eventSlug: 'eurovision-2026-best-nordic-country' }, // 6 open
  { eventSlug: 'eurovision-2026-margin-of-victory' }, // 7 open

  // Semi-final advancement markets — high volume the day-of, then settle.
  { eventSlug: 'eurovision-2026-first-semi-final-winner' }, // 22 open
  { eventSlug: 'eurovision-2026-second-semi-final-winner' }, // 22 open
];

export const FLAG_THRESHOLDS = {
  /** Notional in USDC = price * size. Any trade at/above this fires a flag. */
  singleTradeUsd: 5_000,
  /** Raw share count. Either rule (USD or shares) is sufficient. */
  singleTradeShares: 25_000,
  /** Above this, severity = "big" — louder sound + bold Telegram. */
  bigTradeUsd: 50_000,

  cluster: {
    /** Rolling window for cluster detection. */
    windowMs: 10 * 60_000,
    /** Minimum weighted trade count inside the window. */
    minTrades: 4,
    /** Minimum summed notional USDC inside the window. */
    minTotalUsd: 7_500,
    /** Each same-proxyWallet trade is weighted this many times. */
    sameBuyerWeight: 3,
  },
} as const;

export type FlagThresholds = typeof FLAG_THRESHOLDS;

export const TICKER = {
  /** Minimum notional USDC for a trade to appear in the live ticker strip. */
  minNotionalUsd: 50,
} as const;
