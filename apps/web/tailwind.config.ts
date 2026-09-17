import type { Config } from 'tailwindcss';

// Every colour maps to an "R G B" channel token from src/app/globals.css so
// opacity modifiers work: bg-ink/40 → rgb(var(--ink-rgb) / 0.4). A plain
// var(--x) colour cannot take a /NN modifier — Tailwind silently drops the class.
const token = (name: string) => `rgb(var(--${name}-rgb) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{ts,tsx}'],
  // `dark:` follows the same rule as the CSS tokens: the phone's setting unless
  // the person chose otherwise (data-theme on <html>). Prefer theme-aware tokens;
  // reach for dark: only when a surface must be built differently at night
  // (e.g. the inverted hero panel on the login page).
  darkMode: ['variant', [
    '@media (prefers-color-scheme: dark) { &:not([data-theme="light"] *) }',
    '&:is([data-theme="dark"] *)',
  ]],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        'surface-2': token('surface-2'),
        ink: token('ink'),
        muted: token('muted'),
        faint: token('faint'),
        line: token('line'),
        'line-strong': token('line-strong'),
        accent: token('accent'),
        'accent-soft': token('accent-soft'),
        steel: token('steel'),
        ok: token('ok'),
        warn: token('warn'),
        crit: token('crit'),
        // Tints for pills / notice boxes (text-ok on bg-ok-soft, etc.)
        'ok-soft': token('ok-soft'),
        'warn-soft': token('warn-soft'),
        'crit-soft': token('crit-soft'),
        'steel-soft': token('steel-soft'),
        'ink-soft': token('ink-soft'),
        gold: token('gold'),
        // Text on bg-accent / bg-ok / bg-crit buttons — white by day, near-black at night
        'on-accent': token('on-accent'),
        // Dimming layer behind dialogs (ink by day, black at night) — use bg-scrim/40
        scrim: token('scrim'),
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: { DEFAULT: '6px', lg: '10px' },
    },
  },
  plugins: [],
} satisfies Config;
