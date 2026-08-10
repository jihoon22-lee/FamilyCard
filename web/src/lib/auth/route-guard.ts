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
const PUBLIC_PATHS = new Set(['/login', '/signup', '/api/health']);

export type RouteDecision = { type: 'allow' } | { type: 'redirect'; to: string };

/**
 * @param pathname 요청 경로
 * @param scope    현재 세션의 scope. 세션이 없으면 null
 */
export function decideRoute(pathname: string, scope: SessionScope | null): RouteDecision {
  if (PUBLIC_PATHS.has(pathname)) {
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
