import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, can } from '@/lib/rbac';
import { aiAdminData } from '@/lib/ai-admin';
import { NAV, NAV_GROUPS } from '@/lib/nav-labels';
import { formatDate } from '@/lib/format';
import { StatusPill } from '@/components/status-pill';
import { MonthlyBars, HBarList } from '@/components/charts';
import { MobileList, DesktopTable, ListCard } from '@/components/list-cards';

export const metadata = { title: 'AI activity' };

const STATUS_LABEL: Record<string, string> = {
  executed: 'Saved', cancelled: 'Not saved', failed: 'Couldn’t save', pending: 'Waiting for a Yes', expired: 'Never answered',
};
// Reuse StatusPill tones by mapping onto statuses it already knows.
const PILL: Record<string, string> = { executed: 'paid', cancelled: 'archived', failed: 'failed', pending: 'pending', expired: 'draft' };

const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} M` : n >= 1000 ? `${Math.round(n / 1000)} k` : String(n));
const fmtUsd = (n: number) => (n === 0 ? 'Free tier' : `$${n.toFixed(n < 1 ? 3 : 2)}`);
const timeIST = (d: Date) => new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(d);

export default async function AiActivityPage() {
  const user = await requireUser();
  if (!can(user, 'settings.manage')) redirect(NAV.dashboard.href);
  const d = await aiAdminData();
  const saved = d.actionsByStatus.executed ?? 0;
  const proposed = Object.values(d.actionsByStatus).reduce((s, n) => s + n, 0);

  const tiles = [
    { k: String(d.month.calls), v: 'AI requests this month' },
    { k: fmtTokens(d.month.tokens), v: 'Tokens this month', hint: 'roughly words × 1.3' },
    { k: fmtUsd(d.month.costUsd), v: 'Estimated cost this month' },
    { k: `${saved} / ${proposed}`, v: `Proposals saved (last ${d.days} days)`, hint: 'saved after you tapped Yes' },
  ];

  return (
    <div className="max-w-6xl">
      <p className="text-xs text-muted">{NAV_GROUPS.settings}</p>
      <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">AI activity &amp; usage</h1>
        <span className="text-xs text-muted">Last {d.days} days · India time</span>
      </div>
      <p className="text-sm text-muted mb-5 max-w-2xl">
        Everything the AI proposed is listed here, with whether it was saved. Nothing the AI suggests is saved until someone taps <b>Yes</b> on its card — and every proposal is kept as a record.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-line border border-line rounded-lg overflow-hidden mb-6">
        {tiles.map((t) => (
          <div key={t.v} className="bg-surface p-4 sm:p-5">
            <div className="font-mono text-2xl font-semibold tracking-tight tabular-nums">{t.k}</div>
            <div className="text-sm text-muted mt-1">{t.v}</div>
            {t.hint && <div className="text-xs text-faint mt-0.5">{t.hint}</div>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5">
        <section className="card p-5 md:col-span-2" aria-labelledby="ai-days">
          <div className="flex items-baseline justify-between gap-2 mb-3 flex-wrap">
            <h2 id="ai-days" className="font-medium text-sm">Tokens per day</h2>
            <span className="text-xs text-muted">{d.window.calls} requests · {fmtTokens(d.window.tokens)} tokens · {fmtUsd(d.window.costUsd)}</span>
          </div>
          {d.window.calls === 0
            ? <p className="text-sm text-muted">No AI use in the last {d.days} days.</p>
            : <MonthlyBars data={d.byDay} fmt={fmtTokens} color="bg-accent/70" />}
        </section>
        <section className="card p-5" aria-labelledby="ai-features">
          <h2 id="ai-features" className="font-medium text-sm mb-3">By feature</h2>
          <HBarList data={d.byFeature.map((f) => ({ label: f.label, value: f.calls, hint: fmtTokens(f.tokens) }))} fmt={(n) => `${Math.round(n)}`} labelWidth="10rem" emptyLabel="Nothing yet." />
          {d.byModel.length > 0 && (
            <p className="text-xs text-muted mt-3">Model{d.byModel.length > 1 ? 's' : ''}: {d.byModel.map((m) => `${m.model} (${m.calls})`).join(', ')}</p>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5">
        <section className="card p-5" aria-labelledby="ai-users">
          <h2 id="ai-users" className="font-medium text-sm mb-3">By person</h2>
          <HBarList data={d.byUser.map((r) => ({ label: r.name, value: r.calls, hint: fmtTokens(r.tokens) }))} fmt={(n) => `${Math.round(n)}`} color="bg-steel/70" labelWidth="9rem" emptyLabel="Nothing yet." />
        </section>
        <section className="md:col-span-2" aria-labelledby="ai-actions">
          <div className="flex items-center justify-between mb-2">
            <h2 id="ai-actions" className="font-medium text-sm">What the AI proposed</h2>
            <span className="text-xs text-muted">latest {d.recentActions.length}</span>
          </div>
          {d.recentActions.length === 0 ? (
            <div className="card px-4 py-6 text-sm text-muted">Nothing proposed yet. Try <b>Ask AI</b> — “Sharma Auto ke liye quotation banao”.</div>
          ) : (
            <>
              <MobileList>
                {d.recentActions.map((a) => (
                  <ListCard
                    key={a.id}
                    title={a.label}
                    href={a.path ?? undefined}
                    pill={<StatusPill status={PILL[a.status] ?? a.status} label={STATUS_LABEL[a.status] ?? a.status} />}
                    line2={a.summary}
                    line3={`${formatDate(a.createdAt)} ${timeIST(a.createdAt)} · ${a.userName ?? '—'}${a.error ? ` · ${a.error}` : ''}`}
                  />
                ))}
              </MobileList>
              <DesktopTable>
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="text-left text-muted border-b border-line text-xs [&>th]:px-4 [&>th]:py-2 [&>th]:font-medium">
                      <th>When</th><th>Who</th><th>What</th><th>Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.recentActions.map((a) => (
                      <tr key={a.id} className="border-b border-line last:border-0 hover:bg-surface-2/50 [&>td]:px-4 [&>td]:py-2 align-top">
                        <td className="text-xs text-muted whitespace-nowrap">{formatDate(a.createdAt)}<br />{timeIST(a.createdAt)}</td>
                        <td className="text-xs text-ink whitespace-nowrap">{a.userName ?? '—'}</td>
                        <td>
                          <div className="text-xs text-muted">{a.label}</div>
                          {a.path ? <Link href={a.path} className="text-ink hover:text-accent hover:underline">{a.summary}</Link> : <span className="text-ink">{a.summary}</span>}
                          {a.error && a.status !== 'cancelled' && <div className="text-xs text-crit mt-0.5">{a.error}</div>}
                        </td>
                        <td><StatusPill status={PILL[a.status] ?? a.status} label={STATUS_LABEL[a.status] ?? a.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DesktopTable>
            </>
          )}
        </section>
      </div>

      <p className="text-xs text-muted">
        Tokens are how AI providers count text. Costs are estimates from list prices; Gemini on the free tier shows as free. Voice recordings, photos and PDFs sent to the AI are never stored.
      </p>
      <div className="mt-5"><Link href={NAV.dashboard.href} className="text-steel text-sm hover:underline">← {NAV.dashboard.label}</Link></div>
    </div>
  );
}
