// The one place page names live. Sidebar, header title, keyboard shortcuts,
// mobile tab bar and "Open →" links all read from here so a screen is called
// the same thing everywhere. URLs never change — only the words do.

export type NavKey =
  | 'dashboard' | 'analytics'
  | 'leads' | 'inbox' | 'customers'
  | 'quotations' | 'orders' | 'invoices'
  | 'users' | 'channels' | 'outreach' | 'password' | 'guide';

export const NAV: Record<NavKey, { href: string; label: string }> = {
  dashboard: { href: '/dashboard', label: 'Home' },
  analytics: { href: '/analytics', label: 'Reports' },
  leads: { href: '/leads', label: 'Enquiries' },
  inbox: { href: '/leads/inbox', label: 'Email enquiries' },
  customers: { href: '/customers', label: 'Customers' },
  quotations: { href: '/quotations', label: 'Quotations' },
  orders: { href: '/orders', label: 'Orders' },
  invoices: { href: '/invoices', label: 'Bills (invoices)' },
  users: { href: '/settings/users', label: 'Staff' },
  channels: { href: '/settings/channels', label: 'Email enquiry setup' },
  outreach: { href: '/settings/outreach', label: 'WhatsApp message' },
  password: { href: '/settings/password', label: 'Change password' },
  guide: { href: '/guide', label: 'Help & guide' },
};

export const NAV_LABELS: Record<NavKey, string> = Object.fromEntries(
  Object.entries(NAV).map(([k, v]) => [k, v.label]),
) as Record<NavKey, string>;

/** Sidebar group names — also the page "eyebrow" text. */
export const NAV_GROUPS = {
  home: 'Home',
  crm: 'Enquiries & customers',
  sales: 'Quotations, orders & bills',
  settings: 'Settings',
} as const;

/** Header title for a pathname: the most specific matching nav entry. */
export function navTitleFor(pathname: string): string {
  const hit = (Object.values(NAV) as { href: string; label: string }[])
    .filter((n) => pathname === n.href || pathname.startsWith(n.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return hit?.label ?? 'MS Enterprises';
}
