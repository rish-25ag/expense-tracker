import { useMemo, useState } from 'react';
import { Pressable, SectionList, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '../../lib/store';
import { listBudgets, listCategories, listExpenses, listPeople } from '../../db/repo';
import { myShare } from '../../lib/split';
import { formatINR, round2 } from '../../lib/money';
import { currentMonth, dayLabel } from '../../lib/dates';
import { ME, type Expense } from '../../lib/types';
import { Card, Empty, MonthSwitcher, ProgressBar, colors, styles } from '../../components/ui';

export default function ExpensesScreen() {
  const [month, setMonth] = useState(currentMonth());
  const expenses = useQuery((db) => listExpenses(db, month), [month], [] as Expense[]);
  const categories = useQuery(listCategories, [], []);
  const people = useQuery(listPeople, [], []);
  const budgets = useQuery(listBudgets, [], []);

  const catById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);
  const nameById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p.name])), [people]);

  const { total, sections, over, budgetedSpent } = useMemo(() => {
    const byDay = new Map<string, Expense[]>();
    const byCat: Record<string, number> = {};
    let t = 0;
    for (const e of expenses) {
      const s = myShare(e);
      t += s;
      if (e.categoryId) byCat[e.categoryId] = (byCat[e.categoryId] ?? 0) + s;
      byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
    }
    return {
      total: round2(t),
      sections: [...byDay.entries()].map(([date, data]) => ({ date, data })),
      over: budgets.filter((b) => (byCat[b.categoryId] ?? 0) > b.amount && catById[b.categoryId]),
      // Compare budgets only against spending in the categories that have one.
      budgetedSpent: round2(
        budgets.filter((b) => catById[b.categoryId]).reduce((a, b) => a + (byCat[b.categoryId] ?? 0), 0),
      ),
    };
  }, [expenses, budgets, catById]);

  const budgetTotal = budgets.filter((b) => catById[b.categoryId]).reduce((a, b) => a + b.amount, 0);

  return (
    <View style={styles.screen}>
      <SectionList
        contentContainerStyle={styles.content}
        sections={sections}
        keyExtractor={(e) => e.id}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <MonthSwitcher month={month} onChange={setMonth} />
            <Card>
              <Text style={styles.muted}>You spent</Text>
              <Text style={styles.big}>{formatINR(total)}</Text>
              {budgetTotal > 0 ? (
                <>
                  <ProgressBar value={budgetedSpent} max={budgetTotal} />
                  <Text style={styles.muted}>
                    {budgetedSpent <= budgetTotal
                      ? `${formatINR(round2(budgetTotal - budgetedSpent))} left of ${formatINR(budgetTotal)} budgeted`
                      : `${formatINR(round2(budgetedSpent - budgetTotal))} over your ${formatINR(budgetTotal)} budgets`}
                  </Text>
                </>
              ) : null}
            </Card>
            {over.map((b) => (
              <Pressable key={b.id} onPress={() => router.navigate('/budgets')}>
                <View style={{ backgroundColor: colors.dangerSoft, borderRadius: 10, padding: 12 }}>
                  <Text style={{ color: colors.danger, fontWeight: '600' }}>
                    ⚠️ Over budget: {catById[b.categoryId].icon} {catById[b.categoryId].name}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={[styles.sectionTitle, { marginTop: 8 }]}>{dayLabel(section.date)}</Text>
        )}
        renderItem={({ item: e }) => {
          const cat = e.categoryId ? catById[e.categoryId] : undefined;
          const split = e.shares.length > 0;
          const mine = myShare(e);
          const payer = e.paidBy === ME ? 'You' : (nameById[e.paidBy] ?? 'Someone');
          return (
            <Pressable onPress={() => router.push(`/expense/${e.id}`)}>
              <Card style={{ paddingVertical: 12 }}>
                <View style={styles.row}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor: (cat?.color ?? '#8D8D8D') + '22',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 20 }}>{cat?.icon ?? '🏷️'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, color: colors.text }} numberOfLines={1}>
                      {e.note || cat?.name || 'Expense'}
                    </Text>
                    <Text style={styles.muted} numberOfLines={1}>
                      {cat?.name ?? 'Uncategorised'}
                      {split ? ` · split ${e.shares.length} ways · ${payer} paid` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>{formatINR(mine)}</Text>
                    {split ? <Text style={styles.muted}>of {formatINR(e.amount)}</Text> : null}
                  </View>
                </View>
              </Card>
            </Pressable>
          );
        }}
        ListEmptyComponent={<Empty title="No expenses this month" hint="Tap + to add your first one." />}
      />
      <Pressable
        style={styles.fab}
        onPress={() => router.push('/expense/new')}
        accessibilityLabel="Add expense"
        accessibilityRole="button"
      >
        <Text style={{ color: '#fff', fontSize: 32, lineHeight: 34 }}>+</Text>
      </Pressable>
    </View>
  );
}
