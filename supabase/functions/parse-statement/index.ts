// Supabase Edge Function: unlocks a bank / credit card statement PDF and
// returns its text layout. Free: no AI and no API keys involved.
//
// POST { pdfBase64: string, password?: string }
//   -> 200 { pages: string[] }
//   -> 4xx { error: StatementErrorCode | 'unauthorized' | 'bad_request', message }
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { extractPages, StatementError } from './core.ts';

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

  // Only signed-in users of this project. (The gateway has already checked the JWT.)
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return fail(401, 'unauthorized', 'Sign in to import statements.');
  let userId: string | undefined;
  try {
    const key = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';
    const { data } = await createClient(Deno.env.get('SUPABASE_URL') ?? '', key).auth.getUser(token);
    userId = data.user?.id;
  } catch (e) {
    console.error('auth check failed', e);
  }
  if (!userId) return fail(401, 'unauthorized', 'Sign in to import statements.');

  let body: { pdfBase64?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, 'bad_request', 'Expected a JSON body.');
  }
  if (typeof body.pdfBase64 !== 'string' || !body.pdfBase64) return fail(400, 'bad_request', 'pdfBase64 is required.');
  const password = typeof body.password === 'string' && body.password ? body.password : undefined;

  let pdf: Uint8Array;
  try {
    pdf = decodeBase64(body.pdfBase64);
  } catch {
    return fail(400, 'bad_request', 'pdfBase64 is not valid base64.');
  }
  if (pdf.length > MAX_PDF_BYTES) return fail(413, 'bad_request', 'The PDF is larger than 10 MB.');

  try {
    return json(200, { pages: await extractPages(pdf, password) });
  } catch (e) {
    if (e instanceof StatementError) return fail(422, e.code, e.message);
    console.error(e);
    return fail(500, 'unreadable_pdf', 'Something went wrong reading the PDF.');
  }
});
