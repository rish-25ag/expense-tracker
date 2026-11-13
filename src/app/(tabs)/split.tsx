import { useState } from 'react';
import { Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useApp, useQuery } from '../../lib/store';
import { savePerson } from '../../db/repo';
import { loadBalances } from '../../lib/splitData';
import { formatINR, round2 } from '../../lib/money';
import { Button, Card, Empty, SectionTitle, colors, styles } from '../../components/ui';
import { BalanceText } from '../../components/BalanceText';

export default function SplitScreen() {
  const db = useSQLiteContext();
  const { changed } = useApp();
  const [name, setName] = useState('');
  const rows = useQuery(loadBalances, [], []);

  const owedToMe = round2(rows.filter((r) => r.balance > 0).reduce((a, r) => a + r.balance, 0));
  const iOwe = round2(rows.filter((r) => r.balance < 0).reduce((a, r) => a - r.balance, 0));

  const add = async () => {
    if (!name.trim()) return;
    await savePerson(db, { name });
    setName('');
    changed();
  };

  const shareSummary = () => {
    const lines = rows
      .filter((r) => Math.abs(r.balance) >= 0.01)
      .map((r) => (r.balance > 0 ? `• ${r.person.name} owes me ${formatINR(r.balance)}` : `• I owe ${r.person.name} ${formatINR(-r.balance)}`));
    Share.share({ message: lines.length ? `Balances:\n${lines.join('\n')}` : 'All settled up! 🎉' });
  };

  const sorted = [...rows].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Card style={{ flex: 1 }}>
          <Text style={styles.muted}>You are owed</Text>
          <Text style={{ fontSize: 22, fontWeight: '700', color: colors.success }}>{formatINR(owedToMe)}</Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text style={styles.muted}>You owe</Text>
          <Text style={{ fontSize: 22, fontWeight: '700', color: colors.danger }}>{formatINR(iOwe)}</Text>
        </Card>
      </View>

      <SectionTitle right={rows.length ? <Button title="Share" variant="ghost" onPress={shareSummary} /> : null}>
        Friends
      </SectionTitle>
      {sorted.length === 0 ? (
        <Card>
          <Empty
            title="No friends added yet"
            hint="Add people below, then turn on “Split this expense” when adding an expense. They don’t need the app."
          />
        </Card>
      ) : (
        sorted.map(({ person, balance }) => (
          <Pressable key={person.id} onPress={() => router.push(`/person/${person.id}`)}>
            <Card style={{ paddingVertical: 14 }}>
              <View style={styles.row}>
                <View style={avatar}>
                  <Text style={{ color: colors.primary, fontWeight: '700' }}>{person.name[0]?.toUpperCase()}</Text>
                </View>
                <Text style={styles.rowText}>{person.name}</Text>
                <BalanceText balance={balance} />
              </View>
            </Card>
          </Pressable>
        ))
      )}

      <Card>
        <Text style={styles.label}>Add a friend</Text>
        <View style={styles.row}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Name"
            placeholderTextColor={colors.muted}
            onSubmitEditing={add}
            returnKeyType="done"
            style={[styles.input, { flex: 1 }]}
          />
          <Button title="Add" onPress={add} />
        </View>
      </Card>
    </ScrollView>
  );
}

const avatar = {
  width: 36,
  height: 36,
  borderRadius: 18,
  backgroundColor: colors.primarySoft,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};
