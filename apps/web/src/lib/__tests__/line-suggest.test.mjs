// "Type an item, get its last price": what a picked suggestion may and may not
// overwrite on a line. The description always changes; the rate only fills a
// blank; HSN / unit / GST % only move while still at the shop defaults.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applySuggestionToRow, emptyRow, DEFAULT_HSN, DEFAULT_UOM, DEFAULT_GST,
} from '../../components/line-items-shared.ts';

const S = (over = {}) => ({
  description: 'Blanking die 200×150', hsn: '84807100', uom: 'NOS', gstRate: 18, lastRate: 30000,
  lastDate: '2026-08-12', lastCustomer: 'Sharma Auto', lastDocNumber: 'QT-26-0042',
  times: 4, minRate: 28000, maxRate: 32000, ...over,
});
const fresh = (over = {}) => ({ ...emptyRow(undefined, 'r1'), ...over });

test('an untouched row takes everything from the suggestion', () => {
  const out = applySuggestionToRow(fresh(), S({ hsn: '82073000', uom: 'SET', gstRate: 12, lastRate: 45000 }));
  assert.equal(out.description, 'Blanking die 200×150');
  assert.equal(out.rate, '45000');
  assert.equal(out.hsn, '82073000');
  assert.equal(out.uom, 'SET');
  assert.equal(out.gstRate, '12');
});

test('the description is always replaced, even when one was typed', () => {
  const out = applySuggestionToRow(fresh({ description: 'blank' }), S());
  assert.equal(out.description, 'Blanking die 200×150');
});

test('the rate fills only when empty or zero', () => {
  for (const rate of ['', '0', '0.00', '  ']) {
    assert.equal(applySuggestionToRow(fresh({ rate }), S()).rate, '30000', `rate=${JSON.stringify(rate)}`);
  }
});

test('a rate the user already typed stays', () => {
  const out = applySuggestionToRow(fresh({ rate: '27500' }), S());
  assert.equal(out.rate, '27500');
  assert.equal(out.description, 'Blanking die 200×150');
});

test('HSN, unit and GST % the user changed by hand stay', () => {
  const out = applySuggestionToRow(fresh({ hsn: '82073000', uom: 'SET', gstRate: '12' }), S());
  assert.equal(out.hsn, '82073000');
  assert.equal(out.uom, 'SET');
  assert.equal(out.gstRate, '12');
});

test('"18.0" and "nos" still count as the defaults', () => {
  const out = applySuggestionToRow(fresh({ gstRate: '18.0', uom: 'nos' }), S({ uom: 'PCS', gstRate: 5 }));
  assert.equal(out.uom, 'PCS');
  assert.equal(out.gstRate, '5');
});

test('a suggestion with no HSN or unit leaves the row values alone', () => {
  const out = applySuggestionToRow(fresh(), S({ hsn: null, uom: '' }));
  assert.equal(out.hsn, DEFAULT_HSN);
  assert.equal(out.uom, DEFAULT_UOM);
  assert.equal(out.gstRate, DEFAULT_GST);
});

test('a decimal rate is carried as typed', () => {
  assert.equal(applySuggestionToRow(fresh(), S({ lastRate: 1234.5 })).rate, '1234.5');
});

test('qty, part, one-time flag and extra fields are untouched', () => {
  const row = fresh({
    qty: '3', gid: 'g1', groupLabel: 'Bracket LH', groupNote: 'DRG 42', tooling: true, attributes: { c1: 'D2' },
  });
  const out = applySuggestionToRow(row, S());
  assert.equal(out.rid, 'r1');
  assert.equal(out.qty, '3');
  assert.equal(out.gid, 'g1');
  assert.equal(out.groupLabel, 'Bracket LH');
  assert.equal(out.groupNote, 'DRG 42');
  assert.equal(out.tooling, true);
  assert.deepEqual(out.attributes, { c1: 'D2' });
});

test('returns a new row and never mutates the one given', () => {
  const row = fresh({ description: 'blank', rate: '' });
  const snapshot = JSON.stringify(row);
  const out = applySuggestionToRow(row, S());
  assert.notEqual(out, row);
  assert.equal(JSON.stringify(row), snapshot);
});
