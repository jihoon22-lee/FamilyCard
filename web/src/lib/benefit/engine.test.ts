import { describe, it, expect } from 'vitest';
import { cycle, estimate, validateConfig, type BenefitConfig, type BenefitEntry } from './engine';
const rule: BenefitConfig = {
  periodType: 'PREV_CALENDAR_MONTH',
  tiers: [
    { threshold: 300000, benefitDesc: '가공 혜택', monthlyCap: 10000 },
    { threshold: 700000, benefitDesc: '가공 상위 혜택', monthlyCap: 20000 },
  ],
  exclusions: ['TAX', 'GIFT_CARD'],
  minPerTxAmount: 0,
  cancellationPolicy: 'DEDUCT_FROM_ORIGINAL',
};
const entry = (override: Partial<BenefitEntry> = {}): BenefitEntry => ({
  id: 'a',
  cardId: 'card',
  amount: 300000,
  canceledAmount: 0,
  approvedAt: new Date('2026-07-15T00:00:00Z'),
  txType: 'APPROVAL',
  state: 'CONFIRMED',
  canceledTxId: null,
  merchantName: '가공가맹점',
  benefitOverride: null,
  categoryCode: null,
  excludeReason: null,
  ...override,
});
const july = cycle('2026-08', 'PREV_CALENDAR_MONTH', 14);
describe('benefit estimates', () => {
  it('handles exact thresholds, -1 and partial/full cancellations', () => {
    expect(estimate(rule, 'card', july, [entry()]).achieved?.threshold).toBe(300000);
    const partial = estimate(rule, 'card', july, [entry({ canceledAmount: 1 })]);
    expect(partial.achieved).toBeNull();
    expect(partial.remaining).toBe(1);
    expect(estimate(rule, 'card', july, [entry({ canceledAmount: 300000 })]).total).toBe(0);
  });
  it('excludes categories, merchant patterns, minimum net and uncertain rows, honors manual decisions', () => {
    expect(estimate(rule, 'card', july, [entry({ merchantName: '가공 홈택스' })]).total).toBe(0);
    expect(estimate(rule, 'card', july, [entry({ categoryCode: 'GIFT_CARD' })]).total).toBe(0);
    expect(
      estimate({ ...rule, minPerTxAmount: 10000 }, 'card', july, [
        entry({ amount: 12000, canceledAmount: 3000 }),
      ]).total,
    ).toBe(0);
    expect(
      estimate(rule, 'card', july, [
        entry({ cardId: null }),
        entry({ id: 'b', state: 'REVIEW' }),
        entry({ id: 'c', amount: null }),
      ]).total,
    ).toBe(0);
    expect(
      estimate(rule, 'card', july, [
        entry({ merchantName: '가공 홈택스', benefitOverride: 'INCLUDE' }),
      ]).total,
    ).toBe(300000);
  });
  it('separates original vs cancel cycle without double deduction', () => {
    const a = entry({ canceledAmount: 50000 });
    const c = entry({
      id: 'c',
      txType: 'CANCELLATION',
      amount: 50000,
      canceledAmount: 0,
      canceledTxId: 'a',
      approvedAt: new Date('2026-08-02T00:00:00Z'),
    });
    const cancelRule = { ...rule, cancellationPolicy: 'DEDUCT_FROM_CANCEL_PERIOD' as const };
    expect(estimate(rule, 'card', july, [a, c]).total).toBe(250000);
    expect(estimate(cancelRule, 'card', july, [a, c]).total).toBe(300000);
    const august = cycle('2026-09', 'PREV_CALENDAR_MONTH', 14);
    expect(estimate(cancelRule, 'card', august, [a, c], new Map([['a', rule]])).total).toBe(-50000);
    expect(estimate(cancelRule, 'card', august, [a, c]).uncertain).toBe(1);
    expect(
      estimate(
        cancelRule,
        'card',
        august,
        [{ ...a, categoryCode: 'TAX' }, c],
        new Map([['a', rule]]),
      ).total,
    ).toBe(0);
  });
  it('flags orphan deductions, handles same-period cancellation once', () => {
    const c = entry({ id: 'c', txType: 'CANCELLATION', amount: 10000, canceledTxId: null });
    expect(estimate(rule, 'card', july, [c]).total).toBe(-10000);
    expect(estimate(rule, 'card', july, [c]).uncertain).toBe(1);
    expect(
      estimate({ ...rule, cancellationPolicy: 'DEDUCT_FROM_CANCEL_PERIOD' }, 'card', july, [
        entry({ canceledAmount: 10000 }),
        { ...c, canceledTxId: 'a' },
      ]).total,
    ).toBe(290000);
  });
  it('uses KST month boundaries and clamps cycle days for February/leap years', () => {
    expect(july.end.toISOString()).toBe('2026-07-31T15:00:00.000Z');
    expect(
      estimate(rule, 'card', july, [entry({ approvedAt: new Date('2026-07-31T15:30:00Z') })]).total,
    ).toBe(0);
    expect(cycle('2024-02', 'STATEMENT_CYCLE', 31)).toEqual({
      start: new Date('2024-01-31T15:00:00Z'),
      end: new Date('2024-02-29T15:00:00Z'),
    });
    expect(cycle('2026-08', 'STATEMENT_CYCLE', 14)).toEqual({
      start: new Date('2026-07-14T15:00:00Z'),
      end: new Date('2026-08-14T15:00:00Z'),
    });
  });
  it('rejects unsorted tiers and fractional amounts', () => {
    expect(() => validateConfig({ ...rule, minPerTxAmount: 0.5 })).toThrow();
    expect(() => validateConfig({ ...rule, tiers: [...rule.tiers].reverse() })).toThrow();
  });
});
