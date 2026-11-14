/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatINR, parseAmount, splitEqually } from './money.ts';
import { parseDate, addMonths } from './dates.ts';
import { parseCSV, toCSV, parseExpenseCSV } from './csv.ts';
import { balances, myShare, validateShares } from './split.ts';
import { buildReview, type StatementTxn } from './statementReview.ts';
import { supabaseHost, supabaseUrlProblem } from './supabaseUrl.ts';
import { classify, parseStatementText, statementEndDate } from './statementParser.ts';

test('formatINR uses Indian digit grouping', () => {
  assert.equal(formatINR(1234567), '₹12,34,567');
  assert.equal(formatINR(999), '₹999');
  assert.equal(formatINR(1000.5), '₹1,000.50');
  assert.equal(formatINR(-2500), '-₹2,500');
});

test('parseAmount', () => {
  assert.equal(parseAmount('₹ 1,250.50'), 1250.5);
  assert.equal(parseAmount('Rs. 300'), 300);
  assert.equal(parseAmount('-45'), -45);
  assert.ok(Number.isNaN(parseAmount('abc')));
  assert.ok(Number.isNaN(parseAmount('')));
});

test('splitEqually keeps every paisa', () => {
  assert.deepEqual(splitEqually(100, 3), [33.34, 33.33, 33.33]);
  assert.equal(splitEqually(1000, 7).reduce((a, b) => a + b, 0).toFixed(2), '1000.00');
});

test('parseDate handles bank formats, day-first', () => {
  assert.equal(parseDate('2026-11-13'), '2026-11-13');
  assert.equal(parseDate('13/11/2026'), '2026-11-13');
  assert.equal(parseDate('03-04-26'), '2026-04-03');
  assert.equal(parseDate('13 Nov 2026'), '2026-11-13');
  assert.equal(parseDate('13-Nov-26'), '2026-11-13');
  assert.equal(parseDate('31/02/2026'), null);
  assert.equal(parseDate('hello'), null);
});

test('addMonths crosses years', () => {
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-11', 2), '2027-01');
});

test('CSV round trip with quotes, commas and newlines', () => {
  const csv = toCSV(['a', 'b'], [['x, y', 'say "hi"'], ['line\nbreak', 5]]);
  assert.deepEqual(parseCSV(csv), [['a', 'b'], ['x, y', 'say "hi"'], ['line\nbreak', '5']]);
});

test('import app export format', () => {
  const r = parseExpenseCSV('Date,Amount,Category,Note\n2026-11-01,250,Food,Lunch\n2026-11-02,abc,Food,x\n');
  assert.deepEqual(r.rows, [{ date: '2026-11-01', amount: 250, category: 'Food', note: 'Lunch' }]);
  assert.equal(r.skipped.length, 1);
});

test('import bank statement: preamble, debit column, credits skipped', () => {
  const csv = [
    'Account Statement,,,,',
    'Txn Date,Narration,Withdrawal Amt.,Deposit Amt.,Balance',
    '05/11/2026,UPI-SWIGGY,"1,240.00",,10000',
    '06/11/2026,SALARY,,50000,60000',
  ].join('\n');
  const r = parseExpenseCSV(csv);
  assert.deepEqual(r.rows, [{ date: '2026-11-05', amount: 1240, category: '', note: 'UPI-SWIGGY' }]);
  assert.equal(r.skipped[0].reason, 'Not a debit');
});

test('myShare', () => {
  assert.equal(myShare({ amount: 500, shares: [] }), 500);
  assert.equal(myShare({ amount: 900, shares: [{ personId: 'me', amount: 300 }, { personId: 'a', amount: 600 }] }), 300);
});

test('balances: I paid, they paid, settlements', () => {
  const b = balances(
    [
      // I paid 900 for me, A, B equally -> A owes 300, B owes 300
      { paidBy: 'me', shares: [{ personId: 'me', amount: 300 }, { personId: 'A', amount: 300 }, { personId: 'B', amount: 300 }] },
      // A paid 400 split with me -> I owe A 200
      { paidBy: 'A', shares: [{ personId: 'me', amount: 200 }, { personId: 'A', amount: 200 }] },
      { paidBy: 'me', shares: [] }, // not split, ignored
    ],
    [{ personId: 'B', amount: 300, direction: 'received' }],
  );
  assert.deepEqual(b, { A: 100, B: 0 });
});

test('validateShares', () => {
  assert.equal(validateShares(100, [{ amount: 50 }, { amount: 50 }]), null);
  assert.match(validateShares(100, [{ amount: 50 }])!, /add up/);
});


test('statement review: debits only, transfers and duplicates unselected', () => {
  const t = (date: string, amount: number, extra: Partial<StatementTxn> = {}): StatementTxn => ({
    date, amount, description: 'x', direction: 'debit', kind: 'spend', category: 'Other', ...extra,
  });
  const r = buildReview(
    [
      t('2026-11-01', 485),
      t('2026-11-02', 85000, { direction: 'credit' }),
      t('2026-11-04', 18200, { kind: 'transfer' }),
      t('2026-11-05', 50),
      t('2026-11-05', 50), // second identical tea; only one exists already
    ],
    [{ date: '2026-11-05', amount: 50 }],
  );
  assert.equal(r.creditsSkipped, 1);
  assert.deepEqual(
    r.rows.map((x) => [x.date, x.amount, x.selected, x.duplicate]),
    [
      ['2026-11-05', 50, false, true],
      ['2026-11-05', 50, true, false],
      ['2026-11-04', 18200, false, false],
      ['2026-11-01', 485, true, false],
    ],
  );
});

test('supabase URL checks catch common setup mistakes', () => {
  assert.equal(supabaseUrlProblem('https://abcdefghijklmnop.supabase.co'), null);
  assert.equal(supabaseUrlProblem('https://abcdefghijklmnop.supabase.co/'), null);
  assert.equal(supabaseUrlProblem(undefined), null);
  assert.match(supabaseUrlProblem('https://your-project-ref.supabase.co')!, /example value/);
  assert.match(supabaseUrlProblem('https://supabase.com/dashboard/project/abcd')!, /dashboard/);
  assert.match(supabaseUrlProblem('https://abcd.supabase.co/rest/v1')!, /remove "\/rest\/v1"/);
  assert.match(supabaseUrlProblem('"https://abcd.supabase.co"')!, /quotes/);
  assert.match(supabaseUrlProblem('https://abcd.supabase.co ')!, /spaces/);
  assert.match(supabaseUrlProblem('http://abcd.supabase.co')!, /https/);
  assert.equal(supabaseUrlProblem('http://127.0.0.1:54321'), null);
  assert.match(supabaseUrlProblem('abcd.supabase.co')!, /not a valid URL/);
  assert.equal(supabaseHost('https://abcd.supabase.co'), 'abcd.supabase.co');
});

// Synthetic statement layouts (invented data) in the shape the Edge Function produces.
const CARD_PAGE = [
  '                                                                  08 JAN 2027                   512.30',
  '             MR TEST USER                                         25 DEC 2026 To 24 JAN 2027         12,345.67',
  '       25 DEC 2026 To 24 JAN 2027                                    12,345.67',
  '                 OPENING BALANCE                                                    18,250.00',
  '       26DEC     TO 4111 1111 1111 1234                                             20,000.00  CR',
  '       23DEC     Blinkit Foods Limit  GURGAON  IND                                    168.00',
  '       24DEC     MW Swiggy Instamart  BENGALURU                                        95.00  CR',
  '       28DEC     RSP*ZOMATO LIMITED  GURUGRAM   HAR                                 1,500.50',
  '       03JAN     UBER INDIA SYSTEMS  THANE   IND                                      175.73',
  '       05JAN     LOTUS HOSPITALITY P BENGALURU  KAR                                 252.00',
  '       24JAN      NET OUTSTANDING BALANCE                                           12,345.67',
  '                  TOTAL PURCHASE OUTSTANDING                                        12,345.67',
  'statement date and are yet to be reflected.    The credit limit and cash withdrawal limit are',
].join('\n');

test('statement parser: credit card layout (HSBC style)', () => {
  const r = parseStatementText([CARD_PAGE]);
  assert.equal(r.layout, 'single-amount');
  assert.deepEqual(
    r.transactions.map((t) => [t.date, t.amount, t.direction, t.description, t.category, t.kind]),
    [
      ['2026-12-26', 20000, 'credit', 'Card payment', 'cat_other', 'transfer'],
      ['2026-12-23', 168, 'debit', 'Blinkit', 'cat_groceries', 'spend'],
      ['2026-12-24', 95, 'credit', 'Swiggy Instamart', 'cat_groceries', 'spend'],
      ['2026-12-28', 1500.5, 'debit', 'Zomato', 'cat_food', 'spend'],
      ['2027-01-03', 175.73, 'debit', 'Uber', 'cat_transport', 'spend'],
      ['2027-01-05', 252, 'debit', 'Lotus Hospitality', 'cat_food', 'spend'],
    ],
  );
  // Card numbers never end up in a description.
  assert.ok(r.transactions.every((t) => !/\d{4}/.test(t.description)));
});

test('statement parser: bank layout with Withdrawal / Deposit columns', () => {
  const page = [
    '         HDFC BANK Statement of Account 01/11/2026 to 30/11/2026',
    '         Date        Narration                                           Chq/Ref    Withdrawal Amt.   Deposit Amt.    Balance',
    '         01/11/26    UPI-SWIGGY-SWIGGY8@ICICI-412233                                485.00                            52,015.00',
    '         02/11/26    SALARY NOV 2026 ACME TECH PVT LTD                                                85,000.00       1,37,015.00',
    '         04/11/26    NEFT-HDFC CREDIT CARD BILL PAYMENT                             18,200.00                         1,16,474.50',
    '         06/11/26    ACH D- BESCOM ELECTRICITY                                      1,845.00                          1,14,317.50',
  ].join('\n');
  const r = parseStatementText([page]);
  assert.equal(r.layout, 'columns');
  assert.deepEqual(
    r.transactions.map((t) => [t.date, t.amount, t.direction, t.description, t.kind]),
    [
      ['2026-11-01', 485, 'debit', 'Swiggy', 'spend'],
      ['2026-11-02', 85000, 'credit', 'Salary Nov 2026 Acme Tech', 'spend'],
      ['2026-11-04', 18200, 'debit', 'Hdfc Credit Card Bill Payment', 'transfer'],
      ['2026-11-06', 1845, 'debit', 'Electricity bill', 'spend'],
    ],
  );
});

test('statement parser: statement end date', () => {
  assert.deepEqual(statementEndDate('25 SEP 2026 To 24 OCT 2026'), { year: 2026, month: 10 });
  assert.deepEqual(statementEndDate('Statement from 01/11/2026 to 30/11/2026'), { year: 2026, month: 11 });
  assert.deepEqual(statementEndDate('no dates', new Date(2026, 4, 1)), { year: 2026, month: 5 });
});

test('statement parser: merchant names and categories', () => {
  assert.deepEqual(classify('RSP*BLINK COMMERCE PV BANGALORE   KAR'), { description: 'Blinkit', category: 'cat_groceries', transfer: false });
  assert.deepEqual(classify('FSN ECOMMERCE VENTURES Mumbai   IND'), { description: 'Nykaa', category: 'cat_shopping', transfer: false });
  assert.equal(classify('SHARMA RESTAURANT  GURGAON    HAR').category, 'cat_food');
  assert.equal(classify('CAS*CITY PHARMA RETAIL MUMBAI   IND').category, 'cat_health');
  assert.equal(classify('ZERODHA BROKING SIP').transfer, true);
  assert.equal(classify('Some Unknown Shop  PUNE  IND').description, 'Some Unknown Shop');
});
