import type { EntryType } from './types';

/** A transaction read from a statement (see statementParser.ts). */
export interface StatementTxn {
  date: string;
  description: string;
  amount: number;
  direction: 'debit' | 'credit';
  /** spend = a real expense or credit; transfer = card bill payment, own-account transfer, investment, EMI. */
  kind: 'spend' | 'transfer';
  /** Category id, e.g. cat_food. */
  category: string;
}

export interface ReviewRow extends StatementTxn {
  key: string;
  /** Debits become expenses, credits become credit entries. */
  type: EntryType;
  selected: boolean;
  /** An entry of the same type, date and amount already exists. */
  duplicate: boolean;
}

export interface Review {
  rows: ReviewRow[];
  debits: number;
  credits: number;
}

/**
 * Builds the review list. Every row is pre-selected unless it is a transfer
 * (card bill payment, own-account transfer, investment) or a likely duplicate
 * of an entry already in the app.
 */
export function buildReview(
  txns: StatementTxn[],
  existing: { date: string; amount: number; type: EntryType }[],
): Review {
  // Count existing entries per type+date+amount so two real ₹50 teas on one day
  // are matched against two existing ones, not one.
  const seen = new Map<string, number>();
  const keyOf = (type: EntryType, date: string, amount: number) => `${type}|${date}|${amount.toFixed(2)}`;
  for (const e of existing) {
    const k = keyOf(e.type, e.date, e.amount);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const rows = txns
    .map((t, i) => {
      const type: EntryType = t.direction === 'credit' ? 'credit' : 'expense';
      const k = keyOf(type, t.date, t.amount);
      const left = seen.get(k) ?? 0;
      if (left > 0) seen.set(k, left - 1);
      const duplicate = left > 0;
      return { ...t, key: String(i), type, duplicate, selected: t.kind === 'spend' && !duplicate };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  return {
    rows,
    debits: rows.filter((r) => r.type === 'expense').length,
    credits: rows.filter((r) => r.type === 'credit').length,
  };
}
