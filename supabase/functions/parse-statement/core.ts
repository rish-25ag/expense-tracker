// Core of the parse-statement Edge Function: unlock a statement PDF and return
// its text as a fixed-width layout. Reading the transactions out of that text
// happens in the app (src/lib/statementParser.ts), with rules: no AI, no cost.
import { extractTextItems, getDocumentProxy } from 'npm:unpdf@2.1.0';

export type StatementErrorCode = 'password_required' | 'wrong_password' | 'unreadable_pdf' | 'no_text';

export class StatementError extends Error {
  constructor(
    public code: StatementErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** PDF points per character when laying text out as fixed-width columns (A4 is 595pt wide -> ~130 chars). */
const PT_PER_CHAR = 4.5;

/**
 * Extract text page by page as a fixed-width layout: each visual row becomes one
 * line and each piece of text is placed at a column matching its x position.
 * That keeps amounts under their column heading, so the app can tell a
 * Withdrawal from a Deposit even when the other cell is empty.
 */
export async function extractPages(pdf: Uint8Array, password?: string): Promise<string[]> {
  let doc;
  try {
    // pdf.js takes ownership of (detaches) the buffer it is given, so pass a copy.
    doc = await getDocumentProxy(pdf.slice(), password ? { password } : {});
  } catch (e) {
    // pdf.js signals passwords with PasswordException: code 1 = needed, 2 = incorrect.
    const err = e as { name?: string; code?: number };
    if (err?.name === 'PasswordException') {
      throw err.code === 2
        ? new StatementError('wrong_password', 'That password is incorrect.')
        : new StatementError('password_required', 'This PDF is password-protected.');
    }
    throw new StatementError('unreadable_pdf', 'This file could not be read as a PDF.');
  }
  const { items } = await extractTextItems(doc);
  const pages = items.map((pageItems) => {
    const rows: { y: number; parts: { x: number; str: string }[] }[] = [];
    for (const it of pageItems) {
      if (!it.str.trim()) continue;
      const tol = Math.max(2, (it.fontSize || 8) * 0.4);
      let row = rows.find((r) => Math.abs(r.y - it.y) <= tol);
      if (!row) rows.push((row = { y: it.y, parts: [] }));
      row.parts.push({ x: it.x, str: it.str.trim() });
    }
    rows.sort((a, b) => b.y - a.y); // PDF y grows upwards: top of page first
    return rows
      .map((r) => {
        let line = '';
        for (const p of r.parts.sort((a, b) => a.x - b.x)) {
          const col = Math.round(p.x / PT_PER_CHAR);
          line += ' '.repeat(Math.max(line ? 2 : 0, col - line.length)) + p.str;
        }
        return line.trimEnd();
      })
      .join('\n');
  });
  if (!pages.some((p) => p.trim())) {
    throw new StatementError(
      'no_text',
      'No text found in this PDF. It may be a scanned image; download the statement from net banking or your email instead.',
    );
  }
  return pages;
}
