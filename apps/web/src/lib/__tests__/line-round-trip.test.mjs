// A document must survive the whole editing loop unchanged: stored rows →
// editor rows → saved items. Parts, part details and per-item specs are easy to
// drop silently at any hop, and nothing downstream would notice — hence this.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowsFromStored, serializeItems, cleanColumns, emptyRow } from '../../components/line-items-shared.ts';

const COLUMNS = [
  { id: 'c1', label: 'Material', display: 'spec' },
  { id: 'c2', label: 'Hardness', display: 'spec' },
  { id: 'c3', label: 'Cavities', display: 'column' },
];

/** 2 parts × 3 items with details and specs, plus a standalone charge. */
const STORED = [
  { description: 'Blanking die', hsn: '84807100', qty: 1, uom: 'NOS', rate: 30000, gstRate: 18, isToolingCharge: false, groupLabel: '30017AW1002', groupNote: 'Drawing DRG-114 · MS 2mm', attributes: { c1: 'D2', c2: '58-60 HRC', c3: '2' } },
  { description: 'Bending die', hsn: '84807100', qty: 1, uom: 'NOS', rate: 16000, gstRate: 18, isToolingCharge: false, groupLabel: '30017AW1002', groupNote: 'Drawing DRG-114 · MS 2mm', attributes: { c1: 'EN 31' } },
  { description: 'Piercing die', hsn: '84807100', qty: 2, uom: 'NOS', rate: 12000, gstRate: 18, isToolingCharge: false, groupLabel: '30017AW1002', groupNote: 'Drawing DRG-114 · MS 2mm', attributes: {} },
  { description: 'Blanking & punching die', hsn: '84807100', qty: 1, uom: 'NOS', rate: 55000, gstRate: 12, isToolingCharge: false, groupLabel: '41928', groupNote: 'Drawing DRG-220', attributes: { c1: 'D2', c2: '60-62 HRC' } },
  { description: 'Bending die', hsn: '84807100', qty: 1, uom: 'NOS', rate: 20000, gstRate: 18, isToolingCharge: false, groupLabel: '41928', groupNote: 'Drawing DRG-220', attributes: {} },
  { description: 'Trial & proving', hsn: '84807100', qty: 1, uom: 'NOS', rate: 5000, gstRate: 18, isToolingCharge: true, groupLabel: null, groupNote: null, attributes: {} },
];

const saved = () => serializeItems(rowsFromStored(STORED), COLUMNS);

test('every part, part detail and item spec survives stored → editor → saved', () => {
  const out = saved();
  assert.equal(out.length, STORED.length);
  out.forEach((it, i) => {
    const src = STORED[i];
    assert.equal(it.description, src.description, `line ${i + 1} description`);
    assert.equal(it.qty, src.qty, `line ${i + 1} qty`);
    assert.equal(it.rate, src.rate, `line ${i + 1} rate`);
    assert.equal(it.gstRate, src.gstRate, `line ${i + 1} GST`);
    assert.equal(it.isToolingCharge, src.isToolingCharge, `line ${i + 1} one-time flag`);
    assert.equal(it.groupLabel ?? null, src.groupLabel, `line ${i + 1} part`);
    assert.equal(it.groupNote ?? null, src.groupNote, `line ${i + 1} part detail`);
    assert.deepEqual(it.attributes, src.attributes, `line ${i + 1} specs`);
  });
});

test('a second pass through the loop changes nothing (stable round-trip)', () => {
  const once = saved();
  const twice = serializeItems(rowsFromStored(once.map((it) => ({ ...it, groupLabel: it.groupLabel ?? null, groupNote: it.groupNote ?? null }))), COLUMNS);
  assert.deepEqual(twice, once);
});

test('a part detail written on only one row comes back on every row of that part', () => {
  const partial = STORED.map((it, i) => (i === 1 ? { ...it, groupNote: null } : it));
  const rows = rowsFromStored(partial);
  assert.ok(rows.filter((r) => r.groupLabel === '30017AW1002').every((r) => r.groupNote === 'Drawing DRG-114 · MS 2mm'));
});

test('an ungrouped line never carries a part detail', () => {
  const out = saved();
  const loose = out[out.length - 1];
  assert.equal(loose.groupLabel, undefined);
  assert.equal(loose.groupNote, undefined);
});

test('values of a removed field are dropped, and each field keeps where it prints', () => {
  const withoutHardness = COLUMNS.filter((c) => c.id !== 'c2');
  const out = serializeItems(rowsFromStored(STORED), withoutHardness);
  assert.ok(out.every((it) => !('c2' in it.attributes)));
  assert.equal(out[0].attributes.c1, 'D2');
  assert.deepEqual(cleanColumns(COLUMNS).map((c) => [c.label, c.display]),
    [['Material', 'spec'], ['Hardness', 'spec'], ['Cavities', 'column']]);
});

test('blank rows are dropped without disturbing the parts around them', () => {
  const rows = rowsFromStored(STORED);
  const withBlank = [rows[0], emptyRow({ gid: rows[0].gid, groupLabel: rows[0].groupLabel, groupNote: rows[0].groupNote }), ...rows.slice(1)];
  const out = serializeItems(withBlank, COLUMNS);
  assert.equal(out.length, STORED.length);
  assert.deepEqual(out.map((i) => i.description), STORED.map((i) => i.description));
});
