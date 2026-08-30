# 02 — 수집 파이프라인

## 범위와 우선순위

안드로이드가 카드 알림 원문을 캡처한 순간부터 서버의 `RawMessage`에 안전하게
도착할 때까지를 다룹니다. 파싱은 Phase 3의 책임입니다([03-parser](03-parser.md)).

이 경로의 우선순위는 다음과 같습니다.

1. 화이트리스트 밖의 사적 알림을 **저장하지 않기**
2. 허용된 원문을 **유실하지 않기**
3. 재전송으로 **중복 행을 만들지 않기**

```
허용 목록 판정 → 로컬 큐 저장 → 즉시 업로드 예약 → 서버 항목별 확인
                      ↑                                  │
                      └──── 실패·애매한 응답이면 재시도 ──┘
```

필터는 로컬 큐보다 앞에 있습니다. 이 순서는 [불변 규칙 4](../../AGENTS.md)입니다.

---

## 앱: 보존 큐

알림 순간에는 Tailscale이 꺼져 있거나 서버가 재부팅 중일 수 있습니다. 캡처 콜백에서
HTTP를 직접 보내는 대신 먼저 앱 전용 SQLite에 저장합니다.

```kotlin
data class PendingMessage(
    val id: Long = 0,
    val clientMessageId: String,
    val source: String,       // NOTIFICATION | SMS
    val packageName: String,  // SMS면 확인된 발신번호
    val title: String,
    val body: String,
    val receivedAt: Long,     // 캡처 시각 epoch millis
    val attemptCount: Int = 0,
    val lastAttemptAt: Long? = null,
)
```

- `receivedAt`은 업로드 시각이 아니라 OS가 준 캡처 시각입니다.
- 큐 DB 업그레이드는 테이블을 버리지 않고 기존 원문을 보존합니다.
- 앱 백업·기기 이전에서는 큐와 장기 토큰을 제외합니다. 다른 기기로 복사된 토큰과
  중복 큐가 살아나는 것을 막기 위해서입니다.
- 큐 쓰기 실패는 본문 없이 설정 화면에 표시합니다. 원문은 로그에 쓰지 않습니다.

### 업로드 트리거

- 원문 저장 직후 일회성 작업
- 설정 저장·사용자 수동 전송 직후 일회성 작업
- 네트워크 연결 제약이 붙은 15분 주기 안전망
- 지수 백오프, 초기 30초
- 한 작업에서 200건씩 큐가 빌 때까지 연속 전송

즉시 작업이 실행되지 않아도 주기 작업이 복구하고, 서버 오류나 네트워크 단절에서는
큐를 유지합니다.

---

## 사건 ID와 멱등성

각 캡처 사건은 로컬 큐에 들어갈 때 `clientMessageId`를 한 번 받습니다.

- 알림: OS notification key + `postTime` + 본문
- SMS: 정규화 전 발신자 + 수신 시각 + 결합한 전체 본문
- 같은 큐 행의 모든 재전송: 저장된 ID 재사용

서버는 다음 입력으로 해시를 만듭니다.

```ts
dedupeHash = sha256(`client-message-v1|${deviceId}|${clientMessageId}`)
```

`RawMessage.dedupeHash`와 `(deviceId, clientMessageId)`는 모두 UNIQUE입니다.
같은 ID의 재전송은 `duplicate`가 되지만, 본문과 시각이 우연히 같은 별도 사건은 서로
다른 ID라 둘 다 보존됩니다.

이 결정과 이전 내용·분 단위 해시를 폐기한 이유는
[ADR 0006](../adr/0006-client-event-idempotency.md)에 기록합니다.

> 앱 알림과 SMS가 같은 결제를 각각 알려주는 경우도 수집 단계에서는 합치지 않습니다.
> 원문을 먼저 보존하고 Phase 3에서 실제 문구를 보고 의미를 판단합니다.

---

## 서버: `POST /api/ingest`

### 요청

```http
POST /api/ingest
Authorization: Bearer <deviceToken>
Content-Type: application/json
```

```json
{
  "messages": [
    {
      "clientMessageId": "11111111-1111-4111-8111-111111111111",
      "source": "NOTIFICATION",
      "packageName": "com.example.testcard",
      "title": "테스트카드 승인",
      "body": "홍길동님 12,000원 일시불 08/10 14:23 테스트가맹점",
      "receivedAt": "2026-08-10T14:23:07+09:00"
    }
  ]
}
```

샘플은 모두 가공 데이터입니다. 실제 원문은 문서나 테스트에 넣지 않습니다.

### 성공 응답

```json
{
  "accepted": 1,
  "duplicates": 1,
  "rejected": 1,
  "results": [
    { "clientMessageId": "...001", "status": "accepted" },
    { "clientMessageId": "...002", "status": "duplicate" },
    {
      "clientMessageId": "...003",
      "status": "rejected",
      "reason": "received_at_in_future"
    }
  ]
}
```

다음 조건을 모두 만족해야 앱이 응답을 적용합니다.

- `accepted + duplicates + rejected == 전송 건수`
- `results.length == 전송 건수`
- 결과 ID 집합이 전송 ID 집합과 정확히 같고 중복이 없음
- 항목별 상태 개수가 요약 건수와 일치

하나라도 다르면 프로토콜 오류로 보고 큐를 그대로 둡니다.

### 항목 처리

| 결과 | 서버 | 앱 |
|---|---|---|
| `accepted` | `RawMessage(PENDING)` 생성 | pending 큐에서 삭제 |
| `duplicate` | 새 행 없음 | pending 큐에서 삭제 |
| `rejected` | 형식상 저장 불가 | 원문+사유를 `rejected_message`로 옮긴 뒤 pending에서 삭제 |

거부 격리 INSERT와 pending 삭제는 한 SQLite 트랜잭션입니다. 격리된 원문은 자동
폐기하지 않으며 설정 화면의 `확인 필요` 건수로 드러냅니다.

### 요청 전체 거부

| 조건 | 응답 |
|---|---|
| 토큰 없음·무효·폐기 | `401` |
| JSON 아님 / `messages` 배열 아님 | `400` |
| `clientMessageId`가 없거나 UUID 아님 / 배치 내 중복 | `400` |
| 메시지 수가 `INGEST_MAX_BATCH_SIZE` 초과 | `413` |
| 원시 요청 바이트가 `INGEST_MAX_REQUEST_BYTES` 초과 | `413` |

바이트 상한은 `Content-Length`만 믿지 않고 요청 스트림을 읽는 동안 강제합니다.
요청 전체가 거부되면 앱은 어떤 큐 행도 지우지 않습니다.

### 건별 거부

| 조건 | 사유 |
|---|---|
| `source`가 `NOTIFICATION`/`SMS` 아님 | `invalid_source` |
| 패키지·발신자 공백·NUL 또는 255자 초과 | `invalid_package_name` |
| 제목 타입·NUL 오류 또는 500자 초과 | `invalid_title` / `title_too_long` |
| 본문 공백·NUL 또는 4000자 초과 | `empty_body` / `invalid_body` / `body_too_long` |
| 시각 파싱 불가 | `invalid_received_at` |
| 현재보다 5분 초과 미래 | `received_at_in_future` |
| 현재보다 5년 초과 과거 | `received_at_too_old` |

한 항목의 명백한 형식 오류는 같은 배치의 정상 항목을 막지 않습니다. 반면 DB 연결
실패처럼 결과가 불명확한 오류는 요청을 실패시켜 전체를 재시도하게 합니다.

### 인증과 소유자

- 서버는 토큰 원문이 아니라 `Device.tokenHash`만 저장합니다.
- 요청 본문은 `memberId`를 받지 않습니다.
- 소유자는 인증된 `Device.memberId`에서만 유도합니다.
- 인증된 요청이 서버에 도달하면 본문 결과와 무관하게 `Device.lastSeenAt`을 갱신합니다.

---

## 저장과 파싱의 분리

`/api/ingest`는 저장까지만 하고 항상 `parseStatus: PENDING`으로 둡니다.

```
/api/ingest → RawMessage(PENDING) → [Phase 3 파서] → Transaction
```

파싱 실패나 규칙 변경이 수집 성공을 뒤집으면 안 됩니다. `RawMessage`는 삭제하지 않고,
규칙을 고친 뒤 과거 전체를 다시 파싱할 수 있어야 합니다([불변 규칙 1](../../AGENTS.md)).

---

## 디바이스 세션 교환과 폐기

WebView 자동 로그인은 수집 토큰으로 장기 세션 URL을 만들지 않습니다.

```
POST /api/auth/device-session + Bearer token
  → 60초·1회용 nonce URL
  → GET에서 nonce 소모
  → entrypoint=DEVICE, deviceId 포함, scope=SELF 쿠키
```

nonce는 발급 기기와 연결됩니다. 발급 후 소비 전 기기가 폐기되면 교환을 거부하고,
이미 발급된 디바이스 세션도 보호 조회마다 기기 활성 상태와 소유자를 다시 확인합니다.
따라서 기기 폐기는 새 수집뿐 아니라 기존 WebView 세션도 무효화합니다.

---

## 로그와 관찰 가능성

- 수집 로그: `deviceId`, 요청/승인/중복/거부 건수만
- 어떤 로그 레벨에서도 제목·본문·항목 ID를 기록하지 않음
- 앱 상태: 대기·격리 건수, 마지막 결과, 본문 없는 캡처 저장 오류
- Phase 6: `DEVICE_SILENCE_WARN_DAYS`를 넘긴 기기 경고

원문 분석은 접근 범위가 적용된 `/raw`에서 합니다. 로그를 분석 경로로 쓰지 않습니다.

---

## 검증 기준

- 같은 `clientMessageId` 재전송 → `duplicate`, DB 중복 없음
- 같은 본문·같은 시각이라도 새 ID → 두 번째 `accepted`
- 부분 실패 응답을 ID별로 정확히 적용
- 불완전·중복·알 수 없는 응답 ID → 큐 전부 유지
- 거부 건 → 원문 보존 격리
- 기기 폐기 → 수집, 미소모 nonce, 기존 디바이스 세션 모두 거부
- 실기기 기내모드 결제 → 연결 복구 뒤 자동 업로드
- 카카오톡 일반 대화 → 로컬 큐와 서버 모두 0건

## 관련 문서

- [08-android-app](08-android-app.md) — 캡처·큐·WebView 구현
- [07-auth-scope](07-auth-scope.md) — 권한과 세션 폐기
- [ADR 0006](../adr/0006-client-event-idempotency.md) — 사건 ID 결정
