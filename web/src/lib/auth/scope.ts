// 가시성 계층 — **이 프로젝트에서 가장 중요한 파일**이다.
//
// 모든 데이터 조회는 예외 없이 visibleMemberIds() 를 거친다. 화면과 API 가
// 수십 개로 늘어난 뒤에 각자 where 절에 memberId 조건을 손으로 쓰면 언젠가
// 하나를 빠뜨리고, 그 순간 그 화면은 가족 전체 데이터를 노출한다. 빠진 조건은
// 코드 리뷰에서 눈에 잘 안 띄고, 개발자는 보통 자기 계정으로만 테스트하므로
// 테스트로도 잘 안 걸린다. 경로를 하나로 모으면 감사할 지점도 하나다.
//
// → AGENTS.md 불변 규칙 2, docs/design/07-auth-scope.md
import { prisma } from '@/lib/db';

import type { AppSession, MemberRole, SessionScope } from '@/lib/auth/types';

/**
 * 웹 로그인으로 들어온 세션의 scope 를 결정한다.
 *
 * scope 는 role 이 아니라 **진입 경로**로 먼저 결정된다. 이 함수는 그중
 * "웹 로그인" 경로 전용이다.
 *
 * Phase 2 에서 안드로이드 앱의 디바이스 토큰 경로가 붙는데, 그쪽은 이 함수를
 * 쓰지 않고 **항상 'SELF' 를 반환하는 별도 경로**로 간다. role 을 조회조차
 * 하지 않는 것이 핵심이다 — 조회하지 않으면 실수로 참조할 수도 없다.
 * 폰을 주운 사람이 앱을 열어도 피해가 본인 데이터로 한정되게 하는 장치다.
 *
 * → AGENTS.md 불변 규칙 3, docs/adr/0005-scope-by-entrypoint.md
 */
export function scopeForWebLogin(role: MemberRole): SessionScope {
  return role === 'ADMIN' ? 'FAMILY' : 'SELF';
}

/**
 * 이 세션이 조회할 수 있는 구성원 id 목록.
 *
 * - `scope === 'FAMILY'` → 가족 전원
 * - 그 외 → 본인 하나
 */
export async function visibleMemberIds(session: AppSession): Promise<string[]> {
  if (session.scope === 'FAMILY') {
    const members = await prisma.familyMember.findMany({
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((member) => member.id);
  }

  return [session.memberId];
}

// ⚠️ CI 실효성 확인용 임시 코드 — 다음 커밋에서 되돌립니다.
// CI 가 web/ 코드를 실제로 타입체크하는지 확인하기 위해 의도적으로
// 틀린 타입을 넣습니다. CI 가 초록이면 그 신호는 무의미하다는 뜻입니다.
const CI_EFFECTIVENESS_PROBE: number = '이 문자열은 number 에 들어갈 수 없습니다';
export { CI_EFFECTIVENESS_PROBE };
