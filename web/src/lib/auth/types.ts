// 애플리케이션 세션의 최소 도메인 타입. UI와 조회 계층은 Auth.js 원본 대신
// 이 타입만 사용한다. 인증 경계 필드를 바꾸면 scope·폐기 회귀 테스트를 함께
// 갱신한다.

// FamilyMember.role — 그 사람이 누구인가(영속). DB의 FamilyRole enum과 대응.
export type MemberRole = 'MEMBER' | 'ADMIN';

// 이번 세션이 무엇을 볼 수 있는가(일시). role과 반드시 같이 움직이지 않는다.
// → docs/design/07-auth-scope.md "두 축: role과 scope"
export type SessionScope = 'SELF' | 'FAMILY';

// 오래된 디바이스 쿠키를 웹 로그인으로 오인하지 않도록 진입 경로를 토큰에
// 명시한다. 이 필드가 없는 구버전 쿠키는 세션으로 인정하지 않는다.
export type AuthEntrypoint = 'WEB' | 'DEVICE';

export interface AppSession {
  memberId: string;
  name: string;
  role: MemberRole;
  scope: SessionScope;
  entrypoint: AuthEntrypoint;
  /** DEVICE 세션에서만 존재. 폐기 여부를 매 요청 확인하는 키. */
  deviceId?: string;
}
