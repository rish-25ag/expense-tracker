import { ME, type Expense, type Settlement } from './types.ts';
import { round2 } from './money.ts';

/** What this expense actually cost me, which is what stats and budgets count. */
export function myShare(e: Pick<Expense, 'amount' | 'shares'>): number {
  if (e.shares.length === 0) return e.amount;
  return e.shares.find((s) => s.personId === ME)?.amount ?? 0;
}

/**
 * Net balance with each person. Positive = they owe me, negative = I owe them.
 * Only debts between me and each person are tracked (not between two friends).
 */
export function balances(
  expenses: Pick<Expense, 'paidBy' | 'shares'>[],
  settlements: Pick<Settlement, 'personId' | 'amount' | 'direction'>[],
): Record<string, number> {
  const bal: Record<string, number> = {};
  const add = (id: string, n: number) => (bal[id] = round2((bal[id] ?? 0) + n));

  for (const e of expenses) {
    if (e.shares.length === 0) continue;
    if (e.paidBy === ME) {
      for (const s of e.shares) if (s.personId !== ME) add(s.personId, s.amount);
    } else {
      const mine = e.shares.find((s) => s.personId === ME)?.amount ?? 0;
      if (mine) add(e.paidBy, -mine);
    }
  }
  for (const s of settlements) {
    // They paid me back -> they owe less. I paid them -> they owe more / I owe less.
    add(s.personId, s.direction === 'received' ? -s.amount : s.amount);
  }
  return bal;
}

/** Error message if shares don't add up to the total, else null. */
export function validateShares(total: number, shares: { amount: number }[]): string | null {
  const sum = round2(shares.reduce((a, s) => a + s.amount, 0));
  if (Math.abs(sum - round2(total)) > 0.009) {
    return `Shares add up to ₹${sum}, but the expense is ₹${round2(total)}`;
  }
  if (shares.some((s) => s.amount < 0)) return 'Shares cannot be negative';
  return null;
}
