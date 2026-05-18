import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { env } from '@/env';

import './globals.css';

export const metadata: Metadata = {
  title: env.NEXT_PUBLIC_APP_NAME,
  description: env.NEXT_PUBLIC_APP_SUBTITLE ?? 'Live Polymarket whale trade watcher',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-text antialiased">{children}</body>
    </html>
  );
}
