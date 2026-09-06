'use client';
import { useState, useTransition } from 'react';
import type { ActionResult } from '@/lib/forms';
import { useToast } from './toast';

/**
 * Auto-submitting status/stage select with optimistic UI: reflects the choice
 * immediately, disables while the server action runs, toasts "Marked as …" on
 * success, and reverts + toasts on error. Thumb-sized on phones, with a visible
 * caret so it reads as something you can change.
 */
export function InlineSelect({
  value,
  options,
  onChange,
  ariaLabel,
  className = 'field w-auto !py-1 !pl-2 !pr-7 text-sm',
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
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;

  return (
    <span className="relative inline-flex items-center">
      <select
        value={val}
        disabled={pending}
        aria-label={ariaLabel}
        aria-busy={pending}
        className={`${className} appearance-none min-h-11 sm:min-h-0 disabled:opacity-60`}
        onChange={(e) => {
          const next = e.target.value;
          const prev = val;
          setVal(next);
          start(async () => {
            try {
              const res = await onChange(next);
              if (res?.error) { setVal(prev); toast({ title: "Couldn't change the status", description: res.error, variant: 'error' }); }
              else toast({ title: `Marked as ${labelOf(next)}`, variant: 'success' });
            } catch {
              setVal(prev);
              toast({ title: "Couldn't change the status", description: 'Please try again.', variant: 'error' });
            }
          });
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span className="pointer-events-none absolute right-2 text-faint text-xs" aria-hidden>▾</span>
    </span>
  );
}
