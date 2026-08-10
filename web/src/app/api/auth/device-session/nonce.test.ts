// 디바이스 세션 nonce 발급·소모 테스트.
//
// docs/plan/phase2-contract.md §7(B) 의 필수 항목:
//   - 만료된 nonce → 401 (이 파일에서는 consumeDeviceSessionNonce() → null 로 검증)
//   - 이미 쓴 nonce 재사용 → 401 (동일)
//
// prisma.deviceSessionNonce 를 실제 테이블처럼 동작하는 인메모리 페이크로
// 대체한다. 호출 인자만 확인하는 목(mock)이 아니라 WHERE 절(nonceHash 일치
// · consumedAt: null · expiresAt > now)을 실제로 평가하게 만들어서,
// "발급 → 소모 → 재소모" 같은 상태 변화 시나리오를 구현 코드 그대로 검증한다.
// 개발 DB(localhost:5433)는 건드리지 않는다.
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeNonceRow {
  nonceHash: string;
  memberId: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

const rows = new Map<string, FakeNonceRow>();

const create = vi.fn(async ({ data }: { data: Omit<FakeNonceRow, 'consumedAt'> }) => {
  rows.set(data.nonceHash, { ...data, consumedAt: null });
  return { id: 'nonce-row', ...data, consumedAt: null };
});

const updateMany = vi.fn(
  async ({
    where,
    data,
  }: {
    where: { nonceHash: string; consumedAt: null; expiresAt: { gt: Date } };
    data: { consumedAt: Date };
  }) => {
    const row = rows.get(where.nonceHash);
    const matches =
      row !== undefined && row.consumedAt === null && row.expiresAt > where.expiresAt.gt;
    if (matches && row) row.consumedAt = data.consumedAt;
    return { count: matches ? 1 : 0 };
  },
);

const findUnique = vi.fn(async ({ where }: { where: { nonceHash: string } }) => {
  const row = rows.get(where.nonceHash);
  return row ? { memberId: row.memberId } : null;
});

vi.mock('@/lib/db', () => ({
  prisma: {
    deviceSessionNonce: {
      create: (...args: unknown[]) => create(...(args as Parameters<typeof create>)),
      updateMany: (...args: unknown[]) => updateMany(...(args as Parameters<typeof updateMany>)),
      findUnique: (...args: unknown[]) => findUnique(...(args as Parameters<typeof findUnique>)),
    },
  },
}));

const { issueDeviceSessionNonce, consumeDeviceSessionNonce } = await import('./nonce');

beforeEach(() => {
  rows.clear();
  create.mockClear();
  updateMany.mockClear();
  findUnique.mockClear();
  vi.unstubAllEnvs();
});

describe('issueDeviceSessionNonce', () => {
  it('DB 에는 nonce 원문이 아니라 해시만 저장한다', async () => {
    const { nonce } = await issueDeviceSessionNonce('member-1');

    const call = create.mock.calls[0]?.[0] as { data: { nonceHash: string } };
    expect(call.data.nonceHash).not.toBe(nonce);
    expect(JSON.stringify(call)).not.toContain(nonce);
  });

  it('DEVICE_SESSION_NONCE_TTL(기본 60초) 뒤 만료로 설정한다', async () => {
    vi.stubEnv('DEVICE_SESSION_NONCE_TTL', '60');
    const before = Date.now();

    const { expiresAt } = await issueDeviceSessionNonce('member-1');

    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 59_000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(before + 61_000);
  });
});

describe('consumeDeviceSessionNonce — 정상 소모', () => {
  it('유효한 nonce 를 소모하면 memberId 를 돌려준다', async () => {
    const { nonce } = await issueDeviceSessionNonce('member-1');

    const result = await consumeDeviceSessionNonce(nonce);

    expect(result).toEqual({ memberId: 'member-1' });
  });
});

describe('consumeDeviceSessionNonce — 만료된 nonce ★', () => {
  it('만료된 nonce 는 null (호출부에서 401 로 매핑)', async () => {
    const { nonce } = await issueDeviceSessionNonce('member-1');
    // 발급 직후 강제로 과거 시각을 만료 시각으로 되돌려 만료 상태를 재현한다.
    const stored = [...rows.values()][0];
    if (stored) stored.expiresAt = new Date(Date.now() - 1000);

    const result = await consumeDeviceSessionNonce(nonce);

    expect(result).toBeNull();
  });
});

describe('consumeDeviceSessionNonce — 이미 쓴 nonce 재사용 ★', () => {
  it('한 번 소모된 nonce 는 두 번째 호출에서 null', async () => {
    const { nonce } = await issueDeviceSessionNonce('member-1');

    const first = await consumeDeviceSessionNonce(nonce);
    const second = await consumeDeviceSessionNonce(nonce);

    expect(first).toEqual({ memberId: 'member-1' });
    expect(second).toBeNull();
  });
});

describe('consumeDeviceSessionNonce — 존재하지 않는 nonce', () => {
  it('발급된 적 없는 nonce 는 null', async () => {
    const result = await consumeDeviceSessionNonce('발급된적없는-nonce');

    expect(result).toBeNull();
  });
});
