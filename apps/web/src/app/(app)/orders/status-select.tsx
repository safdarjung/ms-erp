'use client';
import { ORDER_SETTABLE_STATUSES, ORDER_STATUS_LABELS, type OrderStatus } from '@ms/core';
import { InlineSelect } from '@/components/inline-select';
import { setOrderStatusAction } from './actions';

// "Cancelled" is deliberately NOT in this list — cancelling is a separate,
// confirmed "Cancel this order" button on the detail page.
const CHOICES = ORDER_SETTABLE_STATUSES.filter((s) => s !== 'cancelled');

export function OrderStatusSelect({ id, status }: { id: string; status: string }) {
  return (
    <InlineSelect
      value={status}
      ariaLabel="Order status"
      options={CHOICES.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s as OrderStatus] }))}
      onChange={(next) => setOrderStatusAction(id, next)}
    />
  );
}
