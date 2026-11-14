/**
 * Rule-based reader for bank and credit card statements (no AI, no cost).
 *
 * Input: the statement's pages as a fixed-width text layout, where each line
 * is one visual row and every value sits at the column matching its position
 * on the page (produced by the parse-statement Edge Function).
 *
 * Two layouts are understood:
 *  - Column statements (most bank accounts): a header row with Date and
 *    Withdrawal/Debit and Deposit/Credit columns. An amount's column decides
 *    whether it is money out or in.
 *  - Single-amount statements (most credit cards, e.g. HSBC): each row is
 *    "date  merchant  amount", with "CR" after credits.
 */
import type { StatementTxn } from './statementReview';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad = (n: number) => String(n).padStart(2, '0');

// ---------- dates ----------

/** A date at the start of a row: 26SEP, 26 SEP, 26 Sep 2026, 26-Sep-26, 26/09/2026, 26-09-26, 26.09.2026. */
const ROW_DATE =
  /^\s*(\d{1,2})(?:\s?([A-Za-z]{3})[a-z]*(?:[\s,-]+(\d{4}|\d{2}))?|[/.-]([A-Za-z]{3}|\d{1,2})[/.-](\d{4}|\d{2}))(?=\s|$)/;

interface DayMonth {
  day: number;
  month: number; // 1-12
  year?: number;
  length: number; // characters consumed, including leading spaces
}

function monthIndex(s: string): number {
  return MONTHS.indexOf(s.slice(0, 3).toUpperCase()) + 1;
}

/**
 * A date at the start of the row or, when the table header told us where the
 * Date column is, a date starting at that column (some statements print a chart
 * or labels to the left of the table).
 */
function readRowDateAt(line: string, dateCol: number | null): DayMonth | null {
  const atStart = readRowDate(line);
  if (atStart || dateCol === null) return atStart;
  for (let k = Math.max(1, dateCol - 4); k <= dateCol + 4 && k < line.length; k++) {
    if (line[k - 1] !== ' ' || line[k] === ' ') continue;
    const d = readRowDate(line.slice(k));
    if (d && line.slice(0, k).trim().length <= 6) return { ...d, length: d.length + k };
  }
  return null;
}

function readRowDate(line: string): DayMonth | null {
  const m = line.match(ROW_DATE);
  if (!m) return null;
  const day = +m[1];
  let month: number;
  let yearText: string | undefined;
  if (m[2]) {
    month = monthIndex(m[2]);
    yearText = m[3];
  } else {
    month = /\d/.test(m[4]) ? +m[4] : monthIndex(m[4]);
    yearText = m[5];
  }
  if (!month || month > 12 || day < 1 || day > 31) return null;
  const year = yearText ? (yearText.length === 2 ? 2000 + +yearText : +yearText) : undefined;
  return { day, month, year, length: m[0].length };
}

function validDate(y: number, m: number, d: number): string | null {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/**
 * The statement's end date, used to give a year to rows that only have day and
 * month (e.g. "26SEP"). Looks for a period like "25 SEP 2026 To 24 OCT 2026" or
 * "01/11/2026 to 30/11/2026"; otherwise the latest full date in the text.
 */
export function statementEndDate(text: string, fallback = new Date()): { year: number; month: number } {
  const full = /\b(\d{1,2})[\s/.-]?([A-Za-z]{3}|\d{1,2})[a-z]*[\s/.,-]+(\d{4})\b/g;
  const period = new RegExp(`${full.source}\\s*(?:to|-)\\s*${full.source}`, 'i');
  const p = text.match(period);
  const toYM = (mo: string, y: string) => ({ year: +y, month: /\d/.test(mo) ? +mo : monthIndex(mo) });
  if (p) {
    const end = toYM(p[5], p[6]);
    if (end.month >= 1 && end.month <= 12) return end;
  }
  let best: { year: number; month: number } | null = null;
  for (const m of text.matchAll(full)) {
    const d = toYM(m[2], m[3]);
    if (d.month < 1 || d.month > 12 || d.year < 2000 || d.year > 2100) continue;
    if (!best || d.year * 12 + d.month > best.year * 12 + best.month) best = d;
  }
  return best ?? { year: fallback.getFullYear(), month: fallback.getMonth() + 1 };
}

// ---------- amounts ----------

const AMOUNT = /(?<![\w.])(?:₹|Rs\.?|INR)?\s?(\d{1,3}(?:,\d{2,3})*|\d+)\.(\d{2})(?:\s{0,3}(CR|Cr|cr|DR|Dr|dr|C|D))?(?![\w.])/g;

interface AmountHit {
  value: number;
  start: number;
  end: number;
  mark?: 'CR' | 'DR';
}

function amountsIn(line: string): AmountHit[] {
  const hits: AmountHit[] = [];
  for (const m of line.matchAll(AMOUNT)) {
    hits.push({
      value: +`${m[1].replace(/,/g, '')}.${m[2]}`,
      start: m.index!,
      end: m.index! + m[0].length,
      // SBI Card writes a bare C / D after the amount.
      mark: m[3] ? (m[3].toUpperCase().startsWith('C') ? 'CR' : 'DR') : undefined,
    });
  }
  return hits;
}

// ---------- rows to skip ----------

/** Summary rows that look like transactions but aren't. */
const NOT_A_TXN =
  /\b(opening|closing|net outstanding|total|balance b\/?f|balance c\/?f|brought forward|carried forward|minimum (amount )?due|payment due|credit limit|statement (date|period))\b/i;

/** The rest of a statement-period line such as "25 SEP 2026 To 24 OCT 2026". */
const PERIOD_REST = /^\s*(?:to|till|-)\s+\d{1,2}(?:\s?[A-Za-z]{3}[a-z]*,?\s+|[/.-]\d{1,2}[/.-])\d{2,4}\b/i;

// ---------- merchants and categories ----------

interface MerchantRule {
  match: RegExp;
  name: string;
  category: string; // category id
  transfer?: boolean;
}

/** Known merchants: tidy name and default category. First match wins. */
const MERCHANTS: MerchantRule[] = [
  { match: /cashback/i, name: 'Cashback', category: 'cat_other' },
  { match: /swiggy\s*instamart|instamart/i, name: 'Swiggy Instamart', category: 'cat_groceries' },
  { match: /eazydiner/i, name: 'EazyDiner', category: 'cat_food' },
  { match: /swiggy/i, name: 'Swiggy', category: 'cat_food' },
  { match: /zomato/i, name: 'Zomato', category: 'cat_food' },
  { match: /blinkit|blink commerce|grofers/i, name: 'Blinkit', category: 'cat_groceries' },
  { match: /zepto/i, name: 'Zepto', category: 'cat_groceries' },
  { match: /bigbasket|big basket|innovative retail/i, name: 'BigBasket', category: 'cat_groceries' },
  { match: /dmart|avenue supermarts/i, name: 'DMart', category: 'cat_groceries' },
  { match: /reliance retail|reliance smart|jiomart/i, name: 'Reliance Retail', category: 'cat_shopping' },
  { match: /\buber\b/i, name: 'Uber', category: 'cat_transport' },
  { match: /\bola\b|ani technologies/i, name: 'Ola', category: 'cat_transport' },
  { match: /rapido|roppen/i, name: 'Rapido', category: 'cat_transport' },
  { match: /irctc/i, name: 'IRCTC', category: 'cat_travel' },
  { match: /indigo|interglobe/i, name: 'IndiGo', category: 'cat_travel' },
  { match: /air india|vistara/i, name: 'Air India', category: 'cat_travel' },
  { match: /makemytrip|make my trip/i, name: 'MakeMyTrip', category: 'cat_travel' },
  { match: /ibibo|goibibo/i, name: 'Goibibo', category: 'cat_travel' },
  { match: /easy ?trip|easemytrip/i, name: 'EaseMyTrip', category: 'cat_travel' },
  { match: /booking\.com/i, name: 'Booking.com', category: 'cat_travel' },
  { match: /airbnb/i, name: 'Airbnb', category: 'cat_travel' },
  { match: /\boyo\b|oravel/i, name: 'OYO', category: 'cat_travel' },
  { match: /fsn e-?commerce|nykaa/i, name: 'Nykaa', category: 'cat_shopping' },
  { match: /amazon/i, name: 'Amazon', category: 'cat_shopping' },
  { match: /flipkart/i, name: 'Flipkart', category: 'cat_shopping' },
  { match: /myntra/i, name: 'Myntra', category: 'cat_shopping' },
  { match: /ajio/i, name: 'AJIO', category: 'cat_shopping' },
  { match: /westside|trent/i, name: 'Westside', category: 'cat_shopping' },
  { match: /decathlon/i, name: 'Decathlon', category: 'cat_shopping' },
  { match: /ikea/i, name: 'IKEA', category: 'cat_shopping' },
  { match: /netflix/i, name: 'Netflix', category: 'cat_fun' },
  { match: /spotify/i, name: 'Spotify', category: 'cat_fun' },
  { match: /hotstar|jiocinema|jiohotstar/i, name: 'JioHotstar', category: 'cat_fun' },
  { match: /bookmyshow|bigtree/i, name: 'BookMyShow', category: 'cat_fun' },
  { match: /pvr|inox/i, name: 'PVR INOX', category: 'cat_fun' },
  { match: /youtube|google ?play/i, name: 'Google', category: 'cat_fun' },
  { match: /apple\.com|itunes/i, name: 'Apple', category: 'cat_fun' },
  { match: /anthropic|claude/i, name: 'Claude (Anthropic)', category: 'cat_other' },
  { match: /openai|chatgpt/i, name: 'OpenAI', category: 'cat_other' },
  { match: /myjio|reliance jio|\bjio\b/i, name: 'Jio', category: 'cat_rent' },
  { match: /airtel/i, name: 'Airtel', category: 'cat_rent' },
  { match: /vodafone|\bvi\b/i, name: 'Vi', category: 'cat_rent' },
  { match: /bescom|tata power|adani electricity|bses|msedcl|electricity/i, name: 'Electricity bill', category: 'cat_rent' },
  { match: /pharma|pharmacy|medplus|apollo|1mg|netmeds|pharmeasy|\bhospital\b|\bclinic\b|diagnostic/i, name: '', category: 'cat_health' },
  { match: /one97|paytm/i, name: 'Paytm', category: 'cat_other' },
  { match: /restaurant|cafe|caf[eé]|dhaba|bakery|kitchen|hospitality|food|biryani|pizza|domino|mcdonald|kfc|starbucks|chaayos/i, name: '', category: 'cat_food' },
  { match: /fuel|petrol|hpcl|bpcl|indian oil|iocl|shell/i, name: '', category: 'cat_transport' },
  { match: /alcobev|liquor|wines|beer/i, name: '', category: 'cat_fun' },
  // Merchant-category column printed by some card statements (Axis, IndusInd).
  { match: /\b(?:cloth|apparel|garment|footwear|department) stores?\b|misc store/i, name: '', category: 'cat_shopping' },
  { match: /\bgrocery|supermarket/i, name: '', category: 'cat_groceries' },
  { match: /\bairlines?\b|\bhotels?\b|travel agenc/i, name: '', category: 'cat_travel' },
  { match: /\bdrug stores?\b|\bmedical\b/i, name: '', category: 'cat_health' },
  { match: /service station|\btelecom|utilit/i, name: '', category: 'cat_rent' },
  // Not spending: money moving between your own accounts, cards and investments.
  { match: /credit card|card payment|cc payment|cc bill|billdesk.*card|autopay.*card/i, name: '', category: 'cat_other', transfer: true },
  { match: /\bsip\b|mutual fund|zerodha|groww|upstox|\bnach\b|\bemi\b|loan|\bfd\b|fixed deposit|\brd\b|ppf|nps|self transfer|own account/i, name: '', category: 'cat_other', transfer: true },
];

/** Payment-processor prefixes and UPI wrappers around the real merchant name. */
function stripNoise(raw: string): string {
  let s = raw.trim();
  // UPI-SWIGGY-SWIGGY8@ICICI-1234 / UPI/SWIGGY/... -> SWIGGY
  const upi = s.match(/^UPI[-/\s]+([^-/@]+)/i);
  if (upi) s = upi[1];
  s = s.replace(/^(?:RSP|PAY|CAS|RAZ|PTM|PPSL|PYU|BDS|EAZ|IND|SQ|MW|POS|ECOM|NEFT|IMPS|RTGS|ACH\s?D?)[*\s-]+/i, '');
  return s.trim();
}

/** City, state and country words that statements append after the merchant name. */
const PLACE =
  /\s+(?:mumbai|bombay|bangalore|bengaluru|gurgaon|gurugram|new delhi|delhi|noida|thane|pune|hyderabad|chennai|kolkata|ahmedabad|jaipur|lucknow|chandigarh|kochi|indore|faridabad|ghaziabad|karnataka|haryana|maharashtra|west bengal|san francisco|singapore|dublin|london|in|ind|india|kar|har|mah|utt|del|tn|ts|ka|mh|hr|up|ca|us|usa|gb|sg|ie)$/i;

function stripPlaces(s: string): string {
  let prev;
  do {
    prev = s;
    s = s.replace(PLACE, '');
  } while (s !== prev && s.length > 0);
  return s;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(Private|Limited|Pvt|Ltd|Limit|Limi|Lim|Li|Pv|P|Llp|Inc|Co)\b\.?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Clean merchant name, category id and transfer flag for a raw narration. */
export function classify(narration: string): { description: string; category: string; transfer: boolean } {
  // Never show card or account numbers in descriptions.
  narration = narration.replace(MASKED_NUMBER, '').replace(/\b\d{4}[ -]?[\dXx*]{4}[ -]?[\dXx*]{4}[ -]?\d{4}\b/g, '').trim();
  if (/^to\s*$/i.test(narration)) return { description: 'Card bill payment', category: 'cat_other', transfer: true };
  const rule = MERCHANTS.find((r) => r.match.test(narration));
  // The layout separates PDF text pieces by 2+ spaces; the first piece is the
  // merchant, the rest is usually city / country.
  const merchant = stripPlaces(stripNoise(narration.split(/\s{2,}/)[0].split(',')[0]));
  const description = rule?.name || titleCase(merchant) || narration.trim();
  return { description, category: rule?.category ?? 'cat_other', transfer: !!rule?.transfer };
}

// ---------- the parser ----------

interface Columns {
  debit: number; // character position of the column heading's centre
  credit: number;
  balance?: number;
}

const DATE_CELL = /^(?:txn\.?\s*|tran\.?\s*|transaction\s+|value\s+|posting\s+)?date$/i;
const DEBIT_CELL = /^(?:withdrawals?|debits?|dr\.?)(?:\s*(?:amt\.?|amount))?(?:\s*\((?:inr|rs\.?|₹)\))?$/i;
const CREDIT_CELL = /^(?:deposits?|credits?|cr\.?)(?:\s*(?:amt\.?|amount))?(?:\s*\((?:inr|rs\.?|₹)\))?$/i;
const BALANCE_CELL = /^(?:closing\s+|running\s+)?balance(?:\s*\((?:inr|rs\.?|₹)\))?$/i;

/**
 * A table header row like "Date  Narration  Withdrawal Amt.  Deposit Amt.  Balance".
 * Every cell must be a short label, so sentences in terms & conditions that
 * happen to mention "date", "debit" and "credit" are not mistaken for one.
 */
function readHeader(line: string): Columns | null {
  const cells: { text: string; centre: number }[] = [];
  for (const m of line.matchAll(/\S+(?: \S+)*/g)) {
    cells.push({ text: m[0], centre: m.index! + m[0].length / 2 });
  }
  if (cells.length < 3 || cells.some((c) => c.text.split(' ').length > 4)) return null;
  const at = (re: RegExp) => cells.find((c) => re.test(c.text))?.centre ?? -1;
  if (at(DATE_CELL) < 0) return null;
  const debit = at(DEBIT_CELL);
  const credit = at(CREDIT_CELL);
  if (debit < 0 || credit < 0) return null;
  const balance = at(BALANCE_CELL);
  return { debit, credit, balance: balance >= 0 ? balance : undefined };
}

const AMOUNT_CELL = /^amount\b/i;

/** Character position where the header's Date cell starts. */
function dateColumnStart(line: string): number | null {
  for (const m of line.matchAll(/\S+(?: \S+)*/g)) if (DATE_CELL.test(m[0])) return m.index!;
  return null;
}

/** A card statement header like "DATE  TRANSACTION DETAILS  MERCHANT CATEGORY  AMOUNT (Rs.)  CASHBACK EARNED". */
function readAmountHeader(line: string): number | null {
  const cells = [...line.matchAll(/\S+(?: \S+)*/g)].map((m) => ({ text: m[0], centre: m.index! + m[0].length / 2 }));
  if (cells.length < 3 || cells.some((c) => c.text.split(' ').length > 4)) return null;
  if (!cells.some((c) => DATE_CELL.test(c.text))) return null;
  return cells.find((c) => AMOUNT_CELL.test(c.text))?.centre ?? null;
}

// ---------- which card / account the statement is for ----------

/**
 * A card or account number with its middle hidden: 51xx xxxx xxxx 1234, 4111XXXXXXXX5678,
 * 411111******9012, or SBI Card's XXXX XXXX XXXX XX34 (only the last 2 digits shown).
 */
const MASKED_NUMBER = /(?:\b\d{2,6}[ -]?(?:[Xx*]{2,}[ -]?){1,4}(\d{4})|(?:\b[Xx*]{4}[ -]?){3}[Xx*]{2}(\d{2}))\b/g;
const ACCOUNT_NUMBER = /\b(?:a\/c|account)\s*(?:no\.?|number)?\s*[:.-]?\s*([Xx*\d]{6,20}\d{4})\b/gi;

const BANKS: [RegExp, string][] = [
  [/\bhsbc\b/gi, 'HSBC'],
  [/\baxis\b/gi, 'Axis'],
  [/\bindus\s?[il]nd\b/gi, 'IndusInd'],
  [/\bicici\b/gi, 'ICICI'],
  [/\bhdfc\b/gi, 'HDFC'],
  [/\bsbi\b|state bank of india/gi, 'SBI'],
  [/\bkotak\b/gi, 'Kotak'],
  [/\byes bank\b/gi, 'Yes Bank'],
  [/\bidfc\b/gi, 'IDFC FIRST'],
  [/\bau small finance\b|\bau bank\b/gi, 'AU'],
  [/\brbl\b/gi, 'RBL'],
  [/american express|\bamex\b/gi, 'Amex'],
  [/\bciti\s?bank\b/gi, 'Citi'],
  [/standard chartered/gi, 'Standard Chartered'],
  [/bank of baroda|\bbob\b/gi, 'Bank of Baroda'],
  [/federal bank/gi, 'Federal Bank'],
  [/punjab national bank|\bpnb\b/gi, 'PNB'],
  [/canara bank/gi, 'Canara Bank'],
  [/union bank/gi, 'Union Bank'],
];

export interface StatementAccount {
  /** Stable id, the same for every statement of this card / account. */
  id: string;
  /** e.g. "Axis Card ••1234" */
  name: string;
  bank: string;
  kind: 'card' | 'bank';
  /** Last digits shown on the statement (4, or 2 for SBI Card). */
  last4: string;
}

/** Most frequent match wins: statements repeat their own bank and number on every page. */
function mostFrequent(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, n] of counts) if (best === null || n > counts.get(best)!) best = v;
  return best;
}

export function detectAccount(text: string): StatementAccount | null {
  const bank = mostFrequent(BANKS.flatMap(([re, name]) => [...text.matchAll(re)].map(() => name)));
  const kind: 'card' | 'bank' = /credit card/i.test(text) ? 'card' : 'bank';
  const numbers =
    kind === 'card'
      ? [...text.matchAll(MASKED_NUMBER)].map((m) => m[1] ?? m[2])
      : [...text.matchAll(ACCOUNT_NUMBER)].map((m) => m[1].slice(-4)).filter((d) => /^\d{4}$/.test(d));
  const last4 = mostFrequent(numbers);
  if (!bank || !last4) return null;
  return {
    id: `acct_${bank.toLowerCase().replace(/[^a-z]/g, '')}_${kind}_${last4}`,
    name: `${bank} ${kind === 'card' ? 'Card' : 'A/c'} ••${last4}`,
    bank,
    kind,
    last4,
  };
}

export interface RuleParseResult {
  transactions: StatementTxn[];
  layout: 'columns' | 'single-amount';
  /** The card or bank account the statement belongs to, when it could be identified. */
  account: StatementAccount | null;
}

export function parseStatementText(pages: string[], today = new Date()): RuleParseResult {
  const all = pages.join('\n');
  const end = statementEndDate(all, today);
  const lines = all.split('\n');

  let columns: Columns | null = null;
  for (const l of lines) if ((columns = readHeader(l))) break;
  let amountColumn: number | null = null;
  let headerLine: string | undefined;
  if (columns) headerLine = lines.find((l) => readHeader(l));
  else {
    headerLine = lines.find((l) => readAmountHeader(l) !== null);
    amountColumn = headerLine ? readAmountHeader(headerLine) : null;
  }
  const dateCol = headerLine ? dateColumnStart(headerLine) : null;
  const account = detectAccount(all);

  const out: StatementTxn[] = [];
  for (const line of lines) {
    const d = readRowDateAt(line, dateCol);
    if (!d) continue;
    const rest = line.slice(d.length);
    if (NOT_A_TXN.test(rest) || PERIOD_REST.test(rest)) continue;
    const amounts = amountsIn(rest).map((a) => ({ ...a, start: a.start + d.length, end: a.end + d.length }));
    if (!amounts.length) continue;

    // A year-less date belongs to the statement's year, or the year before
    // when its month is after the statement's end month (Dec rows in a Jan statement).
    const year = d.year ?? (d.month > end.month ? end.year - 1 : end.year);
    const date = validDate(year, d.month, d.day);
    if (!date) continue;

    let amount: number;
    let direction: 'debit' | 'credit';
    let narrationEnd: number;
    if (columns) {
      // Use each amount's position: closest heading wins; the balance column is ignored.
      const cols = columns;
      const pick = amounts
        .map((a) => {
          const centre = (a.start + a.end) / 2;
          const dist = { debit: Math.abs(centre - cols.debit), credit: Math.abs(centre - cols.credit), balance: cols.balance === undefined ? Infinity : Math.abs(centre - cols.balance) };
          const col = (Object.keys(dist) as (keyof typeof dist)[]).reduce((a2, b2) => (dist[a2] <= dist[b2] ? a2 : b2));
          return { a, col };
        })
        .find((x) => x.col !== 'balance' && x.a.value > 0);
      if (!pick) continue;
      amount = pick.a.value;
      direction = pick.a.mark === 'CR' ? 'credit' : pick.a.mark === 'DR' ? 'debit' : pick.col === 'credit' ? 'credit' : 'debit';
      narrationEnd = amounts[0].start;
    } else {
      // Credit cards: the amount under the "Amount" heading if there is one (Axis also
      // prints cashback after it), otherwise the last number on the row. "CR" marks credits.
      const col = amountColumn;
      const a =
        col === null
          ? amounts[amounts.length - 1]
          : amounts.reduce((x, y) => (Math.abs((x.start + x.end) / 2 - col) <= Math.abs((y.start + y.end) / 2 - col) ? x : y));
      if (!(a.value > 0)) continue;
      amount = a.value;
      direction = a.mark === 'CR' ? 'credit' : 'debit';
      narrationEnd = a.start;
    }

    // Narration: text between the date and the first amount, minus reference /
    // serial numbers before or after it (ICICI prints a serial number first).
    const narration = line
      .slice(d.length, narrationEnd)
      .replace(/\s{2,}\d{6,}\s*$/, '')
      .replace(/^\s*\d{6,}\s+/, '')
      .trim();
    if (!narration) continue;
    const c = classify(narration);
    // On a card statement, money coming in that is a payment (not a refund or
    // cashback) is you paying the bill: a transfer, not income.
    const cardPayment =
      account?.kind === 'card' &&
      direction === 'credit' &&
      /payment received|bbps|thank you|autopay|bill ?payment|card payment|^(?:neft|imps|upi|to)\b/i.test(narration) &&
      !/refund|reversal|cashback/i.test(narration);
    out.push({
      date,
      description: cardPayment ? 'Card bill payment' : c.description,
      amount,
      direction,
      kind: c.transfer || cardPayment ? 'transfer' : 'spend',
      category: c.category,
    });
  }
  return { transactions: out, layout: columns ? 'columns' : 'single-amount', account };
}
