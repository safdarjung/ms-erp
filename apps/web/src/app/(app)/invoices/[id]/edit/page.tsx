import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { aiEnabled } from '@ms/ai';
import { requireUser, can } from '@/lib/rbac';
import { getInvoice, customersForSelect, getLetterhead } from '@/lib/queries';
import { rowsFromStored } from '@/components/line-items-shared';
import { InvoiceForm } from '../../invoice-form';

export const metadata = { title: 'Edit invoice' };
export const maxDuration = 60;

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!can(user, 'invoice.edit')) redirect('/invoices');
  const { id } = await params;
  const [data, customers, lh] = await Promise.all([getInvoice(id), customersForSelect(), getLetterhead()]);
  if (!data?.invoice) notFound();
  const { invoice: inv, items } = data;
  if (inv.status === 'cancelled') redirect(`/invoices/${id}`); // cancelled invoices are locked

  const initial = {
    customerId: inv.customerId,
    docDate: new Date(inv.docDate).toISOString().slice(0, 10),
    poRef: inv.poRef ?? '',
    terms: inv.terms ?? '',
    rows: rowsFromStored(items),
    columnDefs: inv.columnDefs ?? [],
  };

  return (
    <div className="max-w-4xl">
      <p className="eyebrow">Sales &amp; GST</p>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Edit {inv.number}</h1>
        <Link href={`/invoices/${id}`} className="text-steel text-sm hover:underline">← Back</Link>
      </div>
      <InvoiceForm
        mode="edit"
        invoiceId={id}
        initial={initial}
        customers={customers}
        supplierStateCode={lh?.stateCode ?? '06'}
        defaultTerms={initial.terms}
        aiEnabled={aiEnabled()}
      />
    </div>
  );
}
