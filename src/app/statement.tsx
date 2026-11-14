import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useApp, useQuery } from '../lib/store';
import { listCategories, listExpenses, saveExpense } from '../db/repo';
import { ParseError, parseStatementPdf, pickStatementPdf, type PickedPdf } from '../lib/statement';
import { buildReview, type ReviewRow } from '../lib/statementReview';
import { formatINR, round2 } from '../lib/money';
import { dayLabel } from '../lib/dates';
import { ME } from '../lib/types';
import { Button, Card, Chip, Field, colors, styles } from '../components/ui';

type Step = 'start' | 'password' | 'reading' | 'review';

export default function StatementImportScreen() {
  const db = useSQLiteContext();
  const { session, changed } = useApp();
  const categories = useQuery(listCategories, [], []);
  const [step, setStep] = useState<Step>('start');
  const [pdf, setPdf] = useState<PickedPdf | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [summary, setSummary] = useState({ creditsSkipped: 0, pages: 0, dropped: 0 });
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const catByName = useMemo(() => Object.fromEntries(categories.map((c) => [c.name, c])), [categories]);
  const selected = rows.filter((r) => r.selected);
  const selectedTotal = round2(selected.reduce((a, r) => a + r.amount, 0));

  const read = async (file: PickedPdf, pw?: string) => {
    setError(null);
    setStep('reading');
    try {
      const res = await parseStatementPdf(file.base64, pw, categories.map((c) => c.name));
      const review = buildReview(res.transactions, await listExpenses(db));
      setRows(review.rows);
      setSummary({ creditsSkipped: review.creditsSkipped, pages: res.pages, dropped: res.dropped });
      setStep('review');
    } catch (e) {
      if (e instanceof ParseError && (e.code === 'password_required' || e.code === 'wrong_password')) {
        setError(e.code === 'wrong_password' ? 'That password didn’t work. Try again.' : null);
        setStep('password');
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
      setStep('start');
    }
  };

  const choose = async () => {
    try {
      const file = await pickStatementPdf();
      if (!file) return;
      setPdf(file);
      setPassword('');
      await read(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggle = (key: string) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, selected: !r.selected } : r)));
  const setAll = (on: boolean) => setRows((rs) => rs.map((r) => ({ ...r, selected: on })));
  const setCategory = (key: string, category: string) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, category } : r)));
    setEditingKey(null);
  };

  const importSelected = async () => {
    setSaving(true);
    try {
      const other = categories.find((c) => c.id === 'cat_other')?.id ?? null;
      await db.withTransactionAsync(async () => {
        for (const r of selected) {
          await saveExpense(db, {
            amount: r.amount,
            categoryId: catByName[r.category]?.id ?? other,
            note: r.description,
            date: r.date,
            paidBy: ME,
            shares: [],
          });
        }
      });
      changed();
      Alert.alert('Statement imported', `Added ${selected.length} expense${selected.length === 1 ? '' : 's'} (${formatINR(selectedTotal)}).`);
      router.back();
    } catch (e) {
      Alert.alert('Import failed', String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!session) {
    return (
      <View style={[styles.screen, styles.content]}>
        <Card>
          <Text style={{ fontSize: 16, fontWeight: '600' }}>Sign in first</Text>
          <Text style={styles.muted}>Statements are read by your cloud server, so you need to be signed in.</Text>
          <Button title="Sign in" onPress={() => router.push('/login')} />
        </Card>
      </View>
    );
  }

  if (step === 'reading') {
    return (
      <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ fontSize: 16, fontWeight: '600' }}>Reading your statement…</Text>
        <Text style={[styles.muted, { textAlign: 'center' }]}>This usually takes 20–60 seconds. Keep the app open.</Text>
      </View>
    );
  }

  if (step === 'review') {
    return (
      <View style={styles.screen}>
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={[styles.content, { paddingBottom: 140 }]}
          ListHeaderComponent={
            <View style={{ gap: 12 }}>
              <Card>
                <Text style={{ fontSize: 16, fontWeight: '600' }}>
                  Found {rows.length} debit{rows.length === 1 ? '' : 's'} in {summary.pages} page{summary.pages === 1 ? '' : 's'}
                </Text>
                <Text style={styles.muted}>
                  Credits (salary, refunds, payments received) are skipped
                  {summary.creditsSkipped ? `: ${summary.creditsSkipped} skipped` : ''}. Transfers and possible duplicates
                  start unticked. Tap a category to change it.
                  {summary.dropped ? ` ${summary.dropped} unreadable row(s) were left out.` : ''}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Chip label="Select all" onPress={() => setAll(true)} />
                  <Chip label="Select none" onPress={() => setAll(false)} />
                </View>
              </Card>
            </View>
          }
          renderItem={({ item: r }) => {
            const cat = catByName[r.category] ?? catByName.Other;
            return (
              <Card style={{ paddingVertical: 12, opacity: r.selected ? 1 : 0.6 }}>
                <Pressable onPress={() => toggle(r.key)} style={styles.row} accessibilityRole="checkbox" accessibilityState={{ checked: r.selected }}>
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      borderWidth: 2,
                      borderColor: r.selected ? colors.primary : colors.border,
                      backgroundColor: r.selected ? colors.primary : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {r.selected ? <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>✓</Text> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15 }} numberOfLines={1}>{r.description}</Text>
                    <Text style={styles.muted}>{dayLabel(r.date)}</Text>
                  </View>
                  <Text style={{ fontSize: 15, fontWeight: '600' }}>{formatINR(r.amount)}</Text>
                </Pressable>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  <Chip
                    label={`${cat?.icon ?? '📦'} ${r.category}`}
                    selected={editingKey === r.key}
                    onPress={() => setEditingKey(editingKey === r.key ? null : r.key)}
                  />
                  {r.kind === 'transfer' ? <Badge text="Transfer / bill payment" color={colors.warning} bg={colors.warningSoft} /> : null}
                  {r.duplicate ? <Badge text="Already added?" color={colors.danger} bg={colors.dangerSoft} /> : null}
                </View>
                {editingKey === r.key ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {categories.map((c) => (
                      <Chip
                        key={c.id}
                        label={`${c.icon} ${c.name}`}
                        color={c.color}
                        selected={c.name === r.category}
                        onPress={() => setCategory(r.key, c.name)}
                      />
                    ))}
                  </View>
                ) : null}
              </Card>
            );
          }}
        />
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 24, gap: 8 }}>
          <Button
            title={selected.length ? `Add ${selected.length} expenses · ${formatINR(selectedTotal)}` : 'Select expenses to add'}
            onPress={importSelected}
            disabled={!selected.length || saving}
          />
        </View>
      </View>
    );
  }

  // start / password
  return (
    <View style={[styles.screen, styles.content]}>
      {step === 'password' && pdf ? (
        <Card>
          <Text style={{ fontSize: 16, fontWeight: '600' }}>🔒 {pdf.name} is password-protected</Text>
          <Text style={styles.muted}>
            Bank statement passwords are usually given in the email the statement came with, e.g. your customer ID, or
            part of your name with your date of birth.
          </Text>
          <Field
            label="PDF password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoFocus
            onSubmitEditing={() => password && read(pdf, password)}
          />
          {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
          <Button title="Unlock and read" onPress={() => read(pdf, password)} disabled={!password} />
          <Button title="Choose a different PDF" variant="ghost" onPress={choose} />
        </Card>
      ) : (
        <Card>
          <Text style={{ fontSize: 16, fontWeight: '600' }}>Import a bank or credit card statement</Text>
          <Text style={styles.muted}>
            Pick the PDF your bank emails you or that you download from net banking. AI reads every transaction, and you
            review them before anything is added. Only debits are imported.
          </Text>
          {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
          <Button title="Choose PDF" onPress={choose} />
          <Text style={styles.muted}>
            Privacy: the PDF and its password go to your own Supabase server, which unlocks it and sends the statement
            text to Anthropic’s Claude API to read. Your server doesn’t save the file or the password.
          </Text>
        </Card>
      )}
    </View>
  );
}

function Badge({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}
