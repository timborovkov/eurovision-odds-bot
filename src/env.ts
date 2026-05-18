import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.string().default('file:./dev.db'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  RTDS_HOST: z.string().default('wss://ws-live-data.polymarket.com'),
  GAMMA_BASE: z.string().default('https://gamma-api.polymarket.com'),
  // NEXT_PUBLIC_ prefix lets the same value be inlined into the client bundle
  // (used by src/lib/url.ts) while still being readable server-side from `env`.
  NEXT_PUBLIC_POLYMARKET_BASE: z.string().default('https://polymarket.com'),
  NEXT_PUBLIC_APP_NAME: z.string().default('PolyTape'),
  NEXT_PUBLIC_APP_SUBTITLE: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
});

export const env = Env.parse(process.env);

export const telegramConfigured = Boolean(env.TELEGRAM_BOT_TOKEN) && Boolean(env.TELEGRAM_CHAT_ID);
