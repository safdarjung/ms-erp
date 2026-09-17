import type { MetadataRoute } from 'next';

// PWA manifest — makes the app installable as a proper standalone app (a real
// WebAPK on Android) with persistent, origin-shared storage, so an installed
// login survives app restarts (a plain "add to home screen" shortcut does not).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MS Enterprises ERP',
    short_name: 'MS ERP',
    description: 'Die & machining job-shop ERP — leads, quotes, orders, GST invoices & payments.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    // Splash + title-bar colours for the installed app (a manifest cannot follow
    // the theme; the in-page <meta theme-color> takes over once loaded).
    background_color: '#eaeef2',
    theme_color: '#eaeef2',
    icons: [
      { src: '/app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}
