import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { StatementTxn } from './statementReview';

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
  | 'ai_refused'
  | 'ai_failed'
  | 'unauthorized'
  | 'forbidden'
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
  dropped: number;
}

/** Sends the PDF to the parse-statement Edge Function, which reads it with Claude. */
export async function parseStatementPdf(
  pdfBase64: string,
  password: string | undefined,
  categories: string[],
): Promise<ParsedStatement> {
  if (!supabase) throw new ParseError('unauthorized', 'Cloud sync is not set up in this build.');
  const { data, error } = await supabase.functions.invoke<ParsedStatement>('parse-statement', {
    body: { pdfBase64, password, categories },
  });
  if (!error && data) return data;

  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response;
    const body = await res.json().catch(() => null);
    if (body?.error) throw new ParseError(body.error, body.message ?? 'Could not read the statement.');
    if (res.status === 404) {
      throw new ParseError('not_deployed', 'The statement reader is not deployed yet. See README → “Statement PDF import”.');
    }
    throw new ParseError('ai_failed', `Server error (${res.status}).`);
  }
  throw new ParseError('network', 'Could not reach the server. Check your internet connection.');
}
