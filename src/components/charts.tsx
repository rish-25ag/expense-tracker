import React, { useState } from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';
import { colors, styles } from './ui';
import { formatINR } from '../lib/money';

/** Bar with only its top corners rounded (4px), anchored to the baseline. */
function barPath(x: number, y: number, w: number, h: number, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

export interface TrendPoint {
  key: string;
  /** Short axis label ("Mon", "12", "Nov"). */
  label: string;
  /** Full label shown above the chart for the selected bar ("Nov 2026"). */
  title: string;
  total: number;
}

/**
 * Spending over time, one series (days or months). Tap a bar to see its exact
 * value; the selected bar is drawn in full ink, the rest muted.
 */
export function TrendBars({ data, initial }: { data: TrendPoint[]; initial?: number }) {
  const [width, setWidth] = useState(0);
  const [sel, setSel] = useState(initial ?? data.length - 1);
  const height = 150;
  const top = 8;
  const bottom = 22;
  const plotH = height - top - bottom;
  const max = Math.max(...data.map((d) => d.total), 1);
  const slot = width / Math.max(data.length, 1);
  const barW = Math.min(slot * 0.55, 36);
  const active = data[Math.min(sel, data.length - 1)];

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>
          {active ? formatINR(active.total) : '–'}
        </Text>
        <Text style={styles.muted}>{active ? active.title : ''}</Text>
      </View>
      <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            <Line x1={0} x2={width} y1={top + plotH} y2={top + plotH} stroke={colors.border} strokeWidth={1} />
            {data.map((d, i) => {
              const h = (d.total / max) * plotH;
              const x = i * slot + (slot - barW) / 2;
              return (
                <React.Fragment key={d.key}>
                  <Path d={barPath(x, top + plotH - h, barW, h)} fill={colors.primary} opacity={i === sel ? 1 : 0.35} />
                  <SvgText
                    x={i * slot + slot / 2}
                    y={height - 6}
                    fontSize={11}
                    fill={i === sel ? colors.text : colors.muted}
                    fontWeight={i === sel ? '700' : '400'}
                    textAnchor="middle"
                  >
                    {data.length > 12 && i % Math.ceil(data.length / 10) !== 0 && i !== sel ? '' : d.label}
                  </SvgText>
                </React.Fragment>
              );
            })}
          </Svg>
        ) : null}
        {/* Full-height hit targets, wider than the bars. */}
        <View style={{ position: 'absolute', inset: 0, flexDirection: 'row' }}>
          {data.map((d, i) => (
            <Pressable
              key={d.key}
              style={{ flex: 1 }}
              onPress={() => setSel(i)}
              accessibilityLabel={`${d.title}: ${formatINR(d.total)}`}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

/**
 * Spend by category as a sorted, labelled bar list: easier to compare than a
 * pie, and every row is named, so identity never depends on color alone.
 */
export function CategoryBars({
  rows,
  onPress,
}: {
  rows: { key: string; label: string; icon: string; color: string; total: number }[];
  onPress?: (key: string) => void;
}) {
  const max = Math.max(...rows.map((r) => r.total), 1);
  const sum = rows.reduce((a, r) => a + r.total, 0);
  return (
    <View style={{ gap: 12 }}>
      {rows.map((r) => (
        <Pressable key={r.key} onPress={() => onPress?.(r.key)} style={{ gap: 5 }}>
          <View style={styles.row}>
            <Text style={{ fontSize: 16 }}>{r.icon}</Text>
            <Text style={[styles.rowText, { fontSize: 15 }]} numberOfLines={1}>
              {r.label}
            </Text>
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>{formatINR(r.total)}</Text>
            <Text style={[styles.muted, { width: 38, textAlign: 'right' }]}>
              {sum > 0 ? Math.round((r.total / sum) * 100) : 0}%
            </Text>
          </View>
          <View style={{ height: 8, flexDirection: 'row' }}>
            <View
              style={{
                width: `${(r.total / max) * 100}%`,
                backgroundColor: r.color,
                borderRadius: 4,
              }}
            />
          </View>
        </Pressable>
      ))}
    </View>
  );
}
