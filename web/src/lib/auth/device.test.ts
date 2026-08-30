// 디바이스 토큰 인증 테스트.
//
// 검증 대상:
//   1. generateDeviceToken/hashDeviceToken 이 기본적인 형식·결정성을 지키는가
//   2. resolveDevice 가 헤더 형식 오류·미일치를 모두 null 로 처리하는가
//   3. resolveDevice 가 토큰 원문이 아니라 해시로 조회하고 폐기를 재확인하는가
import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUnique = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: { device: { findUnique: (...args: unknown[]) => findUnique(...args) } },
}));

const { generateDeviceToken, hashDeviceToken, resolveDevice } = await import('@/lib/auth/device');

beforeEach(() => {
  findUnique.mockReset();
});

describe('generateDeviceToken', () => {
  it('32바이트를 hex 로 인코딩한 64자 문자열을 만든다', () => {
    const token = generateDeviceToken();

    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('호출할 때마다 다른 값을 만든다', () => {
    const a = generateDeviceToken();
    const b = generateDeviceToken();

    expect(a).not.toBe(b);
  });
});

describe('hashDeviceToken', () => {
  it('sha256 hex 다이제스트를 돌려준다 (Node crypto 표준 구현과 일치)', () => {
    const token = '테스트토큰-샘플';
    const expected = createHash('sha256').update(token).digest('hex');

    expect(hashDeviceToken(token)).toBe(expected);
  });

  it('같은 입력 → 같은 해시', () => {
    expect(hashDeviceToken('같은토큰')).toBe(hashDeviceToken('같은토큰'));
  });

  it('다른 입력 → 다른 해시', () => {
    expect(hashDeviceToken('토큰A')).not.toBe(hashDeviceToken('토큰B'));
  });
});

describe('resolveDevice', () => {
  it('헤더가 없으면 null', async () => {
    const result = await resolveDevice(null);

    expect(result).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('Bearer 형식이 아니면 null', async () => {
    const result = await resolveDevice('Basic abcdef');

    expect(result).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('Bearer 다음 값이 64자 hex 토큰 형식이 아니면 null', async () => {
    const result = await resolveDevice('Bearer 형식아님');

    expect(result).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('일치하는 기기가 없으면 null', async () => {
    findUnique.mockResolvedValue(null);

    const result = await resolveDevice(`Bearer ${'a'.repeat(64)}`);

    expect(result).toBeNull();
  });

  it('일치하면 deviceId·memberId 를 돌려준다', async () => {
    findUnique.mockResolvedValue({ id: 'device-1', memberId: 'member-1', revokedAt: null });

    const result = await resolveDevice(`Bearer ${'b'.repeat(64)}`);

    expect(result).toEqual({ deviceId: 'device-1', memberId: 'member-1' });
  });

  it('해시는 일치해도 폐기된 기기면 null', async () => {
    findUnique.mockResolvedValue({
      id: 'device-1',
      memberId: 'member-1',
      revokedAt: new Date('2026-08-30T00:00:00Z'),
    });

    await expect(resolveDevice(`Bearer ${'c'.repeat(64)}`)).resolves.toBeNull();
  });

  it('토큰 원문이 아니라 해시로 조회한다', async () => {
    findUnique.mockResolvedValue({ id: 'device-1', memberId: 'member-1', revokedAt: null });
    const token = 'd'.repeat(64);

    await resolveDevice(`Bearer ${token}`);

    const calledWith = findUnique.mock.calls[0]?.[0] as { where: { tokenHash: string } };
    expect(calledWith.where.tokenHash).toBe(hashDeviceToken(token));
    expect(calledWith.where.tokenHash).not.toBe(token);
    // 조회 조건 어디에도 장기 자격증명 원문이 그대로 들어가면 안 된다.
    expect(JSON.stringify(calledWith)).not.toContain(token);
  });
});
