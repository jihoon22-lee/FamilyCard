// 라우트 1차 방어선.
//
// config.ts(edge 안전) 만으로 NextAuth 인스턴스를 따로 만든다. auth.ts 를
// import 하면 Prisma 가 딸려 들어와 edge 런타임에서 터진다. 세션 전략이
// JWT 라 쿠키만으로 scope 를 읽을 수 있어서 DB 조회가 필요 없다.
//
// 판정 로직 자체는 route-guard.ts 에 순수 함수로 분리해 테스트로 고정했다.
import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';

import { authConfig } from '@/lib/auth/config';
import { decideRoute } from '@/lib/auth/route-guard';

const { auth: withAuth } = NextAuth(authConfig);

export default withAuth((req) => {
  const decision = decideRoute(req.nextUrl.pathname, req.auth?.user?.scope ?? null);

  if (decision.type === 'redirect') {
    return NextResponse.redirect(new URL(decision.to, req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // `/api/auth/**` 는 Auth.js 자신의 엔드포인트라 제외한다 — 여기를 막으면
    // 로그인 자체가 불가능해진다. 정적 파일도 검사할 이유가 없다.
    '/((?!api/auth|_next/static|_next/image|favicon.ico).*)',
  ],
};
