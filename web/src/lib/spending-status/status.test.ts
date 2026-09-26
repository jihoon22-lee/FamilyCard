import { expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { AppSession } from '@/lib/auth/types';
import { spendingStatus, spendingLabel, scopedSpendingStatus } from './index';
vi.mock('@/lib/auth/scope', () => ({
  visibleMemberIds: async (session: AppSession) =>
    session.scope === 'FAMILY' ? ['self', 'other'] : [session.memberId],
}));
it('does not equate raw-only, review-only, or empty collection with zero spending', () => {
  expect(spendingLabel(0, spendingStatus(12, 12, 0, 0))).toBe('집계 전');
  expect(spendingLabel(0, spendingStatus(12, 0, 0, 2))).toBe('집계 전');
  expect(spendingLabel(0, spendingStatus(0, 0, 0, 0))).toBe('수집된 내역 없음');
});
it('preserves genuine calculated zero after cancellation and discloses partial totals', () => {
  expect(spendingLabel(0, spendingStatus(12, 0, 1, 0))).toBe('0원');
  expect(spendingStatus(12, 2, 1, 0).state).toBe('PARTIAL');
  expect(spendingLabel(12000, spendingStatus(12, 2, 1, 0))).toBe('12,000원');
});
it('scopes all original counts and prevents forged member drilldown', async () => {
  const count = vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(10);
  const db = { rawMessage: { count } } as unknown as PrismaClient;
  const self: AppSession = {
    memberId: 'self',
    name: '',
    role: 'ADMIN',
    scope: 'SELF',
    entrypoint: 'DEVICE',
  };
  expect(await scopedSpendingStatus(self, 0, 0, db)).toEqual({
    state: 'UNAVAILABLE',
    unresolvedRaw: 10,
  });
  for (const [arg] of count.mock.calls)
    expect(arg.where.AND[0]).toEqual({
      OR: [
        { device: { memberId: { in: ['self'] } } },
        { deviceId: null, ownerMemberId: { in: ['self'] } },
      ],
    });
  count.mockClear();
  await expect(scopedSpendingStatus(self, 0, 0, db, 'other')).rejects.toThrow('OUT_OF_SCOPE');
  expect(count).not.toHaveBeenCalled();
  count.mockResolvedValueOnce(7).mockResolvedValueOnce(7);
  await scopedSpendingStatus({ ...self, scope: 'FAMILY', entrypoint: 'WEB' }, 0, 0, db, 'other');
  expect(count.mock.calls[0]![0].where.AND[1]).toEqual({
    OR: [{ device: { memberId: 'other' } }, { deviceId: null, ownerMemberId: 'other' }],
  });
});
