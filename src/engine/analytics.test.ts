import { describe, expect, it } from 'vitest';
import { buildReport, categoryAlerts, findLeaks, lastNDays, previousPeriod, weekdayPattern } from './analytics';
import { expense, typicalMonth } from './fixtures';

const TODAY = '2026-09-14';

describe('periods', () => {
  it('computes the previous period of equal length', () => {
    const p = lastNDays(TODAY, 7);
    expect(p).toEqual({ start: '2026-09-08', end: '2026-09-14' });
    expect(previousPeriod(p)).toEqual({ start: '2026-09-01', end: '2026-09-07' });
  });
});

describe('report', () => {
  const report = buildReport(typicalMonth(), lastNDays(TODAY, 30));

  it('ranks categories by spend with shares summing to 100', () => {
    expect(report.categories[0].categoryId).toBe('delivery');
    const share = report.categories.reduce((s, c) => s + c.share, 0);
    expect(share).toBeCloseTo(100);
  });

  it('finds late-night orders and weekend-heavy spending', () => {
    expect(report.lateNight.count).toBe(15);
    expect(report.weekday.weekendAvg).toBeGreaterThan(report.weekday.weekdayAvg);
  });

  it('writes a plain-language summary', () => {
    expect(report.summary[0]).toMatch(/^You spent ₹/);
    expect(report.summary.join(' ')).toMatch(/delivery/);
  });

  it('splits needs and wants', () => {
    const { needs, wants } = report.needsWants;
    expect(needs + wants).toBeCloseTo(report.total);
    expect(wants).toBeGreaterThan(needs);
  });
});

describe('leaks', () => {
  it('detects frequent small spends and delivery habits', () => {
    const leaks = findLeaks(typicalMonth(), lastNDays(TODAY, 30), 150);
    const kinds = leaks.map((l) => l.kind);
    expect(kinds).toContain('small-spends'); // 30 × ₹30 chai = ₹900
    expect(kinds).toContain('delivery-frequency'); // 15 orders/month
    const delivery = leaks.find((l) => l.kind === 'delivery-frequency')!;
    // (15 − 8) orders × ₹280 × 0.6 = 1,176 → floored to 1,100
    expect(delivery.potentialSaving).toBe(1_100);
  });

  it('ignores a handful of small spends', () => {
    const few = [1, 2, 3].map((d) => expense(`2026-09-0${d}T10:00`, 40, 'food_out'));
    expect(findLeaks(few, lastNDays(TODAY, 30))).toEqual([]);
  });
});

describe('weekday pattern', () => {
  it('averages per calendar day including zero days', () => {
    const p = { start: '2026-09-07', end: '2026-09-13' }; // Mon..Sun
    const txns = [expense('2026-09-12T10:00', 700, 'outings')]; // Saturday
    const w = weekdayPattern(txns, p);
    expect(w.avgByWeekday[6]).toBe(700);
    expect(w.weekendAvg).toBe(350);
    expect(w.weekdayAvg).toBe(0);
  });
});

describe('alerts', () => {
  it('flags a category well above its usual week', () => {
    const base = typicalMonth();
    const spree = [1, 2, 3].map((i) => expense(`2026-09-1${i}T20:00`, 900, 'shopping'));
    const prior = [
      expense('2026-08-20T12:00', 300, 'shopping'),
      expense('2026-08-27T12:00', 300, 'shopping'),
    ];
    const alerts = categoryAlerts([...base, ...prior, ...spree], TODAY);
    expect(alerts.some((a) => a.categoryId === 'shopping' && a.severity === 'serious')).toBe(true);
    expect(alerts.some((a) => a.categoryId === 'delivery')).toBe(true); // delivery > 50% of food
  });
});
