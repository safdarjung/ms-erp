// Layout rules for parts / items / specs (packages/core/src/documents.ts).
// Imported by path with its extension: @ms/core's index re-exports with
// extensionless specifiers, which node's runner cannot resolve — this module is
// dependency-free, so importing the file directly is safe and exact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitColumns, itemSpecs, formatSpecs, groupRuns, AUTO_COLUMN_LIMIT, MAX_DOC_COLUMNS, MAX_DOC_LINES,
} from '../../../../../packages/core/src/documents.ts';

const col = (id, label, display) => ({ id, label, ...(display ? { display } : {}) });
const labels = (cs) => cs.map((c) => c.label);

test('caps are the ones the AI engine and zod mirror', () => {
  assert.equal(MAX_DOC_COLUMNS, 16);
  assert.equal(MAX_DOC_LINES, 60);
  assert.equal(AUTO_COLUMN_LIMIT, 2);
});

test('one or two undecided fields stay columns — existing documents look unchanged', () => {
  for (const n of [0, 1, 2]) {
    const cols = Array.from({ length: n }, (_, i) => col(`c${i}`, `F${i}`));
    const { tableCols, specCols } = splitColumns(cols);
    assert.equal(tableCols.length, n, `n=${n}`);
    assert.equal(specCols.length, 0, `n=${n}`);
  }
});

test('a third undecided field moves them all under the item', () => {
  const { tableCols, specCols } = splitColumns([col('c1', 'Material'), col('c2', 'Hardness'), col('c3', 'Size')]);
  assert.deepEqual(labels(tableCols), []);
  assert.deepEqual(labels(specCols), ['Material', 'Hardness', 'Size']);
});

test('an explicit choice always wins over the automatic rule', () => {
  // One explicit column + two undecided = three fields in the table would be too
  // wide, so the undecided ones give way and only the explicit one stays.
  const r = splitColumns([col('c1', 'Cavities', 'column'), col('c2', 'Material'), col('c3', 'Hardness')]);
  assert.deepEqual(labels(r.tableCols), ['Cavities']);
  assert.deepEqual(labels(r.specCols), ['Material', 'Hardness']);

  // Explicit + one undecided still fits, so both are columns.
  const fits = splitColumns([col('c1', 'Cavities', 'column'), col('c2', 'Material')]);
  assert.deepEqual(labels(fits.tableCols), ['Cavities', 'Material']);

  // A lone field forced under the item stays there.
  const forced = splitColumns([col('c1', 'Material', 'spec')]);
  assert.deepEqual(labels(forced.tableCols), []);
  assert.deepEqual(labels(forced.specCols), ['Material']);

  // Explicit columns are never demoted, however many there are.
  const many = splitColumns(['a', 'b', 'c', 'd'].map((x, i) => col(`c${i}`, x, 'column')));
  assert.equal(many.tableCols.length, 4);
  assert.equal(many.specCols.length, 0);
});

test('unnamed fields are ignored everywhere', () => {
  const r = splitColumns([col('c1', '  '), col('c2', 'Material'), null, undefined]);
  assert.deepEqual(labels(r.tableCols), ['Material']);
  assert.deepEqual(splitColumns(null).tableCols, []);
  assert.deepEqual(splitColumns(undefined).specCols, []);
});

test('itemSpecs lists filled spec fields in field order and formats them', () => {
  const cols = [col('c1', 'Material'), col('c2', 'Hardness'), col('c3', 'Size'), col('c4', 'Finish')];
  const specs = itemSpecs(cols, { c3: '250 x 180', c1: 'D2', c2: '  ', c4: '' });
  assert.deepEqual(specs, [{ label: 'Material', value: 'D2' }, { label: 'Size', value: '250 x 180' }]);
  assert.equal(formatSpecs(specs), 'Material: D2 · Size: 250 x 180');
  assert.deepEqual(itemSpecs(cols, null), []);
  assert.equal(formatSpecs([]), '');
  // Values belonging to a field shown as a column are not repeated under the item.
  assert.deepEqual(itemSpecs([col('c1', 'Cavities')], { c1: '2' }), []);
});

test('groupRuns builds the printed blocks and takes the first detail in each run', () => {
  const runs = groupRuns([
    { description: 'a', groupLabel: 'P1', groupNote: null },
    { description: 'b', groupLabel: 'P1', groupNote: 'Drawing DRG-114' },
    { description: 'loose', groupLabel: null },
    { description: 'c', groupLabel: 'P2', groupNote: 'Drawing DRG-220' },
  ]);
  assert.equal(runs.length, 3);
  assert.deepEqual(runs.map((r) => r.label), ['P1', '', 'P2']);
  assert.equal(runs[0].note, 'Drawing DRG-114');   // picked up from the second line
  assert.equal(runs[0].items.length, 2);
  assert.equal(runs[1].note, '');                   // ungrouped line carries none
  assert.equal(runs[2].note, 'Drawing DRG-220');
});

test('the same part name in two separate runs stays two blocks', () => {
  const runs = groupRuns([
    { groupLabel: 'P1', groupNote: 'first' },
    { groupLabel: 'P2', groupNote: 'other' },
    { groupLabel: 'P1', groupNote: 'second' },
  ]);
  assert.equal(runs.length, 3);
  assert.deepEqual(runs.map((r) => r.note), ['first', 'other', 'second']);
});

test('groupRuns copes with an empty document', () => {
  assert.deepEqual(groupRuns([]), []);
});
