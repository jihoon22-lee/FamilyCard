# ADR 0005 — 가시성 범위를 role이 아니라 진입 경로로 결정한다

- **상태**: 채택
- **일자**: 2026-08-10

## 배경

요구사항이 세 문장이었습니다.

1. 가족 구성원은 본인 카드 통계만 본다
2. 관리자는 웹 대시보드에서 가족 전체를 본다
3. **관리자도 자기 폰 앱에서는 본인 것만 본다**

3번이 특이합니다. 같은 사람인데 어느 화면으로 들어왔느냐에 따라 보이는 범위가 다릅니다.

## 흔한 접근과 그 문제

일반적인 RBAC라면 이렇게 짭니다.

```ts
// ❌
const visible = user.role === 'ADMIN'
  ? allMemberIds
  : [user.id];
```

이러면 요구 3번을 만족할 수 없습니다. 관리자가 폰 앱을 열면 가족 전체가 보입니다.

조건을 하나 더 붙이는 방법이 있습니다.

```ts
// ❌ 조금 나아졌지만 여전히 위험
const visible = (user.role === 'ADMIN' && !session.isFromDevice)
  ? allMemberIds
  : [user.id];
```

동작은 하지만 **이 조건문 자체가 공격 표면**입니다. `isFromDevice`가 어디선가 잘못 세팅되거나, 나중에 누군가 "관리자는 편의상 앱에서도 다 보이게 하자"고 조건을 완화하면 그대로 뚫립니다.

## 왜 3번이 필요한가

앱은 UX를 위해 **로그인 화면 없이** 바로 대시보드를 엽니다(디바이스 토큰 → 세션 교환). 가족용 앱에 매번 비밀번호를 요구하면 안 씁니다.

그런데 그 편의의 대가로, **폰을 주운 사람이 앱을 열면 그대로 데이터를 봅니다.**

관리자 폰이 가족 전체를 보여준다면, 관리자 폰 하나가 가족 전원 금융 데이터의 열쇠가 됩니다. 폰 분실 한 번에 아버지·어머니·자녀의 카드 사용내역이 전부 넘어갑니다.

## 결정

**scope를 role이 아니라 진입 경로로 먼저 결정합니다.**

```
FamilyMember.role : MEMBER | ADMIN     — 그 사람이 누구인가 (영속)
Session.scope     : SELF | FAMILY      — 이번 세션이 무엇을 볼 수 있는가 (일시)
```

```
디바이스 토큰으로 들어옴?
  ├─ 예  →  scope = SELF          ← role 을 조회조차 하지 않음
  └─ 아니오 (웹 로그인)
        └─ role == ADMIN  →  scope = FAMILY
           role == MEMBER →  scope = SELF
```

| 진입 경로 | role | scope |
|---|---|---|
| 앱 WebView | 무관 | **항상 SELF** |
| 웹 로그인 | MEMBER | SELF |
| 웹 로그인 | ADMIN | FAMILY |

### 핵심: 조건문을 없앤다

디바이스 세션 발급 코드에서 **`role`을 읽지 않습니다.**

```ts
// 디바이스 세션 발급 — role 참조가 아예 없음
async function createDeviceSession(device: Device) {
  return createSession({ memberId: device.memberId, scope: 'SELF' });
}
```

조회하지 않으면 실수로 참조할 수도 없습니다. "관리자면 예외" 같은 분기가 존재하지 않으므로, 그 분기를 뚫을 방법도 없습니다.

권한 상승 경로를 조건문으로 막는 대신, **경로 자체를 만들지 않았습니다.**

## 결과

### 조회는 헬퍼 하나로 통일

```ts
// web/src/lib/auth/scope.ts
export async function visibleMemberIds(session: Session): Promise<string[]> {
  if (session.scope === 'FAMILY') { /* 전체 */ }
  return [session.memberId];
}
```

모든 조회가 이걸 거칩니다. 화면마다 `where`를 손으로 쓰면 언젠가 빠뜨리고, 그 순간 그 화면이 가족 전체를 노출합니다. → [불변 규칙 2](../../AGENTS.md)

### 라우트도 분리

```
src/app/(app)/      본인 데이터만 다루는 화면
src/app/(family)/   ADMIN 전용, 미들웨어에서 scope 검사
```

미들웨어는 1차 방어선일 뿐이고, 각 페이지·API도 자체적으로 `visibleMemberIds()`를 거칩니다.

### 관리자가 감수하는 불편

관리자가 폰에서 가족 전체를 보려면 **웹 브라우저를 열어 로그인**해야 합니다. 앱에서는 안 됩니다.

이건 의도된 불편입니다. 폰을 잃어버렸을 때 그 불편이 방어선이 됩니다.

### Phase 1부터 스키마에 넣는다

`role`과 `scope`가 실제로 쓰이는 것은 Phase 5(가족 대시보드)지만, **스키마와 헬퍼는 Phase 1부터** 넣습니다. 나중에 얹으면 이미 작성된 모든 쿼리를 다시 뒤져야 하고, 그 과정에서 빠뜨린 하나가 곧 유출입니다.

## 테스트로 고정할 것

```
✅ ADMIN 디바이스 토큰으로 세션 발급 → scope = SELF
✅ MEMBER 세션으로 API 에 타인 memberId 전달 → 403 또는 빈 결과
```

이 두 개가 이 ADR의 주장을 지키는 테스트입니다. 권한 관련 코드를 고칠 때마다 통과하는지 확인하세요.

관련 설계: [07-auth-scope](../design/07-auth-scope.md)
