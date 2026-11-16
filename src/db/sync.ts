import type { SQLiteDatabase } from 'expo-sqlite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SYNCED_TABLES, type SyncedTable } from './schema';
import { getMeta, setMeta } from './repo';
import { syncShared } from './sharedSync';

/**
 * Offline-first sync with last-write-wins per row.
 *
 * pull: fetch rows whose server_updated_at is newer than our cursor and apply
 *       each one only if it is newer than the local copy (by updated_at).
 * push: upsert all locally dirty rows. A database trigger on the server
 *       ignores an upsert that is older than the row it already has.
 */

const COLUMNS: Record<SyncedTable, string[]> = {
  categories: ['name', 'icon', 'color', 'sort'],
  accounts: ['name', 'bank', 'kind', 'last4'],
  expenses: ['amount', 'category_id', 'note', 'date', 'paid_by', 'shares', 'type', 'account_id', 'shared'],
  people: ['name', 'friend_uid', 'email'],
  budgets: ['category_id', 'amount'],
  settlements: ['person_id', 'amount', 'direction', 'date', 'note', 'shared'],
};

const PAGE = 500;
/** Re-read a little before the cursor so rows committed slightly out of order aren't missed. */
const OVERLAP_MS = 10_000;

type Row = Record<string, unknown>;

function toRemote(table: SyncedTable, r: Row): Row {
  const out: Row = { id: r.id, updated_at: r.updated_at, deleted: r.deleted === 1 };
  for (const c of COLUMNS[table]) out[c] = c === 'shares' ? JSON.parse(r[c] as string) : r[c];
  return out;
}

function toLocalValues(table: SyncedTable, r: Row): (string | number | null)[] {
  return COLUMNS[table].map((c) => {
    const v = r[c];
    if (c === 'shares') return JSON.stringify(v ?? []);
    if (c === 'amount') return Number(v);
    return (v ?? null) as string | number | null;
  });
}

async function pullTable(db: SQLiteDatabase, sb: SupabaseClient, table: SyncedTable) {
  const cursorKey = `pull_cursor_${table}`;
  const cursor = await getMeta(db, cursorKey);
  const since = cursor ? new Date(new Date(cursor).getTime() - OVERLAP_MS).toISOString() : null;
  let maxSeen = cursor;
  let from = 0;
  const cols = COLUMNS[table];

  for (;;) {
    let q = sb
      .from(table)
      .select(['id', 'updated_at', 'deleted', 'server_updated_at', ...cols].join(','))
      .order('server_updated_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (since) q = q.gt('server_updated_at', since);
    const { data, error } = await q;
    if (error) throw new Error(`Pull ${table}: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];

    await db.withTransactionAsync(async () => {
      for (const r of rows) {
        // Insert, or overwrite only when the remote edit is at least as new as ours.
        await db.runAsync(
          `INSERT INTO ${table} (id, ${cols.join(', ')}, updated_at, deleted, dirty)
           VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?, 0)
           ON CONFLICT(id) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(', ')},
             updated_at = excluded.updated_at, deleted = excluded.deleted, dirty = 0
           WHERE excluded.updated_at >= ${table}.updated_at`,
          r.id as string, ...toLocalValues(table, r), Number(r.updated_at), r.deleted ? 1 : 0,
        );
        const s = r.server_updated_at as string;
        if (!maxSeen || new Date(s) > new Date(maxSeen)) maxSeen = s;
      }
    });

    if (rows.length < PAGE) break;
    from += PAGE;
  }
  if (maxSeen && maxSeen !== cursor) await setMeta(db, cursorKey, maxSeen);
}

async function pushTable(db: SQLiteDatabase, sb: SupabaseClient, table: SyncedTable) {
  const cols = COLUMNS[table];
  for (;;) {
    const rows = await db.getAllAsync<Row>(
      `SELECT id, ${cols.join(', ')}, updated_at, deleted FROM ${table} WHERE dirty = 1 LIMIT ${PAGE}`,
    );
    if (rows.length === 0) return;
    const { error } = await sb
      .from(table)
      .upsert(rows.map((r) => toRemote(table, r)), { onConflict: 'user_id,id' });
    if (error) throw new Error(`Push ${table}: ${error.message}`);
    // Clear dirty only if the row wasn't edited again while we were uploading.
    await db.withTransactionAsync(async () => {
      for (const r of rows) {
        await db.runAsync(
          `UPDATE ${table} SET dirty = 0 WHERE id = ? AND updated_at = ?`,
          r.id as string, r.updated_at as number,
        );
      }
    });
    if (rows.length < PAGE) return;
  }
}

let running: Promise<void> | null = null;

/** Runs one full sync. Concurrent calls share the same run. */
export function syncNow(db: SQLiteDatabase, sb: SupabaseClient): Promise<void> {
  if (!running) {
    running = (async () => {
      for (const t of SYNCED_TABLES) await pullTable(db, sb, t);
      for (const t of SYNCED_TABLES) await pushTable(db, sb, t);
      // Expenses / settle-ups shared with friends who have an account, then push the
      // personal copies those changes produced.
      await syncShared(db, sb);
      for (const t of SYNCED_TABLES) await pushTable(db, sb, t);
      await setMeta(db, 'last_synced_at', new Date().toISOString());
    })().finally(() => {
      running = null;
    });
  }
  return running;
}

export async function countUnsynced(db: SQLiteDatabase): Promise<number> {
  let n = 0;
  for (const t of SYNCED_TABLES) {
    const sharedToo = t === 'expenses' || t === 'settlements' ? ' OR shared_dirty = 1' : '';
    n += (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE dirty = 1${sharedToo}`))?.n ?? 0;
  }
  return n;
}

/** Remove all local data (used on sign-out so the next account starts clean). */
export async function wipeLocal(db: SQLiteDatabase) {
  await db.withTransactionAsync(async () => {
    for (const t of SYNCED_TABLES) {
      // Keep the built-in categories so the app is usable straight away.
      await db.runAsync(t === 'categories' ? `DELETE FROM ${t} WHERE id NOT LIKE 'cat\\_%' ESCAPE '\\'` : `DELETE FROM ${t}`);
    }
    await db.runAsync(`UPDATE categories SET deleted = 0, dirty = 0, updated_at = 0`);
    await db.runAsync('DELETE FROM meta');
  });
}
