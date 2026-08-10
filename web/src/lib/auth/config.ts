// Auth.js v5 기본 설정 — **edge 런타임에서 안전한 부분만** 담는다.
//
// 왜 파일을 둘로 쪼갰나:
// 미들웨어는 기본적으로 edge 런타임에서 돌고, Prisma 는 거기서 동작하지
// 않는다. 그런데 미들웨어도 세션(scope)을 읽어야 한다. 그래서 DB 를 건드리는
// Credentials provider 의 authorize() 는 auth.ts 에만 두고, 미들웨어는 이
// 파일만 가지고 NextAuth 인스턴스를 따로 만든다. 세션 전략이 JWT 라 세션
// 내용이 쿠키 안에 있으므로 DB 조회 없이 검사할 수 있다.
//
// → docs/design/07-auth-scope.md, docs/plan/w3-contract.md §6
import type { NextAuthConfig } from 'next-auth';

import type { MemberRole, SessionScope } from '@/lib/auth/types';

const THIRTY_DAYS_IN_SECONDS = 60 * 60 * 24 * 30;

interface AppTokenFields {
  memberId: string;
  memberName: string;
  role: MemberRole;
  scope: SessionScope;
}

/**
 * JWT 에서 우리 도메인 필드를 꺼낸다.
 *
 * 모듈 보강 대신 런타임 검증을 쓰는 이유는 src/types/next-auth.d.ts 주석
 * 참고. 부수 효과로, 형식이 어긋난 토큰(필드 이름이 바뀌기 전의 오래된
 * 쿠키 등)은 여기서 null 이 되어 세션이 성립하지 않고 재로그인으로 흐른다.
 * 잘못된 값을 그대로 신뢰하는 것보다 안전하다.
 *
 * 토큰 이름 필드를 `name` 이 아니라 `memberName` 으로 둔 것은 Auth.js 기본
 * JWT 의 `name`(string | null | undefined)과 충돌을 피하기 위해서다.
 */
function readAppTokenFields(token: unknown): AppTokenFields | null {
  if (typeof token !== 'object' || token === null) return null;

  const fields = token as Record<string, unknown>;
  const { memberId, memberName, role, scope } = fields;

  if (typeof memberId !== 'string' || memberId === '') return null;
  if (typeof memberName !== 'string') return null;
  if (role !== 'MEMBER' && role !== 'ADMIN') return null;
  if (scope !== 'SELF' && scope !== 'FAMILY') return null;

  return { memberId, memberName, role, scope };
}

// 개발 환경은 http://localhost 라 Secure 쿠키를 쓸 수 없다. 운영(NAS +
// Tailscale)은 HTTPS 이므로 Secure 를 켠다. `__Secure-` 접두사는 secure:true
// 일 때만 브라우저가 받아들이므로 이름과 옵션을 함께 갈아 끼운다.
const useSecureCookies = process.env.NODE_ENV === 'production';

export const authConfig = {
  // Auth.js 의 DB 어댑터를 쓰지 않으므로 JWT 전략이 필수다.
  // (어댑터를 붙이면 미들웨어가 DB 를 타게 되어 위의 분리가 무너진다.)
  session: { strategy: 'jwt', maxAge: THIRTY_DAYS_IN_SECONDS },

  pages: { signIn: '/login' },

  // 여기서는 비워둔다. Credentials provider 는 authorize() 안에서 Prisma 를
  // 쓰므로 auth.ts 에서만 주입한다.
  providers: [],

  cookies: {
    sessionToken: {
      name: useSecureCookies ? '__Secure-authjs.session-token' : 'authjs.session-token',
      options: {
        httpOnly: true, // JS 접근 차단
        sameSite: 'strict', // CSRF 방어. 앱 WebView 는 같은 호스트만 로드하므로 strict 로 충분하다
        path: '/',
        secure: useSecureCookies,
      },
    },
  },

  callbacks: {
    // 로그인 직후(user 가 있을 때)에만 도메인 필드를 토큰에 심는다. 이후
    // 요청에서는 토큰에 이미 들어있는 값을 그대로 흘려보낸다.
    //
    // 주의: scope 는 여기서 계산하지 않는다. scope 는 **진입 경로**로
    // 결정되며(웹 로그인 / 디바이스 토큰), 그 판정은 authorize() 쪽에서
    // 이미 끝나 user 에 실려 온다. 여기서 role 을 보고 scope 를 다시
    // 계산하면 불변 규칙 3(디바이스 세션은 절대 FAMILY 가 아니다)이
    // 깨진다. → docs/adr/0005-scope-by-entrypoint.md
    jwt({ token, user }) {
      if (user) {
        return {
          ...token,
          memberId: user.memberId,
          memberName: user.name ?? '',
          role: user.role,
          scope: user.scope,
        };
      }
      return token;
    },

    session({ session, token }) {
      const fields = readAppTokenFields(token);
      if (fields) {
        session.user.memberId = fields.memberId;
        session.user.name = fields.memberName;
        session.user.role = fields.role;
        session.user.scope = fields.scope;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
