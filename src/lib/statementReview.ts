/** A transaction as returned by the parse-statement Edge Function. */
export interface StatementTxn {
  date: string;
  description: string;
  amount: number;
  direction: 'debit' | 'credit';
  kind: 'spend' | 'transfer';
  category: string;
}

export interface ReviewRow extends StatementTxn {
  key: string;
  selected: boolean;
  /** An expense with the same date and amount already exists. */
  duplicate: boolean;
}

export interface Review {
  rows: ReviewRow[];
  /** Credits (salary, refunds, payments received) are not imported. */
  creditsSkipped: number;
}

/**
 * Builds the review list: debits only, and each row pre-selected unless it is a
 * transfer (card bill payment, self transfer, investment) or a likely duplicate
 * of an expense already in the app.
 */
export function buildReview(
  txns: StatementTxn[],
  existing: { date: string; amount: number }[],
): Review {
  // Count existing expenses per date+amount so two real ₹50 teas on one day
  // are matched against two existing ones, not one.
  const seen = new Map<string, number>();
  for (const e of existing) {
    const k = `${e.date}|${e.amount.toFixed(2)}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const debits = txns.filter((t) => t.direction === 'debit');
  const rows = debits
    .map((t, i) => {
      const k = `${t.date}|${t.amount.toFixed(2)}`;
      const left = seen.get(k) ?? 0;
      if (left > 0) seen.set(k, left - 1);
      const duplicate = left > 0;
      return { ...t, key: String(i), duplicate, selected: t.kind === 'spend' && !duplicate };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  return { rows, creditsSkipped: txns.length - debits.length };
}
