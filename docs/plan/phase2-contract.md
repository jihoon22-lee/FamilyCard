# Phase 2 Wave 1 — 인터페이스 계약 (서버)

Phase 2 의 **서버 쪽**을 두 갈래로 나눠 **병렬** 진행하기 위한 경계면 정의다.
안드로이드 앱(Wave 2)은 이 계약이 확정된 뒤에 붙는다.

두 작업을 나눠 맡길 경우 이 문서를 **양쪽에 그대로** 전달한다.

> **선행 조건**: Phase 1 완료 (`v0.1.0`). 인증·scope 계층이 `web/src/lib/auth/` 에 있다.
> 관련 설계: [02-ingest](../design/02-ingest.md), [07-auth-scope](../design/07-auth-scope.md)

---

## 0. 이 Phase 에서 파싱하지 않는다

`/api/ingest` 는 원문을 **그대로 저장만** 한다. `parseStatus` 는 항상 `PENDING`.
파서는 Phase 3 이고, 그 입력은 이 Phase 가 쌓아둔 실제 알림 원문이다.
추측으로 정규식을 짜면 실물이 도착했을 때 전부 다시 써야 한다.

→ [AGENTS.md — 작업 순서에 대한 주의](../../AGENTS.md)

---

## 1. 디바이스 토큰 — `web/src/lib/auth/device.ts` (**A 소유**)

B 가 발급 화면에서, A 가 수집 엔드포인트에서 각각 쓴다.

```ts
/** 32바이트 랜덤 토큰 원문. 발급 시 1회만 화면에 표시하고 저장하지 않는다. */
export function generateDeviceToken(): string;

/** 토큰 원문 → 저장용 해시. sha256 hex. */
export function hashDeviceToken(token: string): string;

/**
 * Authorization 헤더에서 기기를 식별한다.
 * 헤더가 없거나 형식이 틀리거나 일치하는 기기가 없으면 null.
 *
 * 해시 조회(findUnique)라 상수 시간 비교가 자동으로 보장된다.
 * 문자열을 직접 비교하는 코드를 두지 말 것.
 */
export function resolveDevice(
  authorizationHeader: string | null,
): Promise<{ deviceId: string; memberId: string } | null>;
```

**클라이언트가 보낸 `memberId` 는 어디서도 받지 않는다.** 소유자는 항상 토큰에서 유도한다.

---

## 2. `POST /api/ingest` (**A 소유**)

### 요청
```
Authorization: Bearer <deviceToken>
Content-Type: application/json

{ "messages": [
  { "source": "NOTIFICATION",
    "packageName": "com.shinhancard.smartshinhan",
    "title": "신한카드 승인",
    "body": "홍길동님 12,000원 일시불 08/10 14:23 테스트가맹점",
    "receivedAt": "2026-08-10T14:23:07+09:00" }
]}
```
`source` 는 `MessageSource` enum 중 `NOTIFICATION` | `SMS` 만 허용한다.

### 응답
```ts
200 { accepted: number; duplicates: number; rejected: number }
```
`accepted + duplicates + rejected` 가 보낸 개수와 **반드시** 같아야 한다.
앱은 이 합계를 검증한 뒤에만 로컬 큐를 비운다. 어긋나면 앱이 큐를 못 비워 무한 재전송에 빠진다.

| 상황 | 응답 |
|---|---|
| 토큰 없음/무효 | `401` |
| 배치 크기 > `INGEST_MAX_BATCH_SIZE`(기본 200) | `413` (요청 전체 거부) |
| JSON 파싱 불가 / `messages` 배열 아님 | `400` |

### dedupeHash — 규칙을 그대로 지킬 것
```ts
dedupeHash = sha256([deviceId, packageName, body, truncateToMinute(receivedAt)].join('|'))
```
- 구분자는 `'|'`
- `truncateToMinute` 은 **초·밀리초를 0으로** (UTC 기준 ISO 문자열로 직렬화해 일관성 유지)
- `title` 은 **넣지 않는다** (카드사가 제목만 바꾸는 경우가 있음)
- `deviceId` 는 **넣는다** (부부가 같은 가족카드를 쓰면 두 폰에 같은 문구가 오는데, 이건 서로 다른 사실)

근거는 [02-ingest](../design/02-ingest.md) "설계 근거 3가지".

`RawMessage.dedupeHash` 는 UNIQUE 다. 삽입 충돌(P2002)이면 `duplicates` 로 세고 넘어간다.
**한 건의 충돌이 배치 전체를 실패시키면 안 된다.**

### 건별 유효성 검사 → `rejected`
| 조건 | 처리 |
|---|---|
| `body` 가 빈 문자열 | reject |
| `body` 길이 > 4000 | reject |
| `receivedAt` 파싱 불가 | reject |
| `receivedAt` 이 미래 (허용 오차 **5분** 초과) | reject |
| `receivedAt` 이 5년 이전 | reject |
| `source` 가 `NOTIFICATION`/`SMS` 가 아님 | reject |

### 그 밖에
- 저장은 전부 `parseStatus: PENDING`
- 매 요청마다 `Device.lastSeenAt` 갱신
- **로그에 본문(`body`)·`title` 을 남기지 않는다.** `deviceId`, 건수, 결과만.
  `LOG_LEVEL=debug` 일 때만 예외 → [02-ingest](../design/02-ingest.md) "관찰 가능성"

---

## 3. `POST /api/auth/device-session` (**B 소유**)

```
Authorization: Bearer <deviceToken>
→ 200 { "url": "<APP_URL>/?t=<nonce>" }
```

- nonce 는 랜덤, **`DEVICE_SESSION_NONCE_TTL`(기본 60초) 만료, 1회용**
- nonce 소모 → 세션 쿠키 발급 → 대시보드로 리다이렉트
- 만료/재사용 nonce → `401`

### ★ 이 경로의 세션은 **무조건 `scope: 'SELF'`**

`Device.memberId` 의 `role` 이 `ADMIN` 이어도 그렇다.
**`role` 을 조회조차 하지 말 것** — 조회하지 않으면 실수로 참조할 수도 없다.

`web/src/lib/auth/scope.ts` 의 `scopeForWebLogin()` 을 **쓰지 말고**, 같은 파일에 디바이스 전용 함수를 추가한다:
```ts
/** 디바이스 토큰 경로는 role 과 무관하게 항상 SELF. */
export function scopeForDeviceSession(): SessionScope {
  return 'SELF';
}
```
→ [AGENTS.md 불변 규칙 3](../../AGENTS.md), [ADR 0005](../adr/0005-scope-by-entrypoint.md)

nonce 저장 위치는 구현자 판단(신규 모델 추가 시 마이그레이션 필요). 선택 근거를 주석으로 남길 것.

---

## 4. 기기 등록 화면 (**B 소유**) — `/family/devices`

ADMIN 전용이므로 `(family)` 그룹 아래 둔다 (미들웨어가 이미 `scope` 를 검사).

- 구성원 선택 → 기기 이름 입력 → 토큰 발급
- **토큰 원문은 발급 직후 1회만 표시** + QR 코드. 다시 볼 수 없다는 안내를 화면에 명시
- 기기 목록 (구성원 · 기기명 · `lastSeenAt`) 과 **폐기** 기능
- 폐기하면 그 토큰은 즉시 무효 (폰 분실 시 첫 대응)

---

## 5. `/raw` 원문 목록 화면 (**B 소유**)

Phase 3 파서 작성의 **근거 자료**가 되는 화면이다. 파싱 전이므로 원문을 그대로 보여준다.

- 조회는 **반드시 `visibleMemberIds(session)` 경유** (불변 규칙 2)
  `RawMessage` → `Device` → `memberId` 로 이어지므로 `where: { device: { memberId: { in: visible } } }`
- 최신순, 페이지네이션
- 표시: 수신 시각 · 출처(`source`) · 패키지명 · 제목 · 본문
- 패키지명으로 거르기 (카드사별로 문구를 모아 보기 위해)

---

## 6. 파일 소유권 — 충돌 방지

| 파일 | 담당 |
|---|---|
| `web/src/lib/auth/device.ts` | **A** |
| `web/src/lib/ingest/**` | **A** |
| `web/src/app/api/ingest/**` | **A** |
| `web/src/app/api/auth/device-session/**` | **B** |
| `web/src/lib/auth/scope.ts` 에 `scopeForDeviceSession()` 추가 | **B** (그 함수만 추가, 기존 코드 수정 금지) |
| `web/src/app/(family)/devices/**` | **B** |
| `web/src/app/(app)/raw/**` 또는 `(family)` 하위 `/raw` | **B** |
| `web/prisma/schema.prisma` · 마이그레이션 | **B** (nonce 모델이 필요한 경우) |

A 는 화면을 만들지 않는다. B 는 `web/src/lib/ingest/` 와 `device.ts` 를 **import 만** 하고 수정하지 않는다.
(B 는 A 가 아직 안 끝났어도 §1 의 시그니처를 신뢰하고 진행한다.)

---

## 7. 테스트 (양쪽 공통 필수)

`curl` 검증 시나리오는 [02-ingest](../design/02-ingest.md) "검증 방법" 참고.

**A**
- 기본 수집 → `{accepted:1, duplicates:0, rejected:0}`
- **같은 요청 재전송 → `{accepted:0, duplicates:1}` 이고 DB 에 중복 행이 없을 것** ★
- 잘못된 토큰 → `401`
- 미래 시각(5분 초과) → `rejected: 1`
- 4000자 초과 → `rejected: 1`
- 배치 201건 → `413`
- **부분 실패**: 한 배치에 정상 2건 + 잘못된 1건 → `{accepted:2, rejected:1}` (전체 실패 아님)

**B**
- 만료된 nonce → `401`
- **이미 쓴 nonce 재사용 → `401`** ★
- **ADMIN 의 디바이스 토큰으로 세션 발급 → `scope: 'SELF'`** ★★ 불변 규칙 3
- 폐기된 디바이스 토큰 → `401`
- `/raw` 가 타인 기기의 원문을 보여주지 않음 ★

★★ 항목은 이 문서의 핵심 주장을 지키는 테스트다. 반드시 넣을 것.

---

## 8. 픽스처 주의

테스트에 **실제 카드 알림 원문을 쓰지 않는다.** 가맹점명·금액·이름·카드번호를 전부 가짜로 바꾸되,
구두점과 공백 구조는 실물과 같게 둔다.

→ [AGENTS.md 불변 규칙 7](../../AGENTS.md)

---

## 9. 구현 중 승인된 이탈

이 계약서 초안과 실제 구현이 갈라진 지점 2건. 둘 다 지휘자 승인됨.

### 9.1 nonce 소비 URL

§3 의 예시는 `<APP_URL>/?t=<nonce>` 였으나, 실제 응답은
`<APP_URL>/api/auth/device-session?t=<nonce>` 를 돌려준다.

**이유**: nonce 소모는 세션 쿠키를 심는 부수효과가 있는 로직이라 `GET` 핸들러가 필요한데,
Next.js App Router 는 같은 라우트 세그먼트에 `page.tsx` 와 `route.ts` 를 함께 둘 수 없다(둘 다
그 경로의 `GET` 을 다룬다). 루트 경로 `/` 는 이미 대시보드(`page.tsx`)가 쓰고 있다.
앱(WebView)은 이 `POST` 응답이 돌려준 `url` 필드를 그대로 로드할 뿐이므로, 정확한 경로가
무엇이든 기능상 차이가 없다. **승인됨.**

### 9.2 `/raw` 위치

§5·§6 은 위치를 명시하지 않았으나 §4(기기 등록 화면)와 나란히 다루고 있어 ADMIN 전용
`(family)` 그룹을 암시했다. 실제로는 `(app)` 그룹에 두어 `requireSession()` 만 요구한다
(ADMIN 여부를 검사하지 않는다).

**이유**: `/raw` 의 조회는 §5 규정대로 `visibleMemberIds(session)` 을 거치므로, MEMBER 세션이
와도 SELF 범위로 자동 필터링되고 FAMILY 범위(ADMIN)는 전 구성원이 보인다 — scope 가시성
계층이 이미 접근 범위를 정확히 좁혀주므로 화면 단에서 ADMIN 전용으로 한 번 더 막을 이유가
없다. **승인됨.**
