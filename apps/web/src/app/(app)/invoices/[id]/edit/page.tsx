import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { aiEnabled } from '@ms/ai';
import { requireUser, can } from '@/lib/rbac';
import { getInvoice, customersForSelect, getLetterhead } from '@/lib/queries';
import { rowsFromStored } from '@/components/line-items-shared';
import { InvoiceForm } from '../../invoice-form';

export const metadata = { title: 'Edit bill' };
export const maxDuration = 60;

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!can(user, 'invoice.edit')) redirect('/invoices');
  const { id } = await params;
  const [data, activeCustomers, lh] = await Promise.all([getInvoice(id), customersForSelect(), getLetterhead()]);
  if (!data?.invoice) notFound();
  const { invoice: inv, items, customer: docCustomer } = data;
  // An archived customer is hidden from pickers, but this document still belongs
  // to them — keep them in the list so the name and GST preview stay right.
  const customers = docCustomer && !activeCustomers.some((c) => c.id === docCustomer.id)
    ? [{ id: docCustomer.id, name: docCustomer.name, stateCode: docCustomer.stateCode, gstin: docCustomer.gstin }, ...activeCustomers]
    : activeCustomers;
  if (inv.status === 'cancelled') redirect(`/invoices/${id}?locked=cancelled`); // cancelled bills are locked

  const initial = {
    customerId: inv.customerId,
    docDate: new Date(inv.docDate).toISOString().slice(0, 10),
    poRef: inv.poRef ?? '',
    terms: inv.terms ?? '',
    notes: inv.notes ?? '',
    rows: rowsFromStored(items),
    columnDefs: inv.columnDefs ?? [],
  };

  return (
    <div className="max-w-4xl">
      <p className="text-xs text-muted">Quotations, orders &amp; bills</p>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">Edit <span className="font-mono">{inv.number}</span></h1>
        <Link href={`/invoices/${id}`} className="text-steel text-sm hover:underline">← Back to {inv.number}</Link>
      </div>
      <InvoiceForm
        mode="edit"
        invoiceId={id}
        initial={initial}
        customers={customers}
        supplierStateCode={lh?.stateCode ?? '06'}
        defaultTerms={lh?.defaultTerms?.join('\n') ?? ''}
        aiEnabled={aiEnabled()}
      />
    </div>
  );
}
