/**
 * Small, dependency-free SVG/HTML charts.
 * Thin marks, rounded data ends anchored to the baseline, hairline grid,
 * tap/hover tooltips, and a table twin for every plotted chart.
 */
import { useState } from 'react';
import { getCategory } from '../domain/categories';
import type { CategoryRow, DayTotal } from '../engine/analytics';
import { WEEKDAYS, formatDayLabel, formatShortDate } from '../lib/dates';
import { rupees, rupeesCompact } from '../lib/money';
import { cx } from './ui';

// ---------------------------------------------------------------------------
// Ranked category bars (one series → one colour)

export function CategoryBars({ rows, limit = 8 }: { rows: CategoryRow[]; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, limit);
  const max = rows[0]?.total ?? 0;
  return (
    <div>
      <ul className="space-y-3.5">
        {shown.map((r) => {
          const c = getCategory(r.categoryId);
          return (
            <li key={r.categoryId}>
              <div className="flex items-baseline gap-2">
                <span aria-hidden>{c.emoji}</span>
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{c.name}</span>
                <span className="tabular text-[15px] font-semibold">{rupees(r.total)}</span>
                <span className="tabular w-10 text-right text-[13px] text-ink-3">{Math.round(r.share)}%</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1.5 flex-1">
                  <div
                    className="h-full rounded-r-[4px]"
                    style={{ width: `${Math.max(1.5, (r.total / max) * 100)}%`, background: 'var(--series-1)' }}
                  />
                </div>
                <span className="w-24 text-right text-[12px] text-ink-3">
                  {r.count}× {r.change == null ? '' : `· ${r.change >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(r.change))}%`}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {rows.length > limit && (
        <button className="mt-3 text-[14px] font-medium text-accent" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less' : `Show all ${rows.length} categories`}
        </button>
      )}
      <p className="mt-3 text-[12px] text-ink-3">▲▼ compared with the previous period of the same length.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Two-part split bar (needs vs wants)

export function SplitBar({ parts }: { parts: Array<{ label: string; value: number; color: string; note?: string }> }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return null;
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px]" role="img" aria-label={parts.map((p) => `${p.label} ${rupees(p.value)}`).join(', ')}>
        {parts
          .filter((p) => p.value > 0)
          .map((p, i, arr) => (
            <div
              key={p.label}
              style={{ flex: p.value, background: p.color }}
              className={cx(i === 0 && 'rounded-l-[4px]', i === arr.length - 1 && 'rounded-r-[4px]')}
            />
          ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {parts.map((p) => (
          <div key={p.label}>
            <div className="flex items-center gap-1.5 text-[13px] text-ink-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} aria-hidden />
              {p.label}
            </div>
            <p className="mt-0.5 text-[17px] font-bold">
              {rupees(p.value)} <span className="text-[13px] font-medium text-ink-3">{Math.round((p.value / total) * 100)}%</span>
            </p>
            {p.note && <p className="text-[12px] text-ink-3">{p.note}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vertical bar chart with tap tooltip

interface BarDatum {
  key: string;
  label: string;
  value: number;
  tooltip: string;
}

export function BarChart({
  data,
  height = 150,
  reference,
  xTicks,
  ariaLabel,
}: {
  data: BarDatum[];
  height?: number;
  reference?: { value: number; label: string };
  xTicks: (d: BarDatum, i: number) => string | null;
  ariaLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const W = 340;
  const padL = 36;
  const padB = 20;
  const padT = 8;
  const plotH = height - padB - padT;
  const plotW = W - padL - 4;
  const rawMax = Math.max(1, ...data.map((d) => d.value), reference?.value ?? 0);
  const step = niceStep(rawMax / 3);
  const max = Math.ceil(rawMax / step) * step;
  const slot = plotW / data.length;
  const barW = Math.max(2, Math.min(22, slot - 2));
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const ticks = [0, step, step * 2, step * 3].filter((t) => t <= max);
  const act = active != null ? data[active] : null;

  return (
    <div className="relative select-none">
      <div className="h-6 text-[13px]" aria-live="polite">
        {act ? (
          <span>
            <span className="text-ink-2">{act.tooltip}</span> <span className="font-semibold">{rupees(act.value)}</span>
          </span>
        ) : (
          <span className="text-ink-3">Tap a bar for details</span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full overflow-visible" role="img" aria-label={ariaLabel} onMouseLeave={() => setActive(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="var(--ink-3)" className="tabular">
              {rupeesCompact(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * slot + (slot - barW) / 2;
          const h = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * plotH);
          const r = Math.min(4, barW / 2, h);
          const top = padT + plotH - h;
          const isActive = active === i;
          return (
            <g key={d.key}>
              {h > 0 && (
                <path
                  d={`M${x},${padT + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${padT + plotH} Z`}
                  fill="var(--series-1)"
                  opacity={active == null || isActive ? 1 : 0.35}
                />
              )}
              {/* Oversized hit target */}
              <rect
                x={padL + i * slot}
                y={padT}
                width={slot}
                height={plotH + padB}
                fill="transparent"
                onMouseEnter={() => setActive(i)}
                onClick={() => setActive(isActive ? null : i)}
              />
              {xTicks(d, i) && (
                <text x={x + barW / 2} y={height - 5} textAnchor="middle" fontSize={10} fill="var(--ink-3)">
                  {xTicks(d, i)}
                </text>
              )}
            </g>
          );
        })}
        {reference && reference.value > 0 && (
          <g>
            <line x1={padL} x2={W} y1={y(reference.value)} y2={y(reference.value)} stroke="var(--ink-2)" strokeWidth={1} opacity={0.7} />
            <text x={W} y={y(reference.value) - 4} textAnchor="end" fontSize={10} fill="var(--ink-2)">
              {reference.label}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

function niceStep(raw: number): number {
  const mag = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

export function DailyChart({ series, average }: { series: DayTotal[]; average: number }) {
  const n = series.length;
  const every = n <= 7 ? 1 : n <= 31 ? 7 : 14;
  return (
    <>
      <BarChart
        ariaLabel="Spending per day"
        data={series.map((d) => ({
          key: d.date,
          label: formatShortDate(d.date),
          value: d.total,
          tooltip: formatDayLabel(d.date),
        }))}
        reference={{ value: average, label: `avg ${rupees(average)}` }}
        xTicks={(d, i) => (n <= 7 ? WEEKDAYS[new Date(`${d.key}T12:00`).getDay()] : i % every === 0 ? d.label : null)}
      />
      <TableTwin
        caption="Spending per day"
        headers={['Day', 'Spent']}
        rows={series.filter((d) => d.total > 0).map((d) => [formatDayLabel(d.date), rupees(d.total)])}
      />
    </>
  );
}

export function WeekdayChart({ averages }: { averages: number[] }) {
  // Monday-first reads more naturally for a college week.
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <>
      <BarChart
        height={130}
        ariaLabel="Average spending by day of week"
        data={order.map((d) => ({
          key: String(d),
          label: WEEKDAYS[d],
          value: averages[d],
          tooltip: `Average ${WEEKDAYS[d]}`,
        }))}
        xTicks={(d) => d.label}
      />
      <TableTwin caption="Average by weekday" headers={['Day', 'Average']} rows={order.map((d) => [WEEKDAYS[d], rupees(averages[d])])} />
    </>
  );
}

export function TableTwin({ caption, headers, rows }: { caption: string; headers: string[]; rows: string[][] }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[13px] font-medium text-accent">View as table</summary>
      <div className="mt-2 max-h-64 overflow-auto">
        <table className="tabular w-full text-[13px]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="text-left text-ink-3">
              {headers.map((h, i) => (
                <th key={h} className={cx('py-1 font-medium', i > 0 && 'text-right')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.join('|')} className="border-t border-line">
                {r.map((c, i) => (
                  <td key={i} className={cx('py-1', i > 0 && 'text-right')}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
