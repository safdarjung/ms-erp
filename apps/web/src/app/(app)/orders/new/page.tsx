import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, can } from '@/lib/rbac';
import { customersForSelect, getLetterhead } from '@/lib/queries';
import { OrderForm } from '../order-form';

export const metadata = { title: 'New order' };

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  const user = await requireUser();
  if (!can(user, 'order.create')) redirect('/orders');

  const { customer } = await searchParams;
  const [customers, lh] = await Promise.all([customersForSelect(), getLetterhead()]);

  return (
    <div className="max-w-4xl">
      <p className="text-xs text-muted">Quotations, orders &amp; bills</p>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">New order</h1>
        <Link href="/orders" className="text-steel text-sm hover:underline">← Orders</Link>
      </div>
      <OrderForm
        customers={customers}
        supplierStateCode={lh?.stateCode ?? '06'}
        defaultCustomerId={customer ?? ''}
      />
    </div>
  );
}
