/**
 * Cash-flow planner for irregular income.
 *
 * Instead of a fixed monthly budget, everything is derived from the wallet balance you have
 * right now, the fixed costs coming up (PG rent etc.), and how fast you actually spend.
 * All functions are pure so they can be unit-tested and reasoned about.
 */
import { ESSENTIAL_GROUPS, getCategory } from '../domain/categories';
import type { FixedCost, Goal, IncomeSource, Settings, Transaction } from '../domain/types';
import { addDays, addMonthsDue, dateKeyOf, daysBetween, dueDateIn, parseLocal } from '../lib/dates';
import { floorTo } from '../lib/money';

/** Days of history needed before the user's own estimate is fully replaced. */
export const HISTORY_DAYS_FOR_TRUST = 14;
/** Never suggest saving money that would leave less than this many days of spending. */
export const MIN_RUNWAY_DAYS = 21;
export const DEFAULT_HORIZON_DAYS = 30;
export const SAVE_RATE = { allowance: 0.15, allowanceAfterEmergencyFund: 0.1, windfall: 0.5, refund: 0 } as const;
export const EMERGENCY_FUND_MONTHS = 2;

export interface PlannerInput {
  settings: Settings;
  txns: Transaction[];
  fixedCosts: FixedCost[];
  goals: Goal[];
  /** Local datetime 'YYYY-MM-DDTHH:mm'. */
  now: string;
}

// ---------------------------------------------------------------------------
// Balances

export function walletBalance(settings: Settings, txns: Transaction[]): number {
  let bal = settings.openingBalance;
  for (const t of txns) {
    if (t.date < settings.openingDate) continue; // already reflected in the opening balance
    if (t.type === 'income' || t.type === 'withdraw') bal += t.amount;
    else bal -= t.amount; // expense, save
  }
  return round2(bal);
}

export function savingsPot(settings: Settings, txns: Transaction[]): number {
  let pot = settings.openingSavings;
  for (const t of txns) {
    if (t.type === 'save') pot += t.amount;
    else if (t.type === 'withdraw') pot -= t.amount;
  }
  return round2(Math.max(0, pot));
}

// ---------------------------------------------------------------------------
// Fixed costs

export function nextDue(fc: FixedCost): string {
  return addMonthsDue(fc.lastCoveredDue, 1, fc.dueDay);
}

/** Which due date a payment made on `dateKey` most plausibly covers (nearest due date). */
export function coveredDueFor(dateKey: string, dueDay: number): string {
  const d = parseLocal(dateKey);
  const candidates = [-1, 0, 1].map((off) => dueDateIn(d.getFullYear(), d.getMonth() + off, dueDay));
  return candidates.reduce((best, c) =>
    Math.abs(daysBetween(dateKey, c)) < Math.abs(daysBetween(dateKey, best)) ? c : best,
  );
}

export interface UpcomingCost {
  fixedCost: FixedCost;
  due: string;
  daysLeft: number; // negative = overdue
}

/** Every unpaid fixed-cost occurrence due on or before today + horizonDays (overdue included). */
export function upcomingFixedCosts(fixedCosts: FixedCost[], today: string, horizonDays: number): UpcomingCost[] {
  const limit = addDays(today, horizonDays);
  const out: UpcomingCost[] = [];
  for (const fc of fixedCosts) {
    if (!fc.active) continue;
    let due = nextDue(fc);
    for (let guard = 0; due <= limit && guard < 6; guard++) {
      out.push({ fixedCost: fc, due, daysLeft: daysBetween(today, due) });
      due = addMonthsDue(due, 1, fc.dueDay);
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

export function monthlyFixedTotal(fixedCosts: FixedCost[]): number {
  return fixedCosts.filter((f) => f.active).reduce((s, f) => s + f.amount, 0);
}

// ---------------------------------------------------------------------------
// Spending pace

export interface Burn {
  /** Rupees per day of variable (non-fixed-cost) spending. */
  perDay: number;
  /** Rupees per day of essential variable spending (food, travel, recharge…). */
  essentialPerDay: number;
  daysOfData: number;
  basis: 'estimate' | 'blended' | 'history';
}

export function isVariableExpense(t: Transaction): boolean {
  return t.type === 'expense' && t.fixedCostId == null;
}

export function dailyBurn(settings: Settings, txns: Transaction[], today: string): Burn {
  const windowStart = addDays(today, -29);
  const expenses = txns.filter(isVariableExpense);
  const earliest = expenses.reduce((min, t) => (dateKeyOf(t.date) < min ? dateKeyOf(t.date) : min), dateKeyOf(settings.openingDate));
  const from = earliest > windowStart ? earliest : windowStart;
  const daysOfData = Math.min(30, Math.max(1, daysBetween(from, today) + 1));

  let spend = 0;
  let essential = 0;
  for (const t of expenses) {
    const k = dateKeyOf(t.date);
    if (k < windowStart || k > today) continue;
    spend += t.amount;
    const cat = getCategory(t.categoryId);
    if (cat.kind === 'need' && ESSENTIAL_GROUPS.has(cat.group)) essential += t.amount;
  }

  const actual = spend / daysOfData;
  const actualEssential = essential / daysOfData;
  const est = settings.estDailySpend;
  if (daysOfData >= HISTORY_DAYS_FOR_TRUST) {
    return { perDay: actual, essentialPerDay: actualEssential, daysOfData, basis: 'history' };
  }
  // Blend: each real day of data replaces one day of the estimate.
  const w = daysOfData / HISTORY_DAYS_FOR_TRUST;
  const noData = spend === 0 && daysOfData <= 1;
  return {
    perDay: noData ? est : actual * w + est * (1 - w),
    essentialPerDay: noData ? est * 0.6 : actualEssential * w + est * 0.6 * (1 - w),
    daysOfData,
    basis: noData ? 'estimate' : 'blended',
  };
}

// ---------------------------------------------------------------------------
// Horizon: how long the current money has to last

export interface Horizon {
  days: number;
  date: string;
  basis: 'expected-income' | 'default';
}

export function planningHorizon(settings: Settings, today: string): Horizon {
  if (settings.nextIncomeDate && settings.nextIncomeDate > today) {
    const days = Math.min(90, Math.max(1, daysBetween(today, settings.nextIncomeDate)));
    return { days, date: settings.nextIncomeDate, basis: 'expected-income' };
  }
  return { days: DEFAULT_HORIZON_DAYS, date: addDays(today, DEFAULT_HORIZON_DAYS), basis: 'default' };
}

// ---------------------------------------------------------------------------
// Snapshot: everything the Home screen needs

export interface GoalProgress {
  goal: Goal;
  saved: number;
  remaining: number;
  /** Projected 'YYYY-MM-DD', or null if not saving at the moment. */
  eta: string | null;
}

export interface Snapshot {
  today: string;
  balance: number;
  pot: number;
  burn: Burn;
  horizon: Horizon;
  upcoming: UpcomingCost[];
  reserve: number;
  spendable: number;
  spentToday: number;
  dailyAllowance: number;
  /** Remaining safe spend for today; negative means over. */
  safeToday: number;
  runwayDays: number;
  status: 'healthy' | 'tight' | 'critical';
  essentialsMonthly: number;
  emergencyTarget: number;
  emergencySaved: number;
  /** Net rupees moved into savings per month recently. */
  monthlySaveRate: number;
  goals: GoalProgress[];
}

export function snapshot({ settings, txns, fixedCosts, goals, now }: PlannerInput): Snapshot {
  const today = dateKeyOf(now);
  const balance = walletBalance(settings, txns);
  const pot = savingsPot(settings, txns);
  const burn = dailyBurn(settings, txns, today);
  const horizon = planningHorizon(settings, today);
  const upcoming = upcomingFixedCosts(fixedCosts, today, horizon.days);
  const reserve = upcoming.reduce((s, u) => s + u.fixedCost.amount, 0);
  const spendable = round2(balance - reserve);

  const spentToday = txns
    .filter((t) => isVariableExpense(t) && dateKeyOf(t.date) === today && t.date >= settings.openingDate)
    .reduce((s, t) => s + t.amount, 0);
  // Allowance is fixed at the start of the day so spending doesn't shrink it mid-day.
  const dailyAllowance = Math.max(0, (spendable + spentToday) / horizon.days);
  const safeToday = dailyAllowance - spentToday;

  const runwayDays = spendable <= 0 ? 0 : burn.perDay <= 0 ? Infinity : spendable / burn.perDay;
  const status: Snapshot['status'] =
    runwayDays >= horizon.days ? 'healthy' : runwayDays >= Math.min(14, horizon.days * 0.6) ? 'tight' : 'critical';

  const essentialsMonthly = monthlyFixedTotal(fixedCosts) + burn.essentialPerDay * 30;
  const emergencyTarget = Math.ceil((essentialsMonthly * EMERGENCY_FUND_MONTHS) / 500) * 500;
  const emergencySaved = Math.min(pot, emergencyTarget);
  const monthlySaveRate = recentMonthlySaveRate(settings, txns, today);

  // Savings fill the emergency fund first, then goals in the order they were created.
  let leftover = pot - emergencySaved;
  let cumulativeNeed = Math.max(0, emergencyTarget - pot);
  const goalProgress = [...goals]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((goal) => {
      const saved = Math.min(goal.target, Math.max(0, leftover));
      leftover -= saved;
      const remaining = goal.target - saved;
      cumulativeNeed += remaining;
      const eta =
        remaining <= 0
          ? today
          : monthlySaveRate > 0
            ? addDays(today, Math.ceil((cumulativeNeed / monthlySaveRate) * 30))
            : null;
      return { goal, saved, remaining, eta };
    });

  return {
    today,
    balance,
    pot,
    burn,
    horizon,
    upcoming,
    reserve,
    spendable,
    spentToday,
    dailyAllowance,
    safeToday,
    runwayDays,
    status,
    essentialsMonthly,
    emergencyTarget,
    emergencySaved,
    monthlySaveRate,
    goals: goalProgress,
  };
}

function recentMonthlySaveRate(settings: Settings, txns: Transaction[], today: string): number {
  const start = addDays(today, -59);
  let net = 0;
  for (const t of txns) {
    const k = dateKeyOf(t.date);
    if (k < start || k > today) continue;
    if (t.type === 'save') net += t.amount;
    if (t.type === 'withdraw') net -= t.amount;
  }
  const daysUsed = Math.min(60, Math.max(30, daysBetween(dateKeyOf(settings.openingDate), today) + 1));
  return Math.max(0, (net / daysUsed) * 30);
}

// ---------------------------------------------------------------------------
// When money comes in: pay yourself first

export interface IncomeSplit {
  amount: number;
  toReserve: number;
  save: number;
  toSpend: number;
  rate: number;
  runwayAfter: number;
  reasons: string[];
}

/** `snap` must be the snapshot *before* this income is recorded. */
export function splitIncome(snap: Snapshot, amount: number, source: IncomeSource): IncomeSplit {
  const reasons: string[] = [];
  const shortfall = Math.max(0, snap.reserve - snap.balance);
  const toReserve = Math.min(amount, shortfall);
  if (toReserve > 0) reasons.push('Upcoming fixed costs are covered first.');

  const rest = amount - toReserve;
  const emergencyFull = snap.pot >= snap.emergencyTarget && snap.emergencyTarget > 0;
  const rate =
    source === 'allowance'
      ? emergencyFull
        ? SAVE_RATE.allowanceAfterEmergencyFund
        : SAVE_RATE.allowance
      : SAVE_RATE[source];

  let save = floorTo(rest * rate);
  if (save > 0) {
    reasons.push(
      source === 'windfall'
        ? 'Unexpected money: save half, enjoy half.'
        : emergencyFull
          ? 'Emergency fund is full, so 10% is enough.'
          : 'Save 15% of every allowance until your emergency fund is full.',
    );
  } else if (source === 'refund') {
    reasons.push('Refunds just replace money you already spent, so nothing is saved.');
  }

  // Guardrail: never save money you'll need for daily life before more arrives.
  const neededDays = MIN_RUNWAY_DAYS;
  const needed = snap.burn.perDay * neededDays;
  const spendableAfterFull = snap.spendable + amount - save;
  if (save > 0 && spendableAfterFull < needed) {
    const capped = floorTo(Math.max(0, snap.spendable + amount - needed));
    if (capped < save) {
      save = capped;
      reasons.push(
        save === 0
          ? `Skipping savings this time: you need this money to last ${neededDays} days.`
          : `Saving less so you still have ${neededDays} days of spending money.`,
      );
    }
  }

  const spendableAfter = snap.spendable + amount - save;
  const runwayAfter = spendableAfter <= 0 ? 0 : snap.burn.perDay <= 0 ? Infinity : spendableAfter / snap.burn.perDay;
  return { amount, toReserve, save, toSpend: round2(amount - toReserve - save), rate, runwayAfter, reasons };
}

// ---------------------------------------------------------------------------
// Sweep: ahead of pace? move the surplus out of reach

export interface Sweep {
  amount: number;
  surplus: number;
}

export function sweepSuggestion(snap: Snapshot): Sweep | null {
  if (snap.runwayDays === Infinity || snap.runwayDays < snap.horizon.days * 1.25) return null;
  const needed = snap.burn.perDay * snap.horizon.days * 1.1; // 10% cushion
  const surplus = snap.spendable - needed;
  const amount = floorTo(surplus * 0.5, 100);
  return amount >= 300 ? { amount, surplus } : null;
}

// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
