import { Pressable, Text, View } from 'react-native';
import { Chip, DateField, colors, styles } from './ui';
import { isLatest, periodContaining, periodLabel, shiftPeriod, type Period, type PeriodKind } from '../lib/period';
import { today } from '../lib/dates';

const KINDS: { kind: PeriodKind; label: string }[] = [
  { kind: 'week', label: 'Week' },
  { kind: 'month', label: 'Month' },
  { kind: 'year', label: 'Year' },
  { kind: 'custom', label: 'Custom' },
];

/** Week / Month / Year / Custom chips, with ‹ › to move between periods and From–To pickers for Custom. */
export function PeriodSwitcher({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const now = today();
  const switchKind = (kind: PeriodKind) => {
    if (kind === period.kind) return;
    if (kind === 'custom') {
      // Start from the period being looked at, so switching to Custom keeps the same dates.
      onChange({ kind, start: period.start, end: period.end > now ? now : period.end });
    } else {
      const anchor = now >= period.start && now <= period.end ? now : period.start;
      onChange(periodContaining(kind, anchor));
    }
  };
  const latest = isLatest(period, now);
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center' }}>
        {KINDS.map((k) => (
          <Chip key={k.kind} label={k.label} selected={period.kind === k.kind} onPress={() => switchKind(k.kind)} />
        ))}
      </View>
      <View style={styles.monthRow}>
        <Pressable hitSlop={12} onPress={() => onChange(shiftPeriod(period, -1))} accessibilityLabel="Previous period">
          <Text style={styles.monthArrow}>‹</Text>
        </Pressable>
        <Text style={[styles.monthText, { minWidth: 150 }]}>{periodLabel(period)}</Text>
        <Pressable
          hitSlop={12}
          disabled={latest}
          onPress={() => onChange(shiftPeriod(period, 1))}
          accessibilityLabel="Next period"
        >
          <Text style={[styles.monthArrow, latest && { opacity: 0.25 }]}>›</Text>
        </Pressable>
      </View>
      {period.kind === 'custom' ? (
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <DateField
              label="From"
              value={period.start}
              onChange={(d) => onChange({ ...period, start: d, end: d > period.end ? d : period.end })}
            />
          </View>
          <View style={{ flex: 1 }}>
            <DateField
              label="To"
              value={period.end}
              onChange={(d) => onChange({ ...period, end: d, start: d < period.start ? d : period.start })}
            />
          </View>
        </View>
      ) : null}
      {period.kind === 'custom' && period.start > period.end ? (
        <Text style={{ color: colors.danger, textAlign: 'center' }}>“From” must be on or before “To”.</Text>
      ) : null}
    </View>
  );
}
