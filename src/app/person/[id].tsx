import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useApp, useQuery } from '../../lib/store';
import {
  addSettlement,
  deletePerson,
  deleteSettlement,
  listExpensesWithPerson,
  listPeople,
  listSettlements,
  savePerson,
} from '../../db/repo';
import { balances } from '../../lib/split';
import { formatINR, parseAmount } from '../../lib/money';
import { dayLabel, today } from '../../lib/dates';
import { ME } from '../../lib/types';
import { BalanceText } from '../../components/BalanceText';
import { Button, Card, Empty, Field, SectionTitle, colors, styles } from '../../components/ui';

export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const { changed } = useApp();
  const navigation = useNavigation();
  const people = useQuery(listPeople, [], []);
  const expenses = useQuery((db) => listExpensesWithPerson(db, id), [id], []);
  const settlements = useQuery((db) => listSettlements(db, id), [id], []);
  const [settleAmount, setSettleAmount] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);

  const person = people.find((p) => p.id === id);
  useEffect(() => {
    if (person) navigation.setOptions({ title: person.name });
  }, [person?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const balance = useMemo(() => balances(expenses, settlements)[id] ?? 0, [expenses, settlements, id]);

  // A single timeline of split expenses and settlements, newest first.
  const history = useMemo(() => {
    const items = [
      ...expenses.map((e) => {
        const theirs = e.shares.find((s) => s.personId === id)?.amount ?? 0;
        const mine = e.shares.find((s) => s.personId === ME)?.amount ?? 0;
        const effect = e.paidBy === ME ? theirs : e.paidBy === id ? -mine : 0;
        return {
          key: e.id,
          date: e.date,
          title: e.note || 'Split expense',
          sub: `${e.paidBy === ME ? 'You' : e.paidBy === id ? person?.name : 'Someone else'} paid ${formatINR(e.amount)}`,
          effect,
          onPress: () => router.push(`/expense/${e.id}`),
        };
      }),
      ...settlements.map((s) => ({
        key: s.id,
        date: s.date,
        title: s.direction === 'received' ? `${person?.name} paid you` : `You paid ${person?.name}`,
        sub: 'Settlement',
        effect: s.direction === 'received' ? -s.amount : s.amount,
        onPress: () =>
          Alert.alert('Delete this settlement?', undefined, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: async () => {
                await deleteSettlement(db, s.id);
                changed();
              },
            },
          ]),
      })),
    ];
    return items.sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses, settlements, person?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!person) return <View style={styles.screen} />;

  const settle = async (full: boolean) => {
    const amt = full ? Math.abs(balance) : parseAmount(settleAmount);
    if (!(amt > 0)) return Alert.alert('Enter an amount');
    // If they owe me, a settlement is money I received; otherwise money I paid.
    await addSettlement(db, {
      personId: id,
      amount: amt,
      direction: balance > 0 ? 'received' : 'paid',
      date: today(),
      note: '',
    });
    setSettleAmount('');
    changed();
  };

  const remind = () => {
    const msg =
      balance > 0
        ? `Hi ${person.name}, just a reminder: you owe me ${formatINR(balance)}. 🙂`
        : balance < 0
          ? `Hi ${person.name}, I owe you ${formatINR(-balance)}. Will settle soon!`
          : `Hi ${person.name}, we're all settled up! 🎉`;
    Share.share({ message: msg });
  };

  const remove = () =>
    Alert.alert(
      `Remove ${person.name}?`,
      Math.abs(balance) >= 0.01
        ? 'You still have an unsettled balance with them. Their past split expenses stay in your history.'
        : 'Their past split expenses stay in your history.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await deletePerson(db, id);
            changed();
            router.back();
          },
        },
      ],
    );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card style={{ alignItems: 'center' }}>
        <BalanceText balance={balance} />
        <Button title="Share reminder" variant="secondary" onPress={remind} style={{ alignSelf: 'stretch' }} />
      </Card>

      {Math.abs(balance) >= 0.01 ? (
        <Card>
          <Text style={{ fontSize: 16, fontWeight: '600' }}>Settle up</Text>
          <Text style={styles.muted}>
            {balance > 0 ? `Record money ${person.name} paid you.` : `Record money you paid ${person.name}.`}
          </Text>
          <Button title={`Settle full ${formatINR(Math.abs(balance))}`} onPress={() => settle(true)} />
          <View style={styles.row}>
            <TextInput
              value={settleAmount}
              onChangeText={setSettleAmount}
              keyboardType="decimal-pad"
              placeholder="Partial amount"
              placeholderTextColor={colors.muted}
              style={[styles.input, { flex: 1 }]}
            />
            <Button title="Record" variant="secondary" onPress={() => settle(false)} />
          </View>
        </Card>
      ) : null}

      <SectionTitle>History</SectionTitle>
      {history.length === 0 ? (
        <Card>
          <Empty title="Nothing shared yet" />
        </Card>
      ) : (
        history.map((h) => (
          <Pressable key={h.key} onPress={h.onPress}>
          <Card style={{ paddingVertical: 12 }}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16 }}>{h.title}</Text>
                <Text style={styles.muted}>
                  {dayLabel(h.date)} · {h.sub}
                </Text>
              </View>
              <Text style={{ fontWeight: '600', color: h.effect > 0 ? colors.success : h.effect < 0 ? colors.danger : colors.muted }}>
                {h.effect > 0 ? '+' : h.effect < 0 ? '−' : ''}
                {formatINR(Math.abs(h.effect))}
              </Text>
            </View>
          </Card>
          </Pressable>
        ))
      )}
      <Text style={styles.muted}>+ means it adds to what {person.name} owes you; − reduces it.</Text>

      <SectionTitle>Manage</SectionTitle>
      <Card>
        {renaming !== null ? (
          <>
            <Field label="Name" value={renaming} onChangeText={setRenaming} autoFocus />
            <Button
              title="Save name"
              onPress={async () => {
                if (!renaming.trim()) return;
                await savePerson(db, { id, name: renaming });
                setRenaming(null);
                changed();
              }}
            />
          </>
        ) : (
          <Button title="Rename" variant="secondary" onPress={() => setRenaming(person.name)} />
        )}
        <Button title={`Remove ${person.name}`} variant="danger" onPress={remove} />
      </Card>
    </ScrollView>
  );
}
