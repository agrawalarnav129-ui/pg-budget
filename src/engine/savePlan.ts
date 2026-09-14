/**
 * Turns the planner snapshot into a concrete "when to save, how much" plan.
 * These are budgeting rules of thumb, not investment advice.
 */
import { getCategory } from '../domain/categories';
import type { Transaction } from '../domain/types';
import { addDays, dateKeyOf, daysBetween, formatEtaDate, formatShortDate } from '../lib/dates';
import { floorTo, rupees } from '../lib/money';
import { weeklyCheckIn } from './analytics';
import { SAVE_RATE, splitIncome, sweepSuggestion, type Snapshot } from './planner';

export type Tone = 'good' | 'neutral' | 'warning' | 'critical';

export interface PlanItem {
  id: string;
  when: string;
  title: string;
  detail: string;
  tone: Tone;
  /** Suggested one-tap transfer to savings, if any. */
  amount?: number;
}

export function typicalIncome(txns: Transaction[], today: string, source: 'allowance' | 'windfall' = 'allowance'): number | null {
  const start = addDays(today, -120);
  const amounts = txns
    .filter((t) => t.type === 'income' && t.source === source && dateKeyOf(t.date) >= start)
    .map((t) => t.amount)
    .sort((a, b) => a - b);
  if (!amounts.length) return null;
  return amounts[Math.floor(amounts.length / 2)];
}

export function averageMonthlyIncome(txns: Transaction[], today: string): number {
  const start = addDays(today, -89);
  const inWindow = txns.filter((t) => dateKeyOf(t.date) >= start);
  const incomes = inWindow.filter((t) => t.type === 'income' && t.source !== 'refund');
  if (!incomes.length) return 0;
  // Span from the start of recorded history, not the first income, so one allowance isn't over-counted.
  const first = inWindow.reduce((m, t) => (dateKeyOf(t.date) < m ? dateKeyOf(t.date) : m), today);
  const spanDays = Math.max(30, Math.min(90, daysBetween(first, today) + 1));
  return (incomes.reduce((s, t) => s + t.amount, 0) / spanDays) * 30;
}

export function buildSavePlan(snap: Snapshot, txns: Transaction[]): PlanItem[] {
  const items: PlanItem[] = [];
  const week = weeklyCheckIn(txns, snap.today);

  // 1. Right now
  const sweep = sweepSuggestion(snap);
  if (snap.status === 'critical') {
    const cut = week.biggestWant ? getCategory(week.biggestWant.categoryId).name.toLowerCase() : 'wants';
    items.push({
      id: 'now',
      when: 'Right now',
      title: "Don't save yet. Protect your runway.",
      detail: `Your spending money lasts about ${Math.floor(snap.runwayDays)} days. Pause saving and cut back on ${cut} until more money comes in.`,
      tone: 'critical',
    });
  } else if (sweep) {
    items.push({
      id: 'now',
      when: 'Today',
      title: `Move ${rupees(sweep.amount)} to savings`,
      detail: `You're spending slower than needed to last until ${formatShortDate(snap.horizon.date)}. Lock away half of the extra before it gets spent.`,
      tone: 'good',
      amount: sweep.amount,
    });
  } else {
    items.push({
      id: 'now',
      when: 'Every day',
      title: `Keep daily spending under ${rupees(snap.dailyAllowance)}`,
      detail: `That makes your money last until ${formatShortDate(snap.horizon.date)} with rent already set aside.`,
      tone: snap.status === 'tight' ? 'warning' : 'neutral',
    });
  }

  // 2. The moment money arrives
  const allowance = typicalIncome(txns, snap.today, 'allowance');
  const emergencyFull = snap.emergencyTarget > 0 && snap.pot >= snap.emergencyTarget;
  const rate = emergencyFull ? SAVE_RATE.allowanceAfterEmergencyFund : SAVE_RATE.allowance;
  if (allowance) {
    const split = splitIncome(snap, allowance, 'allowance');
    items.push({
      id: 'on-income',
      when: 'The day money arrives',
      title: `Save ${Math.round(rate * 100)}% first: about ${rupees(split.save)} of a typical ${rupees(allowance)}`,
      detail:
        (split.toReserve > 0 ? `Put ${rupees(split.toReserve)} aside for rent, then save. ` : '') +
        'Transfer it before spending anything. Money left in your main account gets spent. Windfalls (gifts, internship pay): save 50%.',
      tone: 'neutral',
    });
  } else {
    items.push({
      id: 'on-income',
      when: 'The day money arrives',
      title: `Save ${Math.round(rate * 100)}% of every allowance, 50% of every windfall`,
      detail: 'Record money in with "Money in". The app works out the exact split and keeps rent and 3 weeks of spending safe.',
      tone: 'neutral',
    });
  }

  // 3. Monthly target
  const monthlyIncome = averageMonthlyIncome(txns, snap.today);
  if (monthlyIncome > 0) {
    const target = floorTo(monthlyIncome * rate, 100);
    const onTrack = snap.monthlySaveRate >= target * 0.9;
    items.push({
      id: 'monthly',
      when: 'Each month',
      title: `Aim for ${rupees(target)}/month in savings`,
      detail: `${Math.round(rate * 100)}% of your average ${rupees(monthlyIncome)}/month coming in. Recently saving ${rupees(snap.monthlySaveRate)}/month${onTrack ? ', so you are on track.' : '.'}`,
      tone: onTrack ? 'good' : 'warning',
    });
  }

  // 4. Weekly check-in
  if (week.usualWeek > 0) {
    const diff = week.usualWeek - week.thisWeek;
    items.push({
      id: 'weekly',
      when: 'Every Sunday',
      title:
        diff >= 200
          ? `You spent ${rupees(diff)} less than usual this week. Save it.`
          : 'Review the week and pick one thing to cut',
      detail:
        diff >= 200
          ? 'Moving under-spend to savings each week keeps it from leaking into the next week.'
          : week.biggestWant
            ? `Your biggest want this week was ${getCategory(week.biggestWant.categoryId).name.toLowerCase()} (${rupees(week.biggestWant.total)}).`
            : 'Compare this week with your usual on the Report tab.',
      tone: diff >= 200 ? 'good' : 'neutral',
      amount: diff >= 200 ? floorTo(diff, 100) : undefined,
    });
  }

  // 5. Emergency fund
  const efLeft = snap.emergencyTarget - snap.emergencySaved;
  items.push({
    id: 'emergency',
    when: 'First goal',
    title: emergencyFull
      ? `Emergency fund complete: ${rupees(snap.emergencyTarget)}`
      : `Build an emergency fund of ${rupees(snap.emergencyTarget)}`,
    detail: emergencyFull
      ? 'Two months of essentials are covered. New savings now go to your goals.'
      : `That's 2 months of essentials (rent, food, travel, recharge). ${rupees(snap.emergencySaved)} saved, ${rupees(efLeft)} to go` +
        (snap.monthlySaveRate > 0
          ? `, reached around ${formatEtaDate(addDays(snap.today, Math.ceil((efLeft / snap.monthlySaveRate) * 30)), snap.today)} at your current pace.`
          : '. Keep it in a separate savings account you do not use for UPI.'),
    tone: emergencyFull ? 'good' : 'neutral',
  });

  return items;
}
