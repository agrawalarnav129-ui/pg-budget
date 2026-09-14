import { useMemo, useState } from 'react';
import { CategoryBars, DailyChart, SplitBar, TableTwin, WeekdayChart } from '../components/charts';
import { Button, Card, EmptyState, ProgressBar, SectionTitle, Segmented, StatusBadge, cx } from '../components/ui';
import { getCategory } from '../domain/categories';
import { moveToSavings } from '../db/actions';
import type { AppData } from '../db/hooks';
import { buildReport, lastNDays, type Period } from '../engine/analytics';
import type { Snapshot } from '../engine/planner';
import { buildSavePlan } from '../engine/savePlan';
import { formatEtaDate, formatShortDate } from '../lib/dates';
import { rupees } from '../lib/money';

type Range = '7' | '30' | '90' | 'month';

export default function Report({ data, snap }: { data: AppData; snap: Snapshot }) {
  const [range, setRange] = useState<Range>('30');
  const period: Period = useMemo(
    () => (range === 'month' ? { start: `${snap.today.slice(0, 8)}01`, end: snap.today } : lastNDays(snap.today, Number(range))),
    [range, snap.today],
  );
  const report = useMemo(() => buildReport(data.txns, period, data.settings.smallSpendLimit), [data.txns, period, data.settings.smallSpendLimit]);
  const plan = useMemo(() => buildSavePlan(snap, data.txns), [snap, data.txns]);
  const [moved, setMoved] = useState<Set<string>>(new Set());

  const wantsNote = report.total > 0 && (report.needsWants.wants / report.total) * 100 > 30 ? 'Aim for 30% or less' : undefined;
  const topWant = report.categories.find((c) => getCategory(c.categoryId).kind === 'want');

  return (
    <div>
      <header className="px-1 pb-3 pt-2">
        <h1 className="text-[28px] font-bold">Report</h1>
        <p className="text-[13px] text-ink-3">
          {formatShortDate(period.start)} – {formatShortDate(period.end)}
        </p>
      </header>

      <Segmented
        value={range}
        onChange={setRange}
        options={[
          { value: '7', label: '7 days' },
          { value: '30', label: '30 days' },
          { value: 'month', label: 'Month' },
          { value: '90', label: '90 days' },
        ]}
      />

      {report.total === 0 ? (
        <Card className="mt-4">
          <EmptyState emoji="📊" title="No spending in this period" body="Add a few spends or import a statement to see your report." />
        </Card>
      ) : (
        <>
          {/* Summary */}
          <Card className="mt-4 p-5">
            <p className="text-[13px] font-medium text-ink-3">Spent</p>
            <p className="text-[40px] font-bold leading-tight tracking-tight">{rupees(report.total)}</p>
            <p className="text-[14px] text-ink-2">
              {rupees(report.perDay)}/day
              {report.change != null && (
                <>
                  {' · '}
                  <span className="font-semibold text-ink">
                    {report.change >= 0 ? '▲' : '▼'} {Math.abs(Math.round(report.change))}%
                  </span>{' '}
                  vs previous {report.days} days
                </>
              )}
            </p>
            <ul className="mt-4 space-y-2 border-t border-line pt-4 text-[15px] leading-snug">
              {/* First summary line restates the headline figure shown above. */}
              {report.summary.slice(1).map((s) => (
                <li key={s} className="flex gap-2">
                  <span className="text-accent" aria-hidden>
                    •
                  </span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </Card>

          {/* Where it goes */}
          <SectionTitle>Where your money goes</SectionTitle>
          <Card>
            <CategoryBars rows={report.categories} />
          </Card>

          <SectionTitle>Needs vs wants</SectionTitle>
          <Card>
            <SplitBar
              parts={[
                { label: 'Needs', value: report.needsWants.needs, color: 'var(--series-1)', note: 'Rent, mess, groceries, travel, college' },
                { label: 'Wants', value: report.needsWants.wants, color: 'var(--series-2)', note: wantsNote ?? 'Delivery, cabs, outings, shopping' },
              ]}
            />
            {topWant && (
              <p className="mt-3 border-t border-line pt-3 text-[14px] text-ink-2">
                Biggest want: <span className="font-semibold text-ink">{getCategory(topWant.categoryId).name}</span>. Cutting it by a quarter
                saves about <span className="font-semibold text-ink">{rupees((topWant.total / report.days) * 30 * 0.25)}</span> a month.
              </p>
            )}
          </Card>

          {/* Leaks */}
          {report.leaks.length > 0 && (
            <>
              <SectionTitle>Money leaks</SectionTitle>
              <div className="space-y-3">
                {report.leaks.map((l) => (
                  <Card key={l.kind + l.categoryId}>
                    <div className="flex items-start gap-3">
                      <span className="text-[26px]" aria-hidden>
                        {getCategory(l.categoryId).emoji}
                      </span>
                      <div className="flex-1">
                        <p className="text-[15px] font-semibold">{l.headline}</p>
                        <p className="mt-1 text-[14px] text-ink-2">{l.advice}</p>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}

          {/* When */}
          <SectionTitle>When you spend</SectionTitle>
          <Card>
            <p className="text-[15px] font-semibold">Spending per day</p>
            <p className="text-[13px] text-ink-2">Excludes fixed bills like rent</p>
            <DailyChart series={report.daily} average={report.variablePerDay} />
          </Card>
          <Card className="mt-3">
            <p className="text-[15px] font-semibold">Average by day of week</p>
            <p className="text-[13px] text-ink-2">
              Weekdays {rupees(report.weekday.weekdayAvg)} · Weekends {rupees(report.weekday.weekendAvg)}
            </p>
            <WeekdayChart averages={report.weekday.avgByWeekday} />
          </Card>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Card className="p-3">
              <p className="text-[12px] font-medium text-ink-3">Late-night (10pm–4am)</p>
              <p className="mt-1 text-[17px] font-bold">{rupees(report.lateNight.total)}</p>
              <p className="text-[12px] text-ink-3">{report.lateNight.count} orders/spends</p>
            </Card>
            <Card className="p-3">
              <p className="text-[12px] font-medium text-ink-3">Biggest day</p>
              <p className="mt-1 text-[17px] font-bold">{report.biggestDay ? rupees(report.biggestDay.total) : '—'}</p>
              <p className="text-[12px] text-ink-3">{report.biggestDay ? formatShortDate(report.biggestDay.date) : ''}</p>
            </Card>
          </div>

          {/* Merchants */}
          {report.merchants.length > 0 && (
            <>
              <SectionTitle>Top places</SectionTitle>
              <Card className="divide-y divide-line p-0">
                {report.merchants.map((m, i) => (
                  <div key={m.name} className="flex items-center gap-3 px-4 py-3">
                    <span className="tabular w-5 text-[13px] text-ink-3">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{m.name}</span>
                    <span className="text-[13px] text-ink-3">{m.count}×</span>
                    <span className="tabular w-20 text-right text-[15px] font-semibold">{rupees(m.total)}</span>
                  </div>
                ))}
              </Card>
            </>
          )}
        </>
      )}

      {/* Save plan: independent of the selected range */}
      <SectionTitle>Your save plan</SectionTitle>
      <div className="space-y-3">
        {plan.map((item) => (
          <Card key={item.id}>
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-accent">{item.when}</p>
              {item.tone !== 'neutral' && (
                <StatusBadge tone={item.tone} label={item.tone === 'good' ? 'Do it' : item.tone === 'warning' ? 'Watch' : 'Important'} />
              )}
            </div>
            <p className="mt-1 text-[16px] font-semibold leading-snug">{item.title}</p>
            <p className="mt-1 text-[14px] text-ink-2">{item.detail}</p>
            {item.id === 'emergency' && (
              <div className="mt-3">
                <ProgressBar value={snap.emergencySaved} max={snap.emergencyTarget} />
              </div>
            )}
            {item.amount && item.amount > 0 && (
              <Button
                className={cx('mt-3')}
                disabled={moved.has(item.id)}
                onClick={async () => {
                  await moveToSavings(item.amount!, item.id === 'weekly' ? 'Weekly under-spend saved' : 'Swept surplus to savings');
                  setMoved((s) => new Set(s).add(item.id));
                }}
              >
                {moved.has(item.id) ? 'Moved ✓' : `Move ${rupees(item.amount)} to savings`}
              </Button>
            )}
          </Card>
        ))}
        {snap.goals.length > 0 && (
          <Card>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-accent">Goals</p>
            <div className="mt-2 space-y-3">
              {snap.goals.map((g) => (
                <div key={g.goal.id}>
                  <div className="mb-1 flex justify-between text-[14px]">
                    <span className="font-semibold">{g.goal.name}</span>
                    <span className="text-ink-2">
                      {rupees(g.saved)} / {rupees(g.goal.target)}
                    </span>
                  </div>
                  <ProgressBar value={g.saved} max={g.goal.target} />
                  <p className="mt-1 text-[12px] text-ink-3">
                    {g.remaining <= 0
                      ? 'Reached 🎉'
                      : g.eta
                        ? `At ${rupees(snap.monthlySaveRate)}/month you'll get there around ${formatEtaDate(g.eta, snap.today)}.`
                        : 'Starts filling once you save regularly.'}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <Card className="mt-3">
        <p className="text-[14px] font-semibold">How these numbers work</p>
        <TableTwin
          caption="Planning rules"
          headers={['Rule', 'Value']}
          rows={[
            ['Daily spending pace', `${rupees(snap.burn.perDay)}/day (${snap.burn.basis === 'history' ? 'last 30 days' : 'still learning from your estimate'})`],
            ['Bills set aside', rupees(snap.reserve)],
            ['Allowance saved', '15% (10% once emergency fund is full)'],
            ['Windfalls saved', '50%'],
            ['Never save below', '21 days of spending money'],
            ['Emergency fund', `2 × monthly essentials ≈ ${rupees(snap.essentialsMonthly)}`],
          ]}
        />
      </Card>
      <p className="mt-4 px-2 text-center text-[12px] text-ink-3">
        Budgeting rules of thumb, not investment advice. For where to put savings, talk to a qualified advisor or your bank.
      </p>
    </div>
  );
}
