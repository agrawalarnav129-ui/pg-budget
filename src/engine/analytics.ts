/**
 * Spending analytics for the Report screen. Pure functions over transactions.
 */
import { CATEGORIES, getCategory } from '../domain/categories';
import type { Transaction } from '../domain/types';
import { addDays, dateKeyOf, daysBetween, formatShortDate, isWeekend, parseLocal } from '../lib/dates';
import { floorTo, pct, rupees } from '../lib/money';

export interface Period {
  /** Inclusive 'YYYY-MM-DD'. */
  start: string;
  end: string;
}

export const periodDays = (p: Period) => daysBetween(p.start, p.end) + 1;

export function lastNDays(today: string, n: number): Period {
  return { start: addDays(today, -(n - 1)), end: today };
}

export function previousPeriod(p: Period): Period {
  const n = periodDays(p);
  return { start: addDays(p.start, -n), end: addDays(p.start, -1) };
}

export function expensesIn(txns: Transaction[], p: Period): Transaction[] {
  return txns.filter((t) => {
    if (t.type !== 'expense') return false;
    const k = dateKeyOf(t.date);
    return k >= p.start && k <= p.end;
  });
}

const sum = (ts: Transaction[]) => ts.reduce((s, t) => s + t.amount, 0);

// ---------------------------------------------------------------------------

export interface CategoryRow {
  categoryId: string;
  total: number;
  count: number;
  share: number; // % of period spend
  prevTotal: number;
  change: number | null; // % vs previous period, null if no previous spend
}

export function categoryBreakdown(current: Transaction[], previous: Transaction[] = []): CategoryRow[] {
  const total = sum(current);
  const cur = groupBy(current, (t) => getCategory(t.categoryId).id);
  const prev = groupBy(previous, (t) => getCategory(t.categoryId).id);
  return CATEGORIES.map((c) => {
    const rows = cur.get(c.id) ?? [];
    const catTotal = sum(rows);
    const prevTotal = sum(prev.get(c.id) ?? []);
    return {
      categoryId: c.id,
      total: catTotal,
      count: rows.length,
      share: pct(catTotal, total),
      prevTotal,
      change: prevTotal > 0 ? pct(catTotal - prevTotal, prevTotal) : null,
    };
  })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
}

export interface MerchantRow {
  name: string;
  total: number;
  count: number;
}

export function topMerchants(expenses: Transaction[], n = 5): MerchantRow[] {
  const groups = groupBy(
    expenses.filter((t) => (t.merchant || t.note).trim()),
    (t) => (t.merchant || t.note).trim().toLowerCase(),
  );
  return [...groups.values()]
    .map((ts) => ({ name: (ts[0].merchant || ts[0].note).trim(), total: sum(ts), count: ts.length }))
    .sort((a, b) => b.total - a.total)
    .slice(0, n);
}

export function needsVsWants(expenses: Transaction[]): { needs: number; wants: number } {
  let needs = 0;
  let wants = 0;
  for (const t of expenses) {
    if (getCategory(t.categoryId).kind === 'need') needs += t.amount;
    else wants += t.amount;
  }
  return { needs, wants };
}

export interface DayTotal {
  date: string;
  total: number;
}

export function dailySeries(expenses: Transaction[], p: Period): DayTotal[] {
  const map = new Map<string, number>();
  for (const t of expenses) map.set(dateKeyOf(t.date), (map.get(dateKeyOf(t.date)) ?? 0) + t.amount);
  const out: DayTotal[] = [];
  for (let k = p.start; k <= p.end; k = addDays(k, 1)) out.push({ date: k, total: map.get(k) ?? 0 });
  return out;
}

export interface WeekdayPattern {
  /** Average spend on each weekday (Sun..Sat) across the period. */
  avgByWeekday: number[];
  weekdayAvg: number;
  weekendAvg: number;
}

export function weekdayPattern(expenses: Transaction[], p: Period): WeekdayPattern {
  const series = dailySeries(expenses, p);
  const totals = Array(7).fill(0);
  const counts = Array(7).fill(0);
  let wd = 0,
    wdN = 0,
    we = 0,
    weN = 0;
  for (const d of series) {
    const day = parseLocal(d.date).getDay();
    totals[day] += d.total;
    counts[day] += 1;
    if (isWeekend(d.date)) {
      we += d.total;
      weN++;
    } else {
      wd += d.total;
      wdN++;
    }
  }
  return {
    avgByWeekday: totals.map((t, i) => (counts[i] ? t / counts[i] : 0)),
    weekdayAvg: wdN ? wd / wdN : 0,
    weekendAvg: weN ? we / weN : 0,
  };
}

export function lateNightSpends(expenses: Transaction[]): { count: number; total: number } {
  const late = expenses.filter((t) => {
    if (!t.timeKnown) return false;
    const h = parseLocal(t.date).getHours();
    return h >= 22 || h < 4;
  });
  return { count: late.length, total: sum(late) };
}

// ---------------------------------------------------------------------------
// Leaks: small, frequent spends that quietly add up

export interface Leak {
  kind: 'small-spends' | 'delivery-frequency';
  categoryId: string;
  count: number;
  total: number;
  /** Rupees per 30 days at the current pace. */
  monthly: number;
  /** Realistic monthly saving if the suggested change is made. */
  potentialSaving: number;
  /** Needs the headline above it for context (used on the leaks card). */
  advice: string;
  headline: string;
  /** Stands on its own, for the report summary. */
  summaryLine: string;
}

export function findLeaks(expenses: Transaction[], p: Period, smallLimit = 150): Leak[] {
  const days = periodDays(p);
  const perMonth = (n: number) => (n / days) * 30;
  const leaks: Leak[] = [];

  const small = expenses.filter(
    (t) => t.amount <= smallLimit && getCategory(t.categoryId).kind === 'want' && t.fixedCostId == null,
  );
  for (const [categoryId, ts] of groupBy(small, (t) => getCategory(t.categoryId).id)) {
    const total = sum(ts);
    if (ts.length < 5 || total < 500) continue;
    const monthly = perMonth(total);
    const cat = getCategory(categoryId);
    leaks.push({
      kind: 'small-spends',
      categoryId,
      count: ts.length,
      total,
      monthly,
      potentialSaving: floorTo(monthly * 0.5),
      headline: `${ts.length} small ${cat.name.toLowerCase()} spends under ${rupees(smallLimit)} added up to ${rupees(total)}`,
      advice: `That's about ${rupees(monthly)} a month. Halving them saves ~${rupees(floorTo(monthly * 0.5))}/month.`,
      summaryLine: `Halving your small ${cat.name.toLowerCase()} spends would save about ${rupees(floorTo(monthly * 0.5))} a month.`,
    });
  }

  const delivery = expenses.filter((t) => getCategory(t.categoryId).id === 'delivery');
  const ordersPerMonth = perMonth(delivery.length);
  const target = 8; // ~2 orders a week
  if (delivery.length >= 4 && ordersPerMonth > target + 2) {
    const avgOrder = sum(delivery) / delivery.length;
    const saving = floorTo((ordersPerMonth - target) * avgOrder * 0.6, 100); // assume a home/mess meal still costs ~40%
    leaks.push({
      kind: 'delivery-frequency',
      categoryId: 'delivery',
      count: delivery.length,
      total: sum(delivery),
      monthly: perMonth(sum(delivery)),
      potentialSaving: saving,
      headline: `${Math.round(ordersPerMonth)} food delivery orders a month, averaging ${rupees(avgOrder)}`,
      advice: `Cutting to 2 a week (eat at the mess the rest) saves about ${rupees(saving)}/month.`,
      summaryLine: `Cutting food delivery to 2 a week would save about ${rupees(saving)} a month.`,
    });
  }

  return leaks.sort((a, b) => b.potentialSaving - a.potentialSaving);
}

// ---------------------------------------------------------------------------
// Alerts: spending noticeably above your own normal

export interface SpendAlert {
  categoryId: string;
  severity: 'warning' | 'serious';
  message: string;
}

export function categoryAlerts(txns: Transaction[], today: string): SpendAlert[] {
  const last7 = expensesIn(txns, lastNDays(today, 7)).filter((t) => t.fixedCostId == null);
  const prior = expensesIn(txns, { start: addDays(today, -34), end: addDays(today, -7) }).filter(
    (t) => t.fixedCostId == null,
  );
  const alerts: SpendAlert[] = [];
  if (prior.length >= 5) {
    const recent = groupBy(last7, (t) => getCategory(t.categoryId).id);
    const base = groupBy(prior, (t) => getCategory(t.categoryId).id);
    for (const [id, ts] of recent) {
      const week = sum(ts);
      const usual = sum(base.get(id) ?? []) / 4;
      if (usual > 0 && week > usual * 1.25 && week - usual >= 300) {
        const up = Math.round(pct(week - usual, usual));
        alerts.push({
          categoryId: id,
          severity: up >= 75 ? 'serious' : 'warning',
          message: `${getCategory(id).name} is ${up}% above your usual this week (${rupees(week)} vs ~${rupees(usual)}).`,
        });
      }
    }
  }

  const month = expensesIn(txns, lastNDays(today, 30));
  const food = month.filter((t) => getCategory(t.categoryId).group === 'food');
  const foodTotal = sum(food);
  const deliveryTotal = sum(food.filter((t) => t.categoryId === 'delivery'));
  if (foodTotal >= 1000 && deliveryTotal / foodTotal > 0.5) {
    alerts.push({
      categoryId: 'delivery',
      severity: 'warning',
      message: `${Math.round(pct(deliveryTotal, foodTotal))}% of your food money went on delivery in the last 30 days.`,
    });
  }
  return alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'serious' ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Weekly check-in (shown on Sundays, or on demand)

export interface WeeklyCheckIn {
  thisWeek: number;
  usualWeek: number;
  change: number | null;
  biggestWant: { categoryId: string; total: number } | null;
}

export function weeklyCheckIn(txns: Transaction[], today: string): WeeklyCheckIn {
  const week = expensesIn(txns, lastNDays(today, 7)).filter((t) => t.fixedCostId == null);
  const prior = expensesIn(txns, { start: addDays(today, -34), end: addDays(today, -7) }).filter(
    (t) => t.fixedCostId == null,
  );
  const thisWeek = sum(week);
  const usualWeek = sum(prior) / 4;
  const wants = [...groupBy(week.filter((t) => getCategory(t.categoryId).kind === 'want'), (t) => getCategory(t.categoryId).id)]
    .map(([categoryId, ts]) => ({ categoryId, total: sum(ts) }))
    .sort((a, b) => b.total - a.total);
  return {
    thisWeek,
    usualWeek,
    change: usualWeek > 0 ? pct(thisWeek - usualWeek, usualWeek) : null,
    biggestWant: wants[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Full report

export interface Report {
  period: Period;
  days: number;
  total: number;
  prevTotal: number;
  change: number | null;
  perDay: number;
  /** Per day excluding fixed bills. */
  variablePerDay: number;
  categories: CategoryRow[];
  merchants: MerchantRow[];
  needsWants: { needs: number; wants: number };
  daily: DayTotal[];
  weekday: WeekdayPattern;
  lateNight: { count: number; total: number };
  leaks: Leak[];
  biggestDay: DayTotal | null;
  summary: string[];
}

export function buildReport(txns: Transaction[], period: Period, smallLimit = 150): Report {
  const current = expensesIn(txns, period);
  const previous = expensesIn(txns, previousPeriod(period));
  // Timing patterns use day-to-day spending only; a rent payment would swamp every chart.
  const variable = current.filter((t) => t.fixedCostId == null);
  const total = sum(current);
  const prevTotal = sum(previous);
  const days = periodDays(period);
  const categories = categoryBreakdown(current, previous);
  const daily = dailySeries(variable, period);
  const biggestDay = daily.reduce<DayTotal | null>((m, d) => (d.total > 0 && (!m || d.total > m.total) ? d : m), null);
  const report: Report = {
    period,
    days,
    total,
    prevTotal,
    change: prevTotal > 0 ? pct(total - prevTotal, prevTotal) : null,
    perDay: total / days,
    variablePerDay: sum(variable) / days,
    categories,
    merchants: topMerchants(variable),
    needsWants: needsVsWants(current),
    daily,
    weekday: weekdayPattern(variable, period),
    lateNight: lateNightSpends(variable),
    leaks: findLeaks(variable, period, smallLimit),
    biggestDay,
    summary: [],
  };
  report.summary = summarise(report);
  return report;
}

function summarise(r: Report): string[] {
  if (r.total === 0) return ['No spending recorded in this period yet.'];
  const lines: string[] = [];

  let first = `You spent ${rupees(r.total)} in ${r.days} days (${rupees(r.perDay)}/day)`;
  if (r.change != null && Math.abs(r.change) >= 5) {
    first += `, ${Math.abs(Math.round(r.change))}% ${r.change > 0 ? 'more' : 'less'} than the ${r.days} days before`;
  }
  lines.push(first + '.');

  const variable = r.categories.filter((c) => c.categoryId !== 'rent');
  const top = variable[0];
  const afterRent = variable.length < r.categories.length ? ' after rent' : '';
  if (top) {
    const foodShare = r.categories
      .filter((c) => getCategory(c.categoryId).group === 'food')
      .reduce((s, c) => s + c.total, 0);
    const delivery = r.categories.find((c) => c.categoryId === 'delivery')?.total ?? 0;
    if (getCategory(top.categoryId).group === 'food' && foodShare > 0) {
      lines.push(
        `Food is your biggest cost${afterRent}: ${Math.round(pct(foodShare, r.total))}% of spending` +
          (delivery > 0 ? `, and ${Math.round(pct(delivery, foodShare))}% of that was delivery.` : '.'),
      );
    } else {
      lines.push(`${getCategory(top.categoryId).name} is your biggest cost${afterRent} (${Math.round(top.share)}%).`);
    }
  }

  const wantsShare = pct(r.needsWants.wants, r.total);
  if (wantsShare >= 35) {
    lines.push(`${Math.round(wantsShare)}% went on wants. For a student budget, aim for 30% or less.`);
  }

  if (r.weekday.weekdayAvg > 0 && r.weekday.weekendAvg > r.weekday.weekdayAvg * 1.5) {
    lines.push(
      `Weekends cost ${(r.weekday.weekendAvg / r.weekday.weekdayAvg).toFixed(1)}× a weekday (${rupees(r.weekday.weekendAvg)} vs ${rupees(r.weekday.weekdayAvg)}).`,
    );
  }

  const leak = r.leaks[0];
  if (leak && leak.potentialSaving > 0) lines.push(leak.summaryLine);

  if (r.biggestDay && r.biggestDay.total > r.variablePerDay * 4) {
    lines.push(`Biggest day: ${formatShortDate(r.biggestDay.date)} at ${rupees(r.biggestDay.total)}.`);
  }
  return lines;
}

// ---------------------------------------------------------------------------

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}
