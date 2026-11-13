import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useApp, useQuery } from '../lib/store';
import { deleteCategory, listCategories, saveCategory } from '../db/repo';
import type { Category } from '../lib/types';
import { Button, Card, Field, colors, styles } from '../components/ui';

/** Same fixed-order categorical palette as the built-in categories. */
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#8D8D8D'];
const ICONS = ['🍔', '☕', '🛒', '🚕', '⛽', '🏠', '💡', '📱', '🛍️', '👕', '💊', '🏋️', '🎬', '🎮', '✈️', '🎁', '📚', '🐶', '👶', '💼', '💸', '📦', '🏷️'];

type Draft = { id?: string; name: string; icon: string; color: string };

export default function CategoriesScreen() {
  const db = useSQLiteContext();
  const { changed } = useApp();
  const categories = useQuery(listCategories, [], [] as Category[]);
  const [draft, setDraft] = useState<Draft | null>(null);

  const save = async () => {
    if (!draft?.name.trim()) return Alert.alert('Give the category a name');
    const clash = categories.find(
      (c) => c.name.toLowerCase() === draft.name.trim().toLowerCase() && c.id !== draft.id,
    );
    if (clash) return Alert.alert('That category already exists');
    await saveCategory(db, draft);
    setDraft(null);
    changed();
  };

  const remove = (c: Category) =>
    Alert.alert(`Delete ${c.name}?`, 'Its expenses become “Uncategorised” and its budget is removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteCategory(db, c.id);
          setDraft(null);
          changed();
        },
      },
    ]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {draft ? (
        <Card>
          <Field label="Name" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} autoFocus />
          <Text style={styles.label}>Icon</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {ICONS.map((i) => (
              <Pressable
                key={i}
                onPress={() => setDraft({ ...draft, icon: i })}
                style={[swatch, draft.icon === i && { borderColor: colors.primary, backgroundColor: colors.primarySoft }]}
              >
                <Text style={{ fontSize: 20 }}>{i}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>Colour</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {PALETTE.map((c) => (
              <Pressable
                key={c}
                accessibilityLabel={`Colour ${c}`}
                onPress={() => setDraft({ ...draft, color: c })}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: c,
                  borderWidth: 3,
                  borderColor: draft.color === c ? colors.text : 'transparent',
                }}
              />
            ))}
          </View>
          <Button title={draft.id ? 'Save' : 'Add category'} onPress={save} />
          <Button title="Cancel" variant="ghost" onPress={() => setDraft(null)} />
          {draft.id ? (
            <Button
              title="Delete category"
              variant="danger"
              onPress={() => remove(categories.find((c) => c.id === draft.id)!)}
            />
          ) : null}
        </Card>
      ) : (
        <Button
          title="+ New category"
          onPress={() => setDraft({ name: '', icon: '🏷️', color: PALETTE[categories.length % PALETTE.length] })}
        />
      )}

      {categories.map((c) => (
        <Pressable key={c.id} onPress={() => setDraft({ ...c })}>
          <Card style={{ paddingVertical: 12 }}>
            <View style={styles.row}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c.color }} />
              <Text style={{ fontSize: 20 }}>{c.icon}</Text>
              <Text style={styles.rowText}>{c.name}</Text>
              <Text style={styles.muted}>Edit</Text>
            </View>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const swatch = {
  width: 40,
  height: 40,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: colors.border,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};
