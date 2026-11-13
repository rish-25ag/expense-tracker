import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { addMonths, currentMonth, dayLabel, monthLabel, toISODate } from '../lib/dates';

export const colors = {
  bg: '#F5F6FA',
  card: '#FFFFFF',
  text: '#1C1C28',
  muted: '#6B7080',
  border: '#E3E5EC',
  primary: '#4F46E5',
  primarySoft: '#EEF0FF',
  danger: '#DC2626',
  dangerSoft: '#FDECEC',
  warning: '#D97706',
  warningSoft: '#FFF4E0',
  success: '#059669',
  successSoft: '#E6F6F0',
};

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const v = {
    primary: { bg: colors.primary, fg: '#fff' },
    secondary: { bg: colors.primarySoft, fg: colors.primary },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    ghost: { bg: 'transparent', fg: colors.primary },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: v.bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      <Text style={[styles.buttonText, { color: v.fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput placeholderTextColor={colors.muted} {...props} style={[styles.input, props.style]} />
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  color,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  color?: string;
}) {
  const c = color ?? colors.primary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityState={{ selected }}
      style={[
        styles.chip,
        selected ? { backgroundColor: c, borderColor: c } : { borderColor: colors.border },
      ]}
    >
      <Text style={{ color: selected ? '#fff' : colors.text, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

export function MonthSwitcher({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const isCurrent = month >= currentMonth();
  return (
    <View style={styles.monthRow}>
      <Pressable hitSlop={12} onPress={() => onChange(addMonths(month, -1))} accessibilityLabel="Previous month">
        <Text style={styles.monthArrow}>‹</Text>
      </Pressable>
      <Text style={styles.monthText}>{monthLabel(month)}</Text>
      <Pressable
        hitSlop={12}
        disabled={isCurrent}
        onPress={() => onChange(addMonths(month, 1))}
        accessibilityLabel="Next month"
      >
        <Text style={[styles.monthArrow, isCurrent && { opacity: 0.25 }]}>›</Text>
      </Pressable>
    </View>
  );
}

export function ProgressBar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const over = value > max;
  const ratio = max > 0 ? value / max : 0;
  const fill = color ?? (over ? colors.danger : ratio >= 0.8 ? colors.warning : colors.success);
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: fill }]} />
    </View>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={{ alignItems: 'center', padding: 32, gap: 6 }}>
      <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>{title}</Text>
      {hint ? <Text style={{ color: colors.muted, textAlign: 'center' }}>{hint}</Text> : null}
    </View>
  );
}

/** Tap to pick a date. Android uses the system dialog, iOS shows an inline calendar. */
export function DateField({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const [showIOS, setShowIOS] = useState(false);
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const open = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: date,
        mode: 'date',
        maximumDate: new Date(),
        onChange: (e, picked) => e.type === 'set' && picked && onChange(toISODate(picked)),
      });
    } else setShowIOS((s) => !s);
  };
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>Date</Text>
      <Pressable onPress={open} style={styles.input}>
        <Text style={{ color: colors.text, fontSize: 16 }}>📅 {dayLabel(value)}</Text>
      </Pressable>
      {showIOS && Platform.OS === 'ios' ? (
        <DateTimePicker
          value={date}
          mode="date"
          display="inline"
          maximumDate={new Date()}
          onChange={(_e, picked) => {
            if (picked) onChange(toISODate(picked));
            setShowIOS(false);
          }}
        />
      ) : null}
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12, paddingBottom: 96 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  button: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
  label: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.card },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 },
  monthArrow: { fontSize: 30, color: colors.primary, lineHeight: 32, paddingHorizontal: 8 },
  monthText: { fontSize: 17, fontWeight: '600', color: colors.text, minWidth: 110, textAlign: 'center' },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1, fontSize: 16, color: colors.text },
  muted: { color: colors.muted, fontSize: 13 },
  big: { fontSize: 30, fontWeight: '700', color: colors.text },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    backgroundColor: colors.primary,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
});
