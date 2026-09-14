import { describe, expect, it } from 'vitest';
import { expense, makeSettings, rent, txn, typicalMonth } from './fixtures';
import {
  coveredDueFor,
  dailyBurn,
  nextDue,
  planningHorizon,
  savingsPot,
  snapshot,
  splitIncome,
  sweepSuggestion,
  upcomingFixedCosts,
  walletBalance,
} from './planner';

const NOW = '2026-09-14T18:00';

describe('balances', () => {
  it('ignores transactions before the opening date and tracks savings moves', () => {
    const settings = makeSettings({ openingBalance: 10_000, openingSavings: 1_000 });
    const txns = [
      expense('2026-08-10T10:00', 500, 'shopping'), // before opening, already in balance
      expense('2026-08-20T10:00', 300, 'delivery'),
      txn({ type: 'income', amount: 5_000, date: '2026-09-01T10:00', source: 'allowance' }),
      txn({ type: 'save', amount: 750, date: '2026-09-01T10:05' }),
      txn({ type: 'withdraw', amount: 250, date: '2026-09-05T10:05' }),
    ];
    expect(walletBalance(settings, txns)).toBe(10_000 - 300 + 5_000 - 750 + 250);
    expect(savingsPot(settings, txns)).toBe(1_000 + 750 - 250);
  });
});

describe('fixed costs', () => {
  it('computes next due from the last covered due date, clamping short months', () => {
    expect(nextDue(rent({ lastCoveredDue: '2026-09-01' }))).toBe('2026-10-01');
    expect(nextDue(rent({ dueDay: 31, lastCoveredDue: '2026-08-31' }))).toBe('2026-09-30');
    expect(nextDue(rent({ dueDay: 31, lastCoveredDue: '2026-09-30' }))).toBe('2026-10-31');
  });

  it('matches a payment to the nearest due date', () => {
    expect(coveredDueFor('2026-09-28', 1)).toBe('2026-10-01'); // paid early
    expect(coveredDueFor('2026-10-04', 1)).toBe('2026-10-01'); // paid late
    expect(coveredDueFor('2026-10-10', 5)).toBe('2026-10-05');
  });

  it('includes overdue and in-horizon occurrences only', () => {
    const overdue = rent({ lastCoveredDue: '2026-08-01' }); // Sep rent unpaid
    const up = upcomingFixedCosts([overdue], '2026-09-14', 30);
    expect(up.map((u) => u.due)).toEqual(['2026-09-01', '2026-10-01']);
    expect(up[0].daysLeft).toBe(-13);
    expect(upcomingFixedCosts([rent({ active: false })], '2026-09-14', 30)).toEqual([]);
  });
});

describe('daily burn', () => {
  it('uses the estimate on day one', () => {
    const s = makeSettings({ openingDate: '2026-09-14T09:00' });
    const burn = dailyBurn(s, [], '2026-09-14');
    expect(burn.basis).toBe('estimate');
    expect(burn.perDay).toBe(300);
  });

  it('blends estimate with history for the first two weeks', () => {
    const s = makeSettings({ openingDate: '2026-09-08T09:00', estDailySpend: 300 });
    const txns = [expense('2026-09-10T12:00', 700, 'delivery')]; // 700 over 7 days = 100/day
    const burn = dailyBurn(s, txns, '2026-09-14');
    expect(burn.daysOfData).toBe(7);
    expect(burn.basis).toBe('blended');
    expect(burn.perDay).toBeCloseTo(100 * 0.5 + 300 * 0.5);
  });

  it('uses 30 days of history and excludes fixed-cost payments', () => {
    const s = makeSettings();
    const txns = [...typicalMonth(), expense('2026-09-01T10:00', 12_000, 'rent', { fixedCostId: 1 })];
    const burn = dailyBurn(s, txns, '2026-09-14');
    expect(burn.basis).toBe('history');
    expect(burn.daysOfData).toBe(30);
    const variable = typicalMonth().reduce((a, t) => a + t.amount, 0);
    expect(burn.perDay).toBeCloseTo(variable / 30);
  });
});

describe('horizon', () => {
  it('uses the expected income date when set in the future', () => {
    expect(planningHorizon(makeSettings({ nextIncomeDate: '2026-09-24' }), '2026-09-14')).toMatchObject({
      days: 10,
      basis: 'expected-income',
    });
    expect(planningHorizon(makeSettings({ nextIncomeDate: '2026-09-01' }), '2026-09-14').basis).toBe('default');
  });
});

describe('snapshot', () => {
  it('reserves upcoming rent before computing safe-to-spend and runway', () => {
    const settings = makeSettings({ openingDate: '2026-09-14T09:00', openingBalance: 21_000, estDailySpend: 300 });
    const snap = snapshot({ settings, txns: [], fixedCosts: [rent()], goals: [], now: NOW });
    expect(snap.reserve).toBe(12_000);
    expect(snap.spendable).toBe(9_000);
    expect(snap.dailyAllowance).toBeCloseTo(300);
    expect(snap.runwayDays).toBeCloseTo(30);
    expect(snap.status).toBe('healthy');
  });

  it('keeps the daily allowance stable as today’s spending is recorded', () => {
    const settings = makeSettings({ openingDate: '2026-09-14T09:00', openingBalance: 21_000 });
    const txns = [expense('2026-09-14T13:00', 120, 'food_out')];
    const snap = snapshot({ settings, txns, fixedCosts: [rent()], goals: [], now: NOW });
    expect(snap.dailyAllowance).toBeCloseTo(300);
    expect(snap.safeToday).toBeCloseTo(180);
  });

  it('flags a critical runway', () => {
    const settings = makeSettings({ openingDate: '2026-09-14T09:00', openingBalance: 13_000 });
    const snap = snapshot({ settings, txns: [], fixedCosts: [rent()], goals: [], now: NOW });
    expect(snap.runwayDays).toBeCloseTo(1000 / 300);
    expect(snap.status).toBe('critical');
  });

  it('fills the emergency fund before goals', () => {
    const settings = makeSettings({ openingDate: '2026-09-14T09:00', openingSavings: 30_000, estDailySpend: 300 });
    const goals = [{ id: 1, name: 'Laptop', target: 50_000, createdAt: 1 }];
    const snap = snapshot({ settings, txns: [], fixedCosts: [rent()], goals, now: NOW });
    // essentials = 12,000 rent + 180/day × 30 = 17,400 → ×2 = 34,800 → rounded up to 35,000
    expect(snap.emergencyTarget).toBe(35_000);
    expect(snap.emergencySaved).toBe(30_000);
    expect(snap.goals[0].saved).toBe(0);
  });
});

describe('income split', () => {
  const base = () => makeSettings({ openingDate: '2026-09-14T09:00', estDailySpend: 300 });

  it('saves 15% of an allowance when there is plenty of runway', () => {
    const snap = snapshot({
      settings: { ...base(), openingBalance: 25_000 },
      txns: [],
      fixedCosts: [rent()],
      goals: [],
      now: NOW,
    });
    const split = splitIncome(snap, 10_000, 'allowance');
    expect(split.toReserve).toBe(0);
    expect(split.save).toBe(1_500);
    expect(split.toSpend).toBe(8_500);
  });

  it('tops up rent first, then applies the runway guardrail', () => {
    // Balance 8,000 with 12,000 rent due → 4,000 short. 15,000 arrives.
    const snap = snapshot({
      settings: { ...base(), openingBalance: 8_000 },
      txns: [],
      fixedCosts: [rent()],
      goals: [],
      now: NOW,
    });
    const split = splitIncome(snap, 15_000, 'allowance');
    expect(split.toReserve).toBe(4_000);
    // Wanted 15% of 11,000 = 1,650, but only 11,000 − 21×300 = 4,700 is spare, so 1,650 stands.
    expect(split.save).toBe(1_650);
    expect(split.runwayAfter).toBeGreaterThanOrEqual(21);
  });

  it('shrinks or skips savings when money is tight', () => {
    const snap = snapshot({
      settings: { ...base(), openingBalance: 12_000 },
      txns: [],
      fixedCosts: [rent()],
      goals: [],
      now: NOW,
    });
    const split = splitIncome(snap, 6_000, 'windfall'); // spendable 0 → 6,000 < 21 × 300
    expect(split.save).toBe(0);
    expect(split.reasons.join(' ')).toMatch(/Skipping savings/);
  });

  it('saves half a windfall and nothing from refunds', () => {
    const snap = snapshot({
      settings: { ...base(), openingBalance: 40_000 },
      txns: [],
      fixedCosts: [rent()],
      goals: [],
      now: NOW,
    });
    expect(splitIncome(snap, 3_000, 'windfall').save).toBe(1_500);
    expect(splitIncome(snap, 3_000, 'refund').save).toBe(0);
  });
});

describe('sweep', () => {
  it('suggests sweeping surplus only when well ahead of pace', () => {
    const settings = makeSettings({ openingDate: '2026-09-14T09:00', estDailySpend: 300 });
    const rich = snapshot({ settings: { ...settings, openingBalance: 40_000 }, txns: [], fixedCosts: [rent()], goals: [], now: NOW });
    // spendable 28,000; needed 300×30×1.1 = 9,900; surplus 18,100 → half, floored to 100
    expect(sweepSuggestion(rich)).toEqual({ amount: 9_000, surplus: 18_100 });
    const ok = snapshot({ settings: { ...settings, openingBalance: 22_000 }, txns: [], fixedCosts: [rent()], goals: [], now: NOW });
    expect(sweepSuggestion(ok)).toBeNull();
  });
});
