import { describe, expect, it } from 'vitest';
import { clusterColumns, collectRows, detectDateFormat, isMoneyCell, itemsToLines, rowsFromLines, type TextItem } from './pdf';

/** Build text items for one statement line. Numbers are right-aligned on their column. */
type Spec = Array<{ at: number; text: string; right?: boolean }>;
const CHAR = 5;

function line(y: number, spec: Spec, page = 1): TextItem[] {
  return spec.map(({ at, text, right }) => {
    const width = text.length * CHAR;
    return { str: text, x: right ? at - width : at, y, width, page };
  });
}

const money = (at: number, text: string) => ({ at, text, right: true });

/** HDFC-style: Date | Narration | Ref | Withdrawal | Deposit | Balance */
const HDFC: TextItem[] = [
  ...line(700, [{ at: 40, text: 'Date' }, { at: 100, text: 'Narration' }, { at: 360, text: 'Withdrawal' }, { at: 420, text: 'Deposit' }, { at: 500, text: 'Balance' }]),
  ...line(680, [{ at: 40, text: 'Opening Balance' }, money(530, '20,000.00')]),
  ...line(660, [{ at: 40, text: '01/09/26' }, { at: 100, text: 'UPI-SWIGGY LIMITED-swiggy@ybl' }, money(400, '345.00'), money(530, '19,655.00')]),
  ...line(640, [{ at: 40, text: '03/09/26' }, { at: 100, text: 'NEFT CR-PAPA-SBIN0001234' }, money(460, '15,000.00'), money(530, '34,655.00')]),
  ...line(620, [{ at: 40, text: '04/09/26' }, { at: 100, text: 'UPI-ZEPTO MARKETPLACE' }, money(400, '212.50'), money(530, '34,442.50')]),
  ...line(600, [{ at: 40, text: 'Total' }, money(400, '557.50'), money(460, '15,000.00')]),
];

describe('line assembly', () => {
  it('groups items into lines and splits columns on wide gaps', () => {
    const lines = itemsToLines(HDFC);
    expect(lines).toHaveLength(6);
    expect(lines[0].cells.map((c) => c.text)).toEqual(['Date', 'Narration', 'Withdrawal', 'Deposit', 'Balance']);
    // Words inside one cell stay together.
    expect(lines[2].cells[1].text).toBe('UPI-SWIGGY LIMITED-swiggy@ybl');
  });

  it('orders pages top to bottom', () => {
    const items = [...line(100, [{ at: 40, text: 'second' }]), ...line(700, [{ at: 40, text: 'first' }])];
    expect(itemsToLines(items).map((l) => l.text)).toEqual(['first', 'second']);
  });
});

describe('money detection', () => {
  it('accepts printed amounts and rejects reference numbers', () => {
    for (const ok of ['345.00', '1,234.50', '19,655.00', '₹500', '500', '1,234.00 Dr']) {
      expect(isMoneyCell(ok), ok).toBe(true);
    }
    for (const no of ['0000424512345678', '01/09/26', 'SBIN0001234', '424512345678', 'UPI']) {
      expect(isMoneyCell(no), no).toBe(false);
    }
  });
});

describe('row collection', () => {
  const lines = itemsToLines(HDFC);

  it('keeps only dated lines and reads the opening balance', () => {
    const { rows, opening } = collectRows(lines, 'DMY');
    expect(rows).toHaveLength(3);
    expect(opening?.value).toBe(20_000);
    expect(rows[0].descriptionCells.map((c) => c.text)).toEqual(['UPI-SWIGGY LIMITED-swiggy@ybl']);
  });

  it('skips header, opening-balance and total lines', () => {
    const { rows } = collectRows(lines, 'DMY');
    expect(rows.some((r) => /Total|Opening|Narration/.test(r.line.text))).toBe(false);
  });

  it('clusters right-aligned amounts into three columns', () => {
    const { rows } = collectRows(lines, 'DMY');
    expect(clusterColumns(rows)).toHaveLength(3);
  });
});

describe('direction', () => {
  it('reads debit/credit from a withdrawal + deposit + balance layout', () => {
    const r = rowsFromLines(itemsToLines(HDFC));
    expect(r.columnCount).toBe(3);
    expect(r.directionAmbiguous).toBe(false);
    expect(r.rows.map((x) => [x.date, x.amount, x.direction])).toEqual([
      ['2026-09-01', 345, 'debit'],
      ['2026-09-03', 15_000, 'credit'],
      ['2026-09-04', 212.5, 'debit'],
    ]);
  });

  it('derives direction from the running balance when there is one amount column', () => {
    const items = [
      ...line(700, [{ at: 40, text: '10/09/26' }, { at: 100, text: 'SWIGGY' }, money(420, '345.00'), money(520, '19,655.00')]),
      ...line(680, [{ at: 40, text: '11/09/26' }, { at: 100, text: 'STIPEND' }, money(420, '5,000.00'), money(520, '24,655.00')]),
      ...line(660, [{ at: 40, text: '12/09/26' }, { at: 100, text: 'RAPIDO' }, money(420, '88.00'), money(520, '24,567.00')]),
    ];
    const r = rowsFromLines(itemsToLines(items));
    expect(r.rows.map((x) => x.direction)).toEqual(['debit', 'credit', 'debit']);
  });

  it('uses the opening balance to settle the very first row', () => {
    const items = [
      ...line(700, [{ at: 40, text: 'Opening Balance' }, money(520, '20,000.00')]),
      ...line(680, [{ at: 40, text: '10/09/26' }, { at: 100, text: 'REFUND' }, money(420, '499.00'), money(520, '20,499.00')]),
      ...line(660, [{ at: 40, text: '11/09/26' }, { at: 100, text: 'SWIGGY' }, money(420, '345.00'), money(520, '20,154.00')]),
    ];
    expect(rowsFromLines(itemsToLines(items)).rows.map((x) => x.direction)).toEqual(['credit', 'debit']);
  });

  it('handles a balance that goes negative', () => {
    const items = [
      ...line(700, [{ at: 40, text: 'Opening Balance' }, money(520, '500.00')]),
      ...line(680, [{ at: 40, text: '10/09/26' }, { at: 100, text: 'RENT' }, money(420, '9,500.00'), money(520, '-9,000.00')]),
      ...line(660, [{ at: 40, text: '11/09/26' }, { at: 100, text: 'FROM HOME' }, money(420, '12,000.00'), money(520, '3,000.00')]),
      ...line(640, [{ at: 40, text: '12/09/26' }, { at: 100, text: 'SWIGGY' }, money(420, '345.00'), money(520, '2,655.00')]),
    ];
    const r = rowsFromLines(itemsToLines(items));
    expect(r.rows.map((x) => x.direction)).toEqual(['debit', 'credit', 'debit']);
    expect(r.rows.map((x) => x.amount)).toEqual([9500, 12_000, 345]);
  });

  it('falls back to Dr/Cr wording when there is no balance column', () => {
    const items = [
      ...line(700, [{ at: 40, text: '10/09/26' }, { at: 100, text: 'Paid to Swiggy' }, money(420, '345.00'), { at: 440, text: 'DEBIT' }]),
      ...line(680, [{ at: 40, text: '11/09/26' }, { at: 100, text: 'Received from Papa' }, money(420, '5,000.00'), { at: 440, text: 'CREDIT' }]),
    ];
    const r = rowsFromLines(itemsToLines(items));
    expect(r.rows.map((x) => x.direction)).toEqual(['debit', 'credit']);
    expect(r.directionAmbiguous).toBe(false);
  });

  it('flags ambiguity and honours positiveIsDebit when nothing else is available', () => {
    const items = [
      ...line(700, [{ at: 40, text: '10/09/26' }, { at: 100, text: 'Some shop' }, money(420, '345.00')]),
      ...line(680, [{ at: 40, text: '11/09/26' }, { at: 100, text: 'Another shop' }, money(420, '120.00')]),
    ];
    expect(rowsFromLines(itemsToLines(items)).directionAmbiguous).toBe(true);
    expect(rowsFromLines(itemsToLines(items), { positiveIsDebit: false }).rows[0].direction).toBe('credit');
  });
});

describe('narration and dates', () => {
  it('joins wrapped narration onto the transaction above', () => {
    const items = [
      ...line(700, [{ at: 40, text: '10/09/26' }, { at: 100, text: 'UPI-SWIGGY LIMITED' }, money(420, '345.00'), money(520, '19,655.00')]),
      ...line(690, [{ at: 100, text: 'swiggy@ybl-YESB0000001' }]),
      ...line(670, [{ at: 40, text: '11/09/26' }, { at: 100, text: 'UPI-RAPIDO' }, money(420, '88.00'), money(520, '19,567.00')]),
    ];
    const r = rowsFromLines(itemsToLines(items));
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].description).toBe('UPI-SWIGGY LIMITED swiggy@ybl-YESB0000001');
  });

  it('detects the date format from an unambiguous day', () => {
    expect(detectDateFormat(itemsToLines(line(700, [{ at: 40, text: '14/09/2026' }])))).toBe('DMY');
    expect(detectDateFormat(itemsToLines(line(700, [{ at: 40, text: '09/14/2026' }])))).toBe('MDY');
    expect(detectDateFormat(itemsToLines(line(700, [{ at: 40, text: '05/06/2026' }])))).toBe('DMY');
  });

  it('gives identical rows distinct hashes', () => {
    const items = [
      ...line(700, [{ at: 40, text: '10/09/26' }, { at: 100, text: 'ZEPTO' }, money(420, '212.50'), money(520, '19,787.50')]),
      ...line(680, [{ at: 40, text: '10/09/26' }, { at: 100, text: 'ZEPTO' }, money(420, '212.50'), money(520, '19,575.00')]),
    ];
    const r = rowsFromLines(itemsToLines(items));
    expect(r.rows[0].hash).not.toBe(r.rows[1].hash);
  });
});
