import { useState } from 'react';
import { Alert, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useApp, useQuery } from '../../lib/store';
import { savePerson } from '../../db/repo';
import { findAccount } from '../../lib/accounts';
import { loadBalances } from '../../lib/splitData';
import { formatINR, round2 } from '../../lib/money';
import { Button, Card, Empty, SectionTitle, colors, styles } from '../../components/ui';
import { BalanceText } from '../../components/BalanceText';

export default function SplitScreen() {
  const db = useSQLiteContext();
  const { changed, session } = useApp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = useQuery(loadBalances, [], []);

  const owedToMe = round2(rows.filter((r) => r.balance > 0).reduce((a, r) => a + r.balance, 0));
  const iOwe = round2(rows.filter((r) => r.balance < 0).reduce((a, r) => a - r.balance, 0));

  const add = async () => {
    const mail = email.trim();
    if (!mail) {
      if (!name.trim()) return;
      await savePerson(db, { name });
      setName('');
      changed();
      return;
    }
    if (!session) return Alert.alert('Sign in first', 'Sign in (Settings) to link friends by their account email.');
    if (!/^\S+@\S+\.\S+$/.test(mail)) return Alert.alert('Check the email', 'That doesn’t look like an email address.');
    setBusy(true);
    try {
      const account = await findAccount(mail);
      if (!account) {
        Alert.alert(
          'No account with that email',
          'Ask them to create an account in this app first, or add them by name only (leave the email empty).',
        );
        return;
      }
      if (account.id === session.user.id) return Alert.alert('That’s you', 'Enter a friend’s email.');
      if (rows.some((r) => r.person.userId === account.id)) {
        return Alert.alert('Already added', 'This friend is already linked to that account.');
      }
      await savePerson(db, { name: name.trim() || account.name, userId: account.id, email: mail });
      setName('');
      setEmail('');
      changed();
      Alert.alert(
        'Friend linked',
        `Expenses you split with ${name.trim() || account.name} will appear in their app, and they can edit them too.`,
      );
    } catch (e) {
      Alert.alert('Could not look up the email', String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const shareSummary = () => {
    const lines = rows
      .filter((r) => Math.abs(r.balance) >= 0.01)
      .map((r) =>
        r.balance > 0
          ? `• ${r.person.name} owes me ${formatINR(r.balance)}`
          : `• I owe ${r.person.name} ${formatINR(-r.balance)}`,
      );
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
                <Text style={styles.rowText}>
                  {person.name}
                  {person.userId ? <Text style={styles.muted}> 🔗</Text> : null}
                </Text>
                <BalanceText balance={balance} />
              </View>
            </Card>
          </Pressable>
        ))
      )}

      <Card>
        <Text style={styles.label}>Add a friend</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name"
          placeholderTextColor={colors.muted}
          returnKeyType="next"
          style={styles.input}
        />
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Their account email (optional)"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          keyboardType="email-address"
          onSubmitEditing={add}
          returnKeyType="done"
          style={styles.input}
        />
        <Text style={styles.muted}>
          With an email, expenses you split with them also show in their app (they need an account in this app).
        </Text>
        <Button title={email.trim() ? 'Find and add' : 'Add'} onPress={add} disabled={busy} />
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
