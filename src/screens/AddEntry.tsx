import { useMemo, useState } from 'react';
import { Button, Card, Field, Segmented, Sheet, cx, inputClass } from '../components/ui';
import { CATEGORIES, INCOME_SOURCES } from '../domain/categories';
import type { IncomeSource } from '../domain/types';
import { addExpense, addIncome, moveToSavings, updateSettings, withdrawFromSavings } from '../db/actions';
import type { AppData } from '../db/hooks';
import { splitIncome, type IncomeSplit, type Snapshot } from '../engine/planner';
import { addDays, dateKeyOf, toLocalDateTime } from '../lib/dates';
import { rupees } from '../lib/money';

export type EntryMode = 'expense' | 'income' | 'save';

export default function AddEntry({
  data,
  snap,
  initialMode,
  onClose,
}: {
  data: AppData;
  snap: Snapshot;
  initialMode: EntryMode;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<EntryMode>(initialMode);
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [source, setSource] = useState<IncomeSource>('allowance');
  const [saveDir, setSaveDir] = useState<'in' | 'out'>('in');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(() => toLocalDateTime(new Date()));
  const [showDate, setShowDate] = useState(false);
  const [split, setSplit] = useState<IncomeSplit | null>(null);
  const [nextIncome, setNextIncome] = useState('');

  const value = Number(amount) || 0;

  // Most-used categories first (last 60 days), so the usual taps are closest to the thumb.
  const categories = useMemo(() => {
    const since = addDays(snap.today, -60);
    const counts = new Map<string, number>();
    for (const t of data.txns) {
      if (t.type === 'expense' && t.fixedCostId == null && dateKeyOf(t.date) >= since && t.categoryId) {
        counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
      }
    }
    return [...CATEGORIES]
      .filter((c) => c.id !== 'rent')
      .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
  }, [data.txns, snap.today]);

  const press = (k: string) => {
    setAmount((a) => {
      if (k === '⌫') return a.slice(0, -1);
      if (k === '.') return a.includes('.') ? a : (a || '0') + '.';
      if (a.includes('.') && a.split('.')[1].length >= 2) return a;
      if (a.replace('.', '').length >= 7) return a;
      return a === '0' ? k : a + k;
    });
  };

  const submit = async () => {
    if (value <= 0) return;
    if (mode === 'expense') {
      if (!categoryId) return;
      await addExpense({ amount: value, categoryId, note, date });
      onClose();
    } else if (mode === 'income') {
      const s = splitIncome(snap, value, source);
      await addIncome({ amount: value, source, note, date });
      setSplit(s);
    } else {
      if (saveDir === 'in') await moveToSavings(value, note || undefined);
      else await withdrawFromSavings(value, note || undefined);
      onClose();
    }
  };

  const disabled =
    value <= 0 ||
    (mode === 'expense' && !categoryId) ||
    (mode === 'save' && saveDir === 'out' && value > snap.pot) ||
    (mode === 'save' && saveDir === 'in' && value > Math.max(0, snap.balance));

  // ---- Income split result -------------------------------------------------
  if (split) {
    return (
      <Sheet open onClose={onClose} title={`${rupees(split.amount)} received`}>
        <p className="mb-4 px-1 text-[15px] text-ink-2">Here's how to use it. Save first, before any of it gets spent.</p>
        <Card className="space-y-3">
          {split.toReserve > 0 && <SplitRow label="Set aside for bills" value={split.toReserve} color="var(--ink-3)" />}
          <SplitRow label="Move to savings" value={split.save} color="var(--accent)" strong />
          <SplitRow label="Spending money" value={split.toSpend} color="var(--series-1)" />
          <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {[
              [split.toReserve, 'var(--ink-3)'],
              [split.save, 'var(--accent)'],
              [split.toSpend, 'var(--series-1)'],
            ]
              .filter(([v]) => (v as number) > 0)
              .map(([v, c], i) => (
                <div key={i} style={{ flex: v as number, background: c as string }} />
              ))}
          </div>
          <ul className="space-y-1 pt-1 text-[13px] text-ink-2">
            {split.reasons.map((r) => (
              <li key={r}>• {r}</li>
            ))}
            {split.runwayAfter !== Infinity && (
              <li>• Your spending money will then last about {Math.floor(split.runwayAfter)} days.</li>
            )}
          </ul>
        </Card>

        <div className="mt-4">
          <Field label="When do you expect money next? (optional)" hint="Your daily limit makes this money last until then.">
            <input
              type="date"
              className={inputClass}
              min={addDays(snap.today, 1)}
              value={nextIncome}
              onChange={(e) => setNextIncome(e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-5 space-y-2">
          {split.save > 0 && (
            <Button
              className="w-full"
              onClick={async () => {
                await moveToSavings(split.save, `Saved from ${rupees(split.amount)} received`);
                await updateSettings({ nextIncomeDate: nextIncome || undefined });
                onClose();
              }}
            >
              I moved {rupees(split.save)} to savings
            </Button>
          )}
          <Button
            variant="secondary"
            className="w-full"
            onClick={async () => {
              await updateSettings({ nextIncomeDate: nextIncome || undefined });
              onClose();
            }}
          >
            {split.save > 0 ? 'Skip saving this time' : 'Done'}
          </Button>
        </div>
      </Sheet>
    );
  }

  // ---- Entry form ------------------------------------------------------------
  return (
    <Sheet open onClose={onClose} full>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'expense', label: 'Spent' },
          { value: 'income', label: 'Money in' },
          { value: 'save', label: 'Savings' },
        ]}
      />

      <div className="pb-2 pt-3 text-center" aria-live="polite">
        <span className={cx('text-[52px] font-bold leading-tight tracking-tight', !amount && 'text-ink-3')}>₹{amount || '0'}</span>
        {/* Fixed-height hint line so the layout never jumps under your thumb */}
        <p className="h-5 text-[13px]">
          {mode === 'expense' && value > 0 && value > snap.safeToday && snap.safeToday >= 0 && (
            <span className="font-medium text-critical">More than today's safe limit of {rupees(snap.safeToday)}</span>
          )}
          {mode === 'save' && (
            <span className="text-ink-3">
              Savings {rupees(snap.pot)} · Spending money {rupees(snap.balance)}
            </span>
          )}
        </p>
      </div>

      {mode === 'expense' && (
        <div className="no-scrollbar -mx-4 grid auto-cols-[92px] grid-flow-col grid-rows-2 gap-2 overflow-x-auto px-4 pb-1">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoryId(c.id)}
              aria-pressed={categoryId === c.id}
              className={cx(
                'flex h-[72px] flex-col items-center justify-center gap-1 rounded-2xl px-1 text-center text-[11px] font-medium leading-tight',
                categoryId === c.id ? 'bg-accent text-accent-ink' : 'bg-card text-ink-2',
              )}
            >
              <span className="text-[22px]" aria-hidden>
                {c.emoji}
              </span>
              {c.name}
            </button>
          ))}
        </div>
      )}

      {mode === 'income' && (
        <div className="grid grid-cols-3 gap-2">
          {INCOME_SOURCES.map((s) => (
            <button
              key={s.id}
              onClick={() => setSource(s.id)}
              aria-pressed={source === s.id}
              className={cx(
                'flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-2xl px-2 text-[12px] font-medium leading-tight',
                source === s.id ? 'bg-accent text-accent-ink' : 'bg-card text-ink-2',
              )}
            >
              <span className="text-[22px]" aria-hidden>
                {s.emoji}
              </span>
              {s.name}
            </button>
          ))}
        </div>
      )}

      {mode === 'save' && (
        <Segmented
          value={saveDir}
          onChange={setSaveDir}
          options={[
            { value: 'in', label: 'Put into savings' },
            { value: 'out', label: 'Take out' },
          ]}
        />
      )}

      <div className="mt-3 flex gap-2">
        <input
          className={cx(inputClass, 'flex-1')}
          placeholder={mode === 'expense' ? 'Note (e.g. Swiggy, auto to college)' : 'Note (optional)'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          enterKeyHint="done"
        />
        {mode !== 'save' && (
          <button
            className={cx('min-h-11 rounded-xl px-3 text-[14px] font-medium', showDate ? 'bg-accent-soft text-accent' : 'bg-card text-ink-2')}
            onClick={() => setShowDate((s) => !s)}
          >
            {dateKeyOf(date) === snap.today ? 'Today' : dateKeyOf(date).slice(5)}
          </button>
        )}
      </div>
      {showDate && mode !== 'save' && (
        <input
          type="datetime-local"
          className={cx(inputClass, 'mt-2')}
          value={date}
          max={toLocalDateTime(new Date())}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
      )}

      <div className="mt-3 grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => (
          <button
            key={k}
            onClick={() => press(k)}
            aria-label={k === '⌫' ? 'Delete' : k}
            className="h-14 rounded-2xl bg-card text-[24px] font-medium active:bg-card-2"
          >
            {k}
          </button>
        ))}
      </div>

      <Button className="mt-3 w-full min-h-13 text-[17px]" disabled={disabled} onClick={submit}>
        {mode === 'expense'
          ? categoryId
            ? `Add ${rupees(value)}`
            : 'Pick a category'
          : mode === 'income'
            ? `Record ${rupees(value)} received`
            : saveDir === 'in'
              ? `Save ${rupees(value)}`
              : `Take out ${rupees(value)}`}
      </Button>
    </Sheet>
  );
}

function SplitRow({ label, value, color, strong }: { label: string; value: number; color: string; strong?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-3 w-3 rounded-full" style={{ background: color }} aria-hidden />
      <span className={cx('flex-1 text-[15px]', strong && 'font-semibold')}>{label}</span>
      <span className={cx('tabular text-[16px]', strong ? 'font-bold' : 'font-semibold')}>{rupees(value)}</span>
    </div>
  );
}
