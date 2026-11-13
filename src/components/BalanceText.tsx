import { Text, View } from 'react-native';
import { formatINR } from '../lib/money';
import { colors, styles } from './ui';

export function BalanceText({ balance }: { balance: number }) {
  if (Math.abs(balance) < 0.01) return <Text style={styles.muted}>settled up</Text>;
  const owesMe = balance > 0;
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <Text style={styles.muted}>{owesMe ? 'owes you' : 'you owe'}</Text>
      <Text style={{ fontWeight: '700', fontSize: 16, color: owesMe ? colors.success : colors.danger }}>
        {formatINR(Math.abs(balance))}
      </Text>
    </View>
  );
}
