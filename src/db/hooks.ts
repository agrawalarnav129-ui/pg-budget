import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { snapshot, type Snapshot } from '../engine/planner';
import type { FixedCost, Goal, MerchantRule, Settings, Transaction } from '../domain/types';
import { toLocalDateTime } from '../lib/dates';
import { db, defaultSettings } from './schema';

export interface AppData {
  settings: Settings;
  txns: Transaction[];
  fixedCosts: FixedCost[];
  goals: Goal[];
  rules: MerchantRule[];
}

/** Live view of the whole database; small enough (a few thousand rows a year) to keep in memory. */
export function useAppData(): AppData | undefined {
  return useLiveQuery(async () => {
    const [settings, txns, fixedCosts, goals, rules] = await Promise.all([
      db.settings.get('main'),
      db.transactions.orderBy('date').reverse().toArray(),
      db.fixedCosts.toArray(),
      db.goals.toArray(),
      db.merchantRules.toArray(),
    ]);
    return { settings: settings ?? defaultSettings(), txns, fixedCosts, goals, rules };
  });
}

/** Current local time, refreshed every minute so "today" rolls over at midnight. */
export function useNow(): string {
  const [now, setNow] = useState(() => toLocalDateTime(new Date()));
  useEffect(() => {
    const tick = () => setNow(toLocalDateTime(new Date()));
    const id = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return now;
}

export function useSnapshot(data: AppData | undefined, now: string): Snapshot | undefined {
  return useMemo(
    () =>
      data && data.settings.onboarded
        ? snapshot({ settings: data.settings, txns: data.txns, fixedCosts: data.fixedCosts, goals: data.goals, now })
        : undefined,
    [data, now],
  );
}
