// POST /api/auth/device-session — 디바이스 토큰 → 웹 세션 교환.
// GET  /api/auth/device-session?t=<nonce> — nonce 소모 → 세션 쿠키 → 대시보드 리다이렉트.
//
// 앱이 WebView 를 로그인 화면 없이 바로 여는 흐름:
//   1. 앱이 POST 로 이 엔드포인트를 부른다 (Authorization: Bearer <deviceToken>)
//   2. 서버가 60초 만료·1회용 nonce 를 발급하고 그 nonce 를 실은 URL 을 응답한다
//   3. 앱이 WebView 에 그 URL 을 로드한다 (= 이 파일의 GET)
//   4. 서버가 nonce 를 소모하고 세션 쿠키를 심은 뒤 대시보드(/)로 리다이렉트한다
//
// ── 계약서 예시 URL(`<APP_URL>/?t=<nonce>`)과 다르게, 이 응답은 nonce 소비
// 경로로 `<APP_URL>/api/auth/device-session?t=<nonce>` 를 돌려준다. 이유:
// nonce 소모는 세션 쿠키를 심는 부수효과가 있는 로직이라 GET 핸들러가
// 필요한데, Next.js App Router 는 같은 라우트 세그먼트에 page.tsx 와
// route.ts 를 함께 둘 수 없다(둘 다 그 경로의 GET 을 다룬다). 루트 경로
// `/` 는 이미 web/src/app/(app)/page.tsx(대시보드)가 쓰고 있고, 그 파일과
// 미들웨어는 이 웨이브(B)의 담당 파일 목록 밖이라 손대지 않는다
// (docs/plan/phase2-contract.md §6). 안드로이드 앱(Wave 2)은 아직 이
// 계약이 확정된 뒤에 구현되고, WebView 는 이 POST 응답이 돌려준 url 을
// 그대로 로드할 뿐이라 정확한 경로가 무엇이든 동작에는 차이가 없다.
// → 보고서의 "확인이 필요한 점" 참고.
//
// → docs/plan/phase2-contract.md §3, docs/design/07-auth-scope.md "세션 교환"
import { NextResponse } from 'next/server';

import { resolveDevice } from '@/lib/auth/device';
import { prisma } from '@/lib/db';

import { consumeDeviceSessionNonce, issueDeviceSessionNonce } from './nonce';
import { encodeDeviceSessionCookie } from './session-token';

function resolveAppUrl(): string {
  const url = process.env.APP_URL;
  if (!url) {
    throw new Error('APP_URL이 설정되지 않았습니다. web/.env를 확인하세요.');
  }
  return url.replace(/\/+$/, '');
}

export async function POST(request: Request): Promise<NextResponse> {
  const device = await resolveDevice(request.headers.get('authorization'));
  if (!device) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { nonce } = await issueDeviceSessionNonce(device.memberId);

  return NextResponse.json(
    { url: `${resolveAppUrl()}/api/auth/device-session?t=${nonce}` },
    { status: 200 },
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  const nonce = new URL(request.url).searchParams.get('t');
  if (!nonce) {
    return NextResponse.json({ error: 'missing_nonce' }, { status: 401 });
  }

  const consumed = await consumeDeviceSessionNonce(nonce);
  if (!consumed) {
    // 만료·재사용·존재하지 않음을 구분해 알려주지 않는다 — nonce.ts 주석 참고.
    return NextResponse.json({ error: 'invalid_nonce' }, { status: 401 });
  }

  // role 은 조회하지 않는다 — select 에 넣지 않았으니 애초에 값이 없어
  // 실수로도 참조할 수 없다. (불변 규칙 3)
  const member = await prisma.familyMember.findUnique({
    where: { id: consumed.memberId },
    select: { name: true },
  });
  if (!member) {
    // nonce 발급 이후 구성원이 삭제된 극단적인 경우. 정상 흐름에서는 발생하지 않는다.
    return NextResponse.json({ error: 'member_not_found' }, { status: 401 });
  }

  const cookie = await encodeDeviceSessionCookie({
    memberId: consumed.memberId,
    memberName: member.name,
  });

  const response = NextResponse.redirect(new URL('/', request.url), { status: 302 });
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
