import Dexie, { type EntityTable } from 'dexie';
import type { FixedCost, Goal, MerchantRule, Settings, Transaction } from '../domain/types';
import { toLocalDateTime } from '../lib/dates';

export class BudgetDB extends Dexie {
  transactions!: EntityTable<Transaction, 'id'>;
  fixedCosts!: EntityTable<FixedCost, 'id'>;
  goals!: EntityTable<Goal, 'id'>;
  merchantRules!: EntityTable<MerchantRule, 'id'>;
  settings!: EntityTable<Settings, 'id'>;

  constructor() {
    super('pg-budget');
    this.version(1).stores({
      transactions: '++id, date, type, categoryId, importHash, fixedCostId',
      fixedCosts: '++id',
      goals: '++id',
      merchantRules: '++id, &keyword',
      settings: 'id',
    });
  }
}

export const db = new BudgetDB();

export function defaultSettings(): Settings {
  return {
    id: 'main',
    onboarded: false,
    openingBalance: 0,
    openingDate: toLocalDateTime(new Date()),
    openingSavings: 0,
    estDailySpend: 300,
    importMappings: {},
    smallSpendLimit: 150,
  };
}

/** Ask the browser not to evict our data (important on iOS). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
