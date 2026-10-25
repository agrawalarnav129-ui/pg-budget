import { useMemo, useState, type ReactNode } from 'react';
import { Button, Card, EmptyState, Field, MoneyInput, Segmented, Sheet, cx, inputClass, parseMoney } from '../components/ui';
import { TransactionRow } from '../components/TransactionRow';
import { CATEGORIES, INCOME_SOURCES, getCategory } from '../domain/categories';
import type { IncomeSource, Transaction } from '../domain/types';
import { deleteTransaction, updateTransaction } from '../db/actions';
import type { AppData } from '../db/hooks';
import { dateKeyOf, formatDayLabel } from '../lib/dates';
import { rupees } from '../lib/money';

type Filter = 'all' | 'expense' | 'income' | 'savings';
const PAGE = 120;

export default function History({ data, onImport }: { data: AppData; onImport: () => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [category, setCategory] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<Transaction | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.txns.filter((t) => {
      if (filter === 'expense' && t.type !== 'expense') return false;
      if (filter === 'income' && t.type !== 'income') return false;
      if (filter === 'savings' && t.type !== 'save' && t.type !== 'withdraw') return false;
      if (category && t.categoryId !== category) return false;
      if (!q) return true;
      return [t.note, t.merchant, getCategory(t.categoryId).name, String(t.amount)].some((s) => s?.toLowerCase().includes(q));
    });
  }, [data.txns, query, filter, category]);

  const groups = useMemo(() => {
    const out: Array<{ day: string; txns: Transaction[]; spent: number }> = [];
    for (const t of filtered.slice(0, limit)) {
      const day = dateKeyOf(t.date);
      let g = out[out.length - 1];
      if (!g || g.day !== day) out.push((g = { day, txns: [], spent: 0 }));
      g.txns.push(t);
      if (t.type === 'expense') g.spent += t.amount;
    }
    return out;
  }, [filtered, limit]);

  const totalSpent = filtered.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  return (
    <div>
      <header className="flex items-end justify-between px-1 pb-3 pt-2">
        <h1 className="text-[28px] font-bold">History</h1>
        <Button variant="ghost" className="px-0" onClick={onImport}>
          Import statement
        </Button>
      </header>

      <div className="sticky top-0 z-10 -mx-4 space-y-2 bg-bg/95 px-4 pb-3 pt-1 backdrop-blur">
        <input
          type="search"
          className={inputClass}
          placeholder="Search notes, merchants, amounts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Segmented
          value={filter}
          onChange={(f) => {
            setFilter(f);
            if (f !== 'expense' && f !== 'all') setCategory('');
          }}
          options={[
            { value: 'all', label: 'All' },
            { value: 'expense', label: 'Spent' },
            { value: 'income', label: 'In' },
            { value: 'savings', label: 'Savings' },
          ]}
        />
        {(filter === 'all' || filter === 'expense') && (
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            <Chip active={!category} onClick={() => setCategory('')}>
              All categories
            </Chip>
            {CATEGORIES.map((c) => (
              <Chip key={c.id} active={category === c.id} onClick={() => setCategory(category === c.id ? '' : c.id)}>
                {c.emoji} {c.name}
              </Chip>
            ))}
          </div>
        )}
        {(query || category || filter !== 'all') && (
          <p className="px-1 text-[13px] text-ink-2">
            {filtered.length} entries · {rupees(totalSpent)} spent
          </p>
        )}
      </div>

      {groups.length === 0 ? (
        <EmptyState
          emoji="🧾"
          title={data.txns.length ? 'Nothing matches' : 'No entries yet'}
          body={data.txns.length ? 'Try a different search or filter.' : 'Add spends with ＋, or import a bank statement CSV.'}
          action={!data.txns.length && <Button onClick={onImport}>Import statement</Button>}
        />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.day}>
              <div className="mb-1.5 flex justify-between px-1 text-[13px] font-semibold text-ink-3">
                <span>{formatDayLabel(g.day)}</span>
                {g.spent > 0 && <span className="tabular">{rupees(g.spent)}</span>}
              </div>
              <Card className="divide-y divide-line overflow-hidden p-0">
                {g.txns.map((t) => (
                  <TransactionRow key={t.id} txn={t} onClick={() => setEditing(t)} />
                ))}
              </Card>
            </section>
          ))}
          {filtered.length > limit && (
            <Button variant="secondary" className="w-full" onClick={() => setLimit((l) => l + PAGE)}>
              Show more
            </Button>
          )}
        </div>
      )}

      {editing && <EditSheet txn={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'min-h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-[13px] font-medium',
        active ? 'bg-accent text-accent-ink' : 'bg-card text-ink-2',
      )}
    >
      {children}
    </button>
  );
}

function EditSheet({ txn, onClose }: { txn: Transaction; onClose: () => void }) {
  const [amount, setAmount] = useState(String(txn.amount));
  const [categoryId, setCategoryId] = useState(txn.categoryId ?? 'other');
  const [source, setSource] = useState<IncomeSource>(txn.source ?? 'allowance');
  const [note, setNote] = useState(txn.note);
  const [date, setDate] = useState(txn.date);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async () => {
    const value = parseMoney(amount);
    if (value <= 0) return;
    await updateTransaction(txn.id!, {
      amount: value,
      note,
      // Manual entries use the note as merchant; imported ones keep the bank's merchant name.
      merchant: txn.importHash ? txn.merchant : note.trim() || undefined,
      date,
      ...(txn.type === 'expense' ? { categoryId } : {}),
      ...(txn.type === 'income' ? { source } : {}),
    });
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title="Edit entry">
      <div className="space-y-4">
        <Field label="Amount">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        {txn.type === 'expense' && (
          <Field label="Category">
            <select className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {txn.type === 'income' && (
          <Field label="Type">
            <select className={inputClass} value={source} onChange={(e) => setSource(e.target.value as IncomeSource)}>
              {INCOME_SOURCES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.emoji} {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Note">
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label="Date & time">
          <input type="datetime-local" className={inputClass} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </Field>
        {txn.importHash && <p className="px-1 text-[12px] text-ink-3">Imported from a statement.</p>}
        <Button className="w-full" onClick={save}>
          Save changes
        </Button>
        {confirmDelete ? (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Keep
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await deleteTransaction(txn.id!);
                onClose();
              }}
            >
              Yes, delete
            </Button>
          </div>
        ) : (
          <Button variant="danger" className="w-full" onClick={() => setConfirmDelete(true)}>
            Delete entry
          </Button>
        )}
      </div>
    </Sheet>
  );
}
