// Run: pnpm --filter @ms/web test   (node --experimental-strip-types --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDocEdits, diffDocLines, regroupLines, resolveAttributes } from '../doc-edits.ts';

const L = (description, rate, extra = {}) => ({
  description, hsn: '84807100', qty: 1, uom: 'NOS', rate, gstRate: 18, attributes: {}, ...extra,
});

/** A two-part die quotation with one custom column (Steel grade = c1). */
const doc = () => ({
  columns: [{ id: 'c1', label: 'Steel grade' }],
  lines: [
    L('Blanking die', 30000, { groupLabel: '30017AW1002', attributes: { c1: 'D2' } }),
    L('Bending die', 16000, { groupLabel: '30017AW1002' }),
    L('Blanking & punching die', 55000, { groupLabel: '41928' }),
    L('Bending die', 20000, { groupLabel: '41928', attributes: { c1: 'HCHCr' } }),
    L('Tool trial & proving', 5000, { isToolingCharge: true }),
  ],
});

test('update changes only the given fields and reports a diff', () => {
  const { columns, lines } = doc();
  const r = applyDocEdits(lines, columns, [{ op: 'update', line: 2, rate: 18000, qty: 2 }]);
  assert.equal(r.lines[1].rate, 18000);
  assert.equal(r.lines[1].qty, 2);
  assert.equal(r.lines[1].groupLabel, '30017AW1002'); // untouched
  assert.equal(r.lines[1].description, 'Bending die');
  assert.match(r.changes[0], /Line 2 “Bending die”: qty 1 → 2; rate ₹16,000 → ₹18,000/);
});

test('update with attributes by column NAME creates the column when new', () => {
  const { columns, lines } = doc();
  const r = applyDocEdits(lines, columns, [
    { op: 'update', line: 3, attributes: [{ name: 'Cavities', value: '2' }, { name: 'steel grade', value: 'D2' }] },
  ]);
  assert.equal(r.columns.length, 2);
  assert.equal(r.columns[1].label, 'Cavities');
  assert.equal(r.lines[2].attributes[r.columns[1].id], '2');
  assert.equal(r.lines[2].attributes.c1, 'D2'); // case-insensitive match onto the existing column
  assert.ok(r.changes.some((c) => c.includes('New field “Cavities”')));
});

test('add appends to the named part when no position is given; afterLine positions explicitly', () => {
  const { columns, lines } = doc();
  const r = applyDocEdits(lines, columns, [
    { op: 'add', item: { description: 'Piercing die', rate: 12000, groupLabel: '30017AW1002' } },
    { op: 'add', afterLine: 4, item: { description: 'Trimming die', rate: 9000, qty: 1 } },
  ]);
  const names = r.lines.map((l) => l.description);
  assert.deepEqual(names, [
    'Blanking die', 'Bending die', 'Piercing die', // appended inside part 1
    'Blanking & punching die', 'Bending die', 'Trimming die', // after original line 4
    'Tool trial & proving',
  ]);
  assert.equal(r.lines[2].hsn, '84807100'); // default HSN filled
  assert.equal(r.lines[2].gstRate, 18);
});

test('remove drops the line; removing the last line is refused', () => {
  const { columns, lines } = doc();
  const r = applyDocEdits(lines, columns, [{ op: 'remove', line: 5 }]);
  assert.equal(r.lines.length, 4);
  assert.match(r.changes[0], /− Removed line 5 “Tool trial & proving” \(₹5,000\)/);
  assert.throws(() => applyDocEdits([L('Only', 1)], [], [{ op: 'remove', line: 1 }]), /at least one line/);
});

test('line numbers always refer to the ORIGINAL numbering within one batch', () => {
  const { columns, lines } = doc();
  // Remove line 1, then update "line 3" — must still hit the original line 3.
  const r = applyDocEdits(lines, columns, [{ op: 'remove', line: 1 }, { op: 'update', line: 3, rate: 60000 }]);
  assert.equal(r.lines.find((l) => l.description === 'Blanking & punching die').rate, 60000);
});

test('move down and up land at the requested printed position', () => {
  const { columns, lines } = doc();
  const down = applyDocEdits(lines, columns, [{ op: 'move', line: 5, toLine: 1 }]);
  assert.equal(down.lines[0].description, 'Tool trial & proving');
  const ungroupedFirst = lines.map((l) => ({ ...l, groupLabel: undefined }));
  const up = applyDocEdits(ungroupedFirst, columns, [{ op: 'move', line: 1, toLine: 3 }]);
  assert.deepEqual(up.lines.slice(0, 3).map((l) => l.description), ['Bending die', 'Blanking & punching die', 'Blanking die']);
});

test('adjust_rates by percent with rounding, scoped to a part', () => {
  const { columns, lines } = doc();
  const r = applyDocEdits(lines, columns, [{ op: 'adjust_rates', percent: 5, groupLabel: '41928', roundTo: 100 }]);
  assert.equal(r.lines[2].rate, 57800); // 55000 × 1.05 = 57750 → nearest 100
  assert.equal(r.lines[3].rate, 21000);
  assert.equal(r.lines[0].rate, 30000); // other part untouched
  assert.match(r.changes[0], /Rates \+5% on 2 lines \(part “41928”\), rounded to ₹100/);
});

test('adjust_rates by amount on explicit lines never goes negative', () => {
  const { columns, lines } = doc();
  const r = applyDocEdits(lines, columns, [{ op: 'adjust_rates', amount: -6000, lines: [5] }]);
  assert.equal(r.lines[4].rate, 0);
});

test('set_gst on all lines and set_group / rename_group', () => {
  const { columns, lines } = doc();
  const r = applyDocEdits(lines, columns, [
    { op: 'set_gst', gstRate: 12 },
    { op: 'set_group', lines: [5], groupLabel: '41928' },
    { op: 'rename_group', from: '30017aw1002', to: 'Part A' },
  ]);
  assert.ok(r.lines.every((l) => l.gstRate === 12));
  assert.equal(r.lines.filter((l) => l.groupLabel === '41928').length, 3);
  assert.equal(r.lines.filter((l) => l.groupLabel === 'Part A').length, 2);
  assert.ok(r.changes.some((c) => c === 'Part “30017aw1002” → “Part A” (2 lines)'));
});

test('parts stay contiguous after edits, ungrouped lines keep their place', () => {
  const lines = [L('a', 1, { groupLabel: 'P1' }), L('x', 1), L('b', 1, { groupLabel: 'P2' }), L('c', 1, { groupLabel: 'P1' })];
  const r = regroupLines(lines).map((l) => l.description);
  assert.deepEqual(r, ['a', 'c', 'x', 'b']);
});

test('set_column creates + fills, rename_column and remove_column', () => {
  const { columns, lines } = doc();
  const r = applyDocEdits(lines, columns, [
    { op: 'set_column', name: 'Drawing no.', values: [{ line: 1, value: 'DRG-01' }, { line: 3, value: 'DRG-02' }] },
    { op: 'rename_column', from: 'Steel grade', to: 'Material' },
  ]);
  assert.deepEqual(r.columns.map((c) => c.label), ['Material', 'Drawing no.']);
  assert.equal(r.lines[0].attributes[r.columns[1].id], 'DRG-01');
  const r2 = applyDocEdits(r.lines, r.columns, [{ op: 'remove_column', name: 'material' }]);
  assert.deepEqual(r2.columns.map((c) => c.label), ['Drawing no.']);
  assert.ok(r2.lines.every((l) => !('c1' in l.attributes)));
});

test('validation: unknown line, bad qty, unknown part, unknown op', () => {
  const { columns, lines } = doc();
  assert.throws(() => applyDocEdits(lines, columns, [{ op: 'update', line: 9, rate: 1 }]), /Line 9 does not exist — the document has 5 lines/);
  assert.throws(() => applyDocEdits(lines, columns, [{ op: 'update', line: 1, qty: 0 }]), /quantity must be greater than 0/);
  assert.throws(() => applyDocEdits(lines, columns, [{ op: 'adjust_rates', percent: 5, groupLabel: 'nope' }]), /No part named “nope”/);
  assert.throws(() => applyDocEdits(lines, columns, [{ op: 'explode' }]), /Unknown edit op/);
  assert.throws(() => applyDocEdits(lines, columns, []), /No edits given/);
});

test('resolveAttributes accepts id-keyed records from re-staged card edits', () => {
  const r = resolveAttributes([{ id: 'c1', label: 'Steel grade' }], { c1: 'D2' });
  assert.deepEqual(r.attributes, { c1: 'D2' });
  assert.equal(r.columns.length, 1);
});

test('diffDocLines pairs by description and lists additions/removals', () => {
  const { columns, lines } = doc();
  const after = [
    { ...lines[0], rate: 32000 },
    lines[2],
    L('Shearing die', 7000),
  ];
  const ch = diffDocLines(lines, after, columns);
  assert.ok(ch.some((c) => c.startsWith('Line 1 “Blanking die”: rate ₹30,000 → ₹32,000')));
  assert.ok(ch.some((c) => c.startsWith('− Removed line 2 “Bending die”')));
  assert.ok(ch.some((c) => c.startsWith('− Removed line 5 “Tool trial & proving”')));
  assert.ok(ch.some((c) => c.startsWith('+ Added “Shearing die”')));
});

// ── Complex quotations: parts with their own detail, per-item specs ─────────

/** 2 parts × 3 dies, each die with its own material/hardness, plus a trial line. */
const complex = () => ({
  columns: [
    { id: 'c1', label: 'Material', display: 'spec' },
    { id: 'c2', label: 'Hardness', display: 'spec' },
    { id: 'c3', label: 'Cavities', display: 'column' },
  ],
  lines: [
    L('Blanking die', 30000, { groupLabel: '30017AW1002', groupNote: 'Drawing DRG-114 · MS 2mm', attributes: { c1: 'D2', c2: '58-60 HRC', c3: '2' } }),
    L('Bending die', 16000, { groupLabel: '30017AW1002', groupNote: 'Drawing DRG-114 · MS 2mm', attributes: { c1: 'D2', c2: '56 HRC' } }),
    L('Piercing die', 12000, { groupLabel: '30017AW1002', groupNote: 'Drawing DRG-114 · MS 2mm', attributes: { c1: 'OHNS' } }),
    L('Blanking & punching die', 55000, { groupLabel: '41928', groupNote: 'Drawing DRG-220', attributes: { c1: 'D2' } }),
    L('Bending die', 20000, { groupLabel: '41928', groupNote: 'Drawing DRG-220' }),
    L('Trial & proving', 5000, { isToolingCharge: true }),
  ],
});

test('a part detail is kept on every line of the part and can be changed in one op', () => {
  const { columns, lines } = complex();
  const r = applyDocEdits(lines, columns, [{ op: 'set_group_note', groupLabel: '41928', note: 'Drawing DRG-220 rev B · SS 1.6mm' }]);
  const part = r.lines.filter((l) => l.groupLabel === '41928');
  assert.equal(part.length, 2);
  assert.ok(part.every((l) => l.groupNote === 'Drawing DRG-220 rev B · SS 1.6mm'));
  assert.equal(r.lines[0].groupNote, 'Drawing DRG-114 · MS 2mm'); // other part untouched
  assert.match(r.changes[0], /Part “41928” detail → “Drawing DRG-220 rev B · SS 1\.6mm”/);
  // clearing it
  const cleared = applyDocEdits(r.lines, r.columns, [{ op: 'set_group_note', groupLabel: '41928', note: '' }]);
  assert.ok(cleared.lines.filter((l) => l.groupLabel === '41928').every((l) => l.groupNote === undefined));
});

test('a line joining a part inherits that part detail; leaving a part drops it', () => {
  const { columns, lines } = complex();
  const joined = applyDocEdits(lines, columns, [{ op: 'set_group', lines: [6], groupLabel: '41928' }]);
  const moved = joined.lines.find((l) => l.description === 'Trial & proving');
  assert.equal(moved.groupNote, 'Drawing DRG-220');
  const left = applyDocEdits(joined.lines, joined.columns, [{ op: 'set_group', lines: [6], groupLabel: '' }]);
  const loose = left.lines.find((l) => l.description === 'Trial & proving');
  assert.equal(loose.groupLabel, undefined);
  assert.equal(loose.groupNote, undefined);
});

test('adding an item into an existing part picks up its detail and position', () => {
  const { columns, lines } = complex();
  const r = applyDocEdits(lines, columns, [
    { op: 'add', item: { description: 'Trimming die', rate: 14000, groupLabel: '30017AW1002', attributes: [{ name: 'Material', value: 'D3' }] } },
  ]);
  assert.deepEqual(r.lines.slice(0, 4).map((l) => l.description),
    ['Blanking die', 'Bending die', 'Piercing die', 'Trimming die']);
  assert.equal(r.lines[3].groupNote, 'Drawing DRG-114 · MS 2mm');
  assert.equal(r.lines[3].attributes.c1, 'D3');
});

test('set_specs writes the same spec across a whole part and can clear one', () => {
  const { columns, lines } = complex();
  const r = applyDocEdits(lines, columns, [
    { op: 'set_specs', groupLabel: '41928', specs: [{ name: 'Material', value: 'D2 (imported)' }, { name: 'Size', value: '200x150x25' }] },
  ]);
  const part = r.lines.filter((l) => l.groupLabel === '41928');
  const sizeId = r.columns.find((c) => c.label === 'Size').id;
  assert.ok(part.every((l) => l.attributes.c1 === 'D2 (imported)' && l.attributes[sizeId] === '200x150x25'));
  assert.equal(r.lines[0].attributes.c1, 'D2'); // part 1 untouched
  assert.ok(r.changes.some((c) => c.includes('New field “Size”')));

  const cleared = applyDocEdits(r.lines, r.columns, [{ op: 'set_specs', lines: [4], specs: [{ name: 'Material', value: '' }] }]);
  assert.equal(cleared.lines[3].attributes.c1, undefined);
});

test('set_specs on explicit lines only touches those lines', () => {
  const { columns, lines } = complex();
  const r = applyDocEdits(lines, columns, [{ op: 'set_specs', lines: [1, 4], specs: [{ name: 'Hardness', value: '60 HRC' }] }]);
  assert.equal(r.lines[0].attributes.c2, '60 HRC');
  assert.equal(r.lines[3].attributes.c2, '60 HRC');
  assert.equal(r.lines[1].attributes.c2, '56 HRC');
});

test('a field can be switched between its own column and under-the-item', () => {
  const { columns, lines } = complex();
  const r = applyDocEdits(lines, columns, [
    { op: 'set_column_display', name: 'cavities', display: 'spec' },
    { op: 'set_column_display', name: 'Hardness', display: 'column' },
  ]);
  assert.equal(r.columns.find((c) => c.label === 'Cavities').display, 'spec');
  assert.equal(r.columns.find((c) => c.label === 'Hardness').display, 'column');
  assert.throws(() => applyDocEdits(lines, columns, [{ op: 'set_column_display', name: 'Nope', display: 'spec' }]), /No field named “Nope”/);
  assert.throws(() => applyDocEdits(lines, columns, [{ op: 'set_column_display', name: 'Material' }]), /needs display/);
});

test('a new field created by the AI keeps working past the old 12-column limit', () => {
  const cols = Array.from({ length: 15 }, (_, i) => ({ id: `k${i}`, label: `F${i}` }));
  const r = applyDocEdits([L('Die', 1000)], cols, [{ op: 'set_column', name: 'F15', values: [{ line: 1, value: 'x' }] }]);
  assert.equal(r.columns.length, 16);
  assert.throws(() => applyDocEdits([L('Die', 1000)], r.columns, [{ op: 'set_column', name: 'F16', values: [] }]), /at most 16 extra fields/);
});

test('renaming a part keeps its detail and its items together', () => {
  const { columns, lines } = complex();
  const r = applyDocEdits(lines, columns, [{ op: 'rename_group', from: '30017AW1002', to: 'Bracket LH (30017AW1002)' }]);
  const part = r.lines.filter((l) => l.groupLabel === 'Bracket LH (30017AW1002)');
  assert.equal(part.length, 3);
  assert.ok(part.every((l) => l.groupNote === 'Drawing DRG-114 · MS 2mm'));
});

test('a 4-part quotation survives a mixed batch of edits', () => {
  const base = [
    ...['A', 'B', 'C', 'D'].flatMap((p, i) => [
      L(`${p} blanking die`, 30000 + i * 1000, { groupLabel: `Part ${p}`, groupNote: `Drawing ${p}-1` }),
      L(`${p} bending die`, 16000 + i * 1000, { groupLabel: `Part ${p}`, groupNote: `Drawing ${p}-1` }),
      L(`${p} piercing die`, 12000 + i * 1000, { groupLabel: `Part ${p}`, groupNote: `Drawing ${p}-1` }),
    ]),
  ];
  const r = applyDocEdits(base, [], [
    { op: 'set_specs', groupLabel: 'Part A', specs: [{ name: 'Material', value: 'D2' }, { name: 'Hardness', value: '58-60 HRC' }] },
    { op: 'adjust_rates', groupLabel: 'Part C', percent: 5, roundTo: 100 },
    { op: 'remove', line: 9 },
    { op: 'set_group_note', groupLabel: 'Part D', note: 'Drawing D-2 rev C' },
    { op: 'add', item: { description: 'Trial & proving', rate: 5000, isToolingCharge: true } },
  ]);
  assert.equal(r.lines.length, 12);                                   // 12 - 1 removed + 1 added
  assert.equal(r.columns.length, 2);                                  // Material + Hardness created
  assert.ok(r.lines.filter((l) => l.groupLabel === 'Part A').every((l) => l.attributes[r.columns[0].id] === 'D2'));
  assert.equal(r.lines.filter((l) => l.groupLabel === 'Part C').length, 2);
  assert.equal(r.lines.find((l) => l.description === 'C blanking die').rate, 33600); // 32000 × 1.05
  assert.ok(r.lines.filter((l) => l.groupLabel === 'Part D').every((l) => l.groupNote === 'Drawing D-2 rev C'));
  assert.equal(r.lines[r.lines.length - 1].description, 'Trial & proving');
  // parts stay contiguous and in order
  assert.deepEqual([...new Set(r.lines.map((l) => l.groupLabel ?? '—'))], ['Part A', 'Part B', 'Part C', 'Part D', '—']);
});

test('clearing a spec the document never had does not invent an empty field', () => {
  const { columns, lines } = complex();
  const before = columns.length;
  const r = applyDocEdits(lines, columns, [{ op: 'set_specs', lines: [1], specs: [{ name: 'Coating', value: '' }] }]);
  assert.equal(r.columns.length, before);
  assert.ok(!r.changes.some((c) => c.includes('Coating')));
  // …but clearing a field that DOES exist still works
  const cleared = applyDocEdits(lines, columns, [{ op: 'set_specs', lines: [1], specs: [{ name: 'Material', value: '' }] }]);
  assert.equal(cleared.lines[0].attributes.c1, undefined);
});

test('two blocks sharing a part name are joined, and the change list says so', () => {
  const lines = [
    L('die A1', 1000, { groupLabel: 'Die A', groupNote: 'Drawing A' }),
    L('die B1', 2000, { groupLabel: 'Die B' }),
    L('die A2', 3000, { groupLabel: 'Die A' }),
  ];
  const r = applyDocEdits(lines, [], [{ op: 'update', line: 2, rate: 2500 }]);
  assert.deepEqual(r.lines.map((l) => l.description), ['die A1', 'die A2', 'die B1']);
  assert.ok(r.lines.filter((l) => l.groupLabel === 'Die A').every((l) => l.groupNote === 'Drawing A'));
  assert.ok(r.changes.some((c) => c === 'The 2 blocks named “Die A” are now one part'), r.changes.join(' | '));
});

test('a document with each part in one place reports no merge', () => {
  const { columns, lines } = complex();
  const r = applyDocEdits(lines, columns, [{ op: 'update', line: 1, rate: 31000 }]);
  assert.ok(!r.changes.some((c) => c.includes('are now one part')));
});
