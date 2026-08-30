# 08 — 안드로이드 앱

## 역할

이 앱은 **네이티브 Android 수집기 + 서버 대시보드 WebView**입니다. PWA가 아닙니다.

| 한다 | 하지 않는다 |
|---|---|
| 사용자가 등록한 카드 알림·SMS 캡처 | 알림 문구 파싱 |
| 로컬 원문 보존·재시도 업로드 | 거래 집계·실적 계산 |
| 기기 토큰으로 SELF 세션 교환 | 카드사 로그인 |
| WebView로 서버 화면 표시 | 네이티브 대시보드 복제 |
| 수집 대상·권한·대기·격리 관리 | 미등록 알림 후보 저장 |

파서와 UI를 서버에 두면 화면·규칙 변경 때 APK를 다시 배포하지 않아도 됩니다.
→ [ADR 0003](../adr/0003-webview-dashboard.md),
[ADR 0004](../adr/0004-parse-on-server.md)

---

## 구조

```
android/app/src/main/java/com/familycard/collector/
├── capture/
│   ├── CaptureFilter.kt
│   ├── CaptureSource.kt
│   ├── NotificationBodyExtractor.kt
│   ├── CaptureEventId.kt
│   ├── CardNotificationListener.kt
│   ├── SmsReceiver.kt
│   └── BootReceiver.kt
├── queue/
│   ├── PendingMessage.kt
│   ├── QueueDatabase.kt
│   ├── CapturedMessageStore.kt
│   ├── UploadPolicy.kt
│   └── UploadWorker.kt
├── net/
│   ├── IngestClient.kt
│   └── DeviceSessionClient.kt
├── settings/
│   ├── AppSettings.kt
│   ├── CaptureSourceStore.kt
│   └── ServerUrlPolicy.kt
└── ui/
    ├── MainActivity.kt
    ├── dashboard/DashboardScreen.kt
    └── settings/
        ├── SettingsScreen.kt
        ├── CaptureSourcesSection.kt
        └── CaptureAppSelectionPolicy.kt
```

큐는 관계가 단순한 FIFO 두 테이블이라 Room/KSP 대신 `SQLiteOpenHelper`를 씁니다.
마이그레이션은 원문을 지우거나 테이블을 DROP하지 않습니다.

---

## 캡처의 개인정보 경계

`NotificationListenerService`는 폰의 모든 알림을 볼 수 있습니다. 따라서
`CaptureFilter`를 로컬 큐보다 **앞에** 두고, 허용하지 않은 알림은 본문을 꺼내거나
로그에 남기지 않고 즉시 반환합니다.

### 사용자 관리형 fail-closed 허용 목록

```kotlin
data class CaptureSourceConfig(
    val kind: CaptureOriginKind,
    val identifier: String,
    val displayName: String,
)
```

목록은 개발자가 코드에 넣지 않습니다. 각 사용자가 FamilyCard 설정에서 본인이 쓰는
대상만 추가·삭제하고, 해당 폰의 private SharedPreferences에 저장합니다.

- **카드사 앱**: 시스템 앱 선택기에서 고른 뒤 `CARD_APP`으로 등록
- **결제·자산 앱**: 토스·카카오페이·네이버페이 등을 같은 선택기에서
  `PAYMENT_APP`으로 등록
- **카카오 공식 채널**: 알림에 표시되는 채널 제목을 직접 등록
- **SMS 발신자**: 발신번호 또는 영문 발신자 ID와 로컬 표시명을 등록

판정 규칙:

1. 등록된 카드사/결제 앱 패키지는 정확히 일치할 때 허용
2. `com.kakao.talk`은 등록된 채널 제목과 **정확히 일치**할 때만 허용
3. SMS는 등록된 발신자 **그리고** 거래 어휘를 모두 만족할 때만 허용
4. 카카오톡과 기본 SMS 앱은 “앱 전체” 대상으로 등록할 수 없음
5. 카드사명 정규식이나 본문 추정 fallback은 없음

앱 선택에는 Android의 `ACTION_PICK_ACTIVITY` 시스템 UI를 씁니다. FamilyCard가 설치 앱
전체를 조회하지 않으므로 `QUERY_ALL_PACKAGES`를 선언하지 않으며, 선택 결과의 패키지와
표시명만 보관합니다. 앱 하나를 등록하면 그 앱의 모든 알림 본문이 대상이 되므로 확인창에서
범위를 경고하고 공식 금융 앱만 선택하게 합니다.

카드사처럼 보이는 일반 대화방 제목과 개인 문자가 통과하지 못하도록 JVM 테스트로
고정합니다. 목록이 비었거나 저장 JSON이 손상되면 안전하게 아무것도 수집하지 않습니다.
대상을 삭제하면 이후 캡처만 중단하며 이미 보존된 원문은 지우지 않습니다.

### 알림 본문 선택

화이트리스트를 통과한 뒤에만 다음 순서로 가장 완전한 원문을 선택합니다.

1. `Notification.EXTRA_BIG_TEXT`
2. `Notification.EXTRA_TEXT_LINES`를 개행으로 결합
3. `Notification.EXTRA_TEXT`

펼침형 알림의 축약문만 저장해 금액·가맹점 줄을 잃는 문제를 피합니다. 제목은
`CharSequence`로 읽어 구현체 차이도 흡수합니다.

### 캡처 사건 ID

- 알림: notification key + `postTime` + 본문
- SMS: 발신자 + 첫 조각 수신 시각 + 결합 본문

위 입력으로 안정적인 UUID를 만들고 큐에 함께 저장합니다. 같은 OS 사건의 중복 콜백과
네트워크 재전송은 같은 ID를 쓰지만 별도 사건은 새 ID를 받습니다. 카드 앱이 같은 알림
레코드를 새 본문으로 갱신한 경우도 원문 유실을 피하려고 별도 사건으로 보존합니다.
→ [ADR 0006](../adr/0006-client-event-idempotency.md)

### 복수 출처와 `originKind`

`source`는 `NOTIFICATION | SMS`라는 전송 채널이고, `originKind`는 그보다 구체적인
출처입니다.

| `originKind` | 의미 |
|---|---|
| `CARD_APP` | 사용자가 카드사 앱으로 등록한 패키지 |
| `PAYMENT_APP` | 토스·카카오페이·네이버페이 등 결제·자산 앱 |
| `KAKAO_CHANNEL` | 등록한 카카오 공식 채널 제목 |
| `SMS_SENDER` | 등록한 SMS 발신자 |
| `UNKNOWN_APP` | v2 큐 보존 마이그레이션으로 종류를 알 수 없는 기존 앱 |

같은 결제가 카드사 앱과 결제 앱에서 동시에 오면 두 콜백은 서로 다른 사건 ID와
`originKind`로 **모두** 저장합니다. 내용 기반으로 합치거나 우선순위가 낮은 출처를
버리지 않습니다. 실제 문구를 모은 뒤 Phase 3에서 한 거래로 대사하되 모든 원문은
근거로 유지합니다. → [ADR 0007](../adr/0007-user-managed-capture-sources.md)

### SMS

긴 SMS는 발신자별로 묶되, 등록된 발신자인지 먼저 확인한 다음에만 여러 PDU 본문을
원래 순서대로 결합하고 거래 어휘를 검사합니다.
`RECEIVE_SMS`는 런타임에 사용자가 허용하며 `READ_SMS`는 요청하지 않습니다.

---

## 원문 저장과 업로드

`CapturedMessageStore`가 다음 두 동작을 한 경로로 묶습니다.

1. SQLite pending 큐에 `insertOrThrow`
2. 저장 성공 뒤 네트워크 제약 일회성 업로드 예약

저장 실패는 본문 없이 설정 화면에 표시합니다. 예약 실패는 유실이 아니며 15분 주기
작업이 복구합니다.

### 로컬 DB v3

- `pending_message`: 아직 서버 결과가 확정되지 않은 원문
- `rejected_message`: 서버가 명백한 형식 오류로 거부한 원문+사유
- 두 테이블 모두 `client_message_id UNIQUE`, `origin_kind` 보존
- v1 큐 업그레이드는 기존 행마다 UUID를 채우고 원문을 그대로 유지
- v2→v3은 행·테이블을 삭제하지 않고 SMS→`SMS_SENDER`, 카카오톡→`KAKAO_CHANNEL`,
  나머지 알림→`UNKNOWN_APP`으로 보수적으로 채움

### 응답 적용

서버는 모든 항목에 `clientMessageId`와 상태를 돌려줍니다. 앱은 다음을 모두 검증합니다.

- 결과 수와 ID 집합
- 결과 ID 중복 없음
- 요약 건수와 항목별 상태 개수 일치
- 알 수 없는 상태나 음수 건수 없음

검증에 실패하면 어떤 행도 건드리지 않습니다. 검증된 뒤에는:

- `accepted`, `duplicate`: pending 삭제
- `rejected`: rejected 테이블 INSERT 후 pending 삭제

격리와 삭제는 하나의 SQLite 트랜잭션입니다. HTTP 200이나 총합만 보고 배치를 통째로
삭제하지 않습니다.

### 재시도 분류

| 상황 | 처리 |
|---|---|
| 네트워크 예외, 408/425/429/5xx | 큐 유지, WorkManager 재시도 |
| 401/403 | 큐 유지, 토큰 확인 안내 |
| 400/413 | 큐 유지, 앱·서버 계약 업데이트 안내 |
| 응답 형식·ID 불일치 | 큐 유지, 프로토콜 오류 안내 |
| 항목 `rejected` | 원문을 로컬 격리하고 다음 항목 진행 |

한 번에 200건씩 처리하고 꽉 찬 배치 뒤에는 같은 작업에서 다음 배치를 계속 처리합니다.

---

## 서버 주소와 WebView

### 주소 정책

- release: 매니페스트 cleartext 차단 + 사용자정보·쿼리·fragment·하위 경로가 없는 HTTPS origin만 허용
- debug: 전용 manifest에서 로컬 개발 HTTP를 켜되 코드가 `localhost`, `127.0.0.1`, `10.0.2.2`만 허용
- 세션 API가 돌려준 URL은 설정 주소와 scheme·host·effective port가 모두 같아야 함

따라서 HTTP 운영 주소, 다른 포트로의 리다이렉트, 외부 호스트 세션 URL은 거부합니다.

### WebView 경계

- JavaScript·DOM storage 활성화(Next.js UI에 필요)
- 파일·content provider 접근 비활성화
- 같은 origin만 WebView 내부에서 이동
- 외부 링크는 시스템 브라우저
- 메인 프레임 네트워크 오류와 HTTP 4xx/5xx는 안내 화면으로 전환
- 뒤로가기와 재시도 제공
- 설정 버튼은 실제 설정 탭으로 이동

대시보드가 열리지 않아도 수집 큐는 계속 동작합니다. 화면에는 이 둘이 별개임을 안내합니다.
`MainActivity`는 `FLAG_SECURE`를 사용해 대시보드와 토큰이 스크린샷·최근 앱 미리보기에
남지 않게 합니다.

### 디바이스 세션

```
POST /api/auth/device-session
  → 같은 origin의 60초·1회용 URL
  → WebView가 URL 로드
  → 서버가 scope=SELF 쿠키 발급
```

ADMIN 소유 기기라도 DEVICE 진입 세션은 항상 SELF입니다. 서버에서 기기가 폐기되면 이미
발급된 쿠키도 다음 보호 조회부터 무효입니다.

---

## 설정 화면

- 서버 주소와 마스킹된 기기 토큰 입력
- 카드사 앱·결제/자산 앱을 시스템 선택기로 추가하고 분류 변경·삭제
- 카카오 공식 채널 제목과 SMS 발신자를 직접 추가·삭제
- 앱 등록 시 전체 알림 본문 수집 범위, 삭제 시 기존 원문 보존 안내
- 알림 접근 시스템 화면
- 실제 `RECEIVE_SMS` 런타임 권한 요청
- 배터리 최적화 예외 설정 화면
- pending `대기 중` 건수
- rejected `확인 필요` 건수
- 본문 없는 마지막 캡처/전송 상태
- 수동 즉시 전송

설정 화면으로 돌아오면 권한 상태를 다시 읽습니다. QR 스캔은 아직 구현하지 않았으므로
관리자 화면에서 1회 표시된 토큰을 직접 붙여넣습니다.

---

## 생존과 백업

- 앱 시작과 `BOOT_COMPLETED`에서 15분 주기 작업 등록
- 원문 저장 직후 일회성 작업 등록
- WorkManager 네트워크 제약과 지수 백오프 사용
- 앱 자동 백업·기기 이전에서 DB, SharedPreferences, 파일 전부 제외

앱 삭제나 기기 교체 전에 pending 건수가 0인지 확인해야 합니다. 백업 제외는 보안과
중복 방지를 위한 선택이라 미전송 큐를 새 폰으로 복구해주지 않습니다.

---

## 권한과 매니페스트

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.RECEIVE_SMS" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
<uses-feature android:name="android.hardware.telephony" android:required="false" />
```

알림 접근은 런타임 권한이 아니라 사용자가 특수 앱 접근 화면에서 켭니다.
알림 리스너 서비스는 시스템 바인딩 권한으로 보호하고 `exported=false`로 둡니다.
앱 자체 알림을 게시하지 않고 배터리 예외 목록 화면만 열기 때문에 `POST_NOTIFICATIONS`와
직접 예외 요청용 `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`는 선언하지 않습니다.
시스템 앱 선택기를 사용하므로 설치 앱 전체 가시성 권한인 `QUERY_ALL_PACKAGES`도 선언하지
않습니다.

---

## 서명 배포

release APK는 다음 네 환경변수가 모두 있어야 빌드됩니다.

```
KEYSTORE_FILE
KEYSTORE_PASSWORD
KEY_ALIAS
KEY_PASSWORD
```

하나라도 없거나 파일이 없으면 `assembleRelease`가 명확히 실패합니다. CD는 태그 기준
소스를 체크아웃해 서명 APK를 만들고 `apksigner verify`를 통과한 파일만 Release에
첨부합니다. 실제 keystore 생성·암호화 백업·GitHub Secrets 등록은 사람이 해야 합니다.

---

## 검증

자동 검증:

- 빈 목록·손상 설정은 전부 거부
- 등록한 카드사/결제 앱 패키지·카카오 제목·SMS 발신자만 정확히 허용
- 카카오톡·기본 SMS 앱 전체 등록 차단
- 카드사처럼 보이는 일반 대화·개인 SMS 거부
- 동일 본문의 카드사/결제 앱 알림을 서로 다른 출처 원문으로 보존
- 펼침형 알림 본문 우선순위
- 사건 ID 안정성
- 서버 응답 1:1 검증과 거부 격리 계획
- release HTTPS와 WebView 동일 origin 정책
- Android lint, unit test, debug build
- 임시 키를 이용한 signed release 및 APK 서명 확인

배포 전 실기기 필수 검증:

- FamilyCard 설정에서 실제 사용하는 카드사/결제 앱·카카오 채널·SMS 발신자를 등록
- 카카오톡 일반 대화가 로컬·서버 어디에도 남지 않음
- 실제 결제 원문이 `/raw`에 출처 배지와 함께 도착
- 한 결제의 카드사 앱+결제 앱 동시 알림이 둘 다 별도 원문으로 도착
- 기내모드 복구, 재부팅, 서버 중단 안내 화면
- 기기 폐기 후 수집·미소모 nonce·기존 WebView 세션 거부

## 관련 문서

- [02-ingest](02-ingest.md) — 서버 계약과 멱등성
- [07-auth-scope](07-auth-scope.md) — SELF 세션과 폐기
- [관리자 가이드](../guide/admin-guide.md) — 배포·서명·백업
