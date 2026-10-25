/**
 * Bank / UPI statement PDF import.
 *
 * A PDF has no table structure, only text with coordinates. So we rebuild the table:
 * group text into lines by y, merge into cells by x, find the lines that start with a
 * date, then cluster the x positions of the money cells into columns. The column
 * layout plus the running-balance column tells us which figure is the amount and
 * whether it was money in or out.
 *
 * Only `extractText` touches pdfjs (loaded on demand); everything else is pure so it
 * can be unit-tested without a real PDF.
 */
import type { NormalisedRow, RowError } from './csv';
import { parseAmount, parseDate } from './csv';

export interface TextItem {
  str: string;
  /** Left edge, PDF points. */
  x: number;
  /** Baseline, PDF points (increases upward). */
  y: number;
  width: number;
  page: number;
}

export interface Cell {
  text: string;
  x: number;
  xEnd: number;
}

export interface Line {
  page: number;
  y: number;
  cells: Cell[];
  text: string;
}

/** Money as banks print it: 1,234.50 / 345.00 / ₹500 / 1,234.00 Dr. Never a reference number. */
const MONEY = /^(?:(?:inr|rs\.?|₹)\s*)?[+-]?(?:\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d{1,3}(?:\.\d{1,2})?|\d+\.\d{1,2})\s*(?:dr|cr)?\.?$/i;

const SKIP_LINE =
  /(opening|closing|brought forward|carried forward)\s+balance|^\s*(total|page \d|statement of|continued)|end of statement|\*\*\*/i;

export const isMoneyCell = (text: string) => MONEY.test(text.trim());

// ---------------------------------------------------------------------------
// 1. Text items → lines of cells

/** Group items into visual lines, then merge neighbouring items into table cells. */
export function itemsToLines(items: TextItem[], yTolerance = 3, cellGap = 6): Line[] {
  const buckets: TextItem[][] = [];
  for (const item of items) {
    if (!item.str.trim()) continue;
    const bucket = buckets.find(
      (b) => b[0].page === item.page && Math.abs(b[0].y - item.y) <= yTolerance,
    );
    if (bucket) bucket.push(item);
    else buckets.push([item]);
  }

  return buckets
    .map((bucket) => {
      const sorted = [...bucket].sort((a, b) => a.x - b.x);
      const cells: Cell[] = [];
      for (const item of sorted) {
        const last = cells[cells.length - 1];
        // A wide gap means a new column; a small one is just word spacing.
        if (last && item.x - last.xEnd < cellGap) {
          last.text = `${last.text} ${item.str.trim()}`.trim();
          last.xEnd = Math.max(last.xEnd, item.x + item.width);
        } else {
          cells.push({ text: item.str.trim(), x: item.x, xEnd: item.x + item.width });
        }
      }
      return { page: bucket[0].page, y: bucket[0].y, cells, text: cells.map((c) => c.text).join('  ') };
    })
    .sort((a, b) => a.page - b.page || b.y - a.y); // pdf y grows upward
}

// ---------------------------------------------------------------------------
// 2. Which lines are transactions

export function detectDateFormat(lines: Line[]): 'DMY' | 'MDY' {
  for (const line of lines) {
    for (const cell of line.cells) {
      const m = cell.text.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
      if (!m) continue;
      if (+m[1] > 12) return 'DMY';
      if (+m[2] > 12) return 'MDY';
    }
  }
  return 'DMY'; // Indian statements
}

interface RawRow {
  date: string;
  descriptionCells: Cell[];
  moneyCells: Array<Cell & { value: number }>;
  line: Line;
}

/** A transaction line starts with a date in one of its first cells. */
function leadingDate(line: Line, fmt: 'DMY' | 'MDY'): { date: string; index: number } | null {
  for (let i = 0; i < Math.min(2, line.cells.length); i++) {
    const date = parseDate(line.cells[i].text, fmt);
    if (date) return { date, index: i };
  }
  return null;
}

export interface CollectedRows {
  rows: RawRow[];
  /** The "opening balance" figure, when the statement prints one. */
  opening?: Cell & { value: number };
}

/** Wrapped narration sits on the very next baseline; anything further down is page furniture. */
const MAX_WRAP_GAP = 16;

export function collectRows(lines: Line[], fmt: 'DMY' | 'MDY'): CollectedRows {
  const rows: RawRow[] = [];
  let opening: CollectedRows['opening'];
  let last: Line | null = null;
  for (const line of lines) {
    if (SKIP_LINE.test(line.text)) {
      // Seed the running balance so the very first transaction's direction is known too.
      if (!opening && !rows.length && /opening balance|brought forward|b\/f/i.test(line.text)) {
        const money = line.cells.filter((c) => isMoneyCell(c.text));
        const cell = money[money.length - 1];
        const value = cell ? parseAmount(cell.text) : null;
        if (cell && value != null) opening = { ...cell, value };
      }
      continue;
    }
    const found = leadingDate(line, fmt);
    if (found) {
      const rest = line.cells.slice(found.index + 1);
      const moneyCells = rest
        .filter((c) => isMoneyCell(c.text))
        .map((c) => ({ ...c, value: parseAmount(c.text) ?? 0 }))
        .filter((c) => c.value !== 0);
      // A second date cell (e.g. "value date") is chrome, not description.
      const descriptionCells = rest.filter((c) => !isMoneyCell(c.text) && !parseDate(c.text, fmt));
      rows.push({ date: found.date, descriptionCells, moneyCells, line });
      last = line;
    } else if (
      last &&
      rows.length &&
      line.page === last.page &&
      last.y - line.y <= MAX_WRAP_GAP &&
      line.cells.every((c) => !isMoneyCell(c.text))
    ) {
      // Wrapped narration belongs to the transaction above it.
      rows[rows.length - 1].descriptionCells.push(...line.cells);
      last = line;
    }
  }
  return { rows, opening };
}

// ---------------------------------------------------------------------------
// 3. Money columns

/** Cluster money cells by their right edge: table numbers are right-aligned. */
export function clusterColumns(rows: RawRow[], tolerance = 14): number[] {
  const edges = rows.flatMap((r) => r.moneyCells.map((c) => c.xEnd)).sort((a, b) => a - b);
  const centres: number[] = [];
  let group: number[] = [];
  for (const edge of edges) {
    if (group.length && edge - group[group.length - 1] > tolerance) {
      centres.push(group.reduce((s, v) => s + v, 0) / group.length);
      group = [];
    }
    group.push(edge);
  }
  if (group.length) centres.push(group.reduce((s, v) => s + v, 0) / group.length);
  return centres;
}

const columnOf = (xEnd: number, columns: number[]) =>
  columns.reduce((best, c, i) => (Math.abs(c - xEnd) < Math.abs(columns[best] - xEnd) ? i : best), 0);

/** A balance column is the one whose change between rows equals the other figure on the row. */
function findBalanceColumn(grid: Array<Array<number | undefined>>, columns: number[]): number {
  let best = -1;
  let bestScore = 0;
  for (let c = columns.length - 1; c >= 0; c--) {
    let hits = 0;
    let tests = 0;
    let prev: number | undefined;
    for (const row of grid) {
      const value = row[c];
      if (value == null) continue;
      const others = row.filter((v, i) => i !== c && v != null) as number[];
      if (prev != null && others.length) {
        tests++;
        if (others.some((o) => Math.abs(Math.abs(value - prev!) - Math.abs(o)) < 0.02)) hits++;
      }
      prev = value;
    }
    // One confirming pair is enough: the test (a balance step equal to the row's own
    // figure) is specific enough that a coincidence is unlikely, and short statements
    // only ever offer one pair.
    const score = tests >= 1 ? hits / tests : 0;
    if (score > 0.7 && score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

export interface PdfParseResult {
  rows: NormalisedRow[];
  errors: RowError[];
  dateFormat: 'DMY' | 'MDY';
  /** True when nothing in the layout said which way the money went. */
  directionAmbiguous: boolean;
  columnCount: number;
}

/**
 * Turn statement lines into transactions.
 * `positiveIsDebit` only matters when the layout is ambiguous (a single amount column
 * with no Dr/Cr marker and no running balance to compare against).
 */
export function rowsFromLines(lines: Line[], opts: { dateFormat?: 'DMY' | 'MDY'; positiveIsDebit?: boolean } = {}): PdfParseResult {
  const dateFormat = opts.dateFormat ?? detectDateFormat(lines);
  const { rows: raw, opening } = collectRows(lines, dateFormat);
  const withMoney = raw.filter((r) => r.moneyCells.length > 0);
  const errors: RowError[] = raw
    .filter((r) => r.moneyCells.length === 0)
    .map((r, i) => ({ line: i + 1, reason: `No amount found on "${r.line.text.slice(0, 40)}"` }));

  const columns = clusterColumns(withMoney);
  const grid = withMoney.map((row) => {
    const cells: Array<number | undefined> = Array(columns.length).fill(undefined);
    for (const cell of row.moneyCells) cells[columnOf(cell.xEnd, columns)] = cell.value;
    return cells;
  });

  const balanceCol = findBalanceColumn(grid, columns);
  const amountCols = columns.map((_, i) => i).filter((i) => i !== balanceCol);
  // Two amount columns are debit then credit, left to right.
  const debitCol = amountCols.length >= 2 ? amountCols[0] : -1;
  const creditCol = amountCols.length >= 2 ? amountCols[amountCols.length - 1] : -1;

  let ambiguous = false;
  const rows: NormalisedRow[] = [];
  const seen = new Map<string, number>();
  // Only trust the opening figure if it sits in the balance column.
  let prevBalance =
    opening && balanceCol >= 0 && columnOf(opening.xEnd, columns) === balanceCol ? opening.value : undefined;

  withMoney.forEach((row, i) => {
    const cells = grid[i];
    const balance = balanceCol >= 0 ? cells[balanceCol] : undefined;
    const amount = Math.abs(amountCols.map((c) => cells[c]).find((v) => v != null) ?? row.moneyCells[0].value);
    const description = row.descriptionCells
      .map((c) => c.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    let direction: 'debit' | 'credit' | null = null;
    // Most reliable: which way the running balance moved.
    if (balance != null && prevBalance != null) {
      const delta = balance - prevBalance;
      if (Math.abs(Math.abs(delta) - amount) < 0.02) direction = delta < 0 ? 'debit' : 'credit';
    }
    // Next: a separate debit / credit column.
    if (!direction && debitCol >= 0) {
      if (cells[debitCol] != null) direction = 'debit';
      else if (cells[creditCol] != null) direction = 'credit';
    }
    // Then an explicit marker or wording.
    if (!direction) {
      const marker = `${row.moneyCells.map((c) => c.text).join(' ')} ${description}`.toUpperCase();
      if (/\b(DR|DEBIT|DEBITED|WITHDRAWAL|PAID TO|SENT)\b/.test(marker)) direction = 'debit';
      else if (/\b(CR|CREDIT|CREDITED|DEPOSIT|RECEIVED|REFUND|CASHBACK)\b/.test(marker)) direction = 'credit';
    }
    if (!direction) {
      ambiguous = true;
      direction = row.moneyCells[0].value < 0 ? 'debit' : opts.positiveIsDebit === false ? 'credit' : 'debit';
    }
    if (balance != null) prevBalance = balance;

    const base = `${row.date}|${amount.toFixed(2)}|${direction}|${description.toUpperCase()}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    rows.push({ date: row.date, description, amount, direction, hash: `${base}#${n}` });
  });

  return { rows, errors, dateFormat, directionAmbiguous: ambiguous, columnCount: columns.length };
}

// ---------------------------------------------------------------------------
// 4. pdfjs glue (browser only)

export class PdfPasswordError extends Error {
  constructor(public wrongPassword: boolean) {
    super(wrongPassword ? 'Wrong password' : 'Password needed');
  }
}

/** Read every page of a PDF into positioned text items. Throws PdfPasswordError if locked. */
export async function extractText(data: ArrayBuffer, password?: string): Promise<TextItem[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;

  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), password });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy().catch(() => {});
    const name = (e as { name?: string }).name;
    const code = (e as { code?: number }).code;
    if (name === 'PasswordException') throw new PdfPasswordError(code === 2);
    throw e;
  }

  const items: TextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!('str' in item)) continue;
      items.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width, page: p });
    }
    page.cleanup();
  }
  await task.destroy();
  return items;
}

export async function parsePdfStatement(
  data: ArrayBuffer,
  opts: { password?: string; dateFormat?: 'DMY' | 'MDY'; positiveIsDebit?: boolean } = {},
): Promise<PdfParseResult> {
  const lines = itemsToLines(await extractText(data, opts.password));
  return rowsFromLines(lines, opts);
}
