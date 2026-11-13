const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(): string {
  return toISODate(new Date());
}

/** "2026-11" for a YYYY-MM-DD date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function currentMonth(): string {
  return monthOf(today());
}

/** Shift a YYYY-MM month key by `delta` months. */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthLabel(month: string, short = false): string {
  const [y, m] = month.split('-').map(Number);
  return short ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${y}`;
}

export function dayLabel(date: string): string {
  if (date === today()) return 'Today';
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (date === toISODate(y)) return 'Yesterday';
  const [yr, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${yr}`;
}

function valid(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return toISODate(dt);
}

/**
 * Parse dates as they appear in Indian bank statements and spreadsheets:
 * 2026-11-13, 13/11/2026, 13-11-2026, 13.11.26, 13 Nov 2026, 13-Nov-26.
 * Numeric dates are read day-first. Returns null if not a date.
 */
export function parseDate(input: string): string | null {
  const s = input.trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) return valid(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/,]+(\d{2,4})$/);
  if (m) {
    const idx = MONTHS.findIndex((x) => x.toLowerCase() === m![2].toLowerCase());
    if (idx >= 0) return valid(+m[3], idx + 1, +m[1]);
  }
  return null;
}
