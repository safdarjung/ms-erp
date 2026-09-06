import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { aiEnabled } from '@ms/ai';
import { requireUser, can } from '@/lib/rbac';
import { getQuotation, customersForSelect, getLetterhead } from '@/lib/queries';
import { rowsFromStored } from '@/components/line-items-shared';
import { QuotationForm } from '../../quotation-form';

export const metadata = { title: 'Edit quotation' };
export const maxDuration = 60;

export default async function EditQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!can(user, 'quotation.edit')) redirect('/quotations');
  const { id } = await params;
  const [data, activeCustomers, lh] = await Promise.all([getQuotation(id), customersForSelect(), getLetterhead()]);
  if (!data?.quotation) notFound();
  const { quotation: q, items, customer: docCustomer } = data;
  // An archived customer is hidden from pickers, but this document still belongs
  // to them — keep them in the list so the name and GST preview stay right.
  const customers = docCustomer && !activeCustomers.some((c) => c.id === docCustomer.id)
    ? [{ id: docCustomer.id, name: docCustomer.name, stateCode: docCustomer.stateCode, gstin: docCustomer.gstin }, ...activeCustomers]
    : activeCustomers;
  // Locked once ordered/billed — say why instead of bouncing back silently.
  if (q.convertedInvoiceId) redirect(`/quotations/${id}?locked=bill`);
  if (q.convertedOrderId) redirect(`/quotations/${id}?locked=order`);

  const initial = {
    customerId: q.customerId,
    docDate: new Date(q.docDate).toISOString().slice(0, 10),
    validityDays: q.validityDays,
    terms: q.terms ?? '',
    notes: q.notes ?? '',
    rows: rowsFromStored(items),
    columnDefs: q.columnDefs ?? [],
  };

  return (
    <div className="max-w-4xl">
      <p className="text-xs text-muted">Quotations, orders &amp; bills</p>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">Edit <span className="font-mono">{q.number}</span></h1>
        <Link href={`/quotations/${id}`} className="text-steel text-sm hover:underline">← Back to {q.number}</Link>
      </div>
      <QuotationForm
        mode="edit"
        quotationId={id}
        initial={initial}
        customers={customers}
        supplierStateCode={lh?.stateCode ?? '06'}
        defaultTerms={lh?.defaultTerms?.join('\n') ?? ''}
        aiEnabled={aiEnabled()}
      />
    </div>
  );
}
