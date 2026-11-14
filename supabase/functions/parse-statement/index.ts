// Supabase Edge Function: reads a bank / credit card statement PDF with Claude.
//
// POST { pdfBase64: string, password?: string, categories: string[] }
//   -> 200 { transactions, pages, dropped }
//   -> 4xx/5xx { error: StatementErrorCode | 'unauthorized' | 'forbidden' | 'bad_request', message }
//
// Secrets (set with `supabase secrets set`):
//   ANTHROPIC_API_KEY  - required
//   ALLOWED_EMAILS     - comma-separated emails allowed to use this (protects your API credit)
//   STATEMENT_MODEL    - optional, defaults to claude-opus-5-5
import Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { parseStatement, StatementError } from './core.ts';

const MAX_PDF_BYTES = 10 * 1024 * 1024;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const fail = (status: number, error: string, message: string) => json(status, { error, message });

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail(405, 'bad_request', 'Use POST.');

  // Who is calling? (The gateway has already checked that the JWT is valid.)
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return fail(401, 'unauthorized', 'Sign in to import statements.');
  let email: string | undefined;
  try {
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', supabaseKey);
    const { data } = await supabase.auth.getUser(token);
    email = data.user?.email?.toLowerCase();
  } catch (e) {
    console.error('auth check failed', e);
  }
  if (!email) return fail(401, 'unauthorized', 'Sign in to import statements.');

  const allowed = (Deno.env.get('ALLOWED_EMAILS') ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.includes(email)) {
    return fail(403, 'forbidden', 'This account is not allowed to use statement import. Add it to ALLOWED_EMAILS.');
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return fail(500, 'ai_failed', 'ANTHROPIC_API_KEY is not set on the server.');

  let body: { pdfBase64?: unknown; password?: unknown; categories?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, 'bad_request', 'Expected a JSON body.');
  }
  if (typeof body.pdfBase64 !== 'string' || !body.pdfBase64) return fail(400, 'bad_request', 'pdfBase64 is required.');
  const categories = Array.isArray(body.categories)
    ? body.categories.filter((c): c is string => typeof c === 'string').slice(0, 100)
    : [];
  const password = typeof body.password === 'string' && body.password ? body.password : undefined;

  let pdf: Uint8Array;
  try {
    pdf = decodeBase64(body.pdfBase64);
  } catch {
    return fail(400, 'bad_request', 'pdfBase64 is not valid base64.');
  }
  if (pdf.length > MAX_PDF_BYTES) return fail(413, 'bad_request', 'The PDF is larger than 10 MB.');

  try {
    const result = await parseStatement(new Anthropic({ apiKey }), pdf, password, categories);
    return json(200, result);
  } catch (e) {
    if (e instanceof StatementError) {
      const status = e.code === 'ai_failed' ? 502 : 422;
      return fail(status, e.code, e.message);
    }
    if (e instanceof Anthropic.RateLimitError) return fail(429, 'ai_failed', 'The AI is busy. Try again in a minute.');
    if (e instanceof Anthropic.AuthenticationError) return fail(500, 'ai_failed', 'The server’s Anthropic API key is invalid.');
    if (e instanceof Anthropic.APIError) return fail(502, 'ai_failed', `AI request failed (${e.status}).`);
    console.error(e);
    return fail(500, 'ai_failed', 'Something went wrong reading the statement.');
  }
});
