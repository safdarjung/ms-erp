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

export const viewport: Viewport = {
  themeColor: '#141a21',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
