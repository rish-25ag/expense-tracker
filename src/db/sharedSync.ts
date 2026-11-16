import type { SQLiteDatabase } from 'expo-sqlite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findPersonByUserId, getMeta, listCategories, listPeople, savePerson, setMeta } from './repo';
import {
  fromSharedExpense,
  fromSharedSettlement,
  missingFriends,
  toSharedExpense,
  toSharedSettlement,
  type SharedExpenseRow,
  type SharedSettlementRow,
} from '../lib/sharing';
import type { Person, Share } from '../lib/types';

/**
 * Sync of expenses and settle-ups shared with friends who have an account.
 * Runs after the personal sync (sync.ts). Shared rows live in shared_expenses /
 * shared_settlements, readable and editable by every member; each phone keeps
 * its own copy translated to its owner's point of view (see lib/sharing.ts).
 *
 * Local `shared_dirty` marks edits not yet pushed. Pulled changes clear it, so
 * a change never bounces back and forth between phones.
 */

const PAGE = 500;
const OVERLAP_MS = 10_000;

interface Me {
  uid: string;
  name: string;
}

async function whoAmI(sb: SupabaseClient): Promise<Me | null> {
  const { data } = await sb.auth.getSession();
  const user = data.session?.user;
  if (!user) return null;
  const { data: profile } = await sb.from('profiles').select('name').eq('id', user.id).maybeSingle();
  return { uid: user.id, name: (profile?.name as string | undefined) ?? user.email?.split('@')[0] ?? 'Friend' };
}

/** All friends, including removed ones (a shared row may still name them). */
async function allPeople(db: SQLiteDatabase): Promise<Person[]> {
  return db.getAllAsync<Person>('SELECT id, name, user_id AS userId, email FROM people');
}

/** The local friend for an account, restoring or creating them if needed. */
async function friendFor(db: SQLiteDatabase, uid: string, name: string): Promise<string> {
  const existing = await findPersonByUserId(db, uid);
  if (existing) {
    const active = (await listPeople(db)).some((p) => p.id === existing.id);
    if (!active) await savePerson(db, { id: existing.id, name: existing.name });
    return existing.id;
  }
  return savePerson(db, { name: name || 'Friend', userId: uid });
}

async function pullPages<T>(db: SQLiteDatabase, sb: SupabaseClient, table: string, apply: (row: T) => Promise<void>) {
  const cursorKey = `pull_cursor_${table}`;
  const cursor = await getMeta(db, cursorKey);
  const since = cursor ? new Date(new Date(cursor).getTime() - OVERLAP_MS).toISOString() : null;
  let maxSeen = cursor;
  for (let from = 0; ; from += PAGE) {
    let q = sb
      .from(table)
      .select('*')
      .order('server_updated_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (since) q = q.gt('server_updated_at', since);
    const { data, error } = await q;
    if (error) throw new Error(`Pull ${table}: ${error.message}`);
    const rows = (data ?? []) as (T & { server_updated_at: string })[];
    for (const r of rows) {
      await apply(r);
      if (!maxSeen || new Date(r.server_updated_at) > new Date(maxSeen)) maxSeen = r.server_updated_at;
    }
    if (rows.length < PAGE) break;
  }
  if (maxSeen && maxSeen !== cursor) await setMeta(db, cursorKey, maxSeen);
}

async function pullExpenses(db: SQLiteDatabase, sb: SupabaseClient, me: Me) {
  await pullPages<SharedExpenseRow>(db, sb, 'shared_expenses', async (row) => {
    const local = await db.getFirstAsync<{ updated_at: number }>(
      'SELECT updated_at FROM expenses WHERE id = ?',
      row.id,
    );
    const updatedAt = Number(row.updated_at);
    // Same version as ours (we pushed it), or edited here more recently (ours will be pushed).
    if (local && local.updated_at >= updatedAt) return;

    for (const f of missingFriends(row, me.uid, await listPeople(db))) await friendFor(db, f.uid, f.name);
    const view = fromSharedExpense(row, me.uid, await listPeople(db));

    // A new copy gets the sharer's category if this phone has one by that name; later
    // updates keep whatever category / card this person chose.
    const categories = await listCategories(db);
    const categoryId =
      categories.find((c) => c.name.toLowerCase() === (row.category ?? '').toLowerCase())?.id ??
      categories.find((c) => c.id === 'cat_other')?.id ??
      null;
    await db.runAsync(
      `INSERT INTO expenses (id, amount, category_id, note, date, paid_by, shares, type, account_id, shared, shared_dirty,
         updated_at, deleted, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'expense', NULL, 1, 0, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET amount = excluded.amount, note = excluded.note, date = excluded.date,
         paid_by = excluded.paid_by, shares = excluded.shares, shared = 1, shared_dirty = 0,
         updated_at = excluded.updated_at, deleted = excluded.deleted, dirty = 1`,
      row.id,
      Number(row.amount),
      categoryId,
      row.note ?? '',
      row.date,
      view.paidBy,
      JSON.stringify(view.shares satisfies Share[]),
      updatedAt,
      row.deleted ? 1 : 0,
    );
  });
}

async function pullSettlements(db: SQLiteDatabase, sb: SupabaseClient, me: Me) {
  await pullPages<SharedSettlementRow>(db, sb, 'shared_settlements', async (row) => {
    const local = await db.getFirstAsync<{ updated_at: number }>(
      'SELECT updated_at FROM settlements WHERE id = ?',
      row.id,
    );
    const updatedAt = Number(row.updated_at);
    if (local && local.updated_at >= updatedAt) return;
    const view = fromSharedSettlement(row, me.uid);
    if (!view) return;
    const personId = await friendFor(db, view.friendUid, view.friendName);
    await db.runAsync(
      `INSERT INTO settlements (id, person_id, amount, direction, date, note, shared, shared_dirty, updated_at, deleted, dirty)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET person_id = excluded.person_id, amount = excluded.amount,
         direction = excluded.direction, date = excluded.date, note = excluded.note, shared = 1, shared_dirty = 0,
         updated_at = excluded.updated_at, deleted = excluded.deleted, dirty = 1`,
      row.id,
      personId,
      Number(row.amount),
      view.direction,
      row.date,
      row.note ?? '',
      updatedAt,
      row.deleted ? 1 : 0,
    );
  });
}

/**
 * Upserts rows one batch at a time. If the batch is refused, retries row by row: a row
 * refused by the server's member rules (you were removed from it) stops being shared here.
 */
async function pushRows(
  db: SQLiteDatabase,
  sb: SupabaseClient,
  table: 'shared_expenses' | 'shared_settlements',
  localTable: 'expenses' | 'settlements',
  rows: (SharedExpenseRow | SharedSettlementRow)[],
) {
  if (!rows.length) return;
  const { error } = await sb.from(table).upsert(rows, { onConflict: 'id' });
  const failed = new Set<string>();
  if (error) {
    for (const r of rows) {
      const one = await sb.from(table).upsert([r], { onConflict: 'id' });
      if (!one.error) continue;
      if (one.error.code === '42501' || /row-level security/i.test(one.error.message)) {
        failed.add(r.id);
        await db.runAsync(`UPDATE ${localTable} SET shared = 0, shared_dirty = 0 WHERE id = ?`, r.id);
      } else {
        throw new Error(`Push ${table}: ${one.error.message}`);
      }
    }
  }
  for (const r of rows) {
    if (failed.has(r.id)) continue;
    await db.runAsync(`UPDATE ${localTable} SET shared_dirty = 0 WHERE id = ? AND updated_at = ?`, r.id, r.updated_at);
  }
}

async function pushExpenses(db: SQLiteDatabase, sb: SupabaseClient, me: Me) {
  const pending = await db.getAllAsync<{
    id: string;
    amount: number;
    category_id: string | null;
    note: string;
    date: string;
    paid_by: string;
    shares: string;
    updated_at: number;
    deleted: number;
  }>(
    `SELECT id, amount, category_id, note, date, paid_by, shares, updated_at, deleted
     FROM expenses WHERE shared = 1 AND shared_dirty = 1 LIMIT ${PAGE}`,
  );
  if (!pending.length) return;
  const people = Object.fromEntries((await allPeople(db)).map((p) => [p.id, p]));
  const catName = Object.fromEntries((await listCategories(db)).map((c) => [c.id, c.name]));
  const rows = pending.map((e) =>
    toSharedExpense(
      {
        id: e.id,
        amount: e.amount,
        date: e.date,
        note: e.note,
        paidBy: e.paid_by,
        shares: JSON.parse(e.shares),
        updatedAt: e.updated_at,
        deleted: e.deleted === 1,
      },
      e.category_id ? (catName[e.category_id] ?? null) : null,
      me.uid, // the server keeps the original creator
      me,
      people,
    ),
  );
  await pushRows(db, sb, 'shared_expenses', 'expenses', rows);
}

async function pushSettlements(db: SQLiteDatabase, sb: SupabaseClient, me: Me) {
  const pending = await db.getAllAsync<{
    id: string;
    amount: number;
    direction: 'paid' | 'received';
    date: string;
    note: string;
    updated_at: number;
    deleted: number;
    user_id: string | null;
    name: string;
  }>(
    `SELECT s.id, s.amount, s.direction, s.date, s.note, s.updated_at, s.deleted, p.user_id, p.name
     FROM settlements s JOIN people p ON p.id = s.person_id
     WHERE s.shared = 1 AND s.shared_dirty = 1 LIMIT ${PAGE}`,
  );
  const rows: SharedSettlementRow[] = [];
  for (const s of pending) {
    if (!s.user_id) {
      await db.runAsync('UPDATE settlements SET shared = 0, shared_dirty = 0 WHERE id = ?', s.id);
      continue;
    }
    rows.push(
      toSharedSettlement(
        {
          id: s.id,
          amount: s.amount,
          date: s.date,
          note: s.note,
          direction: s.direction,
          updatedAt: s.updated_at,
          deleted: s.deleted === 1,
        },
        { uid: s.user_id, name: s.name },
        me.uid,
        me,
      ),
    );
  }
  await pushRows(db, sb, 'shared_settlements', 'settlements', rows);
}

/** Pull then push shared expenses and settle-ups. No-op when signed out. */
export async function syncShared(db: SQLiteDatabase, sb: SupabaseClient) {
  const me = await whoAmI(sb);
  if (!me) return;
  await pullExpenses(db, sb, me);
  await pullSettlements(db, sb, me);
  await pushExpenses(db, sb, me);
  await pushSettlements(db, sb, me);
}
