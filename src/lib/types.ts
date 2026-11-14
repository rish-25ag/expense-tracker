/** A participant in a split. "me" is always the app's owner. */
export const ME = 'me';

export interface Category {
  id: string;
  name: string;
  icon: string; // emoji
  color: string; // hex
}

export interface Share {
  personId: string; // ME or a Person id
  amount: number; // in rupees, 2 decimals
}

/** expense = money spent; credit = money in (refund, cashback, salary...). Credits never count as spending. */
export type EntryType = 'expense' | 'credit';

export interface Expense {
  id: string;
  type: EntryType;
  /** Card or bank account it was paid from / credited to, if known. */
  accountId: string | null;
  amount: number; // total bill amount
  categoryId: string | null;
  note: string;
  date: string; // YYYY-MM-DD
  paidBy: string; // ME or a Person id
  /** Empty = not split, the whole amount is mine. */
  shares: Share[];
}

export interface Person {
  id: string;
  name: string;
}

/** A bank account or credit card, detected from imported statements. */
export interface Account {
  id: string;
  name: string; // e.g. "Axis Card ••1234"
  bank: string;
  kind: 'card' | 'bank';
  last4: string;
}

export interface Budget {
  id: string;
  categoryId: string;
  amount: number; // monthly limit
}

/** Money that moved between me and a person to settle up. */
export interface Settlement {
  id: string;
  personId: string;
  amount: number;
  /** 'paid' = I paid them, 'received' = they paid me. */
  direction: 'paid' | 'received';
  date: string;
  note: string;
}
