// 세션 타입 — W3 계약(docs/plan/w3-contract.md §1)에 시그니처가 고정돼 있다.
// W3-B가 이 타입을 신뢰하고 UI를 작성하므로 임의로 필드를 늘리거나 이름을
// 바꾸지 않는다.

// FamilyMember.role — 그 사람이 누구인가(영속). DB의 FamilyRole enum과 대응.
export type MemberRole = 'MEMBER' | 'ADMIN';

// 이번 세션이 무엇을 볼 수 있는가(일시). role과 반드시 같이 움직이지 않는다.
// → docs/design/07-auth-scope.md "두 축: role과 scope"
export type SessionScope = 'SELF' | 'FAMILY';

export interface AppSession {
  memberId: string;
  name: string;
  role: MemberRole;
  scope: SessionScope;
}
