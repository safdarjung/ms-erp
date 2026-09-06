'use client';
import Link from 'next/link';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { ConfirmButton } from '@/components/confirm-button';
import { useToast } from '@/components/toast';
import { NAV } from '@/lib/nav-labels';
import { createChannelAction, updateChannelAction, regenerateTokenAction, type ActionState } from './actions';

export type ChannelView = {
  id: string;
  name: string;
  enabled: boolean;
  inboundToken: string;
  defaultOwnerUserId: string | null;
  autoCreate: boolean;
  senderAllowlist: string[];
  webhookUrl: string;
  captureAddress: string;
  /** False until the app has an inbound email domain configured. */
  inboundReady: boolean;
};

const COPIED_MS = 1500;

export function CreateChannelForm() {
  const [state, action] = useActionState<ActionState, FormData>(createChannelAction, {});
  const ref = useRef<HTMLFormElement>(null);
  const toast = useToast();
  const nameId = useId();
  useEffect(() => {
    if (state.ok) { ref.current?.reset(); toast({ title: 'Your forwarding address is ready', variant: 'success' }); }
    else if (state.error) toast({ title: 'Could not create the address', description: state.error, variant: 'error' });
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[12rem]">
        <label className="label" htmlFor={nameId}>Name (optional)</label>
        <input id={nameId} name="name" className="field" placeholder="e.g. Sales Gmail" />
      </div>
      <SubmitButton className="btn-primary w-full sm:w-auto" pendingLabel="Creating…">Create forwarding address</SubmitButton>
    </form>
  );
}

function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const id = useId();
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    } catch { /* clipboard blocked — the field is selectable */ }
  };
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="flex gap-2">
        <input id={id} readOnly value={value} className={`field ${mono ? 'font-mono' : ''} text-xs`} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn-ghost text-xs whitespace-nowrap min-w-[4.5rem]" onClick={copy} aria-live="polite">
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export function ChannelEditor({ channel, users }: { channel: ChannelView; users: { id: string; name: string }[] }) {
  const [state, action] = useActionState<ActionState, FormData>(updateChannelAction, {});
  const toast = useToast();
  const ownerId = useId();
  const allowId = useId();
  const allowHintId = useId();
  useEffect(() => {
    if (state.ok) toast({ title: 'Saved', variant: 'success' });
    else if (state.error) toast({ title: 'Could not save', description: state.error, variant: 'error' });
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h2 className="font-medium text-ink">{channel.name}</h2>
        <span className={`pill ${channel.enabled && channel.inboundReady ? 'bg-[#e4f1ea] text-ok' : 'bg-surface-2 text-muted'}`}>
          {!channel.inboundReady ? 'Not receiving yet' : channel.enabled ? 'On' : 'Off'}
        </span>
      </div>

      <ol className="flex flex-col gap-4 text-sm text-ink">
        <li className="flex gap-3">
          <span className="font-semibold shrink-0 w-5">1.</span>
          <div className="flex-1 min-w-0">
            {channel.inboundReady ? (
              <CopyField label="Copy this address" value={channel.captureAddress} />
            ) : (
              <div className="rounded-lg border border-warn/40 bg-surface-2 px-3 py-2 text-sm text-ink" role="status">
                Email forwarding isn&rsquo;t switched on for this app yet. Ask the person who set it up to turn it on
                &mdash; your forwarding address will appear here.
              </div>
            )}
          </div>
        </li>
        <li className="flex gap-3">
          <span className="font-semibold shrink-0 w-5">2.</span>
          <span>In Gmail: <b>Settings → Forwarding</b> → add this address. Gmail will send a confirmation mail; it lands in <Link href={NAV.inbox.href} className="text-steel hover:underline">{NAV.inbox.label}</Link> — open it and tap the confirm link.</span>
        </li>
        <li className="flex gap-3">
          <span className="font-semibold shrink-0 w-5">3.</span>
          <span>Make a filter for IndiaMART / TradeIndia mails → forward to it. Done — enquiries arrive in <Link href={NAV.inbox.href} className="text-steel hover:underline">{NAV.inbox.label}</Link>.</span>
        </li>
      </ol>

      <details className="reveal mt-5 border-t border-line pt-3">
        <summary className="text-sm font-medium text-ink flex items-center gap-2 min-h-[44px]">
          <span className="chev" aria-hidden>›</span> Advanced — for your IT person
        </summary>
        <div className="grid gap-3 mt-2 mb-4">
          <CopyField label="Webhook URL (POST parsed mail here instead of forwarding)" value={channel.webhookUrl} />
        </div>
        <form action={action} className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
          <input type="hidden" name="id" value={channel.id} />
          <div>
            <label className="label" htmlFor={ownerId}>Give new enquiries to</label>
            <select id={ownerId} name="defaultOwnerUserId" defaultValue={channel.defaultOwnerUserId ?? ''} className="field">
              <option value="">Nobody in particular</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor={allowId}>Only accept mail from (optional)</label>
            <input
              id={allowId}
              name="senderAllowlist"
              defaultValue={channel.senderAllowlist.join(', ')}
              className="field"
              placeholder="indiamart.com, tradeindia.com"
              aria-describedby={allowHintId}
            />
            <p id={allowHintId} className="text-xs text-muted mt-1">Domains or addresses, separated by commas. Leave blank to accept all.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink min-h-[44px]">
            <input type="checkbox" name="autoCreate" defaultChecked={channel.autoCreate} className="accent-accent w-4 h-4" />
            Create enquiries automatically from IndiaMART / TradeIndia mails
          </label>
          <label className="flex items-center gap-2 text-sm text-ink min-h-[44px]">
            <input type="checkbox" name="enabled" defaultChecked={channel.enabled} className="accent-accent w-4 h-4" />
            Forwarding address is on
          </label>
          <div className="md:col-span-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:justify-end">
            <ConfirmButton
              action={regenerateTokenAction}
              fields={{ id: channel.id }}
              variant="primary"
              className="btn-ghost text-xs"
              title="Make a new forwarding address?"
              body="The old address stops working right away — you will need to update the Gmail forwarding rule. This can't be undone."
              confirmLabel="Yes, make a new address"
              cancelLabel="Not now"
              pendingLabel="Making…"
            >
              Make a new address
            </ConfirmButton>
            <SubmitButton className="btn-primary">Save changes</SubmitButton>
          </div>
          {state.error && <p className="text-sm text-crit md:col-span-2" role="alert">{state.error}</p>}
        </form>
      </details>
    </div>
  );
}
