import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.fn();
const findUniqueDevice = vi.fn();
const findMember = vi.fn();

vi.mock('@/lib/auth/auth', () => ({ auth: () => auth() }));
vi.mock('@/lib/db', () => ({
  prisma: {
    familyMember: { findUnique: (...args: unknown[]) => findMember(...args) },
    device: { findUnique: (...args: unknown[]) => findUniqueDevice(...args) },
  },
}));

const { getAppSession } = await import('@/lib/auth/session');

beforeEach(() => {
  auth.mockReset();
  findUniqueDevice.mockReset();
  findMember.mockReset();
});

describe('getAppSession — 웹 로그인', () => {
  it('WEB 세션은 현재 구성원 버전을 확인한다', async () => {
    auth.mockResolvedValue({
      user: {
        memberId: 'admin-1',
        name: '김도현',
        role: 'ADMIN',
        scope: 'FAMILY',
        entrypoint: 'WEB',
        sessionVersion: 3,
      },
    });

    findMember.mockResolvedValue({ sessionVersion: 3, role: 'ADMIN' });
    await expect(getAppSession()).resolves.toEqual({
      memberId: 'admin-1',
      name: '김도현',
      role: 'ADMIN',
      scope: 'FAMILY',
      entrypoint: 'WEB',
      sessionVersion: 3,
    });
    expect(findUniqueDevice).not.toHaveBeenCalled();
  });

  it.each([null, { sessionVersion: 4, role: 'ADMIN' }, { sessionVersion: 3, role: 'MEMBER' }])(
    'removed, revoked or changed-role web sessions are rejected',
    async (member) => {
      auth.mockResolvedValue({
        user: {
          memberId: 'admin-1',
          role: 'ADMIN',
          scope: 'FAMILY',
          entrypoint: 'WEB',
          sessionVersion: 3,
        },
      });
      findMember.mockResolvedValue(member);
      expect(await getAppSession()).toBeNull();
    },
  );
  it('rejects legacy web cookies without a version', async () => {
    auth.mockResolvedValue({
      user: { memberId: 'admin-1', role: 'ADMIN', scope: 'FAMILY', entrypoint: 'WEB' },
    });
    expect(await getAppSession()).toBeNull();
    expect(findMember).not.toHaveBeenCalled();
  });
  it('진입 경로가 없는 구버전 쿠키는 세션으로 인정하지 않는다', async () => {
    auth.mockResolvedValue({
      user: { memberId: 'member-1', role: 'MEMBER', scope: 'SELF', name: '김하은' },
    });

    await expect(getAppSession()).resolves.toBeNull();
  });
});

describe('getAppSession — 디바이스 세션 폐기', () => {
  function deviceAuthSession() {
    return {
      user: {
        memberId: 'member-1',
        name: '김하은',
        role: 'MEMBER',
        scope: 'SELF',
        entrypoint: 'DEVICE',
        deviceId: 'device-1',
      },
    };
  }

  it('활성 기기 세션은 SELF로 성립한다', async () => {
    auth.mockResolvedValue(deviceAuthSession());
    findUniqueDevice.mockResolvedValue({ memberId: 'member-1', revokedAt: null });

    const session = await getAppSession();

    expect(session).toEqual({
      memberId: 'member-1',
      name: '김하은',
      role: 'MEMBER',
      scope: 'SELF',
      entrypoint: 'DEVICE',
      deviceId: 'device-1',
    });
    expect(findMember).not.toHaveBeenCalled();
    expect(findUniqueDevice).toHaveBeenCalledWith({
      where: { id: 'device-1' },
      select: { memberId: true, revokedAt: true },
    });
  });

  it('★★ 세션 발급 뒤 기기를 폐기하면 다음 보호 조회부터 거부한다', async () => {
    auth.mockResolvedValue(deviceAuthSession());
    findUniqueDevice.mockResolvedValue({
      memberId: 'member-1',
      revokedAt: new Date('2026-08-30T00:00:00Z'),
    });

    await expect(getAppSession()).resolves.toBeNull();
  });

  it('기기가 없거나 다른 구성원 소유면 거부한다', async () => {
    auth.mockResolvedValue(deviceAuthSession());
    findUniqueDevice.mockResolvedValueOnce(null);
    await expect(getAppSession()).resolves.toBeNull();

    findUniqueDevice.mockResolvedValueOnce({ memberId: 'member-other', revokedAt: null });
    await expect(getAppSession()).resolves.toBeNull();
  });
});
