import Link from 'next/link';
import { redirect } from 'next/navigation';
import { aiEnabled } from '@ms/ai';
import { requireUser, can } from '@/lib/rbac';
import { customersForSelect, getLetterhead } from '@/lib/queries';
import { InvoiceForm } from '../invoice-form';

export const metadata = { title: 'New bill' };

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  const user = await requireUser();
  if (!can(user, 'invoice.create')) redirect('/invoices');

  const { customer } = await searchParams;
  const [customers, lh] = await Promise.all([customersForSelect(), getLetterhead()]);
  const defaultTerms = lh?.defaultTerms?.join('\n') ?? '';

  return (
    <div className="max-w-4xl">
      <p className="text-xs text-muted">Quotations, orders &amp; bills</p>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">New bill</h1>
        <Link href="/invoices" className="text-steel text-sm hover:underline">← Bills</Link>
      </div>
      <InvoiceForm customers={customers} supplierStateCode={lh?.stateCode ?? '06'} defaultTerms={defaultTerms} aiEnabled={aiEnabled()} defaultCustomerId={customer ?? ''} />
    </div>
  );
}
