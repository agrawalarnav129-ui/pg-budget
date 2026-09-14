import { describe, expect, it } from 'vitest';
import { categorise, extractMerchant } from '../domain/merchantRules';
import { rent } from '../engine/fixtures';
import { guessMapping, normaliseRows, parseAmount, parseCsv, parseDate, prepareCandidates } from './csv';

const HDFC_STYLE = `HDFC BANK Ltd.
Statement of account
,,,,,,
Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
01/09/26,UPI-SWIGGY LIMITED-swiggy@ybl-YESB0000001-424512345678-Payment,0000424512345678,01/09/26,345.00,,19655.00
01/09/26,UPI-PG OWNER RAMESH-ramesh@okicici-ICIC0000001-424512345679-Rent Sept,0000424512345679,01/09/26,"12,000.00",,7655.00
03/09/26,NEFT CR-PAPA-SBIN0001234-Allowance,N12345,03/09/26,,"15,000.00",22655.00
03/09/26,UPI-ZEPTO MARKETPLACE-zepto@axl-UTIB0000001-424512345680-Order,0000424512345680,03/09/26,212.50,,22442.50
03/09/26,UPI-ZEPTO MARKETPLACE-zepto@axl-UTIB0000001-424512345680-Order,0000424512345680,03/09/26,212.50,,22230.00
,,,,,,
Opening Balance,Dr Count,Cr Count,Debits,Credits,Closing Bal,
`;

describe('parseCsv + guessMapping', () => {
  it('skips bank preamble and maps withdrawal/deposit columns', () => {
    const { headers, rows } = parseCsv(HDFC_STYLE);
    expect(headers[0]).toBe('Date');
    const m = guessMapping(headers);
    expect(m).toMatchObject({ date: 'Date', description: 'Narration', debit: 'Withdrawal Amt.', credit: 'Deposit Amt.' });
    const { rows: norm } = normaliseRows(rows, m);
    expect(norm).toHaveLength(5);
    expect(norm[1]).toMatchObject({ date: '2026-09-01', amount: 12_000, direction: 'debit' });
    expect(norm[2]).toMatchObject({ amount: 15_000, direction: 'credit' });
    // identical rows get distinct hashes
    expect(norm[3].hash).not.toBe(norm[4].hash);
  });

  it('handles a single amount column with Dr/Cr', () => {
    const csv = `Transaction Date,Description,Amount,Dr/Cr\n14-Sep-2026,UBER INDIA,189.00,DR\n14-Sep-2026,Refund AMAZON,499,CR\n`;
    const { headers, rows } = parseCsv(csv);
    const m = guessMapping(headers);
    expect(m.amount).toBe('Amount');
    expect(m.type).toBe('Dr/Cr');
    const { rows: norm } = normaliseRows(rows, m);
    expect(norm.map((r) => r.direction)).toEqual(['debit', 'credit']);
  });
});

describe('prepareCandidates', () => {
  it('categorises, links rent, detects refunds and duplicates', () => {
    const { headers, rows } = parseCsv(HDFC_STYLE);
    const { rows: norm } = normaliseRows(rows, guessMapping(headers));
    const existing = new Set([norm[0].hash]);
    const c = prepareCandidates(norm, existing, [], [rent()]);
    expect(c[0]).toMatchObject({ duplicate: true, include: false, categoryId: 'delivery' });
    expect(c[1]).toMatchObject({ categoryId: 'rent', fixedCostId: 1 });
    expect(c[2]).toMatchObject({ direction: 'credit', source: 'allowance' });
    expect(c[3].categoryId).toBe('groceries');
  });
});

describe('parsers', () => {
  it('parses Indian date formats', () => {
    expect(parseDate('14/09/2026', 'DMY')).toBe('2026-09-14');
    expect(parseDate('14-09-26', 'DMY')).toBe('2026-09-14');
    expect(parseDate('14 Sep 2026', 'DMY')).toBe('2026-09-14');
    expect(parseDate('2026-09-14 10:22:01', 'DMY')).toBe('2026-09-14');
    expect(parseDate('09/14/2026', 'MDY')).toBe('2026-09-14');
    expect(parseDate('31/02/2026', 'DMY')).toBeNull();
    expect(parseDate('Opening Balance', 'DMY')).toBeNull();
  });

  it('parses amounts', () => {
    expect(parseAmount('₹1,23,456.50')).toBe(123456.5);
    expect(parseAmount('(500)')).toBe(-500);
    expect(parseAmount('1,234.00 Dr')).toBe(-1234);
    expect(parseAmount('-')).toBeNull();
  });
});

describe('merchant rules', () => {
  it('prefers user rules and longer keywords, respecting word boundaries', () => {
    expect(categorise('UPI/SWIGGY INSTAMART/xyz')).toBe('groceries');
    expect(categorise('UPI/SWIGGY/xyz')).toBe('delivery');
    expect(categorise('BESTSELLER BOOKS')).toBeUndefined();
    expect(categorise('UPI-RAJU CHAI', [{ keyword: 'RAJU', categoryId: 'food_out' }])).toBe('food_out');
  });

  it('extracts readable merchant names', () => {
    expect(extractMerchant('UPI/DR/412345678901/SWIGGY LIMITED/YESB/swiggy@ybl/Payment')).toBe('Swiggy Limited');
    expect(extractMerchant('UPI-RAJU TEA STALL-raju@okaxis-UTIB0000001-424512345681-Chai')).toBe('Raju Tea Stall');
    expect(extractMerchant('NEFT CR-PAPA-SBIN0001234-Pocket money')).toBe('Papa');
  });
});
