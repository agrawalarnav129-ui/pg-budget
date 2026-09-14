import { useState } from 'react';
import { Button, Card, Field, MoneyInput, cx, inputClass, parseMoney } from '../components/ui';
import { db } from '../db/schema';
import { seedDemoData } from '../db/demo';
import { dueDateIn, toDateKey, toLocalDateTime } from '../lib/dates';
import { rupees } from '../lib/money';

interface FixedDraft {
  key: string;
  name: string;
  categoryId: string;
  enabled: boolean;
  amount: string;
  dueDay: string;
  paid: boolean;
}

const today = new Date();
const defaultPaid = (dueDay: number) => today.getDate() >= dueDay;

const PRESETS: FixedDraft[] = [
  { key: 'rent', name: 'PG rent', categoryId: 'rent', enabled: true, amount: '', dueDay: '1', paid: defaultPaid(1) },
  { key: 'mess', name: 'Mess / tiffin', categoryId: 'mess', enabled: false, amount: '', dueDay: '1', paid: defaultPaid(1) },
  { key: 'pass', name: 'Train / metro pass', categoryId: 'local_travel', enabled: false, amount: '', dueDay: '1', paid: defaultPaid(1) },
  { key: 'phone', name: 'Phone recharge', categoryId: 'recharge', enabled: false, amount: '', dueDay: '5', paid: defaultPaid(5) },
  { key: 'subs', name: 'Subscriptions', categoryId: 'subscriptions', enabled: false, amount: '', dueDay: '10', paid: defaultPaid(10) },
];

const SPEND_PRESETS = [150, 250, 400, 600];

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [balance, setBalance] = useState('');
  const [savings, setSavings] = useState('');
  const [fixed, setFixed] = useState<FixedDraft[]>(PRESETS);
  const [daily, setDaily] = useState('250');
  const [nextIncome, setNextIncome] = useState('');
  const [goalName, setGoalName] = useState('');
  const [goalAmount, setGoalAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const patchFixed = (key: string, patch: Partial<FixedDraft>) =>
    setFixed((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  const finish = async () => {
    setBusy(true);
    const nowDate = new Date();
    await db.transaction('rw', [db.settings, db.fixedCosts, db.goals], async () => {
      for (const f of fixed) {
        const amount = parseMoney(f.amount);
        if (!f.enabled || amount <= 0) continue;
        const dueDay = Math.min(31, Math.max(1, Number(f.dueDay) || 1));
        const monthOffset = f.paid ? 0 : -1;
        await db.fixedCosts.add({
          name: f.name,
          amount,
          dueDay,
          categoryId: f.categoryId,
          active: true,
          lastCoveredDue: dueDateIn(nowDate.getFullYear(), nowDate.getMonth() + monthOffset, dueDay),
        });
      }
      if (goalName.trim() && parseMoney(goalAmount) > 0) {
        await db.goals.add({ name: goalName.trim(), target: parseMoney(goalAmount), createdAt: Date.now() });
      }
      await db.settings.put({
        id: 'main',
        onboarded: true,
        openingBalance: parseMoney(balance),
        openingDate: toLocalDateTime(nowDate),
        openingSavings: parseMoney(savings),
        estDailySpend: parseMoney(daily) || 250,
        nextIncomeDate: nextIncome || undefined,
        importMappings: {},
        smallSpendLimit: 150,
      });
    });
  };

  const steps = [
    // 0 — welcome
    <div key="w" className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col justify-center">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-3xl text-accent-ink" aria-hidden>
          ₹
        </div>
        <h1 className="text-[34px] font-bold leading-tight">Know where your money goes.</h1>
        <p className="mt-3 text-[17px] text-ink-2">
          Built for PG life: rent set aside first, a daily spending limit that adjusts to you, and a clear plan for when and how much
          to save, even when money comes in at random times.
        </p>
        <ul className="mt-6 space-y-3 text-[15px] text-ink-2">
          <li>🔒 Everything stays on this phone. No account needed.</li>
          <li>⚡ Add a spend in about 3 seconds.</li>
          <li>📊 Import your bank or UPI statement CSV.</li>
        </ul>
      </div>
      <Button className="w-full" onClick={() => setStep(1)}>
        Set up in 1 minute
      </Button>
      <Button
        variant="ghost"
        className="mt-2 w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await seedDemoData();
        }}
      >
        Explore with sample data first
      </Button>
    </div>,

    // 1 — money now
    <div key="m" className="space-y-5">
      <Header step={1} title="How much money do you have right now?" body="Add up your bank account, UPI wallets and cash. Leave out savings you don't touch." />
      <Field label="Spending money (bank + UPI + cash)">
        <MoneyInput value={balance} onChange={setBalance} autoFocus />
      </Field>
      <Field label="Savings already set aside (optional)" hint="Money in a separate account or kept aside that you don't spend.">
        <MoneyInput value={savings} onChange={setSavings} />
      </Field>
    </div>,

    // 2 — fixed costs
    <div key="f" className="space-y-3">
      <Header step={2} title="Your fixed monthly costs" body="These get set aside before anything counts as spendable." />
      {fixed.map((f) => (
        <Card key={f.key} className={cx('space-y-3', !f.enabled && 'opacity-70')}>
          <label className="flex items-center justify-between">
            <span className="text-[16px] font-semibold">{f.name}</span>
            <input
              type="checkbox"
              className="h-6 w-6 accent-[var(--accent)]"
              checked={f.enabled}
              onChange={(e) => patchFixed(f.key, { enabled: e.target.checked })}
            />
          </label>
          {f.enabled && (
            <>
              <div className="grid grid-cols-[1fr_96px] gap-2">
                <MoneyInput value={f.amount} onChange={(v) => patchFixed(f.key, { amount: v })} placeholder="Amount / month" />
                <select
                  className={inputClass}
                  value={f.dueDay}
                  onChange={(e) => patchFixed(f.key, { dueDay: e.target.value, paid: defaultPaid(Number(e.target.value)) })}
                  aria-label="Due day"
                >
                  {Array.from({ length: 31 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      Day {i + 1}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-[14px] text-ink-2">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[var(--accent)]"
                  checked={f.paid}
                  onChange={(e) => patchFixed(f.key, { paid: e.target.checked })}
                />
                Already paid for {today.toLocaleString('en-IN', { month: 'long' })}
              </label>
            </>
          )}
        </Card>
      ))}
    </div>,

    // 3 — pace
    <div key="p" className="space-y-5">
      <Header
        step={3}
        title="Roughly how much do you spend a day?"
        body="Food outside, travel, snacks, everything except fixed costs. It's only a starting guess and gets replaced by your real spending within 2 weeks."
      />
      <div className="grid grid-cols-4 gap-2">
        {SPEND_PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => setDaily(String(p))}
            className={cx(
              'min-h-12 rounded-xl text-[15px] font-semibold',
              daily === String(p) ? 'bg-accent text-accent-ink' : 'bg-card text-ink',
            )}
          >
            {rupees(p)}
          </button>
        ))}
      </div>
      <Field label="Or type it">
        <MoneyInput value={daily} onChange={setDaily} />
      </Field>
      <Field label="When do you expect money next? (optional)" hint="Your daily limit makes the money last until then. Leave blank to plan 30 days ahead.">
        <input type="date" className={inputClass} value={nextIncome} min={toDateKey(today)} onChange={(e) => setNextIncome(e.target.value)} />
      </Field>
    </div>,

    // 4 — goal
    <div key="g" className="space-y-5">
      <Header
        step={4}
        title="Saving for something?"
        body="Optional. Your savings build an emergency fund first (2 months of essentials), then go toward this goal."
      />
      <Field label="Goal">
        <input className={inputClass} placeholder="New laptop, Goa trip, trip home…" value={goalName} onChange={(e) => setGoalName(e.target.value)} />
      </Field>
      <Field label="Amount">
        <MoneyInput value={goalAmount} onChange={setGoalAmount} />
      </Field>
    </div>,
  ];

  const last = steps.length - 1;
  const canContinue = step !== 1 || balance.trim() !== '';

  return (
    <div className="pt-safe pb-safe mx-auto flex min-h-dvh max-w-lg flex-col px-5">
      {step > 0 && (
        <div className="flex items-center justify-between py-2">
          <button className="min-h-11 text-[16px] font-medium text-accent" onClick={() => setStep(step - 1)}>
            ‹ Back
          </button>
          <div className="flex gap-1.5" aria-label={`Step ${step} of ${last}`}>
            {Array.from({ length: last }, (_, i) => (
              <span key={i} className={cx('h-1.5 w-6 rounded-full', i < step ? 'bg-accent' : 'bg-line')} />
            ))}
          </div>
          <span className="w-14" />
        </div>
      )}
      <div className="flex flex-1 flex-col py-4">{steps[step]}</div>
      {step > 0 && (
        <div className="sticky bottom-0 bg-bg py-3">
          <Button
            className="w-full"
            disabled={!canContinue || busy}
            onClick={() => (step === last ? finish() : setStep(step + 1))}
          >
            {step === last ? (goalName ? 'Finish' : 'Skip & finish') : 'Continue'}
          </Button>
        </div>
      )}
    </div>
  );
}

function Header({ step, title, body }: { step: number; title: string; body: string }) {
  return (
    <div className="mb-2">
      <p className="text-[13px] font-semibold uppercase tracking-wide text-accent">Step {step}</p>
      <h1 className="mt-1 text-[28px] font-bold leading-tight">{title}</h1>
      <p className="mt-2 text-[15px] text-ink-2">{body}</p>
    </div>
  );
}
