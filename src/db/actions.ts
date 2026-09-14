/** All writes go through here so invariants (fixed-cost cycles, backups) live in one place. */
import type { FixedCost, Goal, IncomeSource, MerchantRule, Settings, Transaction } from '../domain/types';
import { dateKeyOf, toLocalDateTime } from '../lib/dates';
import { coveredDueFor, nextDue } from '../engine/planner';
import { candidateToTransaction, type ImportCandidate } from '../import/csv';
import { db, defaultSettings } from './schema';

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get('main')) ?? defaultSettings();
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await db.settings.put({ ...current, ...patch, id: 'main' });
}

const now = () => toLocalDateTime(new Date());

export async function addExpense(input: {
  amount: number;
  categoryId: string;
  note: string;
  date?: string;
  fixedCostId?: number;
}): Promise<number> {
  return db.transaction('rw', db.transactions, db.fixedCosts, async () => {
    const id = await db.transactions.add({
      type: 'expense',
      amount: input.amount,
      categoryId: input.categoryId,
      note: input.note.trim(),
      merchant: input.note.trim() || undefined,
      date: input.date ?? now(),
      timeKnown: true,
      fixedCostId: input.fixedCostId,
      createdAt: Date.now(),
    });
    if (input.fixedCostId != null) await advanceFixedCost(input.fixedCostId, dateKeyOf(input.date ?? now()));
    return id as number;
  });
}

export async function addIncome(input: { amount: number; source: IncomeSource; note: string; date?: string }) {
  return db.transactions.add({
    type: 'income',
    amount: input.amount,
    source: input.source,
    note: input.note.trim(),
    date: input.date ?? now(),
    timeKnown: true,
    createdAt: Date.now(),
  });
}

export async function moveToSavings(amount: number, note = 'Moved to savings') {
  if (amount <= 0) return;
  return db.transactions.add({ type: 'save', amount, note, date: now(), timeKnown: true, createdAt: Date.now() });
}

export async function withdrawFromSavings(amount: number, note = 'Taken from savings') {
  if (amount <= 0) return;
  return db.transactions.add({ type: 'withdraw', amount, note, date: now(), timeKnown: true, createdAt: Date.now() });
}

export async function updateTransaction(id: number, patch: Partial<Transaction>) {
  await db.transactions.update(id, patch);
}

export async function deleteTransaction(id: number) {
  await db.transactions.delete(id);
}

/** Mark the next due occurrence of a fixed cost as paid (creates the expense). */
export async function payFixedCost(fc: FixedCost) {
  const due = nextDue(fc);
  await db.transaction('rw', db.transactions, db.fixedCosts, async () => {
    await db.transactions.add({
      type: 'expense',
      amount: fc.amount,
      categoryId: fc.categoryId,
      note: fc.name,
      merchant: fc.name,
      date: now(),
      timeKnown: true,
      fixedCostId: fc.id,
      createdAt: Date.now(),
    });
    await db.fixedCosts.update(fc.id!, { lastCoveredDue: due });
  });
}

async function advanceFixedCost(id: number, paidOn: string) {
  const fc = await db.fixedCosts.get(id);
  if (!fc) return;
  const covered = coveredDueFor(paidOn, fc.dueDay);
  if (covered > fc.lastCoveredDue) await db.fixedCosts.update(id, { lastCoveredDue: covered });
}

export async function importCandidates(candidates: ImportCandidate[]): Promise<number> {
  const chosen = candidates.filter((c) => c.include && !c.duplicate);
  await db.transaction('rw', db.transactions, db.fixedCosts, async () => {
    await db.transactions.bulkAdd(chosen.map((c) => candidateToTransaction(c)));
    for (const c of chosen) if (c.fixedCostId != null) await advanceFixedCost(c.fixedCostId, c.date);
  });
  return chosen.length;
}

export async function rememberRule(keyword: string, categoryId: string) {
  const k = keyword.trim().toUpperCase();
  if (k.length < 3) return;
  const existing = await db.merchantRules.where('keyword').equals(k).first();
  if (existing) await db.merchantRules.update(existing.id!, { categoryId });
  else await db.merchantRules.add({ keyword: k, categoryId });
}

/** Set the wallet balance to what the bank app actually shows right now. */
export async function reconcileBalance(actual: number) {
  await updateSettings({ openingBalance: actual, openingDate: now() });
}

// ---------------------------------------------------------------------------
// Backup

export interface Backup {
  app: 'pg-budget';
  version: 1;
  exportedAt: string;
  settings: Settings;
  transactions: Transaction[];
  fixedCosts: FixedCost[];
  goals: Goal[];
  merchantRules: MerchantRule[];
}

export async function exportBackup(): Promise<Backup> {
  const backup: Backup = {
    app: 'pg-budget',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: await getSettings(),
    transactions: await db.transactions.toArray(),
    fixedCosts: await db.fixedCosts.toArray(),
    goals: await db.goals.toArray(),
    merchantRules: await db.merchantRules.toArray(),
  };
  await updateSettings({ lastBackupAt: Date.now() });
  return backup;
}

export async function restoreBackup(data: unknown) {
  const b = data as Backup;
  if (!b || b.app !== 'pg-budget' || !Array.isArray(b.transactions) || !b.settings) {
    throw new Error("This file isn't a PG Budget backup.");
  }
  await db.transaction('rw', [db.transactions, db.fixedCosts, db.goals, db.merchantRules, db.settings], async () => {
    await Promise.all([db.transactions.clear(), db.fixedCosts.clear(), db.goals.clear(), db.merchantRules.clear()]);
    await db.transactions.bulkAdd(b.transactions);
    await db.fixedCosts.bulkAdd(b.fixedCosts ?? []);
    await db.goals.bulkAdd(b.goals ?? []);
    await db.merchantRules.bulkAdd(b.merchantRules ?? []);
    await db.settings.put({ ...defaultSettings(), ...b.settings, id: 'main' });
  });
}

export async function eraseEverything() {
  await db.transaction('rw', [db.transactions, db.fixedCosts, db.goals, db.merchantRules, db.settings], async () => {
    await Promise.all([
      db.transactions.clear(),
      db.fixedCosts.clear(),
      db.goals.clear(),
      db.merchantRules.clear(),
      db.settings.clear(),
    ]);
  });
}

export function transactionsToCsv(txns: Transaction[]): string {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [['date', 'type', 'amount', 'category', 'source', 'note', 'merchant']];
  for (const t of [...txns].sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push([t.date, t.type, String(t.amount), t.categoryId ?? '', t.source ?? '', t.note, t.merchant ?? '']);
  }
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}
