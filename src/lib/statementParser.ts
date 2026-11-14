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

const AMOUNT = /(?<![\w.])(?:₹|Rs\.?|INR)?\s?(\d{1,3}(?:,\d{2,3})*|\d+)\.(\d{2})(?:\s{0,3}(CR|Cr|cr|DR|Dr|dr))?(?![\w.])/g;

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
      mark: m[3] ? (m[3].toUpperCase() as 'CR' | 'DR') : undefined,
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
  { match: /swiggy\s*instamart|instamart/i, name: 'Swiggy Instamart', category: 'cat_groceries' },
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
  s = s.replace(/^(?:RSP|PAY|CAS|RAZ|PTM|PYU|BDS|EAZ|IND|SQ|MW|POS|ECOM|NEFT|IMPS|RTGS|ACH\s?D?)[*\s-]+/i, '');
  return s.trim();
}

/** City, state and country words that statements append after the merchant name. */
const PLACE =
  /\s+(?:mumbai|bombay|bangalore|bengaluru|gurgaon|gurugram|new delhi|delhi|noida|thane|pune|hyderabad|chennai|kolkata|ahmedabad|jaipur|lucknow|chandigarh|kochi|indore|faridabad|ghaziabad|san francisco|singapore|dublin|london|ind|india|kar|har|mah|utt|del|tn|ts|ka|mh|hr|up|ca|us|usa|gb|sg|ie)$/i;

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
    .replace(/\b(Pvt|Ltd|Limit|Lim|Li|Pv|P|Llp|Inc|Co)\b\.?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Clean merchant name, category id and transfer flag for a raw narration. */
export function classify(narration: string): { description: string; category: string; transfer: boolean } {
  // Never show card or account numbers in descriptions.
  narration = narration.replace(/\b\d{4}[ -]?[\dXx*]{4}[ -]?[\dXx*]{4}[ -]?\d{4}\b/g, '').trim();
  if (/^to\s*$/i.test(narration)) return { description: 'Card payment', category: 'cat_other', transfer: true };
  const rule = MERCHANTS.find((r) => r.match.test(narration));
  // The layout separates PDF text pieces by 2+ spaces; the first piece is the
  // merchant, the rest is usually city / country.
  const merchant = stripPlaces(stripNoise(narration.split(/\s{2,}/)[0]));
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

export interface RuleParseResult {
  transactions: StatementTxn[];
  layout: 'columns' | 'single-amount';
}

export function parseStatementText(pages: string[], today = new Date()): RuleParseResult {
  const all = pages.join('\n');
  const end = statementEndDate(all, today);
  const lines = all.split('\n');

  let columns: Columns | null = null;
  for (const l of lines) if ((columns = readHeader(l))) break;

  const out: StatementTxn[] = [];
  for (const line of lines) {
    const d = readRowDate(line);
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
      // Credit cards: the transaction amount is the last number on the row; "CR" marks credits.
      const a = amounts[amounts.length - 1];
      if (!(a.value > 0)) continue;
      amount = a.value;
      direction = a.mark === 'CR' ? 'credit' : 'debit';
      narrationEnd = a.start;
    }

    // Narration: text between the date and the first amount, minus reference numbers.
    const narration = line
      .slice(d.length, narrationEnd)
      .replace(/\s{2,}\d{6,}\s*$/, '')
      .trim();
    if (!narration) continue;
    const c = classify(narration);
    out.push({
      date,
      description: c.description,
      amount,
      direction,
      kind: c.transfer ? 'transfer' : 'spend',
      category: c.category,
    });
  }
  return { transactions: out, layout: columns ? 'columns' : 'single-amount' };
}
