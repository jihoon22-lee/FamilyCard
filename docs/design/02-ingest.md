# 02 — 수집 파이프라인

## 이 문서의 범위

안드로이드 앱이 캡처한 알림 원문이 서버 DB에 안전하게 도착하기까지. 파싱은 다루지 않습니다([03-parser](03-parser.md)).

## 설계 목표

집 서버는 **밖에서 항상 접근 가능하지 않습니다.** Tailscale이 꺼져 있거나, 지하철이거나, 서버가 재부팅 중일 수 있습니다. 그동안 발생한 결제 알림은 놓치면 영원히 복구할 수 없습니다 — 카드사가 다시 보내주지 않으니까요.

그래서 수집 파이프라인의 제1 목표는 **유실 방지**이고, 그 대가로 **중복**을 허용합니다. 중복은 서버에서 걸러낼 수 있지만 유실은 되돌릴 수 없기 때문입니다.

```
캡처 → 로컬 큐에 즉시 저장 → 업로드 시도 → 성공하면 큐에서 삭제
                    ↑                    │
                    └──── 실패하면 재시도 ┘
```

---

## 앱 쪽: 오프라인 큐

### 왜 즉시 업로드하지 않는가

알림이 도착한 순간 네트워크가 될 것이라는 보장이 없습니다. `NotificationListenerService.onNotificationPosted()`에서 곧바로 HTTP 요청을 던지면, 실패했을 때 그 알림은 사라집니다.

그래서 캡처 즉시 Room DB에 넣고, 업로드는 `WorkManager`에게 맡깁니다. Room 저장은 로컬 디스크 쓰기라 거의 실패하지 않습니다.

### 큐 스키마 (Room)

```kotlin
@Entity(tableName = "pending_message")
data class PendingMessage(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val source: String,        // "NOTIFICATION" | "SMS"
    val packageName: String,   // 알림: 패키지명 / SMS: 발신번호
    val title: String,
    val body: String,
    val receivedAt: Long,      // epoch millis — 캡처 시각
    val attemptCount: Int = 0,
    val lastAttemptAt: Long? = null,
)
```

`receivedAt`은 **캡처 시각**이지 업로드 시각이 아닙니다. 사흘 뒤에 업로드되더라도 알림이 온 시점이 보존돼야 거래 시각이 맞습니다.

### 업로드 정책

- `WorkManager`의 주기 작업 + 네트워크 연결 시 트리거
- 한 번에 최대 `INGEST_MAX_BATCH_SIZE`(기본 200)건씩 배치 전송
- 실패 시 지수 백오프 (`BackoffPolicy.EXPONENTIAL`, 초기 30초)
- 성공 응답을 받은 건만 큐에서 삭제

**서버 응답을 확인하기 전에 큐에서 지우지 않습니다.** HTTP 200이 왔지만 서버가 저장에 실패했을 수 있으므로, 응답 본문의 `accepted` + `duplicates` 합계가 보낸 개수와 일치하는지 확인합니다.

---

## 서버 쪽: `POST /api/ingest`

### 요청

```ts
POST /api/ingest
Authorization: Bearer <deviceToken>

{
  "messages": [
    {
      "source": "NOTIFICATION",
      "packageName": "com.shinhancard.smartshinhan",
      "title": "신한카드 승인",
      "body": "홍길동님 12,000원 일시불 08/10 14:23 테스트가맹점",
      "receivedAt": "2026-08-10T14:23:07+09:00"
    }
  ]
}
```

### 응답

```ts
200 OK
{
  "accepted": 3,      // 새로 저장된 건
  "duplicates": 1,    // 이미 있어서 무시된 건
  "rejected": 0       // 형식 오류로 거부된 건
}
```

`accepted + duplicates + rejected`가 보낸 개수와 같아야 합니다. 앱은 이 합계를 검증한 뒤에만 큐를 비웁니다.

### 인증

`Authorization: Bearer <deviceToken>` 헤더로 기기를 식별합니다.

- 서버는 토큰 **원문을 저장하지 않습니다.** `Device.tokenHash`에 해시만 둡니다
- 발급 시 1회만 화면에 표시하고, 이후에는 재발급만 가능합니다
- 비교는 **상수 시간**으로 (타이밍 공격 방지)
- 토큰이 유효하면 `Device.memberId`가 확정되고, 이 배치의 모든 메시지가 그 구성원에게 귀속됩니다

**클라이언트가 보낸 `memberId`는 받지 않습니다.** 요청 본문에 그런 필드 자체가 없습니다. 소유자는 항상 토큰에서 유도됩니다.

---

## 멱등성 — `dedupeHash`

### 왜 필요한가

앱은 유실을 막기 위해 재전송을 적극적으로 합니다. 다음 상황에서 같은 메시지가 두 번 이상 도착합니다.

- 서버가 저장은 했는데 응답이 유실됨 → 앱이 재시도
- 오프라인 큐가 밀렸다가 한꺼번에 올라오는데 일부가 이미 반영됨
- 사용자가 설정 화면에서 "수동 재전송"을 누름

중복을 허용한 대가를 여기서 치릅니다. 서버가 **멱등**하면 앱은 마음 놓고 재시도할 수 있습니다.

### 해시 생성 규칙

```ts
dedupeHash = sha256([
  deviceId,
  packageName,
  body,
  truncateToMinute(receivedAt),   // 초 단위 절삭
].join('|'))
```

`RawMessage.dedupeHash`에 UNIQUE 제약을 걸고, 삽입 시 충돌하면 `duplicates`로 카운트하고 넘어갑니다.

**설계 근거 3가지**

1. **`deviceId` 포함** — 부부가 같은 가족카드를 쓰면 동일한 문구의 알림이 두 폰에 각각 옵니다. 이건 중복이 아니라 서로 다른 사실이므로 구분해야 합니다

2. **초 단위 절삭** — 알림의 `postTime`과 SMS의 수신 시각은 같은 결제라도 몇 초 차이가 납니다. 초까지 넣으면 같은 결제가 중복 적재됩니다

3. **`title` 미포함** — 카드사 앱이 알림 제목만 미묘하게 바꾸는 경우가 있습니다(`"신한카드"` → `"신한카드 승인"`). 본문이 같고 같은 분에 온 같은 기기 메시지라면 같은 사건으로 봅니다

### 이 규칙의 한계

**같은 가맹점에서 같은 금액을 1분 안에 두 번 결제하면 한 건으로 합쳐집니다.** 편의점에서 결제가 잘못돼 다시 긁는 경우가 여기 해당합니다.

빈도가 낮고, 잘못 합쳐졌을 때의 손해(한 건 누락)가 반대 방향의 오류(중복 계상)보다 작다고 판단해 이 트레이드오프를 받아들입니다. Phase 6의 명세서 대사에서 이런 누락이 잡힙니다.

---

## 유효성 검사

`rejected`로 분류하는 조건입니다. 거부된 건은 저장하지 않고 앱에도 성공으로 응답하지 않습니다(재전송해도 계속 거부되므로 앱은 일정 횟수 후 폐기).

| 조건 | 처리 |
|---|---|
| `body`가 비어 있음 | reject |
| `body` 길이 > 4000자 | reject — 알림 본문이 이만큼 길 수 없음 |
| `receivedAt`이 파싱 불가 | reject |
| `receivedAt`이 미래 (허용 오차 5분 초과) | reject — 기기 시계 이상 |
| `receivedAt`이 5년 이전 | reject |
| 배치 크기 > `INGEST_MAX_BATCH_SIZE` | 요청 전체를 413으로 거부 |

미래 시각을 거부하는 이유는, 기기 시계가 틀어진 상태로 올라온 데이터가 실적 사이클 계산을 오염시키기 때문입니다.

---

## 저장 후

수집된 원문은 `parseStatus: PENDING`으로 저장됩니다. **`/api/ingest`는 파싱하지 않습니다.**

```
/api/ingest  →  RawMessage(PENDING)  →  [파싱 워커]  →  Transaction
   빠르게 받고 끝                          별도 단계
```

분리하는 이유:

- 수집 요청은 빨리 끝나야 합니다. 앱이 배터리를 아끼려면 네트워크를 오래 붙잡으면 안 됩니다
- 파싱은 실패할 수 있고 규칙이 바뀔 수 있습니다. 수집의 성공 여부가 파싱에 좌우되면 안 됩니다
- Phase 2에서는 **파서가 아직 없습니다.** 원문만 쌓아두고 Phase 3에서 그 실물을 보고 규칙을 씁니다

Phase 3부터는 저장 직후 파싱 큐에 넣습니다. 가족 규모에서는 별도 큐 인프라 없이 `after-response` 처리나 짧은 주기 폴링으로 충분합니다.

---

## 디바이스 세션 교환

수집과는 별개지만 같은 토큰을 쓰는 흐름입니다. 앱의 WebView가 로그인 화면 없이 바로 대시보드를 열기 위한 것입니다.

```
POST /api/auth/device-session
Authorization: Bearer <deviceToken>

→ 200 { "url": "https://<서버>/?t=<nonce>" }
```

1. 앱이 WebView를 띄우기 직전에 이 API를 호출
2. 서버는 **60초 만료, 1회용** nonce를 발급 (`DEVICE_SESSION_NONCE_TTL`)
3. 앱이 그 URL을 WebView에 로드
4. 서버가 nonce를 소모하고 세션 쿠키를 심은 뒤 대시보드로 리다이렉트

**이 경로로 만들어진 세션은 `Device.memberId`의 role이 ADMIN이어도 무조건 `scope: SELF`입니다.** → [불변 규칙 3](../../AGENTS.md), [07-auth-scope](07-auth-scope.md)

nonce를 짧게 두는 이유: URL은 로그·히스토리·리퍼러에 남기 쉽습니다. 60초 뒤에 유출되어도 쓸모없게 만듭니다.

---

## 관찰 가능성

수집이 조용히 멈추는 것이 이 시스템의 가장 위험한 실패 모드입니다. 알림 권한이 꺼지거나 배터리 최적화에 걸리면 앱은 아무 소리 없이 데이터를 안 보냅니다. 사용자는 "이번 달에 카드를 안 썼나 보다"라고 생각하게 됩니다.

대응:

- 매 요청마다 `Device.lastSeenAt` 갱신
- `DEVICE_SILENCE_WARN_DAYS`(기본 3일) 넘게 조용한 기기를 대시보드에 경고 표시 (Phase 6)
- 앱 설정 탭에 권한 상태 3종(알림 접근 / SMS / 배터리 최적화 예외)을 항상 노출

로그에는 **어떤 로그 레벨에서도 본문을 남기지 않습니다.** `deviceId`, 메시지 개수, 처리 결과만 기록합니다.

> 이 절은 원래 `LOG_LEVEL=debug`일 때는 본문을 남기는 예외를 뒀었습니다. 구현 단계에서
> 그 예외를 넣지 않기로 하고, 설계를 구현에 맞춰 고쳤습니다. 운영에서 실수로 `debug`를
> 켜면 그 순간부터 카드 알림 원문이 로그 파일에 평문으로 쌓이는데, 그 위험을 감수할
> 대가가 없습니다 — 파서 작성에 필요한 원문 열람은 이미 `/raw` 화면이 담당하고 있어서,
> 로그에 또 남길 이유가 없습니다.

---

## 검증 방법

```bash
# 1. 기본 수집
curl -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"source":"NOTIFICATION","packageName":"test.app",
       "title":"테스트카드 승인","body":"홍길동님 12,000원 일시불 08/10 14:23 테스트가맹점",
       "receivedAt":"2026-08-10T14:23:07+09:00"}]}'
# → {"accepted":1,"duplicates":0,"rejected":0}

# 2. 멱등성 — 똑같이 한 번 더
# → {"accepted":0,"duplicates":1,"rejected":0}   ← 중복 행이 생기면 안 됨

# 3. 잘못된 토큰
# → 401

# 4. 미래 시각
# → rejected: 1
```

앱 통합 검증:
- 기내모드에서 결제 발생 → 네트워크 복구 후 자동 업로드되는지
- 앱 강제 종료 후 재부팅 → `BOOT_COMPLETED`로 서비스가 살아나는지
- **카카오톡 일반 대화 수신 → 서버에 아무것도 안 올라가는지** (필수)

---

## 관련 문서

- [08-android-app](08-android-app.md) — 캡처·큐·업로드 구현
- [03-parser](03-parser.md) — 저장된 원문의 처리
- [07-auth-scope](07-auth-scope.md) — 디바이스 토큰과 세션
