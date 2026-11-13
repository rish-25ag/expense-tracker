import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useQuery } from '../../lib/store';
import { listCategories, spendByCategory, spendByMonth } from '../../db/repo';
import { addMonths, currentMonth, monthLabel } from '../../lib/dates';
import { formatINR, round2 } from '../../lib/money';
import { Card, Empty, MonthSwitcher, SectionTitle, styles } from '../../components/ui';
import { CategoryBars, MonthlyBars } from '../../components/charts';

const TREND_MONTHS = 6;

export default function StatsScreen() {
  const [month, setMonth] = useState(currentMonth());
  const categories = useQuery(listCategories, [], []);
  const byCat = useQuery((db) => spendByCategory(db, month), [month], {} as Record<string, number>);
  const months = useMemo(
    () => Array.from({ length: TREND_MONTHS }, (_, i) => addMonths(month, i - TREND_MONTHS + 1)),
    [month],
  );
  const byMonth = useQuery((db) => spendByMonth(db, months), [months.join()], {} as Record<string, number>);

  const rows = useMemo(() => {
    const cats = Object.fromEntries(categories.map((c) => [c.id, c]));
    return Object.entries(byCat)
      .filter(([, total]) => total > 0)
      .map(([id, total]) => {
        const c = cats[id];
        return { key: id || 'none', label: c?.name ?? 'Uncategorised', icon: c?.icon ?? '🏷️', color: c?.color ?? '#8D8D8D', total };
      })
      .sort((a, b) => b.total - a.total);
  }, [byCat, categories]);

  const total = rows.reduce((a, r) => a + r.total, 0);
  const trend = months.map((m) => ({ month: m, total: byMonth[m] ?? 0 }));
  const prev = byMonth[addMonths(month, -1)] ?? 0;
  const nonZero = trend.filter((t) => t.total > 0);
  const avg = nonZero.length ? round2(nonZero.reduce((a, t) => a + t.total, 0) / nonZero.length) : 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <MonthSwitcher month={month} onChange={setMonth} />

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Card style={{ flex: 1 }}>
          <Text style={styles.muted}>Spent in {monthLabel(month, true)}</Text>
          <Text style={{ fontSize: 22, fontWeight: '700' }}>{formatINR(total)}</Text>
          {prev > 0 ? (
            <Text style={styles.muted}>
              {total >= prev ? '▲' : '▼'} {Math.abs(Math.round(((total - prev) / prev) * 100))}% vs last month
            </Text>
          ) : null}
        </Card>
        <Card style={{ flex: 1 }}>
          <Text style={styles.muted}>Monthly average</Text>
          <Text style={{ fontSize: 22, fontWeight: '700' }}>{formatINR(avg)}</Text>
          <Text style={styles.muted}>over {nonZero.length || 0} active months</Text>
        </Card>
      </View>

      <SectionTitle>By category</SectionTitle>
      <Card>
        {rows.length ? <CategoryBars rows={rows} /> : <Empty title="Nothing spent this month" />}
      </Card>

      <SectionTitle>Last {TREND_MONTHS} months</SectionTitle>
      <Card>
        <MonthlyBars key={month} data={trend} />
        <Text style={styles.muted}>Tap a bar to see that month. Split bills count only your share.</Text>
      </Card>
    </ScrollView>
  );
}
