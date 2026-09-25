export interface LedgerEntry {
  id: string;
  memberId: string;
  cardId: string | null;
  amount: number | null;
  txType: 'APPROVAL' | 'CANCELLATION';
  approvedAt: Date;
  timePrecision?: 'SECOND' | 'MINUTE' | 'DAY' | 'RECEIVED';
  originalApprovedAt?: Date | null;
  merchantName: string;
  currency: string;
  foreignAmount?: number | null;
  foreignScale?: number | null;
  approvalReference?: string | null;
  sourceKeys: string[];
  state: 'CONFIRMED' | 'REVIEW' | 'MERGED';
  canceledTxId?: string | null;
  manualCancellationLink?: boolean;
}
export type DuplicateDecision =
  | { kind: 'NEW' }
  | { kind: 'MERGE'; transactionId: string }
  | { kind: 'REVIEW'; candidates: string[] };
const name = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR');
/** A unique event reference is required for automatic merging; similarity alone needs review. */
export function findDuplicate(
  incoming: LedgerEntry,
  existing: readonly LedgerEntry[],
): DuplicateDecision {
  if (!incoming.cardId) return { kind: 'NEW' };
  const referenceConflicts = incoming.approvalReference
    ? existing.filter(
        (t) =>
          t.id !== incoming.id &&
          t.state !== 'MERGED' &&
          t.memberId === incoming.memberId &&
          t.cardId === incoming.cardId &&
          t.txType === incoming.txType &&
          t.approvalReference === incoming.approvalReference &&
          Math.abs(t.approvedAt.getTime() - incoming.approvedAt.getTime()) <= 86400000 &&
          (t.amount !== incoming.amount ||
            t.currency !== incoming.currency ||
            t.foreignAmount !== incoming.foreignAmount ||
            t.foreignScale !== incoming.foreignScale ||
            name(t.merchantName) !== name(incoming.merchantName)),
      )
    : [];
  if (referenceConflicts.length)
    return { kind: 'REVIEW', candidates: referenceConflicts.map((t) => t.id).sort() };
  const candidates = existing.filter(
    (t) =>
      t.id !== incoming.id &&
      t.state !== 'MERGED' &&
      t.memberId === incoming.memberId &&
      t.cardId === incoming.cardId &&
      t.txType === incoming.txType &&
      t.amount === incoming.amount &&
      t.currency === incoming.currency &&
      t.foreignAmount === incoming.foreignAmount &&
      t.foreignScale === incoming.foreignScale &&
      name(t.merchantName) !== '' &&
      name(t.merchantName) === name(incoming.merchantName) &&
      (t.timePrecision === 'DAY' || incoming.timePrecision === 'DAY'
        ? kstDay(t.approvedAt) === kstDay(incoming.approvedAt)
        : Math.abs(t.approvedAt.getTime() - incoming.approvedAt.getTime()) <= 120000),
  );
  const independent = candidates.filter(
    (t) => !t.sourceKeys.some((s) => incoming.sourceKeys.includes(s)),
  );
  const strong = independent.filter(
    (t) => incoming.approvalReference && t.approvalReference === incoming.approvalReference,
  );
  if (strong.length === 1 && independent.length === 1)
    return { kind: 'MERGE', transactionId: strong[0]!.id };
  const sameReference = candidates.filter(
    (t) => incoming.approvalReference && t.approvalReference === incoming.approvalReference,
  );
  if (!independent.length && sameReference.length)
    return { kind: 'REVIEW', candidates: sameReference.map((t) => t.id).sort() };
  if (independent.length)
    return { kind: 'REVIEW', candidates: independent.map((t) => t.id).sort() };
  return { kind: 'NEW' };
}
export interface CancellationProjection {
  totals: Record<string, number>;
  links: Record<string, string>;
  unresolved: Record<
    string,
    'NO_CARD' | 'UNKNOWN_AMOUNT' | 'NO_ORIGINAL' | 'AMBIGUOUS_ORIGINAL' | 'INVALID_MANUAL_LINK'
  >;
}
/** Recompute from canonical events, never increment an already-derived cancellation total. */
export function projectCancellations(
  entries: readonly LedgerEntry[],
  lookbackDays = 60,
): CancellationProjection {
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 3650)
    throw new Error('Invalid lookback');
  if (new Set(entries.map((e) => e.id)).size !== entries.length)
    throw new Error('Duplicate event IDs');
  if (entries.some((e) => e.amount !== null && (!Number.isInteger(e.amount) || e.amount < 0)))
    throw new Error('Invalid amount');
  const result: CancellationProjection = { totals: {}, links: {}, unresolved: {} };
  const approvals = entries.filter((e) => e.txType === 'APPROVAL' && e.state === 'CONFIRMED');
  for (const e of approvals) result.totals[e.id] = 0;
  const cancels = entries
    .filter((e) => e.txType === 'CANCELLATION' && e.state === 'CONFIRMED')
    .sort(
      (a, b) =>
        Number(Boolean(b.manualCancellationLink)) - Number(Boolean(a.manualCancellationLink)) ||
        a.approvedAt.getTime() - b.approvedAt.getTime() ||
        a.id.localeCompare(b.id),
    );
  for (const cancel of cancels) {
    if (!cancel.cardId) {
      result.unresolved[cancel.id] = 'NO_CARD';
      continue;
    }
    if (cancel.amount === null) {
      result.unresolved[cancel.id] = 'UNKNOWN_AMOUNT';
      continue;
    }
    const boundary =
      cancel.timePrecision === 'DAY'
        ? new Date(Date.parse(kstDay(cancel.approvedAt) + 'T00:00:00+09:00') + 86400000 - 1)
        : cancel.approvedAt;
    const candidates = approvals.filter(
      (a) =>
        a.cardId === cancel.cardId &&
        a.memberId === cancel.memberId &&
        a.amount !== null &&
        a.currency === cancel.currency &&
        a.approvedAt <= boundary &&
        boundary.getTime() - a.approvedAt.getTime() <= lookbackDays * 86400000 &&
        a.amount - result.totals[a.id]! >= cancel.amount! &&
        (!cancel.originalApprovedAt || kstDay(a.approvedAt) === kstDay(cancel.originalApprovedAt)),
    );
    if (cancel.manualCancellationLink) {
      const selected = candidates.find((a) => a.id === cancel.canceledTxId);
      if (selected) {
        result.links[cancel.id] = selected.id;
        result.totals[selected.id]! += cancel.amount;
      } else result.unresolved[cancel.id] = 'INVALID_MANUAL_LINK';
      continue;
    }
    const ranked = candidates
      .map((a) => {
        const merchant = name(a.merchantName),
          target = name(cancel.merchantName);
        let score =
          merchant && target
            ? merchant === target
              ? 50
              : merchant.includes(target) || target.includes(merchant)
                ? 25
                : 0
            : 0;
        score += a.amount === cancel.amount ? 40 : 20;
        score +=
          10 * (1 - (boundary.getTime() - a.approvedAt.getTime()) / (lookbackDays * 86400000));
        return { entry: a, score };
      })
      .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
    const best = ranked[0];
    if (best && best.score >= 60 && (!ranked[1] || best.score - ranked[1].score >= 15)) {
      result.links[cancel.id] = best.entry.id;
      result.totals[best.entry.id]! += cancel.amount;
    } else result.unresolved[cancel.id] = ranked.length ? 'AMBIGUOUS_ORIGINAL' : 'NO_ORIGINAL';
  }
  return result;
}
function kstDay(date: Date): string {
  return new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
export function netAmount(entry: { amount: number | null; canceledAmount: number }): number | null {
  if (entry.amount === null) {
    if (entry.canceledAmount !== 0) throw new Error('Unknown amount has cancellation');
    return null;
  }
  if (
    !Number.isInteger(entry.amount) ||
    !Number.isInteger(entry.canceledAmount) ||
    entry.amount < 0 ||
    entry.canceledAmount < 0 ||
    entry.canceledAmount > entry.amount
  )
    throw new Error('Invalid amount state');
  return entry.amount - entry.canceledAmount;
}
