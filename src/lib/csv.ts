import { parseAmount } from './money.ts';
import { parseDate } from './dates.ts';

/** RFC 4180 CSV parser: quoted fields, escaped quotes, newlines inside quotes. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

function escape(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(header: string[], rows: (string | number)[][]): string {
  return [header, ...rows].map((r) => r.map(escape).join(',')).join('\n') + '\n';
}

export interface ImportedRow {
  date: string;
  amount: number;
  category: string;
  note: string;
}

export interface ImportResult {
  rows: ImportedRow[];
  skipped: { line: number; reason: string }[];
}

const DATE_COLS = ['date', 'txn date', 'transaction date', 'value date', 'posting date'];
const AMOUNT_COLS = ['amount', 'amount (inr)', 'amount(inr)', 'my share', 'total'];
const DEBIT_COLS = ['debit', 'withdrawal', 'withdrawal amt.', 'withdrawal amount', 'debit amount', 'dr'];
const CATEGORY_COLS = ['category'];
const NOTE_COLS = ['note', 'notes', 'description', 'narration', 'details', 'remarks', 'particulars'];

/**
 * Turn a CSV into expenses. Accepts this app's own export, or a bank statement
 * with Date + (Amount | Debit/Withdrawal) + Description/Narration columns.
 * For bank statements, only debits are imported; credit rows are skipped.
 */
export function parseExpenseCSV(text: string): ImportResult {
  const all = parseCSV(text);
  const result: ImportResult = { rows: [], skipped: [] };
  // Bank statements often have a few lines of preamble before the header.
  const headerIdx = all.findIndex((r) => r.some((c) => DATE_COLS.includes(c.trim().toLowerCase())));
  if (headerIdx < 0) {
    result.skipped.push({ line: 1, reason: 'No "Date" column found' });
    return result;
  }
  const header = all[headerIdx].map((h) => h.trim().toLowerCase());
  const col = (names: string[]) => header.findIndex((h) => names.includes(h));
  const iDate = col(DATE_COLS);
  const iAmount = col(AMOUNT_COLS);
  const iDebit = col(DEBIT_COLS);
  const iCat = col(CATEGORY_COLS);
  const iNote = col(NOTE_COLS);
  if (iAmount < 0 && iDebit < 0) {
    result.skipped.push({ line: headerIdx + 1, reason: 'No "Amount" or "Debit" column found' });
    return result;
  }

  for (let r = headerIdx + 1; r < all.length; r++) {
    const row = all[r];
    const line = r + 1;
    const date = parseDate(row[iDate] ?? '');
    if (!date) {
      result.skipped.push({ line, reason: `Unrecognised date "${row[iDate] ?? ''}"` });
      continue;
    }
    const raw = (iDebit >= 0 ? row[iDebit] : row[iAmount]) ?? '';
    if (iDebit >= 0 && raw.trim() === '') {
      result.skipped.push({ line, reason: 'Not a debit' });
      continue;
    }
    let amount = parseAmount(raw);
    if (iDebit < 0 && amount < 0) amount = -amount; // some exports sign debits negative
    if (!(amount > 0)) {
      result.skipped.push({ line, reason: `Invalid amount "${raw}"` });
      continue;
    }
    result.rows.push({
      date,
      amount,
      category: iCat >= 0 ? (row[iCat] ?? '').trim() : '',
      note: iNote >= 0 ? (row[iNote] ?? '').trim() : '',
    });
  }
  return result;
}
