import Link from 'next/link';
import { redirect } from 'next/navigation';
import { aiEnabled } from '@ms/ai';
import { requireUser, can } from '@/lib/rbac';
import { customersForSelect, getLetterhead } from '@/lib/queries';
import { QuotationForm } from '../quotation-form';

export const metadata = { title: 'New quotation' };
// AI quotation drafting (server action on this page) can take ~30s on the
// pricing model — keep Vercel from timing it out at the default.
export const maxDuration = 60;

export default async function NewQuotationPage() {
  const user = await requireUser();
  if (!can(user, 'quotation.create')) redirect('/quotations');

  const [customers, lh] = await Promise.all([customersForSelect(), getLetterhead()]);
  const defaultTerms = lh?.defaultTerms?.join('\n') ?? '';

  return (
    <div className="max-w-4xl">
      <p className="eyebrow">Sales</p>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">New Quotation</h1>
        <Link href="/quotations" className="text-steel text-sm hover:underline">← Quotations</Link>
      </div>
      <QuotationForm
        customers={customers}
        supplierStateCode={lh?.stateCode ?? '06'}
        defaultTerms={defaultTerms}
        aiEnabled={aiEnabled()}
      />
    </div>
  );
}
