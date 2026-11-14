import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { StatementTxn } from './statementReview';
import { parseStatementText, type StatementAccount } from './statementParser';

export const MAX_PDF_MB = 10;

export interface PickedPdf {
  name: string;
  base64: string;
}

/** Opens the file picker for a PDF. null if the user cancelled. Throws if it is too big. */
export async function pickStatementPdf(): Promise<PickedPdf | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  if (asset.size && asset.size > MAX_PDF_MB * 1024 * 1024) {
    throw new Error(`That PDF is larger than ${MAX_PDF_MB} MB.`);
  }
  // Web gives the contents directly (possibly as a data: URL); on phones read the cached copy.
  const base64 = asset.base64
    ? asset.base64.replace(/^data:[^,]*,/, '')
    : await new File(asset.uri).base64();
  return { name: asset.name, base64 };
}

/** Error codes the parse-statement function returns (see supabase/functions/parse-statement). */
export type ParseErrorCode =
  | 'password_required'
  | 'wrong_password'
  | 'unreadable_pdf'
  | 'no_text'
  | 'no_transactions'
  | 'server_error'
  | 'unauthorized'
  | 'bad_request'
  | 'not_deployed'
  | 'network';

export class ParseError extends Error {
  constructor(
    public code: ParseErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface ParsedStatement {
  transactions: StatementTxn[];
  pages: number;
  /** The card / bank account the statement is for, when it could be identified. */
  account: StatementAccount | null;
}

/**
 * Sends the PDF to the parse-statement Edge Function, which unlocks it and
 * returns its text, then reads the transactions out of that text with rules
 * (src/lib/statementParser.ts). No AI is involved, so there is no cost.
 */
export async function parseStatementPdf(pdfBase64: string, password: string | undefined): Promise<ParsedStatement> {
  if (!supabase) throw new ParseError('unauthorized', 'Cloud sync is not set up in this build.');
  const { data, error } = await supabase.functions.invoke<{ pages: string[] }>('parse-statement', {
    body: { pdfBase64, password },
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      const body = await res.json().catch(() => null);
      if (body?.error) throw new ParseError(body.error, body.message ?? 'Could not read the statement.');
      if (res.status === 404) {
        throw new ParseError('not_deployed', 'The statement reader is not deployed yet. See README → “Statement PDF import”.');
      }
      throw new ParseError('server_error', `Server error (${res.status}).`);
    }
    throw new ParseError('network', 'Could not reach the server. Check your internet connection.');
  }
  const pages = data?.pages ?? [];
  const { transactions, account } = parseStatementText(pages);
  if (!transactions.length) {
    throw new ParseError(
      'no_transactions',
      'No transactions were recognised in this statement. Its layout may not be supported yet — tell the developer which bank it is from.',
    );
  }
  return { transactions, pages: pages.length, account };
}
