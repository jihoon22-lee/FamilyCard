// POST /api/auth/device-session — 디바이스 토큰 → 웹 세션 교환.
// GET  /api/auth/device-session?t=<nonce> — nonce 소모 → 세션 쿠키 → 대시보드 리다이렉트.
//
// 앱이 WebView 를 로그인 화면 없이 바로 여는 흐름:
//   1. 앱이 POST 로 이 엔드포인트를 부른다 (Authorization: Bearer <deviceToken>)
//   2. 서버가 60초 만료·1회용 nonce 를 발급하고 그 nonce 를 실은 URL 을 응답한다
//   3. 앱이 WebView 에 그 URL 을 로드한다 (= 이 파일의 GET)
//   4. 서버가 nonce 를 소모하고 세션 쿠키를 심은 뒤 대시보드(/)로 리다이렉트한다
//
// nonce 소모는 쿠키를 심는 GET 부수효과라 전용 API 경로에서 처리한다.
// 루트 `/`는 대시보드 page가 사용하므로 같은 세그먼트에 route를 둘 수 없다.
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

  const { nonce } = await issueDeviceSessionNonce(device);

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

  // nonce 발급 뒤 GET 전에 기기가 폐기될 수 있다. 원 기기가 현재도 활성이고
  // 같은 구성원 소유일 때만 쿠키를 만든다. role은 조회하지 않는다.
  const device = await prisma.device.findUnique({
    where: { id: consumed.deviceId },
    select: {
      memberId: true,
      revokedAt: true,
      member: { select: { name: true } },
    },
  });
  if (!device || device.revokedAt || device.memberId !== consumed.memberId) {
    return NextResponse.json({ error: 'device_revoked' }, { status: 401 });
  }

  const cookie = await encodeDeviceSessionCookie({
    deviceId: consumed.deviceId,
    memberId: consumed.memberId,
    memberName: device.member.name,
  });

  // Tailscale Serve 같은 역방향 프록시는 백엔드에 내부 Host(localhost:3000)를
  // 전달할 수 있다. request.url을 기준으로 삼으면 WebView가 localhost로
  // 이탈하므로, POST에서 세션 URL을 만들 때와 같은 공개 origin을 사용한다.
  const response = NextResponse.redirect(new URL('/', resolveAppUrl()), { status: 302 });
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
