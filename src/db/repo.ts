import type { SQLiteDatabase } from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';
import { ME, type Account, type Budget, type Category, type EntryType, type Expense, type Person, type Settlement, type Share } from '../lib/types';
import { myShare } from '../lib/split';
import { round2 } from '../lib/money';

/**
 * All reads skip soft-deleted rows. All writes bump updated_at and set dirty=1
 * so the sync engine pushes them.
 */

export const newId = () => randomUUID();
const now = () => Date.now();

// ---------- Categories ----------

export async function listCategories(db: SQLiteDatabase): Promise<Category[]> {
  return db.getAllAsync<Category>(
    'SELECT id, name, icon, color FROM categories WHERE deleted = 0 ORDER BY sort, name',
  );
}

export async function saveCategory(db: SQLiteDatabase, c: Omit<Category, 'id'> & { id?: string }) {
  const id = c.id ?? newId();
  const sort = c.id
    ? undefined
    : ((await db.getFirstAsync<{ s: number }>('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM categories'))?.s ?? 0);
  await db.runAsync(
    `INSERT INTO categories (id, name, icon, color, sort, updated_at, deleted, dirty)
     VALUES (?, ?, ?, ?, ?, ?, 0, 1)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon, color = excluded.color,
       updated_at = excluded.updated_at, deleted = 0, dirty = 1`,
    id, c.name.trim(), c.icon, c.color, sort ?? 0, now(),
  );
  return id;
}

export async function findOrCreateCategory(db: SQLiteDatabase, name: string): Promise<string | null> {
  const n = name.trim();
  if (!n) return null;
  const hit = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM categories WHERE deleted = 0 AND lower(name) = lower(?)',
    n,
  );
  return hit?.id ?? saveCategory(db, { name: n, icon: '🏷️', color: '#6C757D' });
}

/** Expenses in a deleted category become uncategorised; its budget goes too. */
export async function deleteCategory(db: SQLiteDatabase, id: string) {
  const t = now();
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE categories SET deleted = 1, dirty = 1, updated_at = ? WHERE id = ?', t, id);
    await db.runAsync(
      'UPDATE expenses SET category_id = NULL, dirty = 1, updated_at = ? WHERE category_id = ? AND deleted = 0',
      t, id,
    );
    await db.runAsync(
      'UPDATE budgets SET deleted = 1, dirty = 1, updated_at = ? WHERE category_id = ? AND deleted = 0',
      t, id,
    );
  });
}

// ---------- Expenses ----------

interface ExpenseRow {
  id: string;
  amount: number;
  category_id: string | null;
  note: string;
  date: string;
  paid_by: string;
  shares: string;
  type: EntryType;
  account_id: string | null;
}

const toExpense = (r: ExpenseRow): Expense => ({
  id: r.id,
  type: r.type,
  accountId: r.account_id,
  amount: r.amount,
  categoryId: r.category_id,
  note: r.note,
  date: r.date,
  paidBy: r.paid_by,
  shares: JSON.parse(r.shares) as Share[],
});

const EXPENSE_COLS = 'id, amount, category_id, note, date, paid_by, shares, type, account_id';

/** month = 'YYYY-MM'; omit for all expenses. Newest first. */
export async function listExpenses(db: SQLiteDatabase, month?: string): Promise<Expense[]> {
  const rows = month
    ? await db.getAllAsync<ExpenseRow>(
        `SELECT ${EXPENSE_COLS} FROM expenses WHERE deleted = 0 AND substr(date, 1, 7) = ?
         ORDER BY date DESC, updated_at DESC`,
        month,
      )
    : await db.getAllAsync<ExpenseRow>(
        `SELECT ${EXPENSE_COLS} FROM expenses WHERE deleted = 0 ORDER BY date DESC, updated_at DESC`,
      );
  return rows.map(toExpense);
}

/** Entries dated from `start` to `end` (inclusive, YYYY-MM-DD). Newest first. */
export async function listExpensesBetween(db: SQLiteDatabase, start: string, end: string): Promise<Expense[]> {
  const rows = await db.getAllAsync<ExpenseRow>(
    `SELECT ${EXPENSE_COLS} FROM expenses WHERE deleted = 0 AND date >= ? AND date <= ?
     ORDER BY date DESC, updated_at DESC`,
    start, end,
  );
  return rows.map(toExpense);
}

/** Spend per category from `start` to `end`, counting only my share of split bills (credits excluded). */
export async function spendByCategoryBetween(db: SQLiteDatabase, start: string, end: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const e of await listExpensesBetween(db, start, end)) {
    if (e.type !== 'expense') continue;
    const k = e.categoryId ?? '';
    out[k] = round2((out[k] ?? 0) + myShare(e));
  }
  return out;
}

/** Total spend (my share, credits excluded) for each date range, keyed by `key`. */
export async function spendByRanges(
  db: SQLiteDatabase,
  ranges: { key: string; start: string; end: string }[],
): Promise<Record<string, number>> {
  if (!ranges.length) return {};
  const from = ranges.reduce((m, r) => (r.start < m ? r.start : m), ranges[0].start);
  const to = ranges.reduce((m, r) => (r.end > m ? r.end : m), ranges[0].end);
  const out: Record<string, number> = Object.fromEntries(ranges.map((r) => [r.key, 0]));
  for (const e of await listExpensesBetween(db, from, to)) {
    if (e.type !== 'expense') continue;
    for (const r of ranges) if (e.date >= r.start && e.date <= r.end) out[r.key] = round2(out[r.key] + myShare(e));
  }
  return out;
}

export async function getExpense(db: SQLiteDatabase, id: string): Promise<Expense | null> {
  const r = await db.getFirstAsync<ExpenseRow>(
    `SELECT ${EXPENSE_COLS} FROM expenses WHERE id = ? AND deleted = 0`,
    id,
  );
  return r ? toExpense(r) : null;
}

export async function listExpensesWithPerson(db: SQLiteDatabase, personId: string): Promise<Expense[]> {
  const all = await db.getAllAsync<ExpenseRow>(
    `SELECT ${EXPENSE_COLS} FROM expenses WHERE deleted = 0 AND shares != '[]'
     AND (paid_by = ? OR shares LIKE ?) ORDER BY date DESC`,
    personId, `%"${personId}"%`,
  );
  return all.map(toExpense).filter((e) => e.paidBy === personId || e.shares.some((s) => s.personId === personId));
}

/** Only split expenses matter for balances. */
export async function listSplitExpenses(db: SQLiteDatabase): Promise<Expense[]> {
  const rows = await db.getAllAsync<ExpenseRow>(
    `SELECT ${EXPENSE_COLS} FROM expenses WHERE deleted = 0 AND shares != '[]'`,
  );
  return rows.map(toExpense);
}

export async function saveExpense(db: SQLiteDatabase, e: Omit<Expense, 'id'> & { id?: string }) {
  const id = e.id ?? newId();
  await db.runAsync(
    `INSERT INTO expenses (id, amount, category_id, note, date, paid_by, shares, type, account_id, updated_at, deleted, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)
     ON CONFLICT(id) DO UPDATE SET amount = excluded.amount, category_id = excluded.category_id,
       note = excluded.note, date = excluded.date, paid_by = excluded.paid_by, shares = excluded.shares,
       type = excluded.type, account_id = excluded.account_id,
       updated_at = excluded.updated_at, deleted = 0, dirty = 1`,
    id, round2(e.amount), e.categoryId, e.note.trim(), e.date,
    // Credits are never split.
    e.type === 'credit' ? ME : e.paidBy, JSON.stringify(e.type === 'credit' ? [] : e.shares),
    e.type, e.accountId, now(),
  );
  return id;
}

export async function deleteExpense(db: SQLiteDatabase, id: string) {
  await db.runAsync('UPDATE expenses SET deleted = 1, dirty = 1, updated_at = ? WHERE id = ?', now(), id);
}

/** Spend per category for a month, counting only my share of split bills. */
export async function spendByCategory(db: SQLiteDatabase, month: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const e of await listExpenses(db, month)) {
    if (e.type !== 'expense') continue;
    const k = e.categoryId ?? '';
    out[k] = round2((out[k] ?? 0) + myShare(e));
  }
  return out;
}

/** Total of my share per month for the given months. */
export async function spendByMonth(db: SQLiteDatabase, months: string[]): Promise<Record<string, number>> {
  if (months.length === 0) return {};
  const rows = await db.getAllAsync<ExpenseRow>(
    `SELECT ${EXPENSE_COLS} FROM expenses WHERE deleted = 0 AND type = 'expense' AND substr(date, 1, 7) IN (${months.map(() => '?').join(',')})`,
    months,
  );
  const out: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]));
  for (const r of rows) {
    const e = toExpense(r);
    const m = e.date.slice(0, 7);
    out[m] = round2(out[m] + myShare(e));
  }
  return out;
}

// ---------- Accounts ----------

export async function listAccounts(db: SQLiteDatabase): Promise<Account[]> {
  return db.getAllAsync<Account>('SELECT id, name, bank, kind, last4 FROM accounts WHERE deleted = 0 ORDER BY name');
}

/** Adds a card / account seen on a statement. Its id is derived from bank + last 4 digits, so re-importing finds the same one. */
export async function ensureAccount(db: SQLiteDatabase, a: Account) {
  await db.runAsync(
    `INSERT INTO accounts (id, name, bank, kind, last4, updated_at, deleted, dirty) VALUES (?, ?, ?, ?, ?, ?, 0, 1)
     ON CONFLICT(id) DO UPDATE SET deleted = 0, dirty = CASE WHEN accounts.deleted = 1 THEN 1 ELSE accounts.dirty END,
       updated_at = CASE WHEN accounts.deleted = 1 THEN excluded.updated_at ELSE accounts.updated_at END`,
    a.id, a.name, a.bank, a.kind, a.last4, now(),
  );
}

// ---------- People ----------

export async function listPeople(db: SQLiteDatabase): Promise<Person[]> {
  return db.getAllAsync<Person>('SELECT id, name FROM people WHERE deleted = 0 ORDER BY name COLLATE NOCASE');
}

export async function savePerson(db: SQLiteDatabase, p: { id?: string; name: string }) {
  const id = p.id ?? newId();
  await db.runAsync(
    `INSERT INTO people (id, name, updated_at, deleted, dirty) VALUES (?, ?, ?, 0, 1)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at, deleted = 0, dirty = 1`,
    id, p.name.trim(), now(),
  );
  return id;
}

export async function deletePerson(db: SQLiteDatabase, id: string) {
  await db.runAsync('UPDATE people SET deleted = 1, dirty = 1, updated_at = ? WHERE id = ?', now(), id);
}

// ---------- Budgets ----------

/** One budget per category; its id is derived from the category so devices agree. */
const budgetId = (categoryId: string) => `budget_${categoryId}`;

export async function listBudgets(db: SQLiteDatabase): Promise<Budget[]> {
  return db.getAllAsync<Budget>(
    'SELECT id, category_id AS categoryId, amount FROM budgets WHERE deleted = 0',
  );
}

/** amount <= 0 removes the budget. */
export async function setBudget(db: SQLiteDatabase, categoryId: string, amount: number) {
  await db.runAsync(
    `INSERT INTO budgets (id, category_id, amount, updated_at, deleted, dirty) VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET amount = excluded.amount, updated_at = excluded.updated_at,
       deleted = excluded.deleted, dirty = 1`,
    budgetId(categoryId), categoryId, round2(Math.max(amount, 0)), now(), amount > 0 ? 0 : 1,
  );
}

// ---------- Settlements ----------

export async function listSettlements(db: SQLiteDatabase, personId?: string): Promise<Settlement[]> {
  const sql = `SELECT id, person_id AS personId, amount, direction, date, note FROM settlements
               WHERE deleted = 0 ${personId ? 'AND person_id = ?' : ''} ORDER BY date DESC`;
  return personId ? db.getAllAsync<Settlement>(sql, personId) : db.getAllAsync<Settlement>(sql);
}

export async function addSettlement(db: SQLiteDatabase, s: Omit<Settlement, 'id'>) {
  await db.runAsync(
    `INSERT INTO settlements (id, person_id, amount, direction, date, note, updated_at, deleted, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)`,
    newId(), s.personId, round2(s.amount), s.direction, s.date, s.note.trim(), now(),
  );
}

export async function deleteSettlement(db: SQLiteDatabase, id: string) {
  await db.runAsync('UPDATE settlements SET deleted = 1, dirty = 1, updated_at = ? WHERE id = ?', now(), id);
}

// ---------- Meta ----------

export async function getMeta(db: SQLiteDatabase, key: string): Promise<string | null> {
  return (await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key))?.value ?? null;
}

export async function setMeta(db: SQLiteDatabase, key: string, value: string | null) {
  if (value === null) await db.runAsync('DELETE FROM meta WHERE key = ?', key);
  else await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value);
}
