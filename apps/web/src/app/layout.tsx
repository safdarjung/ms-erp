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

// Runs before the first paint so a person who chose Light or Dark never sees
// the other theme flash on load. Reads the same key the ThemeToggle writes
// ('ms-theme'); any other value, or none, means "follow the phone's setting",
// which is simply the absence of data-theme (globals.css handles the rest).
const THEME_INIT = `(function(){try{var t=localStorage.getItem('ms-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}})();`;

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
