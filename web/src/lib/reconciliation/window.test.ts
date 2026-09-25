import { expect, it } from 'vitest';
import { projectCancellations, projectCancellationWindow, type LedgerEntry } from './index';
it('matches complete replay after 3000 seeded ledger mutations including manual and DAY boundaries', () => {
  let seed = 726;
  const random = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let trial = 0; trial < 3000; trial++) {
    const before: LedgerEntry[] = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      memberId: 'synthetic',
      cardId: 'card',
      amount: (random(8) + 1) * 100,
      txType: i % 3 ? 'APPROVAL' : 'CANCELLATION',
      approvedAt: new Date(Date.UTC(2025, 0, 1) + random(180) * 86400000),
      merchantName: 'fake-' + random(3),
      currency: 'KRW',
      sourceKeys: [],
      state: 'CONFIRMED',
      timePrecision: random(2) ? 'DAY' : 'SECOND',
      manualCancellationLink: i % 9 === 0,
      canceledTxId: i % 9 === 0 ? String(Math.max(1, i - 2)) : null,
    }));
    const prior = projectCancellations(before);
    const index = random(before.length),
      old = before[index]!;
    const after = before.map((e, i) =>
      i === index
        ? {
            ...e,
            amount: (random(10) + 1) * 100,
            approvedAt: new Date(e.approvedAt.getTime() + (random(121) - 60) * 86400000),
            state: trial % 5 === 0 ? ('MERGED' as const) : ('CONFIRMED' as const),
            txType:
              trial % 7 === 0
                ? e.txType === 'APPROVAL'
                  ? ('CANCELLATION' as const)
                  : ('APPROVAL' as const)
                : e.txType,
          }
        : e,
    );
    const result = projectCancellationWindow(after, [old, after[index]!]);
    for (const id of result.ids) {
      delete prior.totals[id];
      delete prior.links[id];
      delete prior.unresolved[id];
    }
    for (const key of ['totals', 'links', 'unresolved'] as const)
      Object.assign(prior[key], result.projection[key]);
    expect(prior).toEqual(projectCancellations(after));
  }
}, 30000);
it('includes exact 60-day edges and cascades beyond the initial window', () => {
  const entries: LedgerEntry[] = Array.from({ length: 10 }, (_, i) => ({
    id: String(i),
    memberId: 'm',
    cardId: 'c',
    amount: 100,
    txType: i % 2 ? 'CANCELLATION' : 'APPROVAL',
    approvedAt: new Date((i * 15 + (i % 2 ? 45 : 0)) * 86400000),
    merchantName: 'fake',
    currency: 'KRW',
    sourceKeys: [],
    state: 'CONFIRMED',
  }));
  expect(projectCancellationWindow(entries, [entries[0]!]).ids).toHaveLength(10);
});
