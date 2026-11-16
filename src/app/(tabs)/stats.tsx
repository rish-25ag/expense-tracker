import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useQuery } from '../../lib/store';
import { listCategories, spendByCategoryBetween, spendByRanges } from '../../db/repo';
import { today } from '../../lib/dates';
import { formatINR, round2 } from '../../lib/money';
import {
  daysElapsed,
  periodContaining,
  periodLabel,
  selectedBucketIndex,
  shiftPeriod,
  trendBuckets,
  type Period,
} from '../../lib/period';
import { Card, Empty, SectionTitle, styles } from '../../components/ui';
import { CategoryBars, TrendBars } from '../../components/charts';
import { PeriodSwitcher } from '../../components/PeriodSwitcher';

const PREVIOUS: Record<Period['kind'], string> = {
  week: 'last week',
  month: 'last month',
  year: 'last year',
  custom: 'the previous period',
};

export default function StatsScreen() {
  const [period, setPeriod] = useState<Period>(() => periodContaining('month', today()));
  const prev = useMemo(() => shiftPeriod(period, -1), [period]);
  const buckets = useMemo(() => trendBuckets(period), [period]);

  const categories = useQuery(listCategories, [], []);
  const byCat = useQuery(
    (db) => spendByCategoryBetween(db, period.start, period.end),
    [period.start, period.end],
    {} as Record<string, number>,
  );
  const totals = useQuery(
    (db) => spendByRanges(db, [...buckets, { key: '__prev', start: prev.start, end: prev.end }]),
    [buckets.map((b) => b.key).join(), prev.start, prev.end],
    {} as Record<string, number>,
  );

  const rows = useMemo(() => {
    const cats = Object.fromEntries(categories.map((c) => [c.id, c]));
    return Object.entries(byCat)
      .filter(([, total]) => total > 0)
      .map(([id, total]) => {
        const c = cats[id];
        return {
          key: id || 'none',
          label: c?.name ?? 'Uncategorised',
          icon: c?.icon ?? '🏷️',
          color: c?.color ?? '#8D8D8D',
          total,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [byCat, categories]);

  const total = round2(rows.reduce((a, r) => a + r.total, 0));
  const previous = totals.__prev ?? 0;
  const perDay = round2(total / daysElapsed(period, today()));
  const trend = buckets.map((b) => ({ key: b.key, label: b.label, title: b.title, total: totals[b.key] ?? 0 }));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <PeriodSwitcher period={period} onChange={setPeriod} />

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Card style={{ flex: 1 }}>
          <Text style={styles.muted}>Spent · {periodLabel(period)}</Text>
          <Text style={{ fontSize: 22, fontWeight: '700' }}>{formatINR(total)}</Text>
          {previous > 0 ? (
            <Text style={styles.muted}>
              {total >= previous ? '▲' : '▼'} {Math.abs(Math.round(((total - previous) / previous) * 100))}% vs{' '}
              {PREVIOUS[period.kind]}
            </Text>
          ) : null}
        </Card>
        <Card style={{ flex: 1 }}>
          <Text style={styles.muted}>Per day</Text>
          <Text style={{ fontSize: 22, fontWeight: '700' }}>{formatINR(perDay)}</Text>
          <Text style={styles.muted}>average so far</Text>
        </Card>
      </View>

      <SectionTitle>By category</SectionTitle>
      <Card>{rows.length ? <CategoryBars rows={rows} /> : <Empty title="Nothing spent in this period" />}</Card>

      <SectionTitle>Over time</SectionTitle>
      <Card>
        <TrendBars
          key={`${period.kind}|${period.start}|${period.end}`}
          data={trend}
          initial={selectedBucketIndex(period, buckets, today())}
        />
        <Text style={styles.muted}>
          Tap a bar to see its total. Split bills count only your share; credits aren’t spending.
        </Text>
      </Card>
    </ScrollView>
  );
}
