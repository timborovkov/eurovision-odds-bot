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

// Slug = last path segment of the event URL: polymarket.com/event/<slug>
// Add as many slugs as you want — one RTDS subscription is opened per entry.
export const WATCHED_MARKETS: MarketRef[] = [
  // Eurovision 2026 — the original use case for this tool
  { eventSlug: 'eurovision-winner-2026' }, // 40 open · ~$179M volume
  { eventSlug: 'eurovision-2026-top-3' }, // 25 open
  { eventSlug: 'eurovision-2026-top-5' }, // 25 open
  { eventSlug: 'eurovision-2026-top-10' }, // 25 open
  { eventSlug: 'eurovision-2026-jury-winner' }, // 50 open
  { eventSlug: 'eurovision-2026-televote-winner' }, // 50 open
  { eventSlug: 'eurovision-2nd-place-2026' }, // 50 open
  { eventSlug: 'eurovision-3rd-place-2026' }, // 50 open
  { eventSlug: 'eurovision-last-place-2026' }, // 40 open · inverse signal
  { eventSlug: 'eurovision-2026-best-nordic-country' }, // 6 open
  { eventSlug: 'eurovision-2026-margin-of-victory' }, // 7 open
  { eventSlug: 'eurovision-2026-first-semi-final-winner' }, // 22 open
  { eventSlug: 'eurovision-2026-second-semi-final-winner' }, // 22 open
];

// Tokens stripped from slugs when rendering filter chip labels.
// Update to match the common prefix/suffix in your own slugs, or set to []
// to show the raw slug as-is.
export const SLUG_NOISE_TOKENS: string[] = ['eurovision', '2026'];

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

  /**
   * Spree = one wallet accumulating on the same (conditionId, outcomeIndex, side)
   * inside the window. Distinct from cluster because cluster is a crowd signal;
   * spree is one trader's conviction and tends to lead the move.
   */
  spree: {
    windowMs: 10 * 60_000,
    minTrades: 3,
    minTotalUsd: 5_000,
  },
} as const;

export type FlagThresholds = typeof FLAG_THRESHOLDS;

export const TICKER = {
  /** Minimum notional USDC for a trade to appear in the live ticker strip. */
  minNotionalUsd: 50,
  /** How long each pill stays in the strip before fading out. */
  pillTtlMs: 30_000,
  /** Cap on how many pills can show at once (oldest fall off). */
  maxPills: 20,
} as const;
