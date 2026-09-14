/**
 * Core data model. All money is stored as positive rupees (number, up to 2 decimals).
 * Dates are local-time strings: 'YYYY-MM-DDTHH:mm' for transactions, 'YYYY-MM-DD' for due dates.
 */

export type TxnType =
  | 'expense' // money spent
  | 'income' // money received (allowance, gift, internship, refund)
  | 'save' // moved from wallet into the savings pot
  | 'withdraw'; // taken back out of the savings pot into the wallet

export type IncomeSource = 'allowance' | 'windfall' | 'refund';

export interface Transaction {
  id?: number;
  type: TxnType;
  amount: number;
  /** Local datetime 'YYYY-MM-DDTHH:mm'. */
  date: string;
  /** False for imported rows where the bank gives only a date (time is set to 12:00). */
  timeKnown: boolean;
  categoryId?: string;
  source?: IncomeSource;
  note: string;
  /** Normalised merchant / payee name, used for top-merchant analysis. */
  merchant?: string;
  /** Set when this expense pays a recurring fixed cost (e.g. PG rent). */
  fixedCostId?: number;
  /** Dedupe key for imported rows. */
  importHash?: string;
  createdAt: number;
}

export interface FixedCost {
  id?: number;
  name: string;
  amount: number;
  /** Day of month it is due (1–31, clamped to month length). */
  dueDay: number;
  categoryId: string;
  /** The most recent due date ('YYYY-MM-DD') that has already been paid. */
  lastCoveredDue: string;
  active: boolean;
}

export interface Goal {
  id?: number;
  name: string;
  target: number;
  createdAt: number;
}

export interface MerchantRule {
  id?: number;
  /** Upper-case keyword matched as a substring against the description. */
  keyword: string;
  categoryId: string;
}

export interface ColumnMapping {
  date: string;
  description: string;
  /** Either a single signed/typed amount column … */
  amount?: string;
  /** … with an optional Dr/Cr column … */
  type?: string;
  /** … or separate debit / credit columns. */
  debit?: string;
  credit?: string;
  /** For a single amount column without a Dr/Cr column: are positive numbers expenses? */
  positiveIsDebit?: boolean;
  dateFormat: 'DMY' | 'MDY' | 'YMD';
}

export interface Settings {
  id: 'main';
  onboarded: boolean;
  /** Wallet balance (bank + UPI + cash, excluding savings) at openingDate. */
  openingBalance: number;
  /** Local datetime from which transactions affect the balance. */
  openingDate: string;
  /** Savings already set aside before using the app. */
  openingSavings: number;
  /** User's rough daily spend estimate, used until enough history exists. */
  estDailySpend: number;
  /** Optional 'YYYY-MM-DD' when the next money is expected. */
  nextIncomeDate?: string;
  /** Saved CSV column mappings keyed by header signature. */
  importMappings: Record<string, ColumnMapping>;
  lastBackupAt?: number;
  smallSpendLimit: number;
}

export type CategoryKind = 'need' | 'want';
export type CategoryGroup = 'housing' | 'food' | 'travel' | 'essentials' | 'lifestyle' | 'other';

export interface Category {
  id: string;
  name: string;
  emoji: string;
  kind: CategoryKind;
  group: CategoryGroup;
}
