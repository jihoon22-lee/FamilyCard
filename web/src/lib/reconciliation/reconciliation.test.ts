import { expect, it } from 'vitest';
import { findDuplicate, projectCancellations, netAmount, type LedgerEntry } from './index';
const original: LedgerEntry = {
  id: 'approval',
  memberId: 'self',
  cardId: 'card',
  amount: 100000,
  txType: 'APPROVAL',
  approvedAt: new Date('2026-08-10T02:00:00Z'),
  merchantName: '테스트가맹점',
  currency: 'KRW',
  sourceKeys: ['CARD_APP:synthetic'],
  state: 'CONFIRMED',
};
const cancellation = (id: string, amount: number): LedgerEntry => ({
  ...original,
  id,
  amount,
  txType: 'CANCELLATION',
  approvedAt: new Date('2026-08-12T02:00:00Z'),
  sourceKeys: ['SMS_SENDER:synthetic'],
});
it('merges only independent evidence with strong reference; same-looking separate events need review', () => {
  const other = { ...original, id: 'incoming', sourceKeys: ['PAYMENT_APP:synthetic'] };
  expect(findDuplicate(other, [original]).kind).toBe('REVIEW');
  expect(
    findDuplicate({ ...other, approvalReference: 'synthetic-event' }, [
      { ...original, approvalReference: 'synthetic-event' },
    ]),
  ).toEqual({ kind: 'MERGE', transactionId: 'approval' });
  expect(findDuplicate({ ...other, sourceKeys: original.sourceKeys }, [original]).kind).toBe('NEW');
  expect(findDuplicate({ ...other, memberId: 'other' }, [original]).kind).toBe('NEW');
});
it('partial cancellations recompute from scratch and never double subtract', () => {
  const entries = [original, cancellation('cancel-one', 30000), cancellation('cancel-two', 20000)];
  const first = projectCancellations(entries),
    second = projectCancellations(entries);
  expect(first).toEqual(second);
  expect(first.totals.approval).toBe(50000);
  expect(netAmount({ amount: 100000, canceledAmount: first.totals.approval! })).toBe(50000);
});
it('ambiguous originals, overflow, unknown amounts and duplicates never silently reduce totals', () => {
  expect(
    projectCancellations([
      original,
      { ...original, id: 'other-approval' },
      cancellation('c', 100000),
    ]).unresolved.c,
  ).toBe('AMBIGUOUS_ORIGINAL');
  expect(projectCancellations([original, cancellation('c', 100001)]).unresolved.c).toBe(
    'NO_ORIGINAL',
  );
  expect(
    projectCancellations([original, { ...cancellation('c', 1000), amount: null }]).unresolved.c,
  ).toBe('UNKNOWN_AMOUNT');
  expect(
    projectCancellations([original, { ...cancellation('c', 1000), state: 'REVIEW' }]).totals
      .approval,
  ).toBe(0);
});
it('late-arriving original can resolve an orphan on recomputation', () => {
  const cancel = cancellation('c', 100000);
  expect(projectCancellations([cancel]).unresolved.c).toBe('NO_ORIGINAL');
  expect(projectCancellations([cancel, original]).links.c).toBe('approval');
});
it('day precision cancellation can follow a timed approval on the same KST day', () => {
  const cancel = {
    ...cancellation('c', 100000),
    approvedAt: new Date('2026-08-09T15:00:00Z'),
    timePrecision: 'DAY' as const,
  };
  expect(projectCancellations([original, cancel]).links.c).toBe('approval');
});
it('explicit manual original link remains preferred and bounded', () => {
  const second = { ...original, id: 'second' };
  const cancel = {
    ...cancellation('c', 30000),
    manualCancellationLink: true,
    canceledTxId: 'second',
  };
  expect(projectCancellations([original, second, cancel]).links.c).toBe('second');
  expect(
    projectCancellations([original, { ...cancel, canceledTxId: 'foreign' }]).unresolved.c,
  ).toBe('INVALID_MANUAL_LINK');
  expect(netAmount({ amount: null, canceledAmount: 0 })).toBeNull();
  expect(() => netAmount({ amount: 1000, canceledAmount: 1001 })).toThrow();
});

it('manual links reserve their original before later automatic recomputation', () => {
  const auto = cancellation('automatic', 100000);
  const manual = {
    ...cancellation('manual', 100000),
    manualCancellationLink: true,
    canceledTxId: 'approval',
    approvedAt: new Date('2026-08-13T02:00:00Z'),
  };
  const result = projectCancellations([original, auto, manual]);
  expect(result.links.manual).toBe('approval');
  expect(result.unresolved.automatic).toBe('NO_ORIGINAL');
  expect(() => projectCancellations([original, original])).toThrow();
  expect(() => projectCancellations([original, cancellation('bad', -1)])).toThrow();
});

it('same unique event reference with a conflicting/manual amount needs review, not another confirmed charge', () => {
  expect(
    findDuplicate(
      {
        ...original,
        id: 'new',
        amount: 90000,
        approvalReference: 'event',
        sourceKeys: ['PAYMENT_APP:synthetic'],
      },
      [{ ...original, approvalReference: 'event' }],
    ).kind,
  ).toBe('REVIEW');
});
