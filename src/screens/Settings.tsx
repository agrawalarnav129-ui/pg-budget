import { useEffect, useState, type ReactNode } from 'react';
import { Button, Card, Field, MoneyInput, SectionTitle, Sheet, cx, inputClass, parseMoney } from '../components/ui';
import { CATEGORIES, getCategory } from '../domain/categories';
import type { FixedCost, Goal } from '../domain/types';
import {
  eraseEverything,
  exportBackup,
  reconcileBalance,
  restoreBackup,
  transactionsToCsv,
  updateSettings,
} from '../db/actions';
import { seedDemoData } from '../db/demo';
import type { AppData } from '../db/hooks';
import { db } from '../db/schema';
import { nextDue, type Snapshot } from '../engine/planner';
import { addMonthsDue, dueDateIn, formatShortDate, toDateKey } from '../lib/dates';
import { rupees } from '../lib/money';
import { shareFile } from '../lib/share';

export default function Settings({ data, snap, onImport }: { data: AppData; snap: Snapshot; onImport: () => void }) {
  const { settings } = data;
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [fixedEdit, setFixedEdit] = useState<FixedCost | 'new' | null>(null);
  const [goalEdit, setGoalEdit] = useState<Goal | 'new' | null>(null);
  const [danger, setDanger] = useState<'erase' | 'demo' | null>(null);
  const [message, setMessage] = useState('');
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);

  const flash = (m: string) => {
    setMessage(m);
    setTimeout(() => setMessage(''), 3_000);
  };

  return (
    <div>
      <header className="px-1 pb-1 pt-2">
        <h1 className="text-[28px] font-bold">Settings</h1>
      </header>
      {message && (
        <div className="animate-fade fixed inset-x-4 top-[max(env(safe-area-inset-top),12px)] z-50 mx-auto max-w-md rounded-xl bg-ink px-4 py-3 text-center text-[14px] font-medium text-bg">
          {message}
        </div>
      )}

      <SectionTitle>Money</SectionTitle>
      <Card className="divide-y divide-line p-0">
        <Row label="Spending money" value={rupees(snap.balance)} action="Correct" onClick={() => setBalanceOpen(true)} />
        <div className="px-4 py-3">
          <Field label="Next money expected" hint="Your daily limit makes your money last until this date. Leave empty for 30 days.">
            <div className="flex gap-2">
              <input
                type="date"
                className={inputClass}
                min={snap.today}
                value={settings.nextIncomeDate && settings.nextIncomeDate > snap.today ? settings.nextIncomeDate : ''}
                onChange={(e) => updateSettings({ nextIncomeDate: e.target.value || undefined })}
              />
              {settings.nextIncomeDate && (
                <Button variant="secondary" onClick={() => updateSettings({ nextIncomeDate: undefined })}>
                  Clear
                </Button>
              )}
            </div>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 px-4 py-3">
          <Field label="Starting daily estimate" hint={snap.burn.basis === 'history' ? 'Not used any more: real data wins' : 'Used until 2 weeks of data'}>
            <NumberSetting value={settings.estDailySpend} onSave={(v) => updateSettings({ estDailySpend: v })} />
          </Field>
          <Field label="“Small spend” limit" hint="For leak detection">
            <NumberSetting value={settings.smallSpendLimit} onSave={(v) => updateSettings({ smallSpendLimit: v })} />
          </Field>
        </div>
      </Card>

      <SectionTitle
        action={
          <button className="text-[14px] font-medium text-accent" onClick={() => setFixedEdit('new')}>
            Add
          </button>
        }
      >
        Fixed monthly costs
      </SectionTitle>
      <Card className="divide-y divide-line p-0">
        {data.fixedCosts.length === 0 && <p className="p-4 text-[14px] text-ink-2">Add PG rent, mess, passes and recharges here.</p>}
        {data.fixedCosts.map((f) => (
          <Row
            key={f.id}
            label={`${getCategory(f.categoryId).emoji} ${f.name}`}
            sub={f.active ? `Day ${f.dueDay} · next ${formatShortDate(nextDue(f))}` : 'Paused'}
            value={rupees(f.amount)}
            onClick={() => setFixedEdit(f)}
          />
        ))}
      </Card>

      <SectionTitle
        action={
          <button className="text-[14px] font-medium text-accent" onClick={() => setGoalEdit('new')}>
            Add
          </button>
        }
      >
        Savings goals
      </SectionTitle>
      <Card className="divide-y divide-line p-0">
        {data.goals.length === 0 && <p className="p-4 text-[14px] text-ink-2">No goals yet. Savings build your emergency fund first.</p>}
        {data.goals.map((g) => (
          <Row key={g.id} label={g.name} value={rupees(g.target)} onClick={() => setGoalEdit(g)} />
        ))}
      </Card>

      {data.rules.length > 0 && (
        <>
          <SectionTitle>Your merchant rules</SectionTitle>
          <Card className="divide-y divide-line p-0">
            {data.rules.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{r.keyword}</span>
                <span className="text-[13px] text-ink-2">
                  {getCategory(r.categoryId).emoji} {getCategory(r.categoryId).name}
                </span>
                <button className="text-[13px] font-medium text-critical" onClick={() => db.merchantRules.delete(r.id!)}>
                  Remove
                </button>
              </div>
            ))}
          </Card>
        </>
      )}

      <SectionTitle>Your data</SectionTitle>
      <Card className="divide-y divide-line p-0">
        <Row label="Import bank / UPI statement" sub="CSV file" onClick={onImport} action="›" />
        <Row
          label="Export backup"
          sub={settings.lastBackupAt ? `Last: ${formatShortDate(toDateKey(new Date(settings.lastBackupAt)))}` : 'Never backed up'}
          action="›"
          onClick={async () => {
            const backup = await exportBackup();
            await shareFile(`pg-budget-backup-${snap.today}.json`, JSON.stringify(backup), 'application/json');
          }}
        />
        <label className="flex min-h-14 cursor-pointer items-center justify-between px-4 py-3 active:bg-card-2">
          <span>
            <span className="block text-[15px] font-medium">Restore from backup</span>
            <span className="block text-[13px] text-ink-3">Replaces everything on this phone</span>
          </span>
          <span className="text-accent">›</span>
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                await restoreBackup(JSON.parse(await file.text()));
                flash('Backup restored');
              } catch (err) {
                flash((err as Error).message || 'Could not read that file');
              }
              e.target.value = '';
            }}
          />
        </label>
        <Row
          label="Export spreadsheet"
          sub="All entries as CSV"
          action="›"
          onClick={() => shareFile(`pg-budget-${snap.today}.csv`, transactionsToCsv(data.txns), 'text/csv')}
        />
        <Row label="Load sample data" sub="Replaces your data with 60 demo days" action="›" onClick={() => setDanger('demo')} />
        <Row label="Erase everything" danger onClick={() => setDanger('erase')} />
      </Card>

      <SectionTitle>Install on iPhone</SectionTitle>
      <Card className="space-y-2 text-[14px] text-ink-2">
        <p>
          In Safari, tap <b>Share</b> → <b>Add to Home Screen</b>. It opens full-screen like an app and works offline.
        </p>
        <p>
          Your data is stored only on this device{persisted ? ' and protected from automatic clean-up' : ''}. Export a backup every month
          in case you delete Safari data or change phones.
        </p>
      </Card>
      <p className="mt-6 text-center text-[12px] text-ink-3">PG Budget · budgeting guidance, not investment advice</p>

      {balanceOpen && <BalanceSheet current={snap.balance} onClose={() => setBalanceOpen(false)} onDone={() => flash('Balance updated')} />}
      {fixedEdit && <FixedCostSheet fc={fixedEdit === 'new' ? null : fixedEdit} onClose={() => setFixedEdit(null)} />}
      {goalEdit && <GoalSheet goal={goalEdit === 'new' ? null : goalEdit} onClose={() => setGoalEdit(null)} />}
      {danger && (
        <Sheet open onClose={() => setDanger(null)} title={danger === 'erase' ? 'Erase everything?' : 'Load sample data?'}>
          <p className="mb-4 px-1 text-[15px] text-ink-2">
            {danger === 'erase'
              ? 'All entries, bills, goals and settings on this phone will be deleted. Export a backup first if you might want them.'
              : 'Your current entries, bills and goals will be replaced with 60 days of sample data.'}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setDanger(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (danger === 'erase') await eraseEverything();
                else await seedDemoData();
                setDanger(null);
              }}
            >
              {danger === 'erase' ? 'Erase' : 'Replace'}
            </Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function Row({
  label,
  sub,
  value,
  action,
  danger,
  onClick,
}: {
  label: ReactNode;
  sub?: string;
  value?: string;
  action?: string;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button onClick={onClick} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-card-2">
      <span className="min-w-0 flex-1">
        <span className={cx('block truncate text-[15px] font-medium', danger && 'text-critical')}>{label}</span>
        {sub && <span className="block truncate text-[13px] text-ink-3">{sub}</span>}
      </span>
      {value && <span className="tabular text-[15px] font-semibold">{value}</span>}
      {action && <span className="text-[14px] font-medium text-accent">{action}</span>}
    </button>
  );
}

function NumberSetting({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <MoneyInput
      value={draft}
      onChange={(v) => {
        setDraft(v);
        const n = parseMoney(v);
        if (n > 0) onSave(n);
      }}
    />
  );
}

function BalanceSheet({ current, onClose, onDone }: { current: number; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState('');
  return (
    <Sheet open onClose={onClose} title="Correct your balance">
      <p className="mb-4 px-1 text-[15px] text-ink-2">
        The app thinks you have <b>{rupees(current)}</b>. If your bank app + UPI + cash shows something different (missed entries,
        cash spends), enter the real total. Past entries stay in your reports.
      </p>
      <Field label="Actual spending money right now">
        <MoneyInput value={value} onChange={setValue} autoFocus />
      </Field>
      <Button
        className="mt-4 w-full"
        disabled={value.trim() === ''}
        onClick={async () => {
          await reconcileBalance(parseMoney(value));
          onDone();
          onClose();
        }}
      >
        Set balance
      </Button>
    </Sheet>
  );
}

function FixedCostSheet({ fc, onClose }: { fc: FixedCost | null; onClose: () => void }) {
  const today = new Date();
  const [name, setName] = useState(fc?.name ?? '');
  const [amount, setAmount] = useState(fc ? String(fc.amount) : '');
  const [dueDay, setDueDay] = useState(fc?.dueDay ?? 1);
  const [categoryId, setCategoryId] = useState(fc?.categoryId ?? 'rent');
  const [active, setActive] = useState(fc?.active ?? true);
  const [paidThisMonth, setPaidThisMonth] = useState(today.getDate() >= (fc?.dueDay ?? 1));

  const save = async () => {
    const value = parseMoney(amount);
    if (!name.trim() || value <= 0) return;
    if (fc) {
      // If the due day moved, keep the same covered month but on the new day.
      const lastCoveredDue = dueDay !== fc.dueDay ? addMonthsDue(fc.lastCoveredDue, 0, dueDay) : fc.lastCoveredDue;
      await db.fixedCosts.update(fc.id!, { name: name.trim(), amount: value, dueDay, categoryId, active, lastCoveredDue });
    } else {
      await db.fixedCosts.add({
        name: name.trim(),
        amount: value,
        dueDay,
        categoryId,
        active,
        lastCoveredDue: dueDateIn(today.getFullYear(), today.getMonth() - (paidThisMonth ? 0 : 1), dueDay),
      });
    }
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title={fc ? 'Edit fixed cost' : 'New fixed cost'}>
      <div className="space-y-4">
        <Field label="Name">
          <input className={inputClass} value={name} placeholder="PG rent, mess, train pass…" onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount per month">
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <Field label="Due on">
            <select className={inputClass} value={dueDay} onChange={(e) => setDueDay(Number(e.target.value))}>
              {Array.from({ length: 31 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  Day {i + 1}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Category">
          <select className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </select>
        </Field>
        {!fc && (
          <label className="flex items-center gap-2 px-1 text-[15px]">
            <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={paidThisMonth} onChange={(e) => setPaidThisMonth(e.target.checked)} />
            Already paid this month
          </label>
        )}
        {fc && (
          <label className="flex items-center gap-2 px-1 text-[15px]">
            <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active (uncheck to pause, e.g. during vacations)
          </label>
        )}
        <Button className="w-full" onClick={save}>
          Save
        </Button>
        {fc && (
          <Button
            variant="danger"
            className="w-full"
            onClick={async () => {
              await db.fixedCosts.delete(fc.id!);
              onClose();
            }}
          >
            Delete
          </Button>
        )}
      </div>
    </Sheet>
  );
}

function GoalSheet({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? String(goal.target) : '');
  const save = async () => {
    const value = parseMoney(target);
    if (!name.trim() || value <= 0) return;
    if (goal) await db.goals.update(goal.id!, { name: name.trim(), target: value });
    else await db.goals.add({ name: name.trim(), target: value, createdAt: Date.now() });
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={goal ? 'Edit goal' : 'New goal'}>
      <div className="space-y-4">
        <Field label="Goal">
          <input className={inputClass} value={name} placeholder="Laptop, Goa trip…" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Target amount" hint="Goals fill in the order you add them, after the emergency fund.">
          <MoneyInput value={target} onChange={setTarget} />
        </Field>
        <Button className="w-full" onClick={save}>
          Save
        </Button>
        {goal && (
          <Button
            variant="danger"
            className="w-full"
            onClick={async () => {
              await db.goals.delete(goal.id!);
              onClose();
            }}
          >
            Delete goal
          </Button>
        )}
      </div>
    </Sheet>
  );
}
