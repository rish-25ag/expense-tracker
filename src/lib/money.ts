/** Round to paise. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Group digits Indian style: 12,34,567. Hermes Intl support varies, so do it by hand. */
function groupIndian(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

export function formatINR(n: number, opts: { decimals?: boolean } = {}): string {
  const neg = n < 0;
  const abs = Math.abs(round2(n));
  const showDecimals = opts.decimals ?? abs % 1 !== 0;
  const [i, d] = abs.toFixed(showDecimals ? 2 : 0).split('.');
  return `${neg ? '-' : ''}₹${groupIndian(i)}${d ? '.' + d : ''}`;
}

/** Parse user/CSV input like "1,250.50", "₹ 300", "-45". Returns NaN when invalid. */
export function parseAmount(s: string): number {
  const cleaned = s.replace(/[₹,\s]|INR|Rs\.?/gi, '');
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return NaN;
  return round2(parseFloat(cleaned));
}

/** Split `total` equally across n people; leftover paise go to the first ones. */
export function splitEqually(total: number, n: number): number[] {
  if (n <= 0) return [];
  const paise = Math.round(total * 100);
  const base = Math.floor(paise / n);
  let extra = paise - base * n;
  return Array.from({ length: n }, () => {
    const p = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    return p / 100;
  });
}
