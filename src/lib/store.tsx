import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useFocusEffect } from 'expo-router';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { syncNow, countUnsynced, wipeLocal } from '../db/sync';
import { getMeta } from '../db/repo';

type SyncState = 'idle' | 'syncing' | 'error' | 'offline';

interface AppCtx {
  /** Increments after every local write; screens re-query when it changes. */
  version: number;
  /** Call after writing to the DB: refreshes screens and schedules a sync. */
  changed: () => void;
  session: Session | null;
  syncState: SyncState;
  syncError: string | null;
  lastSyncedAt: string | null;
  unsynced: number;
  sync: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AppCtx | null>(null);

const AUTO_SYNC_DELAY_MS = 3000;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const db = useSQLiteContext();
  const [version, setVersion] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [syncState, setSyncState] = useState<SyncState>(supabase ? 'idle' : 'offline');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [unsynced, setUnsynced] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read by sync() so a debounced or AppState-triggered sync sees the latest session.
  const sessionRef = useRef<Session | null>(null);

  const refreshStatus = useCallback(async () => {
    setUnsynced(await countUnsynced(db));
    setLastSyncedAt(await getMeta(db, 'last_synced_at'));
  }, [db]);

  const sync = useCallback(async () => {
    if (!supabase || !sessionRef.current) return;
    setSyncState('syncing');
    try {
      await syncNow(db, supabase);
      setSyncError(null);
      setSyncState('idle');
      setVersion((v) => v + 1); // pulled rows may have changed what screens show
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
      setSyncState('error');
    } finally {
      await refreshStatus();
    }
  }, [db, refreshStatus]);

  const changed = useCallback(() => {
    setVersion((v) => v + 1);
    refreshStatus();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(sync, AUTO_SYNC_DELAY_MS);
  }, [sync, refreshStatus]);

  // Auth session. INITIAL_SESSION fires on start-up with any saved session.
  useEffect(() => {
    countUnsynced(db).then(setUnsynced);
    getMeta(db, 'last_synced_at').then(setLastSyncedAt);
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      sessionRef.current = s;
      setSession(s);
      // Defer: Supabase calls made inside this callback can deadlock the auth lock.
      if (s && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')) setTimeout(sync, 0);
    });
    return () => data.subscription.unsubscribe();
  }, [db, sync]);

  // Sync whenever the app comes back to the foreground (sync() is a no-op when signed out).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && sync());
    return () => sub.remove();
  }, [sync]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    if (timer.current) clearTimeout(timer.current);
    await supabase.auth.signOut();
    await wipeLocal(db);
    setVersion((v) => v + 1);
    await refreshStatus();
  }, [db, refreshStatus]);

  return (
    <Ctx.Provider
      value={{ version, changed, session, syncState, syncError, lastSyncedAt, unsynced, sync, signOut }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp must be used inside AppProvider');
  return c;
}

/**
 * Run an async DB query and re-run it when data changes or the screen regains focus.
 */
export function useQuery<T>(fn: (db: SQLiteDatabase) => Promise<T>, deps: unknown[], initial: T): T {
  const db = useSQLiteContext();
  const { version } = useApp();
  const [value, setValue] = useState<T>(initial);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  // Callers pass small arrays of primitives, so a string key is a stable dependency.
  const depsKey = JSON.stringify(deps);

  const run = useCallback(() => {
    let alive = true;
    fnRef.current(db).then((v) => alive && setValue(v));
    return () => {
      alive = false;
    };
  }, [db, version, depsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useFocusEffect(run);
  return value;
}
