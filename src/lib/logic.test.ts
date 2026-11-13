/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatINR, parseAmount, splitEqually } from './money.ts';
import { parseDate, addMonths } from './dates.ts';
import { parseCSV, toCSV, parseExpenseCSV } from './csv.ts';
import { balances, myShare, validateShares } from './split.ts';

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
