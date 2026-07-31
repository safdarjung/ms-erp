import Link from 'next/link';
import { redirect } from 'next/navigation';
import { aiEnabled } from '@ms/ai';
import { requireUser, can } from '@/lib/rbac';
import { customersForSelect, getLetterhead } from '@/lib/queries';
import { InvoiceForm } from '../invoice-form';

export const metadata = { title: 'New invoice' };

export default async function NewInvoicePage() {
  const user = await requireUser();
  if (!can(user, 'invoice.create')) redirect('/invoices');

  const [customers, lh] = await Promise.all([customersForSelect(), getLetterhead()]);
  const defaultTerms = lh?.defaultTerms?.join('\n') ?? '';

  return (
    <div className="max-w-4xl">
      <p className="eyebrow">Finance</p>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">New GST Invoice</h1>
        <Link href="/invoices" className="text-steel text-sm hover:underline">← Invoices</Link>
      </div>
      <InvoiceForm customers={customers} supplierStateCode={lh?.stateCode ?? '06'} defaultTerms={defaultTerms} aiEnabled={aiEnabled()} />
    </div>
  );
}
