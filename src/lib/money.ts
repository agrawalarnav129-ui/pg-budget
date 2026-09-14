const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inrPrecise = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** ₹1,23,456 (Indian grouping, whole rupees). */
export function rupees(n: number): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}₹${inr.format(Math.abs(Math.round(n)))}`;
}

export function rupeesPrecise(n: number): string {
  return `₹${inrPrecise.format(n)}`;
}

/** ₹1.2k / ₹12k / ₹1.2L for chart ticks. */
export function rupeesCompact(n: number): string {
  const a = Math.abs(n);
  if (a >= 100_000) return `₹${trim(a / 100_000)}L`;
  if (a >= 1_000) return `₹${trim(a / 1_000)}k`;
  return `₹${Math.round(a)}`;
}

const trim = (n: number) => (n >= 10 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ''));

/** Round down to a friendly multiple (default ₹50) for suggested transfers. */
export function floorTo(n: number, step = 50): number {
  return Math.max(0, Math.floor(n / step) * step);
}

export function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}
