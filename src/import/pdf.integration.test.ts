/**
 * End-to-end check of the PDF path against a real PDF file (built by
 * scripts/make-sample-statement.mjs), using pdfjs the same way the browser does.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { itemsToLines, rowsFromLines, type TextItem } from './pdf';
import { prepareCandidates } from './csv';

async function textItems(path: string, password?: string): Promise<TextItem[]> {
  // The legacy build is the Node-compatible one; src/import/pdf.ts uses the browser build.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), password }).promise;
  const items: TextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    for (const item of (await page.getTextContent()).items) {
      if ('str' in item) items.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width, page: p });
    }
  }
  return items;
}

const FIXTURE = 'src/import/__fixtures__/sample-statement.pdf';
const LOCKED = 'src/import/__fixtures__/locked-statement.pdf';

describe('PDF statement import', () => {
  it('reads every transaction with the right amount and direction', async () => {
    const result = rowsFromLines(itemsToLines(await textItems(FIXTURE)));

    expect(result.columnCount).toBe(3); // withdrawal, deposit, balance
    expect(result.dateFormat).toBe('DMY');
    expect(result.directionAmbiguous).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(12);

    expect(result.rows.map((r) => [r.date, r.direction, r.amount])).toEqual([
      ['2026-09-01', 'debit', 9500],
      ['2026-09-02', 'debit', 345],
      ['2026-09-03', 'debit', 212.5],
      ['2026-09-05', 'debit', 349],
      ['2026-09-06', 'debit', 88],
      ['2026-09-08', 'debit', 35],
      ['2026-09-10', 'credit', 20_000],
      ['2026-09-11', 'debit', 410],
      ['2026-09-12', 'debit', 650],
      ['2026-09-14', 'credit', 499],
      ['2026-09-15', 'debit', 268],
      ['2026-09-18', 'debit', 1240],
    ]);
  });

  it('joins wrapped narration and leaves out page furniture', async () => {
    const { rows } = rowsFromLines(itemsToLines(await textItems(FIXTURE)));
    expect(rows[1].description).toBe('UPI-SWIGGY LIMITED-swiggy@ybl-YESB0000001- 424512345671-Payment');
    expect(rows.some((r) => /End of Statement|Closing Balance|Narration/i.test(r.description))).toBe(false);
  });

  it('reports a locked statement the way the password screen expects', async () => {
    // src/import/pdf.ts maps these onto PdfPasswordError; this pins pdfjs's contract.
    await expect(textItems(LOCKED)).rejects.toMatchObject({ name: 'PasswordException', code: 1 });
    await expect(textItems(LOCKED, 'wrong')).rejects.toMatchObject({ name: 'PasswordException', code: 2 });
  });

  it('reads a password-protected statement identically once unlocked', async () => {
    const locked = rowsFromLines(itemsToLines(await textItems(LOCKED, 'arna1234')));
    const plain = rowsFromLines(itemsToLines(await textItems(FIXTURE)));
    expect(locked.rows).toEqual(plain.rows);
  });

  it('feeds straight into categorisation and duplicate detection', async () => {
    const { rows } = rowsFromLines(itemsToLines(await textItems(FIXTURE)));
    const candidates = prepareCandidates(rows, new Set([rows[1].hash]), [], []);

    expect(candidates[1]).toMatchObject({ duplicate: true, include: false });
    const categoryOf = (merchantPart: string) =>
      candidates.find((c) => c.description.includes(merchantPart))?.categoryId;
    expect(categoryOf('SWIGGY')).toBe('delivery');
    expect(categoryOf('ZEPTO')).toBe('groceries');
    expect(categoryOf('RAPIDO')).toBe('cabs');
    expect(categoryOf('JIO')).toBe('recharge');
    expect(categoryOf('BOOKMYSHOW')).toBe('outings');
    expect(categoryOf('DMART')).toBe('groceries');
    expect(candidates.find((c) => c.description.includes('PAPA'))).toMatchObject({ direction: 'credit', source: 'allowance' });
    expect(candidates.find((c) => c.description.includes('AMAZON PAY'))).toMatchObject({ source: 'refund' });
  });
});
