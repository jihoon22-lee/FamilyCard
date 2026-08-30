// 미들웨어의 경로 판정 로직 — **순수 함수로 분리해 테스트 가능하게 둔다.**
//
// 미들웨어 자체는 NextRequest/NextResponse 와 Auth.js 래퍼에 묶여 있어
// 유닛 테스트를 붙이기 번거롭다. 하지만 "누가 어느 경로에 갈 수 있는가"는
// 이 시스템에서 틀리면 안 되는 판정이라 반드시 테스트로 고정해야 한다.
// 그래서 판정만 떼어내 여기에 둔다.
//
// → docs/plan/w3-contract.md §6
import type { SessionScope } from '@/lib/auth/types';

// 세션 없이 접근할 수 있는 경로.
// `/api/auth/**` 는 Auth.js 자신의 엔드포인트라 미들웨어 matcher 에서 아예
// 제외한다(middleware.ts 참고).
const PUBLIC_PATHS = new Set([
  '/login',
  '/signup',
  '/api/health',
  // 외부 브라우저는 앱 WebView의 DEVICE 쿠키를 공유하지 않는다. tailnet 안에서만
  // 노출하고 Android 서명으로 덮어쓰기 무결성을 검증하는 APK 한 파일만 공개한다.
  '/downloads/familycard.apk',
]);

// 세션 쿠키가 아니라 **디바이스 토큰**(Authorization: Bearer)으로 인증하는 경로.
//
// 안드로이드 수집기는 웹 로그인을 하지 않으므로 세션 쿠키가 없다. 이 경로를
// 세션 기준으로 막으면 요청이 핸들러에 닿기도 전에 /login 으로 리다이렉트되어
// 수집 파이프라인 전체가 조용히 죽는다. 실제로 그렇게 만들어졌다가 통합
// 확인에서 잡혔다 — 유닛 테스트는 핸들러를 직접 호출하므로 이걸 못 잡는다.
//
// "공개"가 아니라 "인증 방식이 다른" 경로라서 PUBLIC_PATHS 와 분리했다.
// ⚠️ 여기에 경로를 추가할 때는 **그 핸들러가 반드시 자체적으로 토큰을
//    검증하는지** 확인할 것. 확인 없이 추가하면 인증 없는 엔드포인트가 된다.
const DEVICE_TOKEN_PATHS = new Set(['/api/ingest']);

export type RouteDecision = { type: 'allow' } | { type: 'redirect'; to: string };

/**
 * @param pathname 요청 경로
 * @param scope    현재 세션의 scope. 세션이 없으면 null
 */
export function decideRoute(pathname: string, scope: SessionScope | null): RouteDecision {
  if (PUBLIC_PATHS.has(pathname) || DEVICE_TOKEN_PATHS.has(pathname)) {
    return { type: 'allow' };
  }

  if (scope === null) {
    return { type: 'redirect', to: '/login' };
  }

  // startsWith('/family') 만 쓰면 `/familyfoo` 같은 경로까지 걸린다.
  // 정확히 `/family` 이거나 그 하위 경로일 때만 검사한다.
  const isFamilyRoute = pathname === '/family' || pathname.startsWith('/family/');
  if (isFamilyRoute && scope !== 'FAMILY') {
    return { type: 'redirect', to: '/' };
  }

  return { type: 'allow' };
}
