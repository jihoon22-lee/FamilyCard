// Auth.js v5 모듈 보강 — 세션과 authorize() 반환값에 우리 도메인 필드를 얹는다.
//
// 주의: `interface Session { user: {...} }` 처럼 기존 필드를 통째로 갈아
// 끼우면 "Session 이 DefaultSession 을 잘못 확장한다"는 타입 에러가 난다
// (DefaultSession.user 와 호환되지 않아서). 공식 가이드대로
// `& DefaultSession['user']` 를 교집합해서 확장한다.
//
// JWT(next-auth/jwt) 는 여기서 보강하지 않는다. 그 인터페이스의 원본 선언은
// `@auth/core/jwt` 에 있고 `next-auth/jwt` 는 단순 re-export 라 보강해도
// 원본에 반영되지 않는데, pnpm 의 엄격한 node_modules 구조에서는
// `@auth/core` 가 최상위에 없어 모듈 지정자로 참조할 수도 없다.
// 대신 web/src/lib/auth/config.ts 에서 토큰 값을 런타임 검증으로 좁힌다.
import type { DefaultSession } from 'next-auth';

import type { AuthEntrypoint, MemberRole, SessionScope } from '@/lib/auth/types';

declare module 'next-auth' {
  // Credentials provider 의 authorize() 가 반환하는 형태.
  interface User {
    memberId: string;
    role: MemberRole;
    scope: SessionScope;
    entrypoint: AuthEntrypoint;
    deviceId?: string;
  }

  interface Session {
    // 선택 필드로 둔다. 형식이 어긋난 토큰(구버전 쿠키 등)이 들어오면
    // session 콜백이 이 필드들을 채우지 않고, getAppSession() 이 그걸
    // null 로 해석해 재로그인으로 흘려보낸다.
    user: {
      memberId?: string;
      role?: MemberRole;
      scope?: SessionScope;
      entrypoint?: AuthEntrypoint;
      deviceId?: string;
    } & DefaultSession['user'];
  }
}
