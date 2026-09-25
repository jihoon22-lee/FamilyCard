import { expect, it } from 'vitest';
import { matchCard, type CardCandidate } from './index';
const at = new Date('2026-08-10T00:00:00Z');
const one: CardCandidate = {
  id: 'one',
  memberId: 'self',
  issuer: 'TEST',
  last4: '1234',
  nickname: 'Test Platinum',
  isActive: true,
};
it('matches exact and informative masked tokens only within owner and issuer', () => {
  const other = { ...one, id: 'other', memberId: 'other' };
  expect(matchCard('self', 'TEST', '****-****-****-1234', at, [one, other]).cardId).toBe('one');
  expect(matchCard('self', 'TEST', '1*34', at, [one, other]).cardId).toBe('one');
  expect(matchCard('self', 'OTHER', '1234', at, [one])).toMatchObject({ cardId: null });
});
it('masked or exact last4 collision never chooses arbitrarily', () => {
  expect(
    matchCard('self', 'TEST', '1*34', at, [one, { ...one, id: 'two', last4: '1834' }]),
  ).toMatchObject({ reason: 'AMBIGUOUS_CARD' });
  expect(matchCard('self', 'TEST', '1234', at, [one, { ...one, id: 'two' }])).toMatchObject({
    reason: 'AMBIGUOUS_CARD',
  });
});
it('missing/fully masked token never falls back to the only card', () => {
  expect(matchCard('self', 'TEST', '', at, [one]).cardId).toBeNull();
  expect(matchCard('self', 'TEST', '****', at, [one]).cardId).toBeNull();
});
it('respects historical alias/card intervals and detects alias collision', () => {
  const alias = { token: '별칭', validTo: new Date('2026-09-01T00:00:00Z') };
  expect(
    matchCard('self', 'TEST', '별칭', at, [
      { ...one, isActive: false, validTo: alias.validTo, aliases: [alias] },
    ]).cardId,
  ).toBe('one');
  expect(
    matchCard('self', 'TEST', '별칭', new Date('2026-10-01T00:00:00Z'), [
      { ...one, aliases: [alias] },
    ]).cardId,
  ).toBeNull();
  expect(
    matchCard('self', 'TEST', '별칭', at, [
      { ...one, aliases: [alias] },
      { ...one, id: 'two', aliases: [alias] },
    ]).cardId,
  ).toBeNull();
  expect(matchCard('self', 'TEST', 'Test Platinum', at, [one]).cardId).toBe('one');
});
