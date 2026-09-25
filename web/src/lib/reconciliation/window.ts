import { projectCancellations, type LedgerEntry } from './index';
export const PROJECTION_WINDOW_LIMIT = 10000;
const DAY = 86400000;
/** Conservative dependency edge: even low-ranked candidates affect ambiguity/remaining funds. */
export function projectionDepends(a: LedgerEntry, b: LedgerEntry): boolean {
  if (a.memberId !== b.memberId || a.cardId !== b.cardId || !a.cardId) return false;
  if (a.canceledTxId === b.id || b.canceledTxId === a.id) return true;
  if (a.txType === b.txType || a.currency !== b.currency) return false;
  const approval = a.txType === 'APPROVAL' ? a : b;
  const cancel = a.txType === 'CANCELLATION' ? a : b;
  const boundary =
    cancel.timePrecision === 'DAY'
      ? Math.floor((cancel.approvedAt.getTime() + 9 * 3600000) / DAY) * DAY - 9 * 3600000 + DAY - 1
      : cancel.approvedAt.getTime();
  const delta = boundary - approval.approvedAt.getTime();
  return delta >= 0 && delta <= 60 * DAY;
}
/** Both BEFORE and AFTER roots are required, including removed/moved/merged rows. */
export function cancellationWindow(entries: readonly LedgerEntry[], roots: readonly LedgerEntry[]) {
  const selected = new Map<string, LedgerEntry>();
  const pending = [...roots];
  for (const root of roots) {
    const current = entries.find((e) => e.id === root.id);
    if (current) {
      selected.set(current.id, current);
      pending.push(current);
    }
  }
  for (let i = 0; i < pending.length; i++) {
    for (const entry of entries) {
      if (!selected.has(entry.id) && projectionDepends(pending[i]!, entry)) {
        selected.set(entry.id, entry);
        pending.push(entry);
        if (selected.size > PROJECTION_WINDOW_LIMIT) throw new Error('PROJECTION_WINDOW_LIMIT');
      }
    }
  }
  return [...selected.values()];
}
export function projectCancellationWindow(
  entries: readonly LedgerEntry[],
  roots: readonly LedgerEntry[],
) {
  const window = cancellationWindow(entries, roots);
  return { ids: window.map((e) => e.id), projection: projectCancellations(window) };
}
