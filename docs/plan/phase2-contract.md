# Phase 2 — 수집 인터페이스 계약

> 상태: 2026-08-30 구현·자동/로컬 통합 검증 완료. 실기기 사용자 등록과 실제 결제 검증 전.
>
> 이 문서가 Android와 서버 사이의 현재 계약입니다. 초기 내용·분 단위 dedupe와
> 건수-only 응답은 [ADR 0006](../adr/0006-client-event-idempotency.md)으로 폐기했습니다.

## 0. 수집 단계에서 파싱하지 않는다

`/api/ingest`는 원문을 `RawMessage(PENDING)`으로 저장합니다. 카드사 문구 해석,
카드 매칭, 거래 생성은 실제 원문이 며칠치 모인 뒤 Phase 3에서 시작합니다.

## 1. 인증

```http
Authorization: Bearer <deviceToken>
```

- 토큰 원문은 발급 화면에서 1회만 표시하고 DB에는 SHA-256 해시만 저장합니다.
- 서버는 클라이언트의 `memberId`·`deviceId`를 받지 않습니다.
- 소유자는 유효하고 폐기되지 않은 토큰의 `Device`에서 유도합니다.
- 인증 실패는 `401`입니다.

## 2. `POST /api/ingest`

### 요청

```json
{
  "messages": [
    {
      "clientMessageId": "11111111-1111-4111-8111-111111111111",
      "source": "NOTIFICATION",
      "originKind": "CARD_APP",
      "packageName": "com.example.testcard",
      "title": "테스트카드 승인",
      "body": "홍길동님 12,000원 일시불 08/10 14:23 테스트가맹점",
      "receivedAt": "2026-08-10T14:23:07+09:00"
    }
  ]
}
```

`clientMessageId`는 UUID이며 배치 안에서 유일해야 합니다. Android가 캡처 시 한 번
만들어 큐 재전송 동안 유지합니다.

`originKind`는 `CARD_APP | PAYMENT_APP | KAKAO_CHANNEL | SMS_SENDER | UNKNOWN_APP`입니다.
`UNKNOWN_APP`은 v2 큐 보존 마이그레이션 전용이고 새 등록에서는 만들지 않습니다.
`NOTIFICATION`은 앞의 앱/카카오/기존 앱 종류, `SMS`는 `SMS_SENDER`와만 조합됩니다.

### 응답

```ts
type IngestResponse = {
  accepted: number;
  duplicates: number;
  rejected: number;
  results: Array<{
    clientMessageId: string;
    status: 'accepted' | 'duplicate' | 'rejected';
    reason?: string;
  }>;
};
```

불변식:

- 요약 세 수의 합은 요청 건수
- `results` 길이는 요청 건수
- 응답 ID 집합은 요청 ID 집합과 정확히 같음
- 응답 ID는 중복 없음
- 항목별 상태 개수와 요약 수가 같음

Android는 전부 검증한 뒤에만 큐 변경 계획을 적용합니다.

| 상태 | Android 처리 |
|---|---|
| `accepted` | pending 큐 삭제 |
| `duplicate` | pending 큐 삭제 |
| `rejected` | 원문·사유를 rejected 테이블로 옮긴 뒤 pending 삭제 |

거부 격리와 삭제는 한 SQLite 트랜잭션입니다. 애매한 응답에서는 전부 유지합니다.

### 멱등 키

```ts
sha256(`client-message-v1|${deviceId}|${clientMessageId}`)
```

`RawMessage.dedupeHash`와 `@@unique([deviceId, clientMessageId])`가 재전송을
막습니다. 본문·분 단위가 같은 별도 결제는 다른 ID이므로 합치지 않습니다.

### 상한과 오류

| 상황 | 결과 |
|---|---|
| JSON 불가 / `messages` 배열 아님 | `400` 전체 거부 |
| ID 누락·형식 오류·배치 내 중복 | `400` 전체 거부 |
| `INGEST_MAX_BATCH_SIZE` 초과(기본 200) | `413` 전체 거부 |
| `INGEST_MAX_REQUEST_BYTES` 초과(기본 6,000,000) | `413` 전체 거부 |
| 명백한 항목 형식 오류 | `200` 안의 해당 항목 `rejected` |
| DB·내부 오류 | `5xx`, 앱 큐 유지·재시도 |

요청 바이트 상한은 선언된 `Content-Length`와 실제 스트림 양쪽에서 강제합니다.

건별 검사:

- `source`: `NOTIFICATION | SMS`
- `originKind`: 허용 enum이며 `source`와 올바른 조합
- 카카오 채널: `packageName == com.kakao.talk`, 제목은 비어 있지 않음
- `packageName`: 공백·NUL이 아닌 1~255자
- `title`: NUL 없는 문자열, 최대 500자
- `body`: 공백·NUL이 아닌 1~4000자
- `receivedAt`: 파싱 가능, 현재+5분 이하, 5년 이내

모든 저장 행은 `parseStatus: PENDING`입니다. 로그에는 본문·제목·항목 ID를 넣지 않습니다.

## 3. `POST/GET /api/auth/device-session`

```
POST + Bearer token
  → 200 { url: "<APP_URL>/api/auth/device-session?t=<nonce>" }
GET ?t=<nonce>
  → nonce 소모 → scope=SELF 쿠키 → /
```

- nonce: 32바이트 랜덤, 해시만 저장, 기본 60초, 1회용
- nonce에 `deviceId`와 `memberId`를 함께 저장
- 발급 뒤 기기가 폐기되면 GET은 `401`
- 쿠키: `entrypoint=DEVICE`, `deviceId`, role 최소값 `MEMBER`, scope `SELF`
- 보호 조회마다 해당 기기가 활성·동일 소유인지 재검증
- ADMIN 소유 기기라도 role을 조회하지 않고 scope는 항상 SELF

## 4. Android 캡처 계약

수집 대상은 각 사용자가 FamilyCard 설정에서 폰별로 관리합니다. 기본 목록은 비어 있어
등록 전에는 아무것도 수집하지 않습니다.

- launcher intent로 제한한 설치 앱 화면에서 이름·패키지 검색, 공식/이름 추천, 다중 선택,
  카드사 앱 또는 결제·자산 앱 추가/재분류/삭제
- 전체 설치 앱 목록은 선택기 메모리에만 두고 `QUERY_ALL_PACKAGES`·자동 등록은 사용하지 않음
- 카카오톡은 사용자가 등록한 공식 채널 제목 정확히 일치
- SMS는 사용자가 등록한 발신번호/발신자 ID + 거래 어휘
- 카카오톡과 기본 SMS 앱은 앱 전체 대상으로 등록 금지
- 정규식·본문 기반 발신자 추정 fallback 없음
- 필터 통과 전에 본문 저장·로그 금지
- 본문은 BIG_TEXT → TEXT_LINES → TEXT 순서
- 한 결제의 복수 앱 알림은 `originKind`가 다른 원문으로 모두 보존

새 원문은 로컬 저장 뒤 즉시 업로드를 예약하고, 15분 주기 작업을 복구 안전망으로 둡니다.

## 5. 화면 계약

- `/family/devices`: FAMILY scope 관리자만 발급·폐기, 원문 토큰 1회 표시
- QR 생성·스캔은 아직 없음
- `/raw`: `visibleMemberIds(session)` 경유, SELF는 본인·FAMILY는 가족 전체
- `/raw`: `originKind` 배지로 카드사 앱·결제 앱·카카오·SMS 구분
- Android WebView: 설정한 origin만 내부 로드, DEVICE 세션은 SELF

## 6. 테스트 계약

서버:

- 새 ID 승인, 동일 ID 재전송 중복, 동일 본문 새 ID 승인
- 잘못된 토큰·폐기 토큰 401
- ID 사전 검증, 요청 바이트/배치 상한, 부분 거부
- 응답에 항목별 ID·상태·사유
- 로그에 원문 없음
- nonce 만료·재사용·발급 후 폐기 거부
- 기존 디바이스 세션 폐기 후 보호 조회 거부
- `/raw` 타인 데이터 비노출

Android:

- 빈/손상 목록 fail-closed
- exact package/Kakao/SMS 사용자 목록
- 카드사 앱과 결제 앱 출처 분리, 카카오톡·기본 SMS 앱 전체 등록 차단
- 일반 카카오 대화·개인 SMS 비수집
- 본문 추출 우선순위·사건 ID 안정성
- 응답 ID/건수 불일치 때 큐 유지
- 거부 원문 격리 계획
- HTTPS·동일 origin 정책

실기기:

- 앱 설정에서 실제 수집 대상 등록·삭제·재분류
- 실제 결제·기내모드 복구·재부팅·서버 장애 화면
- 일반 카카오 대화가 로컬 큐와 서버 모두 0건
- 동일 결제 카드사 앱+결제 앱 알림이 둘 다 출처별 원문으로 도착

## 7. 픽스처

실제 카드 원문·카드번호·거래내역은 테스트·문서·로그·커밋에 넣지 않습니다. 구조를
재현해야 할 때 이름·금액·가맹점·번호를 모두 가공합니다.
