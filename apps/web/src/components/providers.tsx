'use client';
import type { ReactNode } from 'react';
import { ToastProvider } from './toast';

/** App-wide client providers (toasts today; theme/etc. can join here). */
export function Providers({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
