# 08 — 안드로이드 앱

## 역할

이 앱은 **네이티브 Android 수집기 + 서버 대시보드 WebView**입니다. PWA가 아닙니다.

| 한다 | 하지 않는다 |
|---|---|
| 검증된 카드 알림·SMS 캡처 | 알림 문구 파싱 |
| 로컬 원문 보존·재시도 업로드 | 거래 집계·실적 계산 |
| 기기 토큰으로 SELF 세션 교환 | 카드사 로그인 |
| WebView로 서버 화면 표시 | 네이티브 대시보드 복제 |
| 권한·대기·격리 상태 표시 | 다른 앱 알림 임시 저장 |

파서와 UI를 서버에 두면 화면·규칙 변경 때 APK를 다시 배포하지 않아도 됩니다.
→ [ADR 0003](../adr/0003-webview-dashboard.md),
[ADR 0004](../adr/0004-parse-on-server.md)

---

## 구조

```
android/app/src/main/java/com/familycard/collector/
├── capture/
│   ├── CaptureFilter.kt
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
│   └── ServerUrlPolicy.kt
└── ui/
    ├── MainActivity.kt
    ├── dashboard/DashboardScreen.kt
    └── settings/SettingsScreen.kt
```

큐는 관계가 단순한 FIFO 두 테이블이라 Room/KSP 대신 `SQLiteOpenHelper`를 씁니다.
마이그레이션은 원문을 지우거나 테이블을 DROP하지 않습니다.

---

## 캡처의 개인정보 경계

`NotificationListenerService`는 폰의 모든 알림을 볼 수 있습니다. 따라서
`CaptureFilter`를 로컬 큐보다 **앞에** 두고, 허용하지 않은 알림은 본문을 꺼내거나
로그에 남기지 않고 즉시 반환합니다.

### fail-closed 허용 목록

```kotlin
data class CaptureAllowlist(
    val cardAppPackages: Set<String>,
    val kakaoChannelTitles: Set<String>,
    val cardSmsSenders: Set<String>,
)
```

운영 기본 목록은 모두 비어 있습니다. 다음 값을 실기기에서 직접 확인한 뒤 정확히
일치하는 문자열만 넣습니다.

- 카드사 앱 패키지명
- 카카오 알림톡 채널의 실제 알림 제목
- 하이픈을 제거한 SMS 발신번호

판정 규칙:

1. 확인된 카드 앱 패키지는 허용
2. `com.kakao.talk`은 확인된 채널 제목과 **정확히 일치**할 때만 허용
3. SMS는 확인된 발신번호 **그리고** 거래 어휘를 모두 만족할 때만 허용
4. 카드사명 정규식이나 본문 추정 fallback은 없음

카드사처럼 보이는 일반 대화방 제목과 개인 문자도 통과하지 못하도록 JVM 테스트로
고정합니다. 목록이 비어 있는 빌드는 안전하게 아무것도 수집하지 않습니다.

> 허용 목록에 새 값을 넣을 때는 실제 원문을 커밋하지 말고 패키지·채널·발신번호만
> 검토합니다. 테스트 본문은 가공 샘플을 씁니다.

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

### SMS

긴 SMS의 여러 PDU는 발신자별로 원래 순서대로 결합한 후 필터링합니다.
`RECEIVE_SMS`는 런타임에 사용자가 허용하며 `READ_SMS`는 요청하지 않습니다.

---

## 원문 저장과 업로드

`CapturedMessageStore`가 다음 두 동작을 한 경로로 묶습니다.

1. SQLite pending 큐에 `insertOrThrow`
2. 저장 성공 뒤 네트워크 제약 일회성 업로드 예약

저장 실패는 본문 없이 설정 화면에 표시합니다. 예약 실패는 유실이 아니며 15분 주기
작업이 복구합니다.

### 로컬 DB v2

- `pending_message`: 아직 서버 결과가 확정되지 않은 원문
- `rejected_message`: 서버가 명백한 형식 오류로 거부한 원문+사유
- 두 테이블 모두 `client_message_id UNIQUE`
- v1 큐 업그레이드는 기존 행마다 UUID를 채우고 원문을 그대로 유지

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

- 운영 기본 허용 목록은 전부 거부
- 정확한 패키지·카카오 제목·SMS 발신번호만 허용
- 카드사처럼 보이는 일반 대화·개인 SMS 거부
- 펼침형 알림 본문 우선순위
- 사건 ID 안정성
- 서버 응답 1:1 검증과 거부 격리 계획
- release HTTPS와 WebView 동일 origin 정책
- Android lint, unit test, debug build
- 임시 키를 이용한 signed release 및 APK 서명 확인

배포 전 실기기 필수 검증:

- 실제 허용 목록 값을 adb와 실제 알림에서 확인
- 카카오톡 일반 대화가 로컬·서버 어디에도 남지 않음
- 실제 결제 원문이 `/raw`에 도착
- 기내모드 복구, 재부팅, 서버 중단 안내 화면
- 기기 폐기 후 수집·미소모 nonce·기존 WebView 세션 거부

## 관련 문서

- [02-ingest](02-ingest.md) — 서버 계약과 멱등성
- [07-auth-scope](07-auth-scope.md) — SELF 세션과 폐기
- [관리자 가이드](../guide/admin-guide.md) — 배포·서명·백업
