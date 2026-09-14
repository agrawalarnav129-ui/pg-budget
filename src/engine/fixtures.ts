import type { FixedCost, Settings, Transaction } from '../domain/types';
import { addDays } from '../lib/dates';

export function makeSettings(over: Partial<Settings> = {}): Settings {
  return {
    id: 'main',
    onboarded: true,
    openingBalance: 20_000,
    openingDate: '2026-08-16T09:00',
    openingSavings: 0,
    estDailySpend: 300,
    importMappings: {},
    smallSpendLimit: 150,
    ...over,
  };
}

let seq = 1;
export function txn(over: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'date'>): Transaction {
  return { id: seq++, timeKnown: true, note: '', createdAt: 0, ...over };
}

export function expense(date: string, amount: number, categoryId: string, extra: Partial<Transaction> = {}): Transaction {
  return txn({ type: 'expense', amount, date, categoryId, ...extra });
}

export function rent(over: Partial<FixedCost> = {}): FixedCost {
  return {
    id: 1,
    name: 'PG rent',
    amount: 12_000,
    dueDay: 1,
    categoryId: 'rent',
    lastCoveredDue: '2026-09-01',
    active: true,
    ...over,
  };
}

/**
 * 30 days (16 Aug → 14 Sep 2026) of a typical PG student's spending:
 * daily chai, delivery every other day, weekday train, weekend outings.
 */
export function typicalMonth(today = '2026-09-14'): Transaction[] {
  const out: Transaction[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = addDays(today, -i);
    const dow = new Date(`${day}T12:00`).getDay();
    out.push(expense(`${day}T11:00`, 30, 'food_out', { merchant: 'Canteen' }));
    if (i % 2 === 0) out.push(expense(`${day}T22:30`, 280, 'delivery', { merchant: 'Swiggy' }));
    if (dow >= 1 && dow <= 5) out.push(expense(`${day}T08:30`, 20, 'local_travel'));
    if (dow === 6) out.push(expense(`${day}T19:00`, 600, 'outings', { merchant: 'PVR' }));
  }
  return out;
}
