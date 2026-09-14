import type { Category } from './types';

/** Defaults tuned for a student living in a PG in Mumbai. */
export const CATEGORIES: Category[] = [
  { id: 'rent', name: 'PG rent', emoji: '🏠', kind: 'need', group: 'housing' },
  { id: 'mess', name: 'Mess / tiffin', emoji: '🍱', kind: 'need', group: 'food' },
  { id: 'food_out', name: 'Eating out & chai', emoji: '☕', kind: 'want', group: 'food' },
  { id: 'delivery', name: 'Food delivery', emoji: '🛵', kind: 'want', group: 'food' },
  { id: 'groceries', name: 'Groceries & snacks', emoji: '🛒', kind: 'need', group: 'food' },
  { id: 'local_travel', name: 'Train / metro / bus', emoji: '🚆', kind: 'need', group: 'travel' },
  { id: 'cabs', name: 'Auto & cabs', emoji: '🛺', kind: 'want', group: 'travel' },
  { id: 'recharge', name: 'Phone & internet', emoji: '📶', kind: 'need', group: 'essentials' },
  { id: 'college', name: 'College & books', emoji: '📚', kind: 'need', group: 'essentials' },
  { id: 'personal', name: 'Laundry & toiletries', emoji: '🧴', kind: 'need', group: 'essentials' },
  { id: 'health', name: 'Health & medicines', emoji: '💊', kind: 'need', group: 'essentials' },
  { id: 'trips', name: 'Trips home', emoji: '🧳', kind: 'need', group: 'travel' },
  { id: 'shopping', name: 'Shopping', emoji: '🛍️', kind: 'want', group: 'lifestyle' },
  { id: 'outings', name: 'Outings & movies', emoji: '🎬', kind: 'want', group: 'lifestyle' },
  { id: 'subscriptions', name: 'Subscriptions', emoji: '📺', kind: 'want', group: 'lifestyle' },
  { id: 'other', name: 'Other', emoji: '📦', kind: 'want', group: 'other' },
];

const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: string | undefined): Category {
  return (id && byId.get(id)) || byId.get('other')!;
}

/** Categories that count toward "monthly essentials" for the emergency fund. */
export const ESSENTIAL_GROUPS = new Set(['housing', 'food', 'travel', 'essentials']);

export const INCOME_SOURCES = [
  { id: 'allowance', name: 'Allowance from home', emoji: '🏡' },
  { id: 'windfall', name: 'Gift / internship / freelance', emoji: '🎁' },
  { id: 'refund', name: 'Refund / friend paid back', emoji: '↩️' },
] as const;
