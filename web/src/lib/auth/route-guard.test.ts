// 미들웨어 경로 판정 테스트. 이 판정이 틀리면 관리자 전용 화면이 열리거나
// 로그인 화면이 무한 리다이렉트에 빠진다.
import { describe, expect, it } from 'vitest';

import { decideRoute } from '@/lib/auth/route-guard';

describe('decideRoute — 공개 경로', () => {
  it.each(['/login', '/signup', '/api/health'])('%s 는 세션 없이 통과', (path) => {
    expect(decideRoute(path, null)).toEqual({ type: 'allow' });
  });
});

describe('decideRoute — 세션 없음', () => {
  it('보호된 경로는 /login 으로 보낸다', () => {
    expect(decideRoute('/', null)).toEqual({ type: 'redirect', to: '/login' });
  });

  it('/family 도 로그인부터 요구한다', () => {
    expect(decideRoute('/family', null)).toEqual({ type: 'redirect', to: '/login' });
  });
});

describe('decideRoute — scope 검사', () => {
  it('SELF 세션이 /family 에 접근하면 / 로 되돌린다', () => {
    expect(decideRoute('/family', 'SELF')).toEqual({ type: 'redirect', to: '/' });
  });

  it('SELF 세션은 /family 하위 경로도 막힌다', () => {
    expect(decideRoute('/family/members/abc', 'SELF')).toEqual({ type: 'redirect', to: '/' });
  });

  it('FAMILY 세션은 /family 에 들어간다', () => {
    expect(decideRoute('/family', 'FAMILY')).toEqual({ type: 'allow' });
  });

  it('SELF 세션도 본인 화면(/)에는 들어간다', () => {
    expect(decideRoute('/', 'SELF')).toEqual({ type: 'allow' });
  });

  it('/family 로 시작하지만 다른 경로(/familyfoo)는 scope 검사 대상이 아니다', () => {
    // startsWith('/family') 로만 짜면 여기서 잘못 걸린다.
    expect(decideRoute('/familyfoo', 'SELF')).toEqual({ type: 'allow' });
  });
});
