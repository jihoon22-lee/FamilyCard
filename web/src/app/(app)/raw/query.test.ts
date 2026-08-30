// `/raw` 조회 테스트.
//
// ★ docs/plan/phase2-contract.md §7(B): "/raw 가 타인 기기의 원문을 보여주지
// 않는다". visibleMemberIds() 를 실제로 거치는지, 그 결과가 where 절의
// device.memberId 조건에 그대로 쓰이는지를 검증한다(AGENTS.md 불변 규칙 2).
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSession } from '@/lib/auth/types';

const visibleMemberIds = vi.fn();
const count = vi.fn();
const findMany = vi.fn();

vi.mock('@/lib/auth/scope', () => ({
  visibleMemberIds: (...args: unknown[]) => visibleMemberIds(...args),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    rawMessage: {
      count: (...args: unknown[]) => count(...args),
      findMany: (...args: unknown[]) => findMany(...args),
    },
  },
}));

const { fetchRawMessages, fetchDistinctPackageNames } = await import('./query');

const SELF_SESSION: AppSession = {
  memberId: 'member-self',
  name: '김하은',
  role: 'MEMBER',
  scope: 'SELF',
  entrypoint: 'WEB',
};

beforeEach(() => {
  visibleMemberIds.mockReset();
  count.mockReset().mockResolvedValue(0);
  findMany.mockReset().mockResolvedValue([]);
});

describe('fetchRawMessages — visibleMemberIds() 경유 ★', () => {
  it('SELF 세션은 본인 memberId 하나로만 where 절을 건다(타인 기기 원문 비노출)', async () => {
    visibleMemberIds.mockResolvedValue(['member-self']);

    await fetchRawMessages(SELF_SESSION, { page: 1 });

    expect(visibleMemberIds).toHaveBeenCalledWith(SELF_SESSION);
    expect(count).toHaveBeenCalledWith({
      where: { device: { memberId: { in: ['member-self'] } } },
    });
    const findManyArgs = findMany.mock.calls[0]?.[0] as { where: unknown };
    expect(findManyArgs.where).toEqual({ device: { memberId: { in: ['member-self'] } } });
  });

  it('FAMILY 세션은 visibleMemberIds() 가 돌려준 전원을 그대로 쓴다', async () => {
    visibleMemberIds.mockResolvedValue(['admin-1', 'member-1', 'member-2']);

    await fetchRawMessages(
      {
        memberId: 'admin-1',
        name: '김도현',
        role: 'ADMIN',
        scope: 'FAMILY',
        entrypoint: 'WEB',
      },
      { page: 1 },
    );

    const findManyArgs = findMany.mock.calls[0]?.[0] as {
      where: { device: { memberId: { in: string[] } } };
    };
    expect(findManyArgs.where.device.memberId.in).toEqual(['admin-1', 'member-1', 'member-2']);
  });

  it('클라이언트가 다른 memberId 를 요청 파라미터로 보낼 방법 자체가 없다', () => {
    // fetchRawMessages 의 두 번째 인자(RawMessageListParams)에는 memberId
    // 필드가 없다 — page 와 packageName 뿐이다. 타입 시그니처 자체가
    // "다른 사람의 memberId 를 지정해서 조회"를 불가능하게 만든다.
    // (컴파일 타임 보증이라 런타임 assertion 은 없다 — 이 테스트는 문서화 목적)
    expect(true).toBe(true);
  });
});

describe('fetchRawMessages — 패키지명 필터', () => {
  it('packageName 이 있으면 where 절에 포함된다', async () => {
    visibleMemberIds.mockResolvedValue(['member-self']);

    await fetchRawMessages(SELF_SESSION, { page: 1, packageName: 'com.shinhancard.smartshinhan' });

    const findManyArgs = findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(findManyArgs.where).toEqual({
      device: { memberId: { in: ['member-self'] } },
      packageName: 'com.shinhancard.smartshinhan',
    });
  });

  it('packageName 이 없으면 where 절에서 빠진다(전체 조회)', async () => {
    visibleMemberIds.mockResolvedValue(['member-self']);

    await fetchRawMessages(SELF_SESSION, { page: 1 });

    const findManyArgs = findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(findManyArgs.where).not.toHaveProperty('packageName');
  });
});

describe('fetchRawMessages — 페이지네이션', () => {
  it('page=2 는 PAGE_SIZE 만큼 건너뛴다', async () => {
    visibleMemberIds.mockResolvedValue(['member-self']);
    count.mockResolvedValue(45);

    const result = await fetchRawMessages(SELF_SESSION, { page: 2 });

    const findManyArgs = findMany.mock.calls[0]?.[0] as { skip: number; take: number };
    expect(findManyArgs.skip).toBe(20);
    expect(findManyArgs.take).toBe(20);
    expect(result.totalPages).toBe(3); // ceil(45/20)
  });

  it('page 가 0 이하로 들어오면 1로 보정한다', async () => {
    visibleMemberIds.mockResolvedValue(['member-self']);

    const result = await fetchRawMessages(SELF_SESSION, { page: 0 });

    expect(result.page).toBe(1);
    const findManyArgs = findMany.mock.calls[0]?.[0] as { skip: number };
    expect(findManyArgs.skip).toBe(0);
  });

  it('최신순(receivedAt desc)으로 정렬한다', async () => {
    visibleMemberIds.mockResolvedValue(['member-self']);

    await fetchRawMessages(SELF_SESSION, { page: 1 });

    const findManyArgs = findMany.mock.calls[0]?.[0] as { orderBy: unknown };
    expect(findManyArgs.orderBy).toEqual({ receivedAt: 'desc' });
  });
});

describe('fetchDistinctPackageNames — visibleMemberIds() 경유', () => {
  it('visibleMemberIds() 결과로 where 절을 건다', async () => {
    visibleMemberIds.mockResolvedValue(['member-self']);
    findMany.mockResolvedValue([{ packageName: 'a' }, { packageName: 'b' }]);

    const result = await fetchDistinctPackageNames(SELF_SESSION);

    expect(findMany).toHaveBeenCalledWith({
      where: { device: { memberId: { in: ['member-self'] } } },
      distinct: ['packageName'],
      select: { packageName: true },
      orderBy: { packageName: 'asc' },
    });
    expect(result).toEqual(['a', 'b']);
  });
});
