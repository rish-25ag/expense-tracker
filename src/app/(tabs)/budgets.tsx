import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useApp, useQuery } from '../../lib/store';
import { listBudgets, listCategories, setBudget, spendByCategory } from '../../db/repo';
import { currentMonth } from '../../lib/dates';
import { formatINR, parseAmount, round2 } from '../../lib/money';
import { Button, Card, MonthSwitcher, ProgressBar, SectionTitle, colors, styles } from '../../components/ui';

export default function BudgetsScreen() {
  const db = useSQLiteContext();
  const { changed } = useApp();
  const [month, setMonth] = useState(currentMonth());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const categories = useQuery(listCategories, [], []);
  const budgets = useQuery(listBudgets, [], []);
  const spent = useQuery((db) => spendByCategory(db, month), [month], {} as Record<string, number>);

  const budgetOf = useMemo(() => Object.fromEntries(budgets.map((b) => [b.categoryId, b.amount])), [budgets]);
  const withBudget = categories.filter((c) => budgetOf[c.id]);
  const withoutBudget = categories.filter((c) => !budgetOf[c.id]);
  const totalBudget = withBudget.reduce((a, c) => a + budgetOf[c.id], 0);
  const totalSpent = round2(withBudget.reduce((a, c) => a + (spent[c.id] ?? 0), 0));

  const startEdit = (id: string) => {
    setEditing(id);
    setDraft(budgetOf[id] ? String(budgetOf[id]) : '');
  };

  const commit = async () => {
    if (!editing) return;
    const v = draft.trim() === '' ? 0 : parseAmount(draft);
    if (Number.isNaN(v) || v < 0) return Alert.alert('Invalid amount', 'Enter a monthly limit in rupees, or leave it empty to remove.');
    await setBudget(db, editing, v);
    setEditing(null);
    changed();
  };

  const renderRow = (c: (typeof categories)[number]) => {
    const limit = budgetOf[c.id] ?? 0;
    const s = spent[c.id] ?? 0;
    const isEditing = editing === c.id;
    return (
      <Card key={c.id}>
        <Pressable onPress={() => startEdit(c.id)} style={styles.row}>
          <Text style={{ fontSize: 20 }}>{c.icon}</Text>
          <Text style={styles.rowText}>{c.name}</Text>
          {limit ? (
            <Text style={{ color: s > limit ? colors.danger : colors.text, fontWeight: '600' }}>
              {formatINR(s)} / {formatINR(limit)}
            </Text>
          ) : (
            <Text style={{ color: colors.primary }}>Set budget</Text>
          )}
        </Pressable>
        {limit && !isEditing ? (
          <>
            <ProgressBar value={s} max={limit} />
            <Text style={[styles.muted, s > limit && { color: colors.danger }]}>
              {s > limit
                ? `⚠️ Over by ${formatINR(round2(s - limit))}`
                : `${formatINR(round2(limit - s))} left · ${Math.round((s / limit) * 100)}% used`}
            </Text>
          </>
        ) : null}
        {isEditing ? (
          <View style={styles.row}>
            <TextInput
              autoFocus
              value={draft}
              onChangeText={setDraft}
              keyboardType="decimal-pad"
              placeholder="Monthly limit, e.g. 5000"
              placeholderTextColor={colors.muted}
              onSubmitEditing={commit}
              style={[styles.input, { flex: 1 }]}
            />
            <Button title="Save" onPress={commit} />
            <Button title="Cancel" variant="ghost" onPress={() => setEditing(null)} />
          </View>
        ) : null}
      </Card>
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <MonthSwitcher month={month} onChange={setMonth} />
      {withBudget.length ? (
        <Card>
          <Text style={styles.muted}>Budgeted categories</Text>
          <Text style={styles.big}>
            {formatINR(totalSpent)} <Text style={{ fontSize: 16, color: colors.muted }}>of {formatINR(totalBudget)}</Text>
          </Text>
          <ProgressBar value={totalSpent} max={totalBudget} />
        </Card>
      ) : (
        <Card>
          <Text style={{ fontSize: 16, fontWeight: '600' }}>Set monthly budgets</Text>
          <Text style={styles.muted}>
            Tap a category below to give it a monthly limit. You’ll get a warning when an expense takes you past 80% and
            when you go over.
          </Text>
        </Card>
      )}
      {withBudget.length ? <SectionTitle>Budgets</SectionTitle> : null}
      {withBudget.map(renderRow)}
      {withoutBudget.length ? <SectionTitle>No budget</SectionTitle> : null}
      {withoutBudget.map(renderRow)}
      <Text style={styles.muted}>Budgets repeat every month. Leave the amount empty to remove one.</Text>
    </ScrollView>
  );
}
