import { useMemo, useState } from 'react';
import { Pressable, ScrollView, SectionList, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '../../lib/store';
import { listAccounts, listBudgets, listCategories, listExpensesBetween, listPeople } from '../../db/repo';
import { myShare } from '../../lib/split';
import { formatINR, round2 } from '../../lib/money';
import { dayLabel, today } from '../../lib/dates';
import { periodContaining, periodLabel, type Period } from '../../lib/period';
import { ME, type Expense } from '../../lib/types';
import { Card, Chip, Empty, ProgressBar, colors, styles } from '../../components/ui';
import { PeriodSwitcher } from '../../components/PeriodSwitcher';

export default function ExpensesScreen() {
  const [period, setPeriod] = useState<Period>(() => periodContaining('month', today()));
  const expenses = useQuery(
    (db) => listExpensesBetween(db, period.start, period.end),
    [period.start, period.end],
    [] as Expense[],
  );
  const categories = useQuery(listCategories, [], []);
  const people = useQuery(listPeople, [], []);
  const budgets = useQuery(listBudgets, [], []);
  const accounts = useQuery(listAccounts, [], []);
  /** null = all accounts. */
  const [accountId, setAccountId] = useState<string | null>(null);
  const acctById = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);
  // Budgets are monthly, so they're shown when a calendar month is selected.
  const showBudgets = period.kind === 'month' && !accountId;

  const catById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);
  const nameById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p.name])), [people]);

  const { total, credited, sections, over, budgetedSpent } = useMemo(() => {
    const byDay = new Map<string, Expense[]>();
    const byCat: Record<string, number> = {};
    let t = 0;
    let c = 0;
    for (const e of expenses) {
      if (accountId && e.accountId !== accountId) continue;
      byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
      // Credits are shown, but never count as spending.
      if (e.type === 'credit') {
        c += e.amount;
        continue;
      }
      const s = myShare(e);
      t += s;
      if (e.categoryId) byCat[e.categoryId] = (byCat[e.categoryId] ?? 0) + s;
    }
    return {
      total: round2(t),
      credited: round2(c),
      sections: [...byDay.entries()].map(([date, data]) => ({
        date,
        data,
        // Day totals: my share of expenses, and credits separately.
        spent: round2(data.filter((e) => e.type !== 'credit').reduce((a, e) => a + myShare(e), 0)),
        credited: round2(data.filter((e) => e.type === 'credit').reduce((a, e) => a + e.amount, 0)),
      })),
      over: budgets.filter((b) => (byCat[b.categoryId] ?? 0) > b.amount && catById[b.categoryId]),
      // Compare budgets only against spending in the categories that have one.
      budgetedSpent: round2(
        budgets.filter((b) => catById[b.categoryId]).reduce((a, b) => a + (byCat[b.categoryId] ?? 0), 0),
      ),
    };
  }, [expenses, budgets, catById, accountId]);

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
            <PeriodSwitcher period={period} onChange={setPeriod} />
            {accounts.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                <Chip label="All accounts" selected={accountId === null} onPress={() => setAccountId(null)} />
                {accounts.map((a) => (
                  <Chip
                    key={a.id}
                    label={`💳 ${a.name}`}
                    selected={accountId === a.id}
                    onPress={() => setAccountId(a.id)}
                  />
                ))}
              </ScrollView>
            ) : null}
            <Card>
              <Text style={styles.muted}>
                {accountId ? `Spent on ${acctById[accountId]?.name ?? 'this account'}` : 'You spent'} ·{' '}
                {periodLabel(period)}
              </Text>
              <Text style={styles.big}>{formatINR(total)}</Text>
              {credited > 0 ? (
                <Text style={{ color: colors.success, fontWeight: '600' }}>Credited +{formatINR(credited)}</Text>
              ) : null}
              {showBudgets && budgetTotal > 0 ? (
                <>
                  <ProgressBar value={budgetedSpent} max={budgetTotal} />
                  <Text style={styles.muted}>
                    {budgetedSpent <= budgetTotal
                      ? `${formatINR(round2(budgetTotal - budgetedSpent))} left of ${formatINR(budgetTotal)} budgeted`
                      : `${formatINR(round2(budgetedSpent - budgetTotal))} over your ${formatINR(budgetTotal)} budgets`}
                  </Text>
                </>
              ) : null}
              {showBudgets ? (
                <Text
                  onPress={() => router.navigate('/budgets')}
                  accessibilityRole="button"
                  style={{ color: colors.primary, fontWeight: '600' }}
                >
                  {budgetTotal > 0 ? '✏️ Edit budgets' : '🎯 Set monthly budgets'}
                </Text>
              ) : null}
            </Card>
            {(showBudgets ? over : []).map((b) => (
              <Pressable key={b.id} onPress={() => router.navigate('/budgets')}>
                <View
                  style={{
                    backgroundColor: colors.dangerSoft,
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  <Text style={{ color: colors.danger, fontWeight: '600' }}>
                    ⚠️ Over budget: {catById[b.categoryId].icon} {catById[b.categoryId].name}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={[styles.row, { marginTop: 8, justifyContent: 'space-between' }]}>
            <Text style={styles.sectionTitle}>{dayLabel(section.date)}</Text>
            <Text style={styles.sectionTitle}>
              {section.spent > 0 ? formatINR(section.spent) : ''}
              {section.spent > 0 && section.credited > 0 ? ' · ' : ''}
              {section.credited > 0 ? (
                <Text style={{ color: colors.success }}>+{formatINR(section.credited)}</Text>
              ) : null}
            </Text>
          </View>
        )}
        renderItem={({ item: e }) => {
          const cat = e.categoryId ? catById[e.categoryId] : undefined;
          const split = e.shares.length > 0;
          const mine = myShare(e);
          const payer = e.paidBy === ME ? 'You' : (nameById[e.paidBy] ?? 'Someone');
          const isCredit = e.type === 'credit';
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
                      {isCredit ? 'Credit' : (cat?.name ?? 'Uncategorised')}
                      {split ? ` · split ${e.shares.length} ways · ${payer} paid` : ''}
                      {e.accountId && !accountId ? ` · ${acctById[e.accountId]?.name ?? ''}` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: '600',
                        color: isCredit ? colors.success : colors.text,
                      }}
                    >
                      {isCredit ? `+${formatINR(e.amount)}` : formatINR(mine)}
                    </Text>
                    {split ? <Text style={styles.muted}>of {formatINR(e.amount)}</Text> : null}
                  </View>
                </View>
              </Card>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Empty
            title={accountId ? 'Nothing on this account in this period' : 'No expenses in this period'}
            hint="Tap + to add one, or import a statement from Settings."
          />
        }
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
