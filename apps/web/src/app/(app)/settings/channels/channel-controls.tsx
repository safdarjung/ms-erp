'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { ConfirmButton } from '@/components/confirm-button';
import { useToast } from '@/components/toast';
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
};

export function CreateChannelForm() {
  const [state, action] = useActionState<ActionState, FormData>(createChannelAction, {});
  const ref = useRef<HTMLFormElement>(null);
  const toast = useToast();
  useEffect(() => {
    if (state.ok) { ref.current?.reset(); toast({ title: 'Lead source added', variant: 'success' }); }
    else if (state.error) toast({ title: 'Could not add source', description: state.error, variant: 'error' });
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[12rem]">
        <label className="label">Name</label>
        <input name="name" className="field" placeholder="e.g. Sales inbox (Gmail)" />
      </div>
      <SubmitButton className="btn-primary">Add email source</SubmitButton>
    </form>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex gap-2">
        <input readOnly value={value} className="field font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          className="btn-ghost text-xs whitespace-nowrap"
          onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export function ChannelEditor({ channel, users }: { channel: ChannelView; users: { id: string; name: string }[] }) {
  const [state, action] = useActionState<ActionState, FormData>(updateChannelAction, {});
  const toast = useToast();
  useEffect(() => {
    if (state.ok) toast({ title: 'Saved', variant: 'success' });
    else if (state.error) toast({ title: 'Could not save', description: state.error, variant: 'error' });
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="font-medium text-ink">{channel.name}</div>
        <span className={`pill ${channel.enabled ? 'bg-[#e4f1ea] text-ok' : 'bg-surface-2 text-muted'}`}>
          {channel.enabled ? 'Active' : 'Disabled'}
        </span>
      </div>

      <div className="grid gap-3 mb-4">
        <CopyField label="Forward your enquiry emails to this address" value={channel.captureAddress} />
        <CopyField label="…or POST parsed mail to this webhook URL" value={channel.webhookUrl} />
        <p className="text-xs text-faint leading-relaxed">
          In Gmail: <b>Settings → Forwarding → Add a forwarding address</b>, then a filter
          (<span className="font-mono">from:(indiamart.com OR tradeindia.com)</span> or your sales alias)
          that forwards a copy to the capture address. New enquiries appear in the Lead inbox within seconds.
        </p>
      </div>

      <form action={action} className="grid md:grid-cols-2 gap-3 items-start border-t border-line pt-3">
        <input type="hidden" name="id" value={channel.id} />
        <div>
          <label className="label">Assign new leads to</label>
          <select name="defaultOwnerUserId" defaultValue={channel.defaultOwnerUserId ?? ''} className="field">
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Only accept mail from (optional)</label>
          <input
            name="senderAllowlist"
            defaultValue={channel.senderAllowlist.join(', ')}
            className="field"
            placeholder="indiamart.com, tradeindia.com"
          />
          <p className="text-[0.7rem] text-faint mt-1">Comma-separated domains/addresses. Leave blank to accept all.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="autoCreate" defaultChecked={channel.autoCreate} className="accent-accent" />
          Auto-create leads from recognised IndiaMART / TradeIndia emails
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="enabled" defaultChecked={channel.enabled} className="accent-accent" />
          Enabled
        </label>
        <div className="md:col-span-2 flex items-center gap-2 md:justify-end">
          <ConfirmButton
            action={regenerateTokenAction}
            fields={{ id: channel.id }}
            variant="primary"
            className="btn-ghost text-xs"
            title="Generate a new capture address?"
            body="The old address stops working immediately — you'll need to update your Gmail forwarding rule."
            confirmLabel="Regenerate"
          >
            Regenerate address
          </ConfirmButton>
          <SubmitButton className="btn-primary">Save</SubmitButton>
        </div>
        {state.error && <p className="text-sm text-crit md:col-span-2">{state.error}</p>}
      </form>
    </div>
  );
}
