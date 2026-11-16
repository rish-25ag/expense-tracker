/**
 * Splitwise-style sharing between accounts.
 *
 * Locally an expense's shares refer to ME or to local friend ids. On the server a
 * shared expense refers to people by account id (`uid`) when they have one, or by
 * name for friends without an account. Each member's app translates the shared
 * row into its own point of view: its owner becomes ME, other accounts become (or
 * create) the friend linked to that account.
 */
import { ME, type Person, type Share } from './types.ts';

/** A participant in a shared expense, as stored on the server. */
export interface SharedShare {
  uid?: string; // account id, when the person has an account
  name: string; // display name (for people without an account, the only identifier)
  amount: number;
}

export interface SharedExpenseRow {
  id: string;
  created_by: string;
  member_ids: string[];
  amount: number;
  date: string;
  note: string;
  /** Category name as the last editor had it; only used for a new mirror's first category. */
  category: string | null;
  /** Who paid, in the same form as a share entry. */
  paid_by: { uid?: string; name: string };
  shares: SharedShare[];
  updated_at: number;
  deleted: boolean;
}

export interface SharedSettlementRow {
  id: string;
  created_by: string;
  member_ids: string[];
  from_uid: string; // who paid the money
  to_uid: string; // who received it
  from_name: string;
  to_name: string;
  amount: number;
  date: string;
  note: string;
  updated_at: number;
  deleted: boolean;
}

/** People with no account are referenced locally by this id prefix when they come from someone else's expense. */
const EXTERNAL = 'ext:';

export function isExternal(personId: string): boolean {
  return personId.startsWith(EXTERNAL);
}

export function externalName(personId: string): string {
  return personId.slice(EXTERNAL.length);
}

interface Me {
  uid: string;
  name: string;
}

function toSharedPerson(personId: string, me: Me, people: Record<string, Person>): { uid?: string; name: string } {
  if (personId === ME) return { uid: me.uid, name: me.name };
  if (isExternal(personId)) return { name: externalName(personId) };
  const p = people[personId];
  return p?.userId ? { uid: p.userId, name: p.name } : { name: p?.name ?? 'Friend' };
}

/** True when the split includes at least one friend who has an account (so it should be shared). */
export function involvesAccounts(shares: Share[], paidBy: string, people: Record<string, Person>): boolean {
  return [paidBy, ...shares.map((s) => s.personId)].some((id) => id !== ME && !!people[id]?.userId);
}

/** Local expense -> shared row (my point of view -> account ids). */
export function toSharedExpense(
  e: {
    id: string;
    amount: number;
    date: string;
    note: string;
    paidBy: string;
    shares: Share[];
    updatedAt: number;
    deleted: boolean;
  },
  categoryName: string | null,
  createdBy: string,
  me: Me,
  people: Record<string, Person>,
): SharedExpenseRow {
  const shares = e.shares.map((s) => ({ ...toSharedPerson(s.personId, me, people), amount: s.amount }));
  const paid_by = toSharedPerson(e.paidBy, me, people);
  const uids = new Set<string>([createdBy, me.uid]);
  for (const p of [paid_by, ...shares]) if (p.uid) uids.add(p.uid);
  return {
    id: e.id,
    created_by: createdBy,
    member_ids: [...uids].sort(),
    amount: e.amount,
    date: e.date,
    note: e.note,
    category: categoryName,
    paid_by,
    shares,
    updated_at: e.updatedAt,
    deleted: e.deleted,
  };
}

/** Friends this device must create to show a shared row (accounts it doesn't know yet). */
export function missingFriends(
  row: SharedExpenseRow,
  myUid: string,
  people: Person[],
): { uid: string; name: string }[] {
  const known = new Set(people.map((p) => p.userId).filter(Boolean));
  const out = new Map<string, string>();
  for (const p of [row.paid_by, ...row.shares]) {
    if (p.uid && p.uid !== myUid && !known.has(p.uid)) out.set(p.uid, p.name);
  }
  return [...out].map(([uid, name]) => ({ uid, name }));
}

/** Shared row -> my local view (account ids -> ME / my friend ids). Call after creating missing friends. */
export function fromSharedExpense(
  row: SharedExpenseRow,
  myUid: string,
  people: Person[],
): { paidBy: string; shares: Share[] } {
  const byUid = new Map(people.filter((p) => p.userId).map((p) => [p.userId!, p.id]));
  // People without an account travel by name: match them to my own friend of that name
  // (so my balance with them stays right), otherwise keep them as a name only.
  const byName = new Map(people.filter((p) => !p.userId).map((p) => [p.name.trim().toLowerCase(), p.id]));
  const local = (p: { uid?: string; name: string }) => {
    if (p.uid === myUid) return ME;
    if (p.uid) return byUid.get(p.uid) ?? `${EXTERNAL}${p.name}`;
    return byName.get(p.name.trim().toLowerCase()) ?? `${EXTERNAL}${p.name}`;
  };
  return {
    paidBy: local(row.paid_by),
    shares: row.shares.map((s) => ({ personId: local(s), amount: s.amount })),
  };
}

/** Local settlement with a linked friend -> shared row. */
export function toSharedSettlement(
  s: {
    id: string;
    amount: number;
    date: string;
    note: string;
    direction: 'paid' | 'received';
    updatedAt: number;
    deleted: boolean;
  },
  friend: { uid: string; name: string },
  createdBy: string,
  me: Me,
): SharedSettlementRow {
  const [from, to] = s.direction === 'paid' ? [me, friend] : [friend, me];
  const [from_uid, to_uid] = [from.uid, to.uid];
  return {
    from_name: from.name,
    to_name: to.name,
    id: s.id,
    created_by: createdBy,
    member_ids: [...new Set([from_uid, to_uid, createdBy])].sort(),
    from_uid,
    to_uid,
    amount: s.amount,
    date: s.date,
    note: s.note,
    updated_at: s.updatedAt,
    deleted: s.deleted,
  };
}

/** Shared settlement -> my view: which friend (account id) and whether I paid or received. */
export function fromSharedSettlement(
  row: SharedSettlementRow,
  myUid: string,
): { friendUid: string; friendName: string; direction: 'paid' | 'received' } | null {
  if (row.from_uid === myUid) return { friendUid: row.to_uid, friendName: row.to_name, direction: 'paid' };
  if (row.to_uid === myUid) return { friendUid: row.from_uid, friendName: row.from_name, direction: 'received' };
  return null; // not between me and someone (shouldn't happen with member rules)
}
