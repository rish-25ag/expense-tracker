import type { SQLiteDatabase } from 'expo-sqlite';
import { listPeople, listSettlements, listSplitExpenses } from '../db/repo';
import { balances } from './split';
import type { Person } from './types';

export async function loadBalances(db: SQLiteDatabase): Promise<{ person: Person; balance: number }[]> {
  const [people, expenses, settlements] = await Promise.all([
    listPeople(db),
    listSplitExpenses(db),
    listSettlements(db),
  ]);
  const b = balances(expenses, settlements);
  return people.map((person) => ({ person, balance: b[person.id] ?? 0 }));
}
