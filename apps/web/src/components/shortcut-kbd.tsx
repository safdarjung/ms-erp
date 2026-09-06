'use client';
import { useEffect, useState } from 'react';

/**
 * Keyboard-shortcut hint that reads right on every device: "⌘K" on Macs,
 * "Ctrl K" elsewhere, and nothing at all on touch screens (a phone user has
 * no keyboard, so a kbd badge is just noise). Renders empty until mounted so
 * server and client markup agree.
 */
export function ShortcutKbd({ keyName = 'K', className = '' }: { keyName?: string; className?: string }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    try {
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      if (coarse) { setLabel(null); return; }
      const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform) || /Mac OS/.test(navigator.userAgent);
      setLabel(`${isMac ? '⌘' : 'Ctrl '}${keyName}`);
    } catch { setLabel(null); }
  }, [keyName]);
  if (!label) return null;
  return <kbd className={`kbd ${className}`} aria-hidden>{label}</kbd>;
}
