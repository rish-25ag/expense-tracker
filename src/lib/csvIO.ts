import type { SQLiteDatabase } from 'expo-sqlite';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { findOrCreateCategory, listCategories, listExpenses, listPeople, saveExpense } from '../db/repo';
import { parseExpenseCSV, toCSV } from './csv';
import { myShare } from './split';
import { ME } from './types';
import { today } from './dates';

/** Writes all expenses to a CSV file and opens the share sheet (Drive, WhatsApp, email…). */
export async function exportCSV(db: SQLiteDatabase): Promise<number> {
  const [expenses, categories, people] = await Promise.all([listExpenses(db), listCategories(db), listPeople(db)]);
  const cat = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const name = (id: string) => (id === ME ? 'Me' : (people.find((p) => p.id === id)?.name ?? 'Unknown'));
  const csv = toCSV(
    ['Date', 'Amount', 'My Share', 'Category', 'Note', 'Paid By', 'Split With'],
    expenses.map((e) => [
      e.date,
      e.amount.toFixed(2),
      myShare(e).toFixed(2),
      e.categoryId ? (cat[e.categoryId] ?? '') : '',
      e.note,
      name(e.paidBy),
      e.shares.map((s) => `${name(s.personId)}: ${s.amount.toFixed(2)}`).join('; '),
    ]),
  );
  const file = new File(Paths.cache, `expenses-${today()}.csv`);
  if (file.exists) file.delete();
  file.create();
  await file.write(csv);
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Export expenses', UTI: 'public.comma-separated-values-text' });
  return expenses.length;
}

export interface ImportSummary {
  imported: number;
  duplicates: number;
  skipped: { line: number; reason: string }[];
}

/**
 * Pick a CSV (this app's export or a bank statement) and add its rows as expenses.
 * Rows that match an existing expense (same date, amount and note) are skipped,
 * so importing the same file twice is safe. Returns null if the user cancelled.
 */
export async function importCSV(db: SQLiteDatabase): Promise<ImportSummary | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets?.length) return null;
  const text = await new File(res.assets[0].uri).text();
  const { rows, skipped } = parseExpenseCSV(text);

  const existing = new Set(
    (await listExpenses(db)).map((e) => `${e.date}|${e.amount.toFixed(2)}|${e.note.trim().toLowerCase()}`),
  );
  const otherId = (await listCategories(db)).find((c) => c.id === 'cat_other')?.id ?? null;
  let imported = 0;
  let duplicates = 0;

  await db.withTransactionAsync(async () => {
    for (const r of rows) {
      const key = `${r.date}|${r.amount.toFixed(2)}|${r.note.trim().toLowerCase()}`;
      if (existing.has(key)) {
        duplicates++;
        continue;
      }
      existing.add(key);
      const categoryId = r.category ? await findOrCreateCategory(db, r.category) : otherId;
      await saveExpense(db, { amount: r.amount, categoryId, note: r.note, date: r.date, paidBy: ME, shares: [] });
      imported++;
    }
  });
  return { imported, duplicates, skipped };
}
