// 미들웨어 경로 판정 테스트. 이 판정이 틀리면 관리자 전용 화면이 열리거나
// 로그인 화면이 무한 리다이렉트에 빠진다.
import { describe, expect, it } from 'vitest';

import { decideRoute } from '@/lib/auth/route-guard';

describe('decideRoute — 공개 경로', () => {
  it.each(['/login', '/signup', '/api/health', '/downloads/familycard.apk'])(
    '%s 는 세션 없이 통과',
    (path) => {
      expect(decideRoute(path, null)).toEqual({ type: 'allow' });
    },
  );

  it('APK와 비슷한 다운로드 경로를 함께 열지 않는다', () => {
    expect(decideRoute('/downloads/familycard.apk.bak', null)).toEqual({
      type: 'redirect',
      to: '/login',
    });
    expect(decideRoute('/downloads/other.apk', null)).toEqual({
      type: 'redirect',
      to: '/login',
    });
  });
});

describe('decideRoute — 디바이스 토큰 경로', () => {
  // 안드로이드 수집기는 세션 쿠키 없이 Authorization: Bearer 로만 온다.
  // 여기서 막히면 요청이 핸들러에 닿지 못해 수집이 통째로 죽는다.
  // 실제로 그렇게 만들어졌다가 통합 확인에서 잡힌 결함이라 테스트로 고정한다.
  it('세션 없이도 /api/ingest 는 통과시킨다 (핸들러가 토큰을 직접 검증)', () => {
    expect(decideRoute('/api/ingest', null)).toEqual({ type: 'allow' });
  });

  it('세션이 있어도 동작이 달라지지 않는다', () => {
    expect(decideRoute('/api/ingest', 'SELF')).toEqual({ type: 'allow' });
    expect(decideRoute('/api/ingest', 'FAMILY')).toEqual({ type: 'allow' });
  });

  it('비슷한 이름의 다른 경로까지 열어주지 않는다', () => {
    expect(decideRoute('/api/ingest-admin', null)).toEqual({ type: 'redirect', to: '/login' });
    expect(decideRoute('/api/ingest/purge', null)).toEqual({ type: 'redirect', to: '/login' });
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
