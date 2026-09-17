// Run: pnpm --filter @ms/web test   (node --experimental-strip-types --test)
// Ledger arithmetic behind the customer statement and the payment receipt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLedger, agingBuckets, istDay, parseIsoDay, defaultStatementPeriod, receiptRef, balanceAfterPayment,
} from '../statement-ledger.ts';

const bill = (id, number, date, amount, extra = {}) => ({ id, number, date, amount, ...extra });
const pay = (id, billId, date, amount, extra = {}) => ({ id, billId, date, amount, methodLabel: 'UPI', ...extra });

test('opening balance sums bills minus payments dated before the period', () => {
  const r = buildLedger({
    bills: [bill('b1', 'INV/25-26/0001', '2026-02-10', 10000), bill('b2', 'INV/26-27/0001', '2026-04-05', 5000)],
    payments: [pay('p1', 'b1', '2026-03-01', 4000)],
    from: '2026-04-01', to: '2026-09-16',
  });
  assert.equal(r.opening, 6000);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].particulars, 'Bill INV/26-27/0001');
  assert.equal(r.rows[0].balance, 11000);
  assert.equal(r.closing, 11000);
  assert.deepEqual(r.totals, { debit: 5000, credit: 0 });
});

test('a bill and a payment on the same day: bill first, then the money against it', () => {
  const r = buildLedger({
    bills: [bill('b1', 'INV/26-27/0002', '2026-05-10', 8000, { poRef: 'PO-77' })],
    payments: [pay('p1', 'b1', '2026-05-10', 8000, { reference: 'UTR123' })],
    from: '2026-04-01', to: '2026-09-16',
  });
  assert.deepEqual(r.rows.map((x) => x.kind), ['bill', 'payment']);
  assert.equal(r.rows[0].particulars, 'Bill INV/26-27/0002 · PO PO-77');
  assert.equal(r.rows[0].balance, 8000);
  assert.equal(r.rows[1].particulars, 'Payment received · UPI · ref UTR123');
  assert.equal(r.rows[1].against, 'INV/26-27/0002');
  assert.equal(r.rows[1].balance, 0);
  assert.equal(r.closing, 0);
});

test('two payments on one day keep created-at order', () => {
  const r = buildLedger({
    bills: [bill('b1', 'INV/26-27/0003', '2026-06-01', 3000)],
    payments: [
      pay('p2', 'b1', '2026-06-02', 2000, { createdAt: '2026-06-02T11:00:00Z' }),
      pay('p1', 'b1', '2026-06-02', 1000, { createdAt: '2026-06-02T09:00:00Z' }),
    ],
    from: '2026-04-01', to: '2026-09-16',
  });
  assert.deepEqual(r.rows.map((x) => x.refId), ['b1', 'p1', 'p2']);
  assert.deepEqual(r.rows.map((x) => x.balance), [3000, 2000, 0]);
});

test('payments larger than bills leave a negative (advance) balance', () => {
  const r = buildLedger({
    bills: [bill('b1', 'INV/26-27/0004', '2026-07-01', 2500)],
    payments: [pay('p1', 'b1', '2026-07-03', 4000)],
    from: '2026-04-01', to: '2026-09-16',
  });
  assert.equal(r.closing, -1500);
  assert.equal(r.rows[1].balance, -1500);
});

test('cancelled bills and their payments are excluded, even when passed in', () => {
  const r = buildLedger({
    bills: [
      bill('b1', 'INV/26-27/0005', '2026-03-01', 9000, { status: 'cancelled' }),
      bill('b2', 'INV/26-27/0006', '2026-05-01', 1200, { status: 'issued' }),
    ],
    payments: [pay('p1', 'b1', '2026-03-05', 9000), pay('p2', 'b2', '2026-05-09', 200)],
    from: '2026-04-01', to: '2026-09-16',
  });
  assert.equal(r.opening, 0);
  assert.deepEqual(r.rows.map((x) => x.refId), ['b2', 'p2']);
  assert.equal(r.closing, 1000);
});

test('empty period: no rows, closing equals opening, zero totals', () => {
  const r = buildLedger({
    bills: [bill('b1', 'INV/25-26/0009', '2026-01-15', 7000)],
    payments: [pay('p1', 'b1', '2026-10-01', 7000)], // after `to`
    from: '2026-04-01', to: '2026-09-16',
  });
  assert.equal(r.rows.length, 0);
  assert.equal(r.opening, 7000);
  assert.equal(r.closing, 7000);
  assert.deepEqual(r.totals, { debit: 0, credit: 0 });
});

test('paise round cleanly along the running balance', () => {
  const r = buildLedger({
    bills: [bill('b1', 'X', '2026-05-01', 0.1), bill('b2', 'Y', '2026-05-02', 0.2)],
    payments: [],
    from: '2026-04-01', to: '2026-09-16',
  });
  assert.equal(r.closing, 0.3);
});

test('istDay reduces a UTC timestamp to the Indian calendar day', () => {
  assert.equal(istDay('2026-04-01T20:30:00Z'), '2026-04-02'); // 02:00 IST next day
  assert.equal(istDay('2026-04-01T18:29:00Z'), '2026-04-01');
  assert.equal(istDay('2026-04-01'), '2026-04-01');
  assert.throws(() => istDay('not a date'));
});

test('parseIsoDay accepts only real YYYY-MM-DD dates', () => {
  assert.equal(parseIsoDay('2026-04-01'), '2026-04-01');
  assert.equal(parseIsoDay('2026-02-30'), null);
  assert.equal(parseIsoDay('2026-13-01'), null);
  assert.equal(parseIsoDay('01-04-2026'), null);
  assert.equal(parseIsoDay(''), null);
  assert.equal(parseIsoDay(undefined), null);
});

test('default period is the Indian financial year to date', () => {
  assert.deepEqual(defaultStatementPeriod(new Date('2026-09-16T10:00:00Z')), { from: '2026-04-01', to: '2026-09-16' });
  assert.deepEqual(defaultStatementPeriod(new Date('2027-01-05T10:00:00Z')), { from: '2026-04-01', to: '2027-01-05' });
  // 31 Mar 23:00 UTC is already 1 Apr in IST → new FY.
  assert.deepEqual(defaultStatementPeriod(new Date('2027-03-31T23:00:00Z')), { from: '2027-04-01', to: '2027-04-01' });
});

test('ageing buckets match the analytics rule', () => {
  const now = '2026-09-16T00:00:00Z';
  const a = agingBuckets([
    { amount: 1000, received: 0, dueDate: '2026-09-30T00:00:00Z' },            // not yet due
    { amount: 2000, received: 500, dueDate: '2026-09-01T00:00:00Z' },          // 15 days late
    { amount: 3000, received: 0, dueDate: '2026-08-01T00:00:00Z' },            // 46 days late
    { amount: 4000, received: 0, dueDate: '2026-05-01T00:00:00Z' },            // >60
    { amount: 500, received: 500, dueDate: '2026-05-01T00:00:00Z' },           // paid → skipped
    { amount: 900, received: 0, dueDate: null },                               // no due date → current
    { amount: 9999, received: 0, dueDate: '2026-01-01T00:00:00Z', status: 'cancelled' },
  ], now);
  assert.deepEqual(a, { current: 1900, d30: 1500, d60: 3000, d60plus: 4000, total: 10400 });
});

test('receipt reference uses the IST day and the first 8 chars of the id', () => {
  assert.equal(receiptRef('1a2b3c4d-5e6f-7a8b-9c0d-e1f2a3b4c5d6', '2026-09-03T19:00:00Z'), 'RCPT/20260904/1A2B3C4D');
});

test('balance after a payment counts earlier payments by paid-on then created-at', () => {
  const payments = [
    { id: 'p3', date: '2026-06-05T00:00:00Z', amount: 1000, createdAt: '2026-06-05T10:00:00Z' },
    { id: 'p1', date: '2026-06-01T00:00:00Z', amount: 2000, createdAt: '2026-06-01T10:00:00Z' },
    { id: 'p2', date: '2026-06-01T00:00:00Z', amount: 500, createdAt: '2026-06-01T12:00:00Z' },
  ];
  assert.deepEqual(balanceAfterPayment({ billTotal: 5000, payments, paymentId: 'p1' }), { receivedUpTo: 2000, balance: 3000 });
  assert.deepEqual(balanceAfterPayment({ billTotal: 5000, payments, paymentId: 'p2' }), { receivedUpTo: 2500, balance: 2500 });
  assert.deepEqual(balanceAfterPayment({ billTotal: 5000, payments, paymentId: 'p3' }), { receivedUpTo: 3500, balance: 1500 });
  assert.equal(balanceAfterPayment({ billTotal: 5000, payments, paymentId: 'nope' }), null);
});
