/**
 * Single source of truth for the kinds of signals a trade can fire.
 * Imported by the flagger (server), broker (server), and the client UI
 * types — keeps the union from drifting when a new reason is added.
 *
 * Lives in `src/lib/` (not `src/lib/watcher/`) so client components can
 * import it without dragging in server-only deps like `@polymarket/real-
 * time-data-client` or `node:events`.
 */
export type FlagReason = 'size' | 'cluster' | 'spree';
