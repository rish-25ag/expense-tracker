/**
 * Date periods for the Expenses and Insights screens: a week (Monday–Sunday),
 * a calendar month, a calendar year, or a custom from–to range.
 * All dates are YYYY-MM-DD strings; ranges are inclusive.
 */
import { toISODate } from './dates.ts';

export type PeriodKind = 'week' | 'month' | 'year' | 'custom';

export interface Period {
  kind: PeriodKind;
  /** First day of the period (inclusive). */
  start: string;
  /** Last day of the period (inclusive). */
  end: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parse(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day);
}

function addDays(d: string, n: number): string {
  const x = parse(d);
  x.setDate(x.getDate() + n);
  return toISODate(x);
}

/** The period of `kind` that contains `date`. A custom period starts as that single day. */
export function periodContaining(kind: PeriodKind, date: string): Period {
  const d = parse(date);
  if (kind === 'week') {
    const offset = (d.getDay() + 6) % 7; // Monday = 0
    const start = addDays(date, -offset);
    return { kind, start, end: addDays(start, 6) };
  }
  if (kind === 'month') {
    const start = toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
    const end = toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    return { kind, start, end };
  }
  if (kind === 'year') {
    return { kind, start: `${d.getFullYear()}-01-01`, end: `${d.getFullYear()}-12-31` };
  }
  return { kind, start: date, end: date };
}

/** The next (+1) or previous (-1) period of the same kind. Custom ranges move by their own length. */
export function shiftPeriod(p: Period, delta: number): Period {
  if (p.kind === 'week') return periodContaining('week', addDays(p.start, 7 * delta));
  if (p.kind === 'month') {
    const d = parse(p.start);
    return periodContaining('month', toISODate(new Date(d.getFullYear(), d.getMonth() + delta, 1)));
  }
  if (p.kind === 'year') {
    const y = parse(p.start).getFullYear() + delta;
    return periodContaining('year', `${y}-01-01`);
  }
  const len = daysIn(p);
  return { kind: 'custom', start: addDays(p.start, len * delta), end: addDays(p.end, len * delta) };
}

/** Number of days in the period. */
export function daysIn(p: Period): number {
  return Math.round((parse(p.end).getTime() - parse(p.start).getTime()) / 86_400_000) + 1;
}

/** Days of the period up to and including `today` (for daily averages); at least 1. */
export function daysElapsed(p: Period, today: string): number {
  if (today < p.start) return 1;
  const end = today < p.end ? today : p.end;
  return Math.max(1, daysIn({ ...p, end }));
}

function short(d: string, withYear: boolean): string {
  const x = parse(d);
  return `${x.getDate()} ${MONTHS[x.getMonth()]}${withYear ? ` ${x.getFullYear()}` : ''}`;
}

/** "10–16 Nov 2026", "Nov 2026", "2026", "1 Dec 2026 – 5 Jan 2027". */
export function periodLabel(p: Period): string {
  const s = parse(p.start);
  const e = parse(p.end);
  if (p.kind === 'month') return `${MONTHS[s.getMonth()]} ${s.getFullYear()}`;
  if (p.kind === 'year') return String(s.getFullYear());
  if (p.start === p.end) return short(p.start, true);
  if (s.getFullYear() !== e.getFullYear()) return `${short(p.start, true)} – ${short(p.end, true)}`;
  if (s.getMonth() === e.getMonth()) return `${s.getDate()}–${e.getDate()} ${MONTHS[e.getMonth()]} ${e.getFullYear()}`;
  return `${short(p.start, false)} – ${short(p.end, true)}`;
}

/** Whether moving forward would start in the future. */
export function isLatest(p: Period, today: string): boolean {
  return shiftPeriod(p, 1).start > today;
}

export interface Bucket {
  key: string;
  /** Short axis label, e.g. "Mon", "12", "Nov". */
  label: string;
  /** Full label for the selected bar, e.g. "Mon 10 Nov 2026", "Nov 2026". */
  title: string;
  start: string;
  end: string;
}

function dayBucket(d: string, label: string): Bucket {
  return { key: d, label, title: short(d, true), start: d, end: d };
}

function monthBucket(year: number, month: number): Bucket {
  const p = periodContaining('month', toISODate(new Date(year, month, 1)));
  return { key: p.start.slice(0, 7), label: MONTHS[month], title: `${MONTHS[month]} ${year}`, start: p.start, end: p.end };
}

/**
 * Bars for the trend chart: a week shows its 7 days, a month the last 6 months
 * up to it, a year its 12 months, a custom range its days (up to 31) or months.
 */
export function trendBuckets(p: Period): Bucket[] {
  if (p.kind === 'week') {
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(p.start, i);
      return dayBucket(d, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i]);
    });
  }
  if (p.kind === 'month') {
    const s = parse(p.start);
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(s.getFullYear(), s.getMonth() - 5 + i, 1); // rolls over into the previous year
      return monthBucket(d.getFullYear(), d.getMonth());
    });
  }
  if (p.kind === 'year') {
    const y = parse(p.start).getFullYear();
    return Array.from({ length: 12 }, (_, i) => monthBucket(y, i));
  }
  const n = daysIn(p);
  if (n <= 31) return Array.from({ length: n }, (_, i) => dayBucket(addDays(p.start, i), String(parse(addDays(p.start, i)).getDate())));
  const s = parse(p.start);
  const e = parse(p.end);
  const months = (e.getFullYear() - s.getFullYear()) * 12 + e.getMonth() - s.getMonth() + 1;
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(s.getFullYear(), s.getMonth() + i, 1);
    return monthBucket(d.getFullYear(), d.getMonth());
  });
}

/**
 * Which bar to highlight first: for a month view, that month; otherwise the bar
 * containing today if it's in range (not an empty future one), else the last bar.
 */
export function selectedBucketIndex(p: Period, buckets: Bucket[], today?: string): number {
  if (p.kind === 'month') {
    const i = buckets.findIndex((b) => b.start === p.start);
    if (i >= 0) return i;
  }
  if (today) {
    const i = buckets.findIndex((b) => today >= b.start && today <= b.end);
    if (i >= 0) return i;
  }
  return buckets.length - 1;
}
