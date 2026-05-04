import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Vantage — Personalized Equity Growth Platform for 20+% XIRR',
  description: 'Local-first portfolio intelligence for long-term Indian equity investors.',
};

// Runs before React hydrates so SSR-rendered tokens flip without flash.
// Mirrors lib/theme.ts#resolveTheme — keep in sync.
const themeBootstrap = `(function(){try{var k='stock-platform.theme';var s=localStorage.getItem(k);var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var r=(s==='light'||s==='dark')?s:(d?'dark':'light');document.documentElement.dataset.theme=r;}catch(_){document.documentElement.dataset.theme='light';}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
