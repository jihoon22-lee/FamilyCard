// 기기 등록 · 폐기 액션 테스트.
//
// 검증 대상:
//   1. 등록: 클라이언트가 보낸 memberId 를 visibleMemberIds() 없이 믿지 않는다
//   2. 등록: 토큰 원문이 아니라 해시만 DB 에 저장한다
//   3. 폐기: Device 를 delete() 하지 않고 tokenHash 를 sentinel 로 덮어써 무효화한다
//      (RawMessage.device 의 onDelete: Restrict 때문에 delete() 는 원문이
//      있는 기기에서 실패한다 — prisma/schema.prisma Device.revokedAt 주석 참고)
//   4. 폐기: 이미 폐기된 기기는 멱등하게 성공 처리한다
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSession } from '@/lib/auth/types';

const requireFamilyScope = vi.fn();
const visibleMemberIds = vi.fn();
const findUniqueMember = vi.fn();
const createDevice = vi.fn();
const findUniqueDevice = vi.fn();
const updateDevice = vi.fn();
const generateDeviceToken = vi.fn();
const hashDeviceToken = vi.fn();
const revalidatePath = vi.fn();

vi.mock('@/lib/auth/session', () => ({
  requireFamilyScope: () => requireFamilyScope(),
}));

vi.mock('@/lib/auth/scope', () => ({
  visibleMemberIds: (...args: unknown[]) => visibleMemberIds(...args),
}));

vi.mock('@/lib/auth/device', () => ({
  generateDeviceToken: () => generateDeviceToken(),
  hashDeviceToken: (...args: unknown[]) => hashDeviceToken(...args),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    familyMember: { findUnique: (...args: unknown[]) => findUniqueMember(...args) },
    device: {
      create: (...args: unknown[]) => createDevice(...args),
      findUnique: (...args: unknown[]) => findUniqueDevice(...args),
      update: (...args: unknown[]) => updateDevice(...args),
      // delete 는 의도적으로 정의하지 않는다 — 코드가 실수로 device.delete() 를
      // 부르면 "delete is not a function" 으로 즉시 테스트가 실패해야 한다.
    },
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

const { registerDeviceAction, revokeDeviceAction } = await import('./actions');

const ADMIN_SESSION: AppSession = {
  memberId: 'admin-1',
  name: '김도현',
  role: 'ADMIN',
  scope: 'FAMILY',
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  requireFamilyScope.mockReset().mockResolvedValue(ADMIN_SESSION);
  visibleMemberIds.mockReset().mockResolvedValue(['admin-1', 'member-1']);
  findUniqueMember.mockReset();
  createDevice.mockReset();
  findUniqueDevice.mockReset();
  updateDevice.mockReset();
  generateDeviceToken.mockReset().mockReturnValue('원문토큰abcdef');
  hashDeviceToken.mockReset().mockReturnValue('해시된토큰값');
  revalidatePath.mockReset();
});

describe('registerDeviceAction — 입력 검증', () => {
  it('구성원·기기 이름이 비면 에러', async () => {
    const result = await registerDeviceAction(
      { status: 'idle' },
      form({ memberId: '', deviceName: '' }),
    );

    expect(result).toEqual({ status: 'error', error: '구성원과 기기 이름을 모두 입력해주세요.' });
    expect(createDevice).not.toHaveBeenCalled();
  });
});

describe('registerDeviceAction — 클라이언트 입력을 신뢰하지 않는다 ★', () => {
  it('visibleMemberIds() 에 없는 memberId 는 거부한다', async () => {
    visibleMemberIds.mockResolvedValue(['admin-1']); // member-1 은 보이지 않는 것으로 설정

    const result = await registerDeviceAction(
      { status: 'idle' },
      form({ memberId: 'member-1', deviceName: '하은이 폰' }),
    );

    expect(result).toEqual({ status: 'error', error: '존재하지 않는 구성원입니다.' });
    expect(createDevice).not.toHaveBeenCalled();
  });
});

describe('registerDeviceAction — 정상 등록', () => {
  it('토큰을 발급하고 해시만 저장한다', async () => {
    findUniqueMember.mockResolvedValue({ name: '김하은' });
    createDevice.mockResolvedValue({ id: 'device-1' });

    const result = await registerDeviceAction(
      { status: 'idle' },
      form({ memberId: 'member-1', deviceName: '하은이 폰' }),
    );

    expect(result).toEqual({
      status: 'success',
      token: '원문토큰abcdef',
      deviceName: '하은이 폰',
      memberName: '김하은',
    });
    expect(createDevice).toHaveBeenCalledWith({
      data: { memberId: 'member-1', deviceName: '하은이 폰', tokenHash: '해시된토큰값' },
    });
    // DB 에 원문 토큰 문자열이 어디에도 실리지 않는다.
    const call = createDevice.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(JSON.stringify(call)).not.toContain('원문토큰abcdef');
  });

  it('화면을 다시 검증한다(ADMIN 전용) — requireFamilyScope 를 호출한다', async () => {
    findUniqueMember.mockResolvedValue({ name: '김하은' });
    createDevice.mockResolvedValue({ id: 'device-1' });

    await registerDeviceAction({ status: 'idle' }, form({ memberId: 'member-1', deviceName: 'x' }));

    expect(requireFamilyScope).toHaveBeenCalledOnce();
  });
});

describe('revokeDeviceAction — 존재하지 않거나 안 보이는 기기', () => {
  it('기기가 없으면 에러', async () => {
    findUniqueDevice.mockResolvedValue(null);

    const result = await revokeDeviceAction('no-such-device');

    expect(result).toEqual({ ok: false, error: '존재하지 않는 기기입니다.' });
    expect(updateDevice).not.toHaveBeenCalled();
  });

  it('visibleMemberIds() 밖의 구성원 소유 기기는 거부한다', async () => {
    visibleMemberIds.mockResolvedValue(['admin-1']);
    findUniqueDevice.mockResolvedValue({ memberId: 'member-1', revokedAt: null });

    const result = await revokeDeviceAction('device-1');

    expect(result).toEqual({ ok: false, error: '존재하지 않는 기기입니다.' });
    expect(updateDevice).not.toHaveBeenCalled();
  });
});

describe('revokeDeviceAction — 정상 폐기 ★', () => {
  it('Device 를 delete 하지 않고 tokenHash 를 sentinel 값으로 덮어쓴다', async () => {
    findUniqueDevice.mockResolvedValue({ memberId: 'member-1', revokedAt: null });
    updateDevice.mockResolvedValue({});

    const result = await revokeDeviceAction('device-1');

    expect(result).toEqual({ ok: true });
    expect(updateDevice).toHaveBeenCalledWith({
      where: { id: 'device-1' },
      data: { tokenHash: 'revoked:device-1', revokedAt: expect.any(Date) },
    });
    // sentinel 은 sha256 hex(64자 소문자 16진수)가 될 수 없는 형식이라
    // resolveDevice() 의 findUnique 가 어떤 원문 토큰을 해시해도 다시는
    // 매치되지 않는다.
    const call = updateDevice.mock.calls[0]?.[0] as { data: { tokenHash: string } };
    expect(call.data.tokenHash).not.toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('revokeDeviceAction — 이미 폐기된 기기', () => {
  it('멱등하게 성공 처리하고 다시 update 하지 않는다', async () => {
    findUniqueDevice.mockResolvedValue({ memberId: 'member-1', revokedAt: new Date('2026-01-01') });

    const result = await revokeDeviceAction('device-1');

    expect(result).toEqual({ ok: true });
    expect(updateDevice).not.toHaveBeenCalled();
  });
});
