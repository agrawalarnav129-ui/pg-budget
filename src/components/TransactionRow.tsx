import { INCOME_SOURCES, getCategory } from '../domain/categories';
import type { Transaction } from '../domain/types';
import { dateKeyOf, formatShortDate, formatTime } from '../lib/dates';
import { rupees } from '../lib/money';
import { cx } from './ui';

export function describe(t: Transaction): { emoji: string; title: string } {
  switch (t.type) {
    case 'expense': {
      const c = getCategory(t.categoryId);
      return { emoji: c.emoji, title: t.merchant || t.note || c.name };
    }
    case 'income': {
      const s = INCOME_SOURCES.find((x) => x.id === t.source) ?? INCOME_SOURCES[0];
      return { emoji: s.emoji, title: t.note || s.name };
    }
    case 'save':
      return { emoji: '🏦', title: t.note || 'Moved to savings' };
    case 'withdraw':
      return { emoji: '↩️', title: t.note || 'Taken from savings' };
  }
}

export function TransactionRow({ txn, showDate, onClick }: { txn: Transaction; showDate?: boolean; onClick?: () => void }) {
  const { emoji, title } = describe(txn);
  const cat = txn.type === 'expense' ? getCategory(txn.categoryId).name : txn.type === 'income' ? 'Money in' : 'Savings';
  const positive = txn.type === 'income' || txn.type === 'withdraw';
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-card-2">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card-2 text-[20px]" aria-hidden>
        {emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{title}</span>
        <span className="block truncate text-[13px] text-ink-3">
          {cat}
          {txn.fixedCostId != null && ' · bill'}
          {showDate ? ` · ${formatShortDate(dateKeyOf(txn.date))}` : txn.timeKnown ? ` · ${formatTime(txn.date)}` : ''}
        </span>
      </span>
      <span className={cx('tabular shrink-0 text-[15px] font-semibold', positive && 'text-good-ink', txn.type === 'save' && 'text-ink-2')}>
        {positive ? '+' : txn.type === 'save' ? '' : '−'}
        {rupees(txn.amount)}
      </span>
    </Tag>
  );
}
