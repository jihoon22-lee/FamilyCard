// 가시성 계층 테스트.
//
// AGENTS.md: "권한(scope) 관련 변경은 반드시 테스트를 동반합니다. '타인
// 데이터가 안 보이는지'를 명시적으로 검증하세요."
//
// 개발 DB 를 건드리지 않도록 Prisma 를 모킹한다. 시드 데이터를 테스트가
// 바꾸면 다음 사람이 이유 모를 실패를 만난다.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: { familyMember: { findMany: (...args: unknown[]) => findMany(...args) } },
}));

const { scopeForWebLogin, visibleMemberIds } = await import('@/lib/auth/scope');

import type { AppSession } from '@/lib/auth/types';

const 본인: AppSession = {
  memberId: 'member-self',
  name: '김하은',
  role: 'MEMBER',
  scope: 'SELF',
};

const 관리자: AppSession = {
  memberId: 'member-admin',
  name: '김도현',
  role: 'ADMIN',
  scope: 'FAMILY',
};

beforeEach(() => {
  findMany.mockReset();
});

describe('scopeForWebLogin', () => {
  it('ADMIN 이 웹으로 로그인하면 FAMILY', () => {
    expect(scopeForWebLogin('ADMIN')).toBe('FAMILY');
  });

  it('MEMBER 가 웹으로 로그인하면 SELF', () => {
    expect(scopeForWebLogin('MEMBER')).toBe('SELF');
  });
});

describe('visibleMemberIds', () => {
  it('SELF 는 본인 id 하나만 본다', async () => {
    const result = await visibleMemberIds(본인);

    expect(result).toEqual(['member-self']);
    // 본인만 볼 때는 DB 를 조회할 이유가 없다.
    expect(findMany).not.toHaveBeenCalled();
  });

  it('FAMILY 는 가족 전원을 본다', async () => {
    findMany.mockResolvedValue([{ id: 'member-admin' }, { id: 'member-self' }]);

    const result = await visibleMemberIds(관리자);

    expect(result).toEqual(['member-admin', 'member-self']);
    expect(findMany).toHaveBeenCalledOnce();
  });

  it('role 이 ADMIN 이어도 scope 가 SELF 면 본인만 본다', async () => {
    // 폰 앱으로 들어온 관리자 세션이 이 모양이다. role 이 아니라 scope 로
    // 판정하는지 확인한다 — 불변 규칙 3 이 지켜지는지를 보는 테스트다.
    const 폰으로들어온관리자: AppSession = { ...관리자, scope: 'SELF' };

    const result = await visibleMemberIds(폰으로들어온관리자);

    expect(result).toEqual(['member-admin']);
    expect(findMany).not.toHaveBeenCalled();
  });
});
