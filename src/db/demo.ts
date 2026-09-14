/** Realistic sample data (60 days of a Mumbai PG student's money) for exploring the app. */
import type { FixedCost, Transaction } from '../domain/types';
import { addDays, dueDateIn, parseLocal, toDateKey, toLocalDateTime } from '../lib/dates';
import { db } from './schema';

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedDemoData() {
  const rand = rng(42);
  const between = (lo: number, hi: number, step = 10) => Math.round((lo + rand() * (hi - lo)) / step) * step;
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const at = (day: string, h: number, m = between(0, 59, 1)) => `${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  const today = toDateKey(new Date());
  const start = addDays(today, -59);
  const startDate = parseLocal(start);

  const fixedDefs: Omit<FixedCost, 'id'>[] = [
    { name: 'PG rent (with breakfast)', amount: 9_500, dueDay: 1, categoryId: 'rent', active: true, lastCoveredDue: '' },
    { name: 'Jio recharge', amount: 349, dueDay: 5, categoryId: 'recharge', active: true, lastCoveredDue: '' },
    { name: 'Spotify', amount: 139, dueDay: 12, categoryId: 'subscriptions', active: true, lastCoveredDue: '' },
  ];
  // Start with the due date just before the window as already covered.
  const fixed = fixedDefs.map((f) => ({
    ...f,
    lastCoveredDue: dueDateIn(startDate.getFullYear(), startDate.getMonth() - (startDate.getDate() >= f.dueDay ? 0 : 1), f.dueDay),
  }));

  await db.transaction('rw', [db.transactions, db.fixedCosts, db.goals, db.settings, db.merchantRules], async () => {
    await Promise.all([db.transactions.clear(), db.fixedCosts.clear(), db.goals.clear(), db.merchantRules.clear()]);
    const ids = (await db.fixedCosts.bulkAdd(fixed, { allKeys: true })) as number[];
    const txns: Transaction[] = [];
    const add = (t: Omit<Transaction, 'createdAt' | 'timeKnown'> & { timeKnown?: boolean }) =>
      txns.push({ timeKnown: true, createdAt: Date.now(), ...t });
    const spend = (day: string, h: number, amount: number, categoryId: string, merchant: string) =>
      add({ type: 'expense', amount, date: at(day, h), categoryId, note: merchant, merchant });

    for (let i = 0; i < 60; i++) {
      const day = addDays(start, i);
      const d = parseLocal(day);
      const dow = d.getDay();
      const weekend = dow === 0 || dow === 6;

      // Money in
      // Money in: allowance lands a few days before rent; one internship stipend.
      if (d.getDate() === 27) {
        add({ type: 'income', amount: 24_000, source: 'allowance', date: at(day, 10), note: 'From home' });
        add({ type: 'save', amount: 3_600, date: at(day, 10, 30), note: 'Saved 15% of allowance' });
      }
      if (i === 50) {
        add({ type: 'income', amount: 8_000, source: 'windfall', date: at(day, 17), note: 'Internship stipend' });
        add({ type: 'save', amount: 4_000, date: at(day, 17, 20), note: 'Saved half of stipend' });
      }

      // Fixed costs on their due day
      fixed.forEach((f, idx) => {
        if (d.getDate() === f.dueDay) {
          add({ type: 'expense', amount: f.amount, date: at(day, 11), categoryId: f.categoryId, note: f.name, merchant: f.name, fixedCostId: ids[idx] });
          f.lastCoveredDue = day;
        }
      });

      // Everyday spending
      const chais = weekend ? 1 : 1 + Math.floor(rand() * 2);
      for (let c = 0; c < chais; c++) spend(day, pick([10, 11, 16, 17]), between(20, 60, 5), 'food_out', pick(['College canteen', 'Tapri chai', 'Vada pav stall']));
      if (rand() < 0.32) {
        const late = rand() < 0.5;
        spend(day, late ? pick([22, 23]) : pick([13, 20]), between(170, 420), 'delivery', pick(['Swiggy', 'Zomato', 'Swiggy', 'Dominos']));
      }
      if (rand() < 0.22) spend(day, pick([12, 19, 21]), between(110, 340), 'groceries', pick(['Zepto', 'Blinkit', 'D-Mart']));
      if (!weekend) spend(day, 8, between(20, 40, 5), 'local_travel', pick(['Mumbai Metro', 'Local train', 'BEST bus']));
      if (rand() < 0.22) spend(day, pick([9, 18, 21]), between(60, 220), 'cabs', pick(['Uber', 'Rapido', 'Auto']));
      if (dow === 6 && rand() < 0.55) spend(day, 19, between(400, 1_100, 50), 'outings', pick(['PVR', 'Bandra café', 'Bowling with friends']));
      if (rand() < 0.035) spend(day, 21, between(499, 1_499, 100), 'shopping', pick(['Myntra', 'Amazon', 'Decathlon']));
      if (dow === 3) spend(day, 20, between(150, 250), 'personal', 'Laundry');
      if (rand() < 0.12) spend(day, 14, between(30, 160), 'college', pick(['Xerox', 'Stationery']));
      if (i === 20) spend(day, 7, 1_450, 'trips', 'IRCTC');
      if (i === 38) spend(day, 18, 280, 'health', 'Apollo Pharmacy');
    }

    await db.transactions.bulkAdd(txns);
    for (let idx = 0; idx < fixed.length; idx++) await db.fixedCosts.update(ids[idx], { lastCoveredDue: fixed[idx].lastCoveredDue });
    await db.goals.add({ name: 'New laptop', target: 55_000, createdAt: Date.now() });
    const now = new Date();
    const nextAllowance = toDateKey(new Date(now.getFullYear(), now.getMonth() + (now.getDate() >= 26 ? 1 : 0), 27));
    await db.settings.put({
      id: 'main',
      onboarded: true,
      nextIncomeDate: nextAllowance,
      openingBalance: 6_000,
      openingDate: toLocalDateTime(new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0)),
      openingSavings: 4_000,
      estDailySpend: 300,
      importMappings: {},
      smallSpendLimit: 150,
    });
  });
}
