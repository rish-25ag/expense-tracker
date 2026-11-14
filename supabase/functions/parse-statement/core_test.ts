// Run: deno test --allow-read --allow-env supabase/functions/parse-statement
// Fixtures are synthetic statements (fake data). bank_locked.pdf's password is RISH1234.
// Reading transactions from the text is tested in the app: src/lib/logic.test.ts.
import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1';
import { extractPages, StatementError } from './core.ts';

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

Deno.test('unlocked credit card statement: CR marks are kept', async () => {
  const pages = await extractPages(await read('card.pdf'));
  assertStringIncludes(pages[0], '18,200.00 CR');
  assertStringIncludes(pages[0], 'PAYMENT RECEIVED - THANK YOU');
});
