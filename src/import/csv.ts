/**
 * Bank / UPI statement CSV import: parse → map columns → normalise rows → categorise → dedupe.
 */
import Papa from 'papaparse';
import { categorise, extractMerchant } from '../domain/merchantRules';
import type { ColumnMapping, FixedCost, IncomeSource, MerchantRule, Transaction } from '../domain/types';
import { daysBetween } from '../lib/dates';
import { coveredDueFor } from '../engine/planner';

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

const HEADER_HINT = /date|narration|description|particulars|amount|debit|credit|withdrawal|deposit|remarks/i;

/** Parse CSV text, skipping any bank preamble lines above the real header row. */
export function parseCsv(text: string): ParsedCsv {
  const { data } = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
  const headerIndex = data.findIndex(
    (r) => r.filter((c) => c.trim()).length >= 3 && r.filter((c) => HEADER_HINT.test(c)).length >= 2,
  );
  if (headerIndex < 0) return { headers: [], rows: [] };
  const rawHeaders = data[headerIndex].map((h) => h.trim());
  // Make duplicate / blank header names unique so no column is lost.
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h, i) => {
    const base = h || `Column ${i + 1}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base} (${n + 1})` : base;
  });
  const rows = data
    .slice(headerIndex + 1)
    .filter((r) => r.length >= Math.min(3, headers.length))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { headers, rows };
}

export function headerSignature(headers: string[]): string {
  return headers.map((h) => h.toLowerCase()).join('|');
}

export function guessMapping(headers: string[]): ColumnMapping {
  const combinedType = /dr ?\/ ?cr|cr ?\/ ?dr/i;
  const find = (...patterns: RegExp[]) => {
    for (const p of patterns) {
      const h = headers.find((x) => p.test(x));
      if (h) return h;
    }
    return undefined;
  };
  const findSided = (...patterns: RegExp[]) =>
    patterns.map((p) => headers.find((x) => p.test(x) && !combinedType.test(x))).find(Boolean);
  const debit = findSided(/withdrawal/i, /^debit/i, /debit amount/i, /\bdr\b/i, /paid out/i);
  const credit = findSided(/deposit/i, /^credit/i, /credit amount/i, /\bcr\b/i, /paid in/i);
  const amount = debit && credit ? undefined : find(/^amount/i, /amount/i, /value/i);
  return {
    date: find(/^(txn|transaction|tran) ?date/i, /^date/i, /value date/i, /date/i) ?? headers[0],
    description: find(/narration/i, /description/i, /particulars/i, /remarks/i, /details/i, /merchant|payee|name/i) ?? headers[1],
    debit: amount ? undefined : debit,
    credit: amount ? undefined : credit,
    amount,
    type: amount ? find(/dr ?\/ ?cr|cr ?\/ ?dr/i, /^type$/i, /transaction type/i) : undefined,
    positiveIsDebit: true,
    dateFormat: 'DMY',
  };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Returns 'YYYY-MM-DD' or null. Handles 14/09/2026, 14-09-26, 14 Sep 2026, 14-Sep-26, 2026-09-14 (+ time). */
export function parseDate(raw: string, fmt: ColumnMapping['dateFormat']): string | null {
  const s = raw.trim().split(/[ T](?=\d{1,2}:\d{2})/)[0].trim();
  let y: number, m: number, d: number;

  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const named = s.match(/^(\d{1,2})[-/ .]([A-Za-z]{3,4})[a-z]*[-/ .,]+(\d{2,4})$/);
  const numeric = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (iso) {
    [y, m, d] = [+iso[1], +iso[2], +iso[3]];
  } else if (named && MONTHS[named[2].toLowerCase()]) {
    [d, m, y] = [+named[1], MONTHS[named[2].toLowerCase()], +named[3]];
  } else if (numeric) {
    const [a, b] = [+numeric[1], +numeric[2]];
    y = +numeric[3];
    [d, m] = fmt === 'MDY' ? [b, a] : [a, b];
  } else {
    return null;
  }
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  if (date.getMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** '₹1,234.50', '(500)', '-500', '1,234.00 Dr' → signed number (negative = debit when marked). */
export function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s || s === '-') return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (/\bdr\.?$/i.test(s)) sign = -1;
  s = s.replace(/(inr|rs\.?|₹|cr\.?|dr\.?|,|\s)/gi, '');
  if (s.startsWith('-')) {
    sign *= -1;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  const n = Number(s);
  return Number.isFinite(n) ? sign * n : null;
}

export interface NormalisedRow {
  date: string;
  description: string;
  amount: number;
  direction: 'debit' | 'credit';
  hash: string;
}

export interface RowError {
  line: number;
  reason: string;
}

export function normaliseRows(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
): { rows: NormalisedRow[]; errors: RowError[] } {
  const out: NormalisedRow[] = [];
  const errors: RowError[] = [];
  const occurrences = new Map<string, number>();

  rows.forEach((row, i) => {
    const date = parseDate(row[mapping.date] ?? '', mapping.dateFormat);
    const description = (row[mapping.description] ?? '').trim();
    if (!date) {
      // Footer lines ("Total", "Closing balance") are common. Only report rows that look like data.
      if (Object.values(row).some((v) => /\d/.test(v)) && (row[mapping.date] ?? '').trim()) {
        errors.push({ line: i + 1, reason: `Couldn't read date "${row[mapping.date]}"` });
      }
      return;
    }

    let amount: number | null = null;
    let direction: 'debit' | 'credit' = 'debit';
    if (mapping.debit || mapping.credit) {
      const dr = parseAmount(mapping.debit ? row[mapping.debit] : undefined);
      const cr = parseAmount(mapping.credit ? row[mapping.credit] : undefined);
      if (dr && Math.abs(dr) > 0) {
        amount = Math.abs(dr);
        direction = 'debit';
      } else if (cr && Math.abs(cr) > 0) {
        amount = Math.abs(cr);
        direction = 'credit';
      }
    } else if (mapping.amount) {
      const raw = row[mapping.amount] ?? '';
      const val = parseAmount(raw);
      if (val != null && val !== 0) {
        amount = Math.abs(val);
        const typeText = `${mapping.type ? row[mapping.type] ?? '' : ''} ${raw}`.toUpperCase();
        if (/\b(DR|DEBIT|DEBITED|PAID|SENT|WITHDRAWAL)\b/.test(typeText)) direction = 'debit';
        else if (/\b(CR|CREDIT|CREDITED|RECEIVED|DEPOSIT|REFUND)\b/.test(typeText)) direction = 'credit';
        else if (val < 0) direction = 'debit';
        else direction = mapping.positiveIsDebit === false ? 'credit' : 'debit';
      }
    }
    if (amount == null) return; // balance-only / blank rows

    const base = `${date}|${amount.toFixed(2)}|${direction}|${description.toUpperCase().replace(/\s+/g, ' ')}`;
    const n = occurrences.get(base) ?? 0;
    occurrences.set(base, n + 1);
    out.push({ date, description, amount, direction, hash: `${base}#${n}` });
  });

  return { rows: out, errors };
}

export interface ImportCandidate extends NormalisedRow {
  include: boolean;
  duplicate: boolean;
  categoryId: string;
  source: IncomeSource;
  merchant: string;
  fixedCostId?: number;
  autoCategorised: boolean;
}

export function prepareCandidates(
  rows: NormalisedRow[],
  existingHashes: Set<string>,
  userRules: MerchantRule[],
  fixedCosts: FixedCost[],
): ImportCandidate[] {
  return rows.map((r) => {
    const duplicate = existingHashes.has(r.hash);
    const matched = categorise(r.description, userRules);
    const fc =
      r.direction === 'debit'
        ? fixedCosts.find(
            (f) => f.active && Math.abs(f.amount - r.amount) < 1 && Math.abs(daysBetween(r.date, coveredDueFor(r.date, f.dueDay))) <= 10,
          )
        : undefined;
    return {
      ...r,
      include: !duplicate,
      duplicate,
      categoryId: fc?.categoryId ?? matched ?? 'other',
      source: /REFUND|REVERSAL|CASHBACK|RETURN/i.test(r.description) ? 'refund' : 'allowance',
      merchant: extractMerchant(r.description),
      fixedCostId: fc?.id,
      autoCategorised: Boolean(fc || matched),
    };
  });
}

export function candidateToTransaction(c: ImportCandidate, now = Date.now()): Transaction {
  const base = {
    amount: c.amount,
    date: `${c.date}T12:00`,
    timeKnown: false,
    note: c.description.slice(0, 80),
    merchant: c.merchant,
    importHash: c.hash,
    createdAt: now,
  };
  return c.direction === 'debit'
    ? { ...base, type: 'expense', categoryId: c.categoryId, fixedCostId: c.fixedCostId }
    : { ...base, type: 'income', source: c.source };
}
