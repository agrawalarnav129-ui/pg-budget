import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(' ');
}

export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={cx(
        'block w-full rounded-2xl bg-card text-left shadow-[0_1px_0_var(--line)]',
        !/(^|\s)p-\d/.test(className ?? '') && 'p-4',
        onClick && 'active:opacity-80',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-end justify-between px-1">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">{children}</h2>
      {action}
    </div>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'primary',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold transition active:scale-[0.98] disabled:opacity-40',
        variant === 'primary' && 'bg-accent text-accent-ink',
        variant === 'secondary' && 'bg-card-2 text-ink',
        variant === 'ghost' && 'text-accent',
        variant === 'danger' && 'bg-critical/10 text-critical',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  full,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  full?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="animate-fade absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className={cx(
          'animate-sheet pb-safe relative mx-auto flex w-full max-w-lg flex-col rounded-t-3xl bg-bg',
          full ? 'h-[94dvh]' : 'max-h-[94dvh]',
        )}
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <div className="w-16" />
          <div className="h-1.5 w-10 rounded-full bg-line" />
          <button onClick={onClose} className="w-16 text-right text-[15px] font-medium text-accent">
            Close
          </button>
        </div>
        {title && <h2 className="px-5 pb-2 text-xl font-bold">{title}</h2>}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cx('flex rounded-xl bg-card-2 p-1', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'min-h-9 flex-1 rounded-lg px-2 text-[14px] font-semibold transition',
            value === o.value ? 'bg-card text-ink shadow-sm' : 'text-ink-2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block px-1 text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block px-1 text-[12px] text-ink-3">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full min-h-11 rounded-xl border border-line bg-card px-3 text-ink outline-none focus:border-accent placeholder:text-ink-3';

export function MoneyInput({
  value,
  onChange,
  placeholder = '0',
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">₹</span>
      <input
        inputMode="decimal"
        autoFocus={autoFocus}
        className={cx(inputClass, 'pl-7 tabular')}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
      />
    </div>
  );
}

export function ProgressBar({ value, max, color = 'var(--accent)' }: { value: number; max: number; color?: string }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-card-2" role="progressbar" aria-valuenow={Math.round(w)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

const STATUS = {
  good: { icon: '✓', label: 'Good', color: 'var(--good)' },
  neutral: { icon: '•', label: 'Tip', color: 'var(--accent)' },
  warning: { icon: '!', label: 'Watch', color: 'var(--warning)' },
  serious: { icon: '!', label: 'High', color: 'var(--serious)' },
  critical: { icon: '✕', label: 'Urgent', color: 'var(--critical)' },
} as const;

export type StatusTone = keyof typeof STATUS;

/** Status colour is never used alone: always an icon plus a text label. */
export function StatusBadge({ tone, label }: { tone: StatusTone; label?: string }) {
  const s = STATUS[tone];
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-2">
      <span
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
        style={{ background: s.color }}
        aria-hidden
      >
        {s.icon}
      </span>
      {label ?? s.label}
    </span>
  );
}

export function EmptyState({ emoji, title, body, action }: { emoji: string; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 text-4xl" aria-hidden>
        {emoji}
      </div>
      <p className="text-[17px] font-semibold">{title}</p>
      <p className="mt-1 text-[14px] text-ink-2">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function parseMoney(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
