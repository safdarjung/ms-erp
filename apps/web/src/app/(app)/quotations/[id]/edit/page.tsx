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
  const [data, customers, lh] = await Promise.all([getQuotation(id), customersForSelect(), getLetterhead()]);
  if (!data?.quotation) notFound();
  const { quotation: q, items } = data;
  if (q.convertedInvoiceId || q.convertedOrderId) redirect(`/quotations/${id}`); // locked once ordered/invoiced

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
      <p className="eyebrow">Sales</p>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Edit {q.number}</h1>
        <Link href={`/quotations/${id}`} className="text-steel text-sm hover:underline">← Back</Link>
      </div>
      <QuotationForm
        mode="edit"
        quotationId={id}
        initial={initial}
        customers={customers}
        supplierStateCode={lh?.stateCode ?? '06'}
        defaultTerms={initial.terms}
        aiEnabled={aiEnabled()}
      />
    </div>
  );
}
