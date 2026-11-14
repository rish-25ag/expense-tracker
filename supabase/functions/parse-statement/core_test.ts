// Run: deno test --allow-read --allow-env supabase/functions/parse-statement
// Fixtures are synthetic statements (fake data). bank_locked.pdf's password is RISH1234.
import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1';
import { chunkPages, type ClaudeClient, extractPages, parseStatement, StatementError } from './core.ts';

const read = (name: string) => Deno.readFile(new URL(`./testdata/${name}`, import.meta.url));

Deno.test('locked PDF without a password -> password_required', async () => {
  const err = await assertRejects(async () => await extractPages(await read('bank_locked.pdf')), StatementError);
  assertEquals(err.code, 'password_required');
});

Deno.test('locked PDF with a wrong password -> wrong_password', async () => {
  const err = await assertRejects(async () => await extractPages(await read('bank_locked.pdf'), 'nope'), StatementError);
  assertEquals(err.code, 'wrong_password');
});

Deno.test('not a PDF -> unreadable_pdf', async () => {
  const err = await assertRejects(async () => await extractPages(new TextEncoder().encode('hello')), StatementError);
  assertEquals(err.code, 'unreadable_pdf');
});

Deno.test('locked PDF with the right password: amounts stay under their column', async () => {
  const pages = await extractPages(await read('bank_locked.pdf'), 'RISH1234');
  assertEquals(pages.length, 5);
  const lines = pages[0].split('\n');
  const header = lines.find((l) => l.includes('Withdrawal Amt.'))!;
  const debit = lines.find((l) => l.includes('UPI-DMART'))!;
  const credit = lines.find((l) => l.includes('SALARY'))!;
  const near = (a: number, b: number) => Math.abs(a - b) <= 2;
  // The withdrawal sits under "Withdrawal", the salary under "Deposit": the empty cell is not lost.
  assert(near(debit.indexOf('2,340.50'), header.indexOf('Withdrawal')), debit);
  assert(near(credit.indexOf('85,000.00'), header.indexOf('Deposit')), credit);
});

Deno.test('chunking: 5 pages -> 2 chunks, each with the page-1 header', async () => {
  const pages = await extractPages(await read('bank_locked.pdf'), 'RISH1234');
  const chunks = chunkPages(pages);
  assertEquals(chunks.map((c) => [c.from, c.to]), [[1, 4], [5, 5]]);
  assertStringIncludes(chunks[1].header, 'HDFC BANK');
  assertStringIncludes(chunks[1].text, '--- Page 5 ---');
});

/** Fake Claude client: records requests and replies with canned JSON per call. */
function fakeClient(replies: (string | { stop_reason: string })[]) {
  const requests: Record<string, unknown>[] = [];
  let i = 0;
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>) {
          requests.push(params);
          const r = replies[Math.min(i++, replies.length - 1)];
          const msg = typeof r === 'string'
            ? { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: r }] }
            : { ...r, content: [] };
          return { finalMessage: () => Promise.resolve(msg) };
        },
      },
    },
  } as unknown as ClaudeClient;
  return { client, requests };
}

Deno.test('parseStatement: sends one request per chunk, validates and merges rows', async () => {
  const good = (date: string, amount: number) =>
    ({ date, description: ' Swiggy ', amount, direction: 'debit', kind: 'spend', category: 'Food & Dining' });
  const { client, requests } = fakeClient([
    JSON.stringify({ transactions: [good('2026-11-01', 485), { ...good('bad-date', 10) }, good('2026-11-03', 0)] }),
    JSON.stringify({ transactions: [good('2026-11-05', 312.005)] }),
  ]);
  const res = await parseStatement(client, await read('bank_locked.pdf'), 'RISH1234', ['Food & Dining', 'Groceries']);

  assertEquals(requests.length, 2);
  assertEquals(res.pages, 5);
  assertEquals(res.dropped, 2);
  assertEquals(res.transactions.map((t) => [t.date, t.amount, t.description]), [
    ['2026-11-01', 485, 'Swiggy'],
    ['2026-11-05', 312.01, 'Swiggy'],
  ]);

  const req = requests[0] as {
    model: string; betas: string[]; fallbacks: string;
    output_config: { format: { type: string; schema: { properties: { transactions: { items: { properties: { category: { enum: string[] } } } } } } } };
    messages: { content: string }[];
  };
  assertEquals(req.model, 'claude-opus-5-5');
  assertEquals(req.fallbacks, 'default');
  assert(req.betas.includes('server-side-fallback-2026-07-01'));
  assertEquals(req.output_config.format.type, 'json_schema');
  assertEquals(req.output_config.format.schema.properties.transactions.items.properties.category.enum, ['Food & Dining', 'Groceries', 'Other']);
  assertStringIncludes(req.messages[0].content, 'UPI-SWIGGY');
});

Deno.test('parseStatement: refusal and max_tokens become typed errors', async () => {
  const pdf = await read('card.pdf');
  let err = await assertRejects(() => parseStatement(fakeClient([{ stop_reason: 'refusal' }]).client, pdf, undefined, []), StatementError);
  assertEquals(err.code, 'ai_refused');
  err = await assertRejects(() => parseStatement(fakeClient([{ stop_reason: 'max_tokens' }]).client, pdf, undefined, []), StatementError);
  assertEquals(err.code, 'ai_failed');
  err = await assertRejects(() => parseStatement(fakeClient(['not json']).client, pdf, undefined, []), StatementError);
  assertEquals(err.code, 'ai_failed');
});

Deno.test('unlocked credit card statement: CR rows are visible to the model', async () => {
  const pages = await extractPages(await read('card.pdf'));
  assertStringIncludes(pages[0], '18,200.00 CR');
  assertStringIncludes(pages[0], 'PAYMENT RECEIVED - THANK YOU');
});
