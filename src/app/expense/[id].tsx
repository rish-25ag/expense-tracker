import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useApp, useQuery } from '../../lib/store';
import {
  deleteExpense,
  listAccounts,
  getExpense,
  listBudgets,
  listCategories,
  listPeople,
  savePerson,
  saveExpense,
  spendByCategory,
} from '../../db/repo';
import { formatINR, parseAmount, round2, splitEqually } from '../../lib/money';
import { monthOf, today } from '../../lib/dates';
import { validateShares } from '../../lib/split';
import { ME, type EntryType, type Share } from '../../lib/types';
import { Button, Card, Chip, DateField, Field, colors, styles } from '../../components/ui';

type SplitMode = 'equal' | 'custom';

export default function ExpenseEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const db = useSQLiteContext();
  const { changed } = useApp();
  const navigation = useNavigation();
  const categories = useQuery(listCategories, [], []);
  const people = useQuery(listPeople, [], []);

  const [loaded, setLoaded] = useState(isNew);
  const [type, setType] = useState<EntryType>('expense');
  const [accountId, setAccountId] = useState<string | null>(null);
  const accounts = useQuery(listAccounts, [], []);
  const [amountText, setAmountText] = useState('');
  const [pickedCategoryId, setCategoryId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(today());
  const [isSplit, setIsSplit] = useState(false);
  const [withIds, setWithIds] = useState<string[]>([]); // people in the split, besides me
  const [paidBy, setPaidBy] = useState<string>(ME);
  const [mode, setMode] = useState<SplitMode>('equal');
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [newPerson, setNewPerson] = useState('');

  useEffect(() => {
    if (isNew) return;
    getExpense(db, id).then((e) => {
      if (!e) return router.back();
      setType(e.type);
      setAccountId(e.accountId);
      setAmountText(String(e.amount));
      setCategoryId(e.categoryId);
      setNote(e.note);
      setDate(e.date);
      setPaidBy(e.paidBy);
      if (e.shares.length) {
        setIsSplit(true);
        setWithIds(e.shares.filter((s) => s.personId !== ME).map((s) => s.personId));
        const eq = splitEqually(e.amount, e.shares.length);
        const isEqual = e.shares.every((s) => eq.includes(s.amount));
        setMode(isEqual ? 'equal' : 'custom');
        setCustom(Object.fromEntries(e.shares.map((s) => [s.personId, String(s.amount)])));
      }
      setLoaded(true);
    });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // New expenses default to the first category until the user picks one.
  const categoryId = pickedCategoryId ?? (isNew ? (categories[0]?.id ?? null) : null);
  useEffect(() => {
    const noun = type === 'credit' ? 'credit' : 'expense';
    navigation.setOptions({ title: isNew ? `Add ${noun}` : `Edit ${noun}` });
  }, [type, isNew, navigation]);

  const amount = parseAmount(amountText);
  const participants = [ME, ...withIds];
  const nameOf = (pid: string) => (pid === ME ? 'You' : (people.find((p) => p.id === pid)?.name ?? '?'));

  const shares: Share[] = useMemo(() => {
    if (!isSplit || withIds.length === 0) return [];
    if (mode === 'equal') {
      const parts = splitEqually(amount > 0 ? amount : 0, participants.length);
      return participants.map((pid, i) => ({
        personId: pid,
        amount: parts[i],
      }));
    }
    return participants.map((pid) => ({
      personId: pid,
      amount: parseAmount(custom[pid] ?? '') || 0,
    }));
  }, [isSplit, withIds, mode, amount, custom]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleWith = (pid: string) => {
    setWithIds((ids) => (ids.includes(pid) ? ids.filter((x) => x !== pid) : [...ids, pid]));
    if (paidBy === pid) setPaidBy(ME);
  };

  const addPerson = async () => {
    const name = newPerson.trim();
    if (!name) return;
    const pid = await savePerson(db, { name });
    setNewPerson('');
    setWithIds((ids) => [...ids, pid]);
    changed();
  };

  const save = async () => {
    if (!(amount > 0)) return Alert.alert('Enter an amount', 'The amount must be more than ₹0.');
    if (isSplit && withIds.length === 0) return Alert.alert('Pick people', 'Choose who you split this with.');
    if (shares.length) {
      const err = validateShares(amount, shares);
      if (err) return Alert.alert('Shares don’t add up', err);
    }
    const isCredit = type === 'credit';
    const finalPaidBy = shares.length && !isCredit ? paidBy : ME;
    await saveExpense(db, {
      id: isNew ? undefined : id,
      type,
      accountId,
      amount,
      categoryId,
      note,
      date,
      paidBy: finalPaidBy,
      shares: isCredit ? [] : shares,
    });
    changed();

    // Budget warning for this category's month (credits never count as spending).
    if (categoryId && !isCredit) {
      const budget = (await listBudgets(db)).find((b) => b.categoryId === categoryId);
      if (budget) {
        const spent = (await spendByCategory(db, monthOf(date)))[categoryId] ?? 0;
        const cat = categories.find((c) => c.id === categoryId);
        if (spent > budget.amount) {
          Alert.alert(
            '⚠️ Over budget',
            `${cat?.name}: ${formatINR(spent)} spent of ${formatINR(budget.amount)} this month (${formatINR(round2(spent - budget.amount))} over).`,
          );
        } else if (spent >= budget.amount * 0.8) {
          Alert.alert(
            'Heads up',
            `${cat?.name}: ${Math.round((spent / budget.amount) * 100)}% of this month’s budget used.`,
          );
        }
      }
    }
    router.back();
  };

  const remove = () =>
    Alert.alert(type === 'credit' ? 'Delete credit?' : 'Delete expense?', 'This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteExpense(db, id);
          changed();
          router.back();
        },
      },
    ]);

  if (!loaded) return <View style={styles.screen} />;

  const customSum = round2(shares.reduce((a, s) => a + s.amount, 0));

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label="Expense" selected={type === 'expense'} onPress={() => setType('expense')} />
          <Chip label="Credit" color={colors.success} selected={type === 'credit'} onPress={() => setType('credit')} />
        </View>
        <Card>
          <Text style={styles.label}>{type === 'credit' ? 'Amount received' : 'Amount'}</Text>
          <View style={[styles.row, { gap: 4 }]}>
            <Text style={[styles.big, { color: colors.muted }]}>₹</Text>
            <TextInput
              value={amountText}
              onChangeText={setAmountText}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.muted}
              autoFocus={isNew}
              style={[styles.big, { flex: 1, padding: 0 }]}
              accessibilityLabel="Amount in rupees"
            />
          </View>
        </Card>

        <Card>
          <Text style={styles.label}>Category</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {categories.map((c) => (
              <Chip
                key={c.id}
                label={`${c.icon} ${c.name}`}
                selected={categoryId === c.id}
                onPress={() => setCategoryId(c.id)}
                color={c.color}
              />
            ))}
          </View>
        </Card>

        <Card>
          <Field label="Note" value={note} onChangeText={setNote} placeholder="e.g. Dinner at Toit" />
          <DateField value={date} onChange={setDate} />
          {accountId ? (
            <Text style={styles.muted}>💳 {accounts.find((a) => a.id === accountId)?.name ?? 'Imported account'}</Text>
          ) : null}
        </Card>

        {type === 'expense' ? (
          <Card>
            <View style={styles.row}>
              <Text style={styles.rowText}>Split this expense</Text>
              <Switch value={isSplit} onValueChange={setIsSplit} trackColor={{ true: colors.primary }} />
            </View>
            {isSplit ? (
              <View style={{ gap: 12 }}>
                <Text style={styles.label}>With</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {people.map((p) => (
                    <Chip
                      key={p.id}
                      label={p.name}
                      selected={withIds.includes(p.id)}
                      onPress={() => toggleWith(p.id)}
                    />
                  ))}
                </View>
                <View style={styles.row}>
                  <TextInput
                    value={newPerson}
                    onChangeText={setNewPerson}
                    placeholder="Add a friend by name"
                    placeholderTextColor={colors.muted}
                    onSubmitEditing={addPerson}
                    returnKeyType="done"
                    style={[styles.input, { flex: 1 }]}
                  />
                  <Button title="Add" variant="secondary" onPress={addPerson} />
                </View>

                {withIds.length ? (
                  <>
                    <Text style={styles.label}>Paid by</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {participants.map((pid) => (
                        <Chip key={pid} label={nameOf(pid)} selected={paidBy === pid} onPress={() => setPaidBy(pid)} />
                      ))}
                    </View>

                    <Text style={styles.label}>Split</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Chip label="Equally" selected={mode === 'equal'} onPress={() => setMode('equal')} />
                      <Chip
                        label="Custom amounts"
                        selected={mode === 'custom'}
                        onPress={() => {
                          setCustom(Object.fromEntries(shares.map((s) => [s.personId, String(s.amount)])));
                          setMode('custom');
                        }}
                      />
                    </View>

                    {participants.map((pid, i) => (
                      <View key={pid} style={styles.row}>
                        <Text style={styles.rowText}>{nameOf(pid)}</Text>
                        {mode === 'equal' ? (
                          <Text style={{ fontSize: 16, color: colors.text }}>{formatINR(shares[i]?.amount ?? 0)}</Text>
                        ) : (
                          <TextInput
                            value={custom[pid] ?? ''}
                            onChangeText={(t) => setCustom((c) => ({ ...c, [pid]: t }))}
                            keyboardType="decimal-pad"
                            placeholder="0"
                            placeholderTextColor={colors.muted}
                            style={[
                              styles.input,
                              {
                                width: 120,
                                textAlign: 'right',
                                paddingVertical: 8,
                              },
                            ]}
                          />
                        )}
                      </View>
                    ))}
                    {mode === 'custom' && amount > 0 && customSum !== round2(amount) ? (
                      <Text style={{ color: colors.warning }}>
                        {customSum < amount
                          ? `${formatINR(round2(amount - customSum))} left to assign`
                          : `${formatINR(round2(customSum - amount))} more than the total`}
                      </Text>
                    ) : null}
                  </>
                ) : null}
              </View>
            ) : null}
          </Card>
        ) : null}

        <Button title={isNew ? (type === 'credit' ? 'Add credit' : 'Add expense') : 'Save changes'} onPress={save} />
        {!isNew ? (
          <Button title={type === 'credit' ? 'Delete credit' : 'Delete expense'} variant="danger" onPress={remove} />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
