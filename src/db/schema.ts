import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Every synced table has:
 *   id          text primary key (random UUID, or a fixed id for default categories)
 *   updated_at  ms timestamp of the last local edit; last write wins during sync
 *   deleted     1 = soft-deleted (tombstone, so deletes sync too)
 *   dirty       1 = changed locally and not yet pushed to Supabase (local only)
 */
export const SYNCED_TABLES = ['categories', 'accounts', 'expenses', 'people', 'budgets', 'settlements'] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

const SYNC_COLS = `
  updated_at INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  dirty INTEGER NOT NULL DEFAULT 1`;

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE categories (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    color TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,${SYNC_COLS}
  );
  CREATE TABLE expenses (
    id TEXT PRIMARY KEY NOT NULL,
    amount REAL NOT NULL,
    category_id TEXT,
    note TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL,
    paid_by TEXT NOT NULL DEFAULT 'me',
    shares TEXT NOT NULL DEFAULT '[]',${SYNC_COLS}
  );
  CREATE INDEX idx_expenses_date ON expenses(date);
  CREATE TABLE people (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,${SYNC_COLS}
  );
  CREATE TABLE budgets (
    id TEXT PRIMARY KEY NOT NULL,
    category_id TEXT NOT NULL,
    amount REAL NOT NULL,${SYNC_COLS}
  );
  CREATE TABLE settlements (
    id TEXT PRIMARY KEY NOT NULL,
    person_id TEXT NOT NULL,
    amount REAL NOT NULL,
    direction TEXT NOT NULL,
    date TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',${SYNC_COLS}
  );
  CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT);
  `,
  // v2: credits and accounts (cards / bank accounts from imported statements)
  `
  ALTER TABLE expenses ADD COLUMN type TEXT NOT NULL DEFAULT 'expense';
  ALTER TABLE expenses ADD COLUMN account_id TEXT;
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    bank TEXT NOT NULL,
    kind TEXT NOT NULL,
    last4 TEXT NOT NULL,${SYNC_COLS}
  );
  `,
  // v3: sharing with friends who have an account. shared_dirty = changed here and not yet
  // pushed to the shared tables (kept apart from dirty so pulled changes don't bounce back).
  `
  ALTER TABLE people ADD COLUMN user_id TEXT;
  ALTER TABLE people ADD COLUMN email TEXT;
  ALTER TABLE expenses ADD COLUMN shared INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE expenses ADD COLUMN shared_dirty INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE settlements ADD COLUMN shared INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE settlements ADD COLUMN shared_dirty INTEGER NOT NULL DEFAULT 0;
  `,
  // v4: the friend's account id must not be called user_id: on the server, user_id is the
  // row's owner (checked by the access rules), so syncing it as the friend's id was refused.
  `
  ALTER TABLE people RENAME COLUMN user_id TO friend_uid;
  `,
];

/** Fixed ids so two phones seeding defaults don't create duplicates after syncing. */
const DEFAULT_CATEGORIES: [string, string, string, string][] = [
  ['cat_food', 'Food & Dining', '🍔', '#2a78d6'],
  ['cat_groceries', 'Groceries', '🛒', '#eb6834'],
  ['cat_transport', 'Transport', '🚕', '#1baf7a'],
  ['cat_rent', 'Rent & Bills', '🏠', '#eda100'],
  ['cat_shopping', 'Shopping', '🛍️', '#e87ba4'],
  ['cat_health', 'Health', '💊', '#008300'],
  ['cat_fun', 'Entertainment', '🎬', '#6250d6'],
  ['cat_travel', 'Travel', '✈️', '#e34948'],
  ['cat_other', 'Other', '📦', '#8D8D8D'],
];

export async function migrate(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[version]);
      if (version === 0) {
        for (const [i, [id, name, icon, color]] of DEFAULT_CATEGORIES.entries()) {
          // updated_at 0 + not dirty: defaults never upload unless edited.
          await db.runAsync(
            'INSERT INTO categories (id, name, icon, color, sort, updated_at, dirty) VALUES (?, ?, ?, ?, ?, 0, 0)',
            id, name, icon, color, i,
          );
        }
      }
      await db.execAsync(`PRAGMA user_version = ${version + 1}`);
    });
    version++;
  }
}
