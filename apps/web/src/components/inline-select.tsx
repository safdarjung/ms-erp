'use client';
import { useState, useTransition } from 'react';
import type { ActionResult } from '@/lib/forms';
import { useToast } from './toast';

/**
 * Auto-submitting status/stage select with optimistic UI: reflects the choice
 * immediately, disables while the server action runs, and reverts + toasts on
 * error. Replaces the raw `<form><select onChange=requestSubmit>` pattern.
 */
export function InlineSelect({
  value,
  options,
  onChange,
  ariaLabel,
  className = 'field w-auto !py-1 !px-2 text-xs',
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => Promise<ActionResult>;
  ariaLabel: string;
  className?: string;
}) {
  const [val, setVal] = useState(value);
  const [pending, start] = useTransition();
  const toast = useToast();

  return (
    <select
      value={val}
      disabled={pending}
      aria-label={ariaLabel}
      className={`${className} disabled:opacity-60`}
      onChange={(e) => {
        const next = e.target.value;
        const prev = val;
        setVal(next);
        start(async () => {
          try {
            const res = await onChange(next);
            if (res?.error) { setVal(prev); toast({ title: 'Update failed', description: res.error, variant: 'error' }); }
          } catch {
            setVal(prev);
            toast({ title: 'Update failed', description: 'Please try again.', variant: 'error' });
          }
        });
      }}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
