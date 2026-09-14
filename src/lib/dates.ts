/** Local-time date helpers. Everything works on 'YYYY-MM-DD' / 'YYYY-MM-DDTHH:mm' strings. */

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toLocalDateTime(d: Date): string {
  return `${toDateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm' as local time. */
export function parseLocal(s: string): Date {
  const [datePart, timePart = '00:00'] = s.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0);
}

export function dateKeyOf(s: string): string {
  return s.slice(0, 10);
}

export function addDays(key: string, days: number): string {
  const d = parseLocal(key);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

/** Whole calendar days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  const da = parseLocal(dateKeyOf(a));
  const db = parseLocal(dateKeyOf(b));
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** The date in a given month for a due day, clamped to month length (31 → 30 Sep). */
export function dueDateIn(year: number, monthIndex: number, dueDay: number): string {
  const y = year + Math.floor(monthIndex / 12);
  const m = ((monthIndex % 12) + 12) % 12;
  return toDateKey(new Date(y, m, Math.min(dueDay, daysInMonth(y, m))));
}

/** Advance a due date by whole months keeping the intended due day. */
export function addMonthsDue(key: string, months: number, dueDay: number): string {
  const d = parseLocal(key);
  return dueDateIn(d.getFullYear(), d.getMonth() + months, dueDay);
}

export function isWeekend(key: string): boolean {
  const day = parseLocal(key).getDay();
  return day === 0 || day === 6;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** '1 Oct' */
export function formatShortDate(key: string): string {
  const d = parseLocal(key);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** '1 Oct', or '1 Oct 2027' when not in the same year as `today`. */
export function formatEtaDate(key: string, today: string): string {
  return key.slice(0, 4) === today.slice(0, 4) ? formatShortDate(key) : `${formatShortDate(key)} ${key.slice(0, 4)}`;
}

/** 'Tue, 1 Oct' */
export function formatDayLabel(key: string): string {
  const d = parseLocal(key);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function formatTime(s: string): string {
  const d = parseLocal(s);
  const h = d.getHours() % 12 || 12;
  return `${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'am' : 'pm'}`;
}
