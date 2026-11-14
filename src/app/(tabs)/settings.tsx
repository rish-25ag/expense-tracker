import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useApp } from '../../lib/store';
import { supabase, SUPABASE_HOST, SUPABASE_URL_PROBLEM } from '../../lib/supabase';
import { exportCSV, importCSV } from '../../lib/csvIO';
import { Button, Card, SectionTitle, colors, styles } from '../../components/ui';

function ago(iso: string | null) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const { session, syncState, syncError, lastSyncedAt, unsynced, sync, signOut, changed } = useApp();
  const [busy, setBusy] = useState(false);

  const doExport = async () => {
    try {
      setBusy(true);
      const n = await exportCSV(db);
      if (n === 0) Alert.alert('Nothing to export yet');
    } catch (e) {
      Alert.alert('Export failed', String(e));
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    try {
      setBusy(true);
      const r = await importCSV(db);
      if (!r) return;
      changed();
      const lines = [`Imported ${r.imported} expense${r.imported === 1 ? '' : 's'}.`];
      if (r.duplicates) lines.push(`${r.duplicates} already existed and were skipped.`);
      if (r.skipped.length) {
        lines.push(`${r.skipped.length} row(s) skipped:`);
        lines.push(...r.skipped.slice(0, 5).map((s) => `• line ${s.line}: ${s.reason}`));
        if (r.skipped.length > 5) lines.push(`…and ${r.skipped.length - 5} more`);
      }
      Alert.alert('Import finished', lines.join('\n'));
    } catch (e) {
      Alert.alert('Import failed', String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmSignOut = () =>
    Alert.alert(
      'Sign out?',
      unsynced > 0
        ? `${unsynced} change(s) haven’t synced yet and will be lost. Sync first if you can.`
        : 'Your data is safely in the cloud and will come back when you sign in again. It will be removed from this phone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: signOut },
      ],
    );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SectionTitle>Cloud backup & sync</SectionTitle>
      <Card>
        {!supabase ? (
          <>
            <Text style={{ fontSize: 16, fontWeight: '600' }}>Offline mode</Text>
            <Text style={styles.muted}>
              Supabase isn’t configured in this build, so data is stored only on this phone. See README → “Set up
              Supabase” to turn on cloud sync.
            </Text>
          </>
        ) : session ? (
          <>
            <Text style={styles.muted}>Signed in as</Text>
            <Text style={{ fontSize: 16, fontWeight: '600' }}>{session.user.email}</Text>
            <View style={styles.row}>
              {syncState === 'syncing' ? <ActivityIndicator color={colors.primary} /> : null}
              <Text style={[styles.muted, { flex: 1 }]}>
                {syncState === 'syncing'
                  ? 'Syncing…'
                  : `Last synced ${ago(lastSyncedAt)}${unsynced ? ` · ${unsynced} change(s) waiting` : ' · all changes backed up'}`}
              </Text>
            </View>
            {syncState === 'error' && syncError ? (
              <Text style={{ color: colors.danger }}>Sync failed: {syncError}</Text>
            ) : null}
            <Button title="Sync now" variant="secondary" onPress={sync} disabled={syncState === 'syncing'} />
            <Button title="Sign out" variant="ghost" onPress={confirmSignOut} />
          </>
        ) : (
          <>
            <Text style={{ fontSize: 16, fontWeight: '600' }}>Back up your expenses</Text>
            <Text style={styles.muted}>
              Sign in to sync with the cloud so your data is safe if you lose or change your phone.
              {unsynced ? ` ${unsynced} item(s) on this phone will be uploaded.` : ''}
            </Text>
            <Button title="Sign in or create account" onPress={() => router.push('/login')} />
          </>
        )}
      </Card>

      {supabase ? (
        <Text style={[styles.muted, SUPABASE_URL_PROBLEM ? { color: colors.danger } : null]}>
          {SUPABASE_URL_PROBLEM ?? `Server: ${SUPABASE_HOST}`}
        </Text>
      ) : null}

      <SectionTitle>Data</SectionTitle>
      <Card>
        <Button title="Import bank statement (PDF)" onPress={() => router.push('/statement')} disabled={busy} />
        <Text style={styles.muted}>
          Reads a bank or credit card statement PDF, including password-protected ones, and lets you review the debits
          before adding them. Free. Needs sign-in.
        </Text>
      </Card>
      <Card>
        <Button title="Export to CSV" variant="secondary" onPress={doExport} disabled={busy} />
        <Button title="Import from CSV" variant="secondary" onPress={doImport} disabled={busy} />
        <Text style={styles.muted}>
          Import accepts this app’s export or a bank statement CSV with Date, Amount (or Debit/Withdrawal) and
          Description/Narration columns. Only debits are imported.
        </Text>
      </Card>

      <SectionTitle>Customise</SectionTitle>
      <Card>
        <Button title="Manage categories" variant="secondary" onPress={() => router.push('/categories')} />
      </Card>
    </ScrollView>
  );
}
