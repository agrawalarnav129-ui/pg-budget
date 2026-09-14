import { useMemo, useState } from 'react';
import type { Tab } from '../App';
import { Button, Card, ProgressBar, SectionTitle, StatusBadge, cx } from '../components/ui';
import { TransactionRow } from '../components/TransactionRow';
import { moveToSavings, payFixedCost } from '../db/actions';
import type { AppData } from '../db/hooks';
import { categoryAlerts, weeklyCheckIn } from '../engine/analytics';
import { sweepSuggestion, upcomingFixedCosts, type Snapshot } from '../engine/planner';
import { formatDayLabel, formatEtaDate, formatShortDate, parseLocal } from '../lib/dates';
import { rupees } from '../lib/money';
import type { EntryMode } from './AddEntry';

const STATUS_COPY = {
  healthy: { tone: 'good', label: 'On track' },
  tight: { tone: 'warning', label: 'Tight' },
  critical: { tone: 'critical', label: 'Running low' },
} as const;

export default function Home({
  data,
  snap,
  onAdd,
  onNavigate,
}: {
  data: AppData;
  snap: Snapshot;
  onAdd: (m: EntryMode) => void;
  onNavigate: (t: Tab) => void;
}) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const alerts = useMemo(() => categoryAlerts(data.txns, snap.today).slice(0, 2), [data.txns, snap.today]);
  const sweep = sweepSuggestion(snap);
  const [dismissedSweep, setDismissedSweep] = useState(false);
  const isSunday = parseLocal(snap.today).getDay() === 0;
  const week = useMemo(() => (isSunday ? weeklyCheckIn(data.txns, snap.today) : null), [isSunday, data.txns, snap.today]);
  const status = STATUS_COPY[snap.status];
  const over = snap.safeToday < 0;
  const needsBackup =
    data.txns.length >= 20 && (!data.settings.lastBackupAt || Date.now() - data.settings.lastBackupAt > 30 * 86_400_000);
  const recent = data.txns.slice(0, 5);
  const laterBills = useMemo(
    () =>
      snap.horizon.basis === 'expected-income'
        ? upcomingFixedCosts(data.fixedCosts, snap.today, 30).filter((u) => u.due > snap.horizon.date)
        : [],
    [data.fixedCosts, snap.today, snap.horizon],
  );

  return (
    <div>
      <header className="flex items-end justify-between px-1 pb-4 pt-2">
        <div>
          <p className="text-[13px] font-medium text-ink-3">{formatDayLabel(snap.today)}</p>
          <h1 className="text-[28px] font-bold leading-tight">{greeting}</h1>
        </div>
        <StatusBadge tone={status.tone} label={status.label} />
      </header>

      {/* Hero: safe to spend today */}
      <Card className="p-5">
        <p className="text-[14px] font-medium text-ink-2">{over ? 'Over today’s limit by' : 'Safe to spend today'}</p>
        <p className={cx('mt-1 text-[48px] font-bold leading-none tracking-tight', over && 'text-critical')}>
          {rupees(Math.abs(snap.safeToday))}
        </p>
        <div className="mt-4">
          <ProgressBar
            value={snap.spentToday}
            max={snap.dailyAllowance}
            color={over ? 'var(--critical)' : snap.spentToday > snap.dailyAllowance * 0.8 ? 'var(--warning)' : 'var(--accent)'}
          />
          <div className="mt-2 flex justify-between text-[13px] text-ink-2">
            <span>Spent {rupees(snap.spentToday)}</span>
            <span>Daily limit {rupees(snap.dailyAllowance)}</span>
          </div>
        </div>
        <p className="mt-3 text-[13px] text-ink-3">
          {snap.horizon.basis === 'expected-income'
            ? `Makes your money last until ${formatShortDate(snap.horizon.date)}, when you expect more.`
            : 'Makes your money last 30 days. Set when you expect money next in Settings.'}
          {over && ' Going over today lowers your limit for the coming days.'}
        </p>
      </Card>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat label="Spending money" value={rupees(snap.balance)} />
        <Stat
          label="Lasts about"
          value={snap.runwayDays === Infinity ? '—' : `${Math.floor(snap.runwayDays)} days`}
          sub={snap.burn.basis !== 'history' ? 'still learning' : `at ${rupees(snap.burn.perDay)}/day`}
        />
        <Stat label="Saved" value={rupees(snap.pot)} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={() => onAdd('income')}>
          ＋ Money in
        </Button>
        <Button variant="secondary" onClick={() => onAdd('save')}>
          ⇢ Savings
        </Button>
      </div>

      {/* Suggestions & alerts */}
      {(sweep && !dismissedSweep) || alerts.length || week || needsBackup || snap.status === 'critical' ? (
        <SectionTitle>For you</SectionTitle>
      ) : null}
      <div className="space-y-3">
        {snap.status === 'critical' && (
          <Card>
            <StatusBadge tone="critical" label="Running low" />
            <p className="mt-2 text-[15px] font-semibold">
              {snap.spendable <= 0
                ? `After setting aside ${rupees(snap.reserve)} for bills, you have no spending money left.`
                : `Your money lasts about ${Math.floor(snap.runwayDays)} days at your current pace.`}
            </p>
            <p className="mt-1 text-[14px] text-ink-2">
              Pause saving, skip delivery and cabs this week, and let home know early if you need money before{' '}
              {formatShortDate(snap.upcoming[0]?.due ?? snap.horizon.date)}.
            </p>
          </Card>
        )}
        {sweep && !dismissedSweep && (
          <Card>
            <StatusBadge tone="good" label="Ahead of pace" />
            <p className="mt-2 text-[15px] font-semibold">Move {rupees(sweep.amount)} to savings today</p>
            <p className="mt-1 text-[14px] text-ink-2">
              You have {rupees(sweep.surplus)} more than you need to reach {formatShortDate(snap.horizon.date)}. Save half before it gets
              spent.
            </p>
            <div className="mt-3 flex gap-2">
              <Button onClick={() => moveToSavings(sweep.amount, 'Swept surplus to savings')}>Move {rupees(sweep.amount)}</Button>
              <Button variant="ghost" onClick={() => setDismissedSweep(true)}>
                Not now
              </Button>
            </div>
          </Card>
        )}
        {alerts.map((a) => (
          <Card key={a.message}>
            <StatusBadge tone={a.severity} label={a.severity === 'serious' ? 'Spending spike' : 'Heads up'} />
            <p className="mt-2 text-[15px]">{a.message}</p>
          </Card>
        ))}
        {week && week.usualWeek > 0 && (
          <Card onClick={() => onNavigate('report')}>
            <StatusBadge tone="neutral" label="Sunday check-in" />
            <p className="mt-2 text-[15px] font-semibold">
              This week: {rupees(week.thisWeek)} vs your usual {rupees(week.usualWeek)}
            </p>
            <p className="mt-1 text-[14px] text-ink-2">
              {week.thisWeek < week.usualWeek
                ? `You're ${rupees(week.usualWeek - week.thisWeek)} under. Consider moving it to savings.`
                : 'Open the report to see where the extra went ›'}
            </p>
          </Card>
        )}
        {needsBackup && (
          <Card onClick={() => onNavigate('settings')}>
            <StatusBadge tone="warning" label="Backup" />
            <p className="mt-2 text-[15px]">Your data lives only on this phone. Export a backup in Settings ›</p>
          </Card>
        )}
      </div>

      {/* Bills */}
      {data.fixedCosts.some((f) => f.active) && (
        <>
          <SectionTitle>
            Set aside for bills · {rupees(snap.reserve)}
          </SectionTitle>
          <Card className="divide-y divide-line p-0">
            {snap.upcoming.length === 0 && (
              <p className="p-4 text-[14px] text-ink-2">Nothing due before {formatShortDate(snap.horizon.date)}.</p>
            )}
            {snap.upcoming.map((u) => (
              <div key={`${u.fixedCost.id}-${u.due}`} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{u.fixedCost.name}</p>
                  <p className={cx('text-[13px]', u.daysLeft < 0 ? 'font-semibold text-critical' : 'text-ink-3')}>
                    {u.daysLeft < 0
                      ? `Overdue since ${formatShortDate(u.due)}`
                      : u.daysLeft === 0
                        ? 'Due today'
                        : `Due ${formatShortDate(u.due)} · in ${u.daysLeft} day${u.daysLeft === 1 ? '' : 's'}`}
                  </p>
                </div>
                <span className="tabular text-[15px] font-semibold">{rupees(u.fixedCost.amount)}</span>
                {u === snap.upcoming.find((x) => x.fixedCost.id === u.fixedCost.id) && (
                  <Button variant="secondary" className="min-h-9 px-3 text-[13px]" onClick={() => payFixedCost(u.fixedCost)}>
                    Paid
                  </Button>
                )}
              </div>
            ))}
            {laterBills.length > 0 && (
              <p className="px-4 py-3 text-[13px] text-ink-2">
                After {formatShortDate(snap.horizon.date)}:{' '}
                {laterBills.map((u) => `${u.fixedCost.name} ${rupees(u.fixedCost.amount)} on ${formatShortDate(u.due)}`).join(', ')}. The
                money you expect on {formatShortDate(snap.horizon.date)} needs to cover{' '}
                {laterBills.length === 1 ? 'it' : 'them'}. If it's late, these get set aside from what you have.
              </p>
            )}
            {snap.upcoming.length > 0 && (
              <p className="px-4 py-3 text-[13px] text-ink-3">
                {snap.balance >= snap.reserve
                  ? '✓ Covered. This is already taken out of your daily limit.'
                  : `✕ Short by ${rupees(snap.reserve - snap.balance)} for bills.`}
              </p>
            )}
          </Card>
        </>
      )}

      {/* Savings */}
      <SectionTitle>Savings</SectionTitle>
      <Card className="space-y-4">
        <GoalLine
          name="Emergency fund"
          sub="2 months of essentials"
          saved={snap.emergencySaved}
          target={snap.emergencyTarget}
        />
        {snap.goals.map((g) => (
          <GoalLine
            key={g.goal.id}
            name={g.goal.name}
            sub={g.remaining <= 0 ? 'Reached 🎉' : g.eta ? `~${formatEtaDate(g.eta, snap.today)} at your pace` : 'Starts after emergency fund'}
            saved={g.saved}
            target={g.goal.target}
          />
        ))}
      </Card>

      {/* Recent */}
      <SectionTitle
        action={
          <button className="text-[14px] font-medium text-accent" onClick={() => onNavigate('history')}>
            See all
          </button>
        }
      >
        Recent
      </SectionTitle>
      <Card className="p-0">
        {recent.length === 0 ? (
          <p className="p-4 text-[14px] text-ink-2">No entries yet. Tap ＋ to add your first spend.</p>
        ) : (
          <div className="divide-y divide-line">
            {recent.map((t) => (
              <TransactionRow key={t.id} txn={t} showDate />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-3">
      <p className="text-[12px] font-medium text-ink-3">{label}</p>
      <p className="mt-1 truncate text-[17px] font-bold">{value}</p>
      {sub && <p className="truncate text-[11px] text-ink-3">{sub}</p>}
    </Card>
  );
}

function GoalLine({ name, sub, saved, target }: { name: string; sub: string; saved: number; target: number }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold">{name}</p>
          <p className="text-[12px] text-ink-3">{sub}</p>
        </div>
        <p className="shrink-0 text-[14px] text-ink-2">
          <span className="font-semibold text-ink">{rupees(saved)}</span> / {rupees(target)}
        </p>
      </div>
      <ProgressBar value={saved} max={target} />
    </div>
  );
}
