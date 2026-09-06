import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser, can } from '@/lib/rbac';
import { getOrder, customersForSelect, getLetterhead } from '@/lib/queries';
import { rowsFromStored } from '@/components/line-items-shared';
import { OrderForm } from '../../order-form';

export const metadata = { title: 'Edit order' };
export const maxDuration = 60;

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!can(user, 'order.edit')) redirect('/orders');
  const { id } = await params;
  const [data, activeCustomers, lh] = await Promise.all([getOrder(id), customersForSelect(), getLetterhead()]);
  if (!data?.order) notFound();
  const { order: o, items, customer: docCustomer } = data;
  // An archived customer is hidden from pickers, but this document still belongs
  // to them — keep them in the list so the name and GST preview stay right.
  const customers = docCustomer && !activeCustomers.some((c) => c.id === docCustomer.id)
    ? [{ id: docCustomer.id, name: docCustomer.name, stateCode: docCustomer.stateCode, gstin: docCustomer.gstin }, ...activeCustomers]
    : activeCustomers;
  if (o.convertedInvoiceId) redirect(`/orders/${id}?locked=bill`);
  if (o.status === 'cancelled') redirect(`/orders/${id}?locked=cancelled`);

  const initial = {
    customerId: o.customerId,
    docDate: new Date(o.docDate).toISOString().slice(0, 10),
    poRef: o.poRef ?? '',
    orderCategory: o.orderCategory,
    materialOwnership: o.materialOwnership,
    deliveryDate: o.deliveryDate ? new Date(o.deliveryDate).toISOString().slice(0, 10) : '',
    rows: rowsFromStored(items),
    columnDefs: o.columnDefs ?? [],
  };

  return (
    <div className="max-w-4xl">
      <p className="text-xs text-muted">Quotations, orders &amp; bills</p>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">Edit <span className="font-mono">{o.number}</span></h1>
        <Link href={`/orders/${id}`} className="text-steel text-sm hover:underline">← Back to {o.number}</Link>
      </div>
      <OrderForm
        mode="edit"
        orderId={id}
        initial={initial}
        customers={customers}
        supplierStateCode={lh?.stateCode ?? '06'}
      />
    </div>
  );
}
