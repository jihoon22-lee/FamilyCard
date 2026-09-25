import { beforeEach, expect, it, vi } from 'vitest';
import type { AppSession } from '@/lib/auth/types';
const visible = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/scope', () => ({ visibleMemberIds: visible }));
import { visibleRawWhere } from './index';
const session: AppSession = {
  memberId: 'self',
  name: 'Test',
  role: 'ADMIN',
  scope: 'SELF',
  entrypoint: 'DEVICE',
};
beforeEach(() => visible.mockResolvedValue(['self']));
it('manual/statement raw has only its owner scope, device raw only its device owner', async () => {
  expect(await visibleRawWhere(session)).toEqual({
    OR: [
      { device: { memberId: { in: ['self'] } } },
      { deviceId: null, ownerMemberId: { in: ['self'] } },
    ],
  });
  expect(visible).toHaveBeenCalledWith(session);
});
it('FAMILY uses all visible owners without accepting arbitrary caller IDs', async () => {
  visible.mockResolvedValue(['self', 'other']);
  const where = await visibleRawWhere({ ...session, scope: 'FAMILY', entrypoint: 'WEB' });
  expect(where.OR).toEqual([
    { device: { memberId: { in: ['self', 'other'] } } },
    { deviceId: null, ownerMemberId: { in: ['self', 'other'] } },
  ]);
});
