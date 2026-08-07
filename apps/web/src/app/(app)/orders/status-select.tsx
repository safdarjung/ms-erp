'use client';
import { ORDER_SETTABLE_STATUSES, ORDER_STATUS_LABELS, type OrderStatus } from '@ms/core';
import { InlineSelect } from '@/components/inline-select';
import { setOrderStatusAction } from './actions';

export function OrderStatusSelect({ id, status }: { id: string; status: string }) {
  return (
    <InlineSelect
      value={status}
      ariaLabel="Order status"
      options={ORDER_SETTABLE_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s as OrderStatus] }))}
      onChange={(next) => setOrderStatusAction(id, next)}
    />
  );
}
