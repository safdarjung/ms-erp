import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: { default: 'MS Enterprises ERP', template: '%s · MS ERP' },
  description: 'AI-native ERP for a precision die & machining job-shop.',
  applicationName: 'MS ERP',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'MS ERP' },
};

// Browser chrome / Android status bar colour = the page background (--bg) in
// each theme. When a person forces Light or Dark, useTheme() rewrites these
// <meta> tags to the resolved --bg so the chrome follows their choice too.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eaeef2' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1418' },
  ],
};

// Runs before the first paint so the remembered choice never flashes the wrong
// theme. Reads the key the ThemeToggle writes ('ms-theme'): 'light'/'dark' are
// pinned on <html>; 'system' (chosen explicitly) leaves data-theme off so CSS
// follows the device; nothing stored means LIGHT — the app never turns itself
// dark just because the phone is in dark mode.
const THEME_INIT = `(function(){var r=document.documentElement;try{var t=localStorage.getItem('ms-theme');if(t==='light'||t==='dark'){r.dataset.theme=t;}else if(t!=='system'){r.dataset.theme='light';}}catch(e){r.dataset.theme='light';}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the script above may add data-theme before React
    // hydrates, and that attribute is intentionally not in the server HTML.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
