# 08 — 안드로이드 앱

## 앱의 책임 범위

앱은 **캡처하고 전달하는 파이프**입니다. 그 이상을 하지 않습니다.

| 한다 | 하지 않는다 |
|---|---|
| 카드사 알림·SMS 캡처 | 파싱 |
| 로컬 큐에 저장, 재시도 업로드 | 집계·실적 계산 |
| WebView로 서버 화면 표시 | 네이티브 대시보드 구현 |
| 권한 상태·전송 로그 표시 | 데이터 보관 (큐를 비운 뒤엔 안 갖고 있음) |

이렇게 나눈 이유는 **APK 재배포를 최소화하기 위해서**입니다. 파싱 규칙이나 화면이 앱에 있으면 바뀔 때마다 가족 전원에게 재설치를 부탁해야 합니다. 서버에 있으면 `docker compose up -d` 한 번입니다.

> **APK 재배포가 필요한 경우는 권한·캡처 로직이 바뀔 때뿐입니다.**

→ [ADR 0003](../adr/0003-webview-dashboard.md), [ADR 0004](../adr/0004-parse-on-server.md)

---

## 구조

```
android/app/src/main/java/.../
├── capture/
│   ├── CardNotificationListener.kt   NotificationListenerService
│   ├── SmsReceiver.kt                BroadcastReceiver
│   └── CaptureFilter.kt              ★ 화이트리스트 판정 (가장 중요)
├── queue/
│   ├── PendingMessage.kt             Room 엔티티
│   ├── PendingMessageDao.kt
│   └── UploadWorker.kt               WorkManager
├── net/
│   └── IngestClient.kt               서버 통신
└── ui/
    ├── MainActivity.kt               하단 탭 2개
    ├── dashboard/DashboardScreen.kt  WebView
    └── settings/SettingsScreen.kt    Compose 네이티브
```

---

## 캡처

### 알림 — `NotificationListenerService`

카드사 앱은 결제 알림을 푸시로 보냅니다. `NotificationListenerService`로 이걸 읽습니다.

```kotlin
class CardNotificationListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        // ★ 저장하기 전에 필터링
        if (!CaptureFilter.shouldCapture(sbn)) return

        val extras = sbn.notification.extras
        queue.enqueue(
            PendingMessage(
                source = "NOTIFICATION",
                packageName = sbn.packageName,
                title = extras.getString(Notification.EXTRA_TITLE).orEmpty(),
                body  = extras.getString(Notification.EXTRA_TEXT).orEmpty(),
                receivedAt = sbn.postTime,
            )
        )
    }
}
```

사용자가 **설정 > 알림 접근 허용**에서 직접 켜야 합니다. 앱이 코드로 부여할 수 없으므로, 설정 탭에서 상태를 보여주고 해당 시스템 화면으로 바로 보냅니다.

### SMS — `BroadcastReceiver`

일부 카드사·일부 카드는 여전히 문자로 옵니다.

```kotlin
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Telephony.Sms.Intents.getMessagesFromIntent(intent).forEach { sms ->
            if (!CaptureFilter.shouldCaptureSms(sms.originatingAddress, sms.messageBody)) return@forEach
            queue.enqueue(...)
        }
    }
}
```

`RECEIVE_SMS` 권한이 필요합니다. Play Store 정책상 까다로운 권한이지만, 스토어에 올리지 않고 APK를 직접 설치하므로 문제 되지 않습니다.

---

## 화이트리스트 필터 — 가장 중요한 코드

`NotificationListenerService`는 폰에 오는 **모든 알림**을 봅니다. 카카오톡 개인 대화, 메신저, 이메일, 전부입니다.

카드사 알림톡을 받으려면 `com.kakao.talk`을 화이트리스트에 넣어야 하는데, **여기서 필터가 새면 가족의 사생활이 통째로 서버에 쌓입니다.**

```kotlin
object CaptureFilter {

    private val CARD_APP_PACKAGES = setOf(
        "com.shinhancard.smartshinhan",
        "com.kbcard.cxh.appcard",
        // … 실기기에서 패키지명 확인 후 채움
    )

    private const val KAKAO = "com.kakao.talk"

    // 알림톡 제목이 카드사 발신인지 판정
    private val CARD_SENDER_PATTERN = Regex("(신한|국민|KB|삼성|현대|롯데|하나|BC|비씨|농협|NH)\\s*카드")

    fun shouldCapture(sbn: StatusBarNotification): Boolean = when (sbn.packageName) {
        in CARD_APP_PACKAGES -> true
        KAKAO -> {
            // ★ 카카오톡은 제목이 카드사 패턴일 때만
            val title = sbn.notification.extras.getString(Notification.EXTRA_TITLE).orEmpty()
            CARD_SENDER_PATTERN.containsMatchIn(title)
        }
        else -> false
    }
}
```

### 지켜야 할 것

1. **판정은 Room에 넣기 전에.** 일단 저장하고 나중에 거르는 구조는 금지입니다
2. **걸러진 알림은 메모리에서도 즉시 폐기.** 변수에 담아두거나 로그에 남기지 않습니다
3. **로그에 알림 본문을 찍지 마세요.** 디버깅 중이라도. `logcat`은 다른 앱이 읽을 수 없지만, 버그 리포트에는 딸려 갑니다
4. **카카오톡은 제목 화이트리스트가 아니라 패턴 매칭.** 알림톡 발신 프로필명이 카드사마다 조금씩 다르고 바뀌기도 합니다

→ [불변 규칙 4](../../AGENTS.md)

### 검증

**반드시 확인하세요**: 카카오톡으로 일반 대화를 받고 서버 DB에 아무것도 안 올라오는지. 이게 이 앱에서 가장 중요한 테스트입니다.

---

## 오프라인 큐

집 서버는 밖에서 항상 접근 가능하지 않습니다. Tailscale이 꺼져 있거나, 지하철이거나, 서버가 재부팅 중일 수 있습니다.

**놓친 알림은 영원히 복구할 수 없습니다.** 카드사가 다시 보내주지 않습니다.

```
캡처 → Room 즉시 저장 → WorkManager 업로드 → 서버 확인 후 삭제
                              ↑              │
                              └── 실패 시 재시도 (지수 백오프)
```

Room 저장은 로컬 디스크 쓰기라 거의 실패하지 않습니다. 네트워크는 나중 문제입니다.

### 업로드 정책

| 항목 | 값 |
|---|---|
| 트리거 | 주기 작업(15분) + 네트워크 연결 시 |
| 배치 크기 | 최대 200건 (`INGEST_MAX_BATCH_SIZE`) |
| 재시도 | `BackoffPolicy.EXPONENTIAL`, 초기 30초 |
| 삭제 시점 | **서버 응답 확인 후** |

```kotlin
val response = ingestClient.upload(batch)
// accepted + duplicates + rejected == batch.size 인지 확인
if (response.total() == batch.size) {
    dao.deleteAll(batch.map { it.id })
}
```

HTTP 200만 보고 지우면 안 됩니다. 서버가 일부만 처리했을 수 있습니다.

서버는 멱등하므로(→ [02-ingest](02-ingest.md)) 재전송해도 중복이 쌓이지 않습니다. **중복은 서버가 걸러주지만 유실은 되돌릴 수 없으므로, 앱은 재전송에 적극적입니다.**

---

## 화면

하단 탭 2개면 충분합니다.

### 대시보드 탭 — WebView

서버 UI를 그대로 띄웁니다. 가족 입장에선 앱 화면이지만, 실제로는 서버가 그린 것이라 **UI를 고쳐도 APK를 다시 깔 필요가 없습니다.**

```kotlin
webView.settings.apply {
    javaScriptEnabled = true
    domStorageEnabled = true

    // 보안
    allowFileAccess = false
    allowContentAccess = false
}
```

**진입 흐름** (로그인 화면을 안 보여주기 위해):

```
1. POST /api/auth/device-session  (Authorization: Bearer <deviceToken>)
2. 응답의 일회용 URL 을 WebView 에 로드
3. 서버가 nonce 소모 → scope=SELF 세션 쿠키 → 대시보드
```

→ [07-auth-scope](07-auth-scope.md)

**구현 항목**

| 항목 | 처리 |
|---|---|
| 뒤로가기 키 | `canGoBack()`이면 `goBack()`, 아니면 앱 종료 |
| 새로고침 | `SwipeRefreshLayout` — 당겨서 새로고침 |
| **연결 실패** | 전용 안내 화면 + 재시도 버튼 (아래) |
| 외부 링크 | 서버 호스트가 아니면 **시스템 브라우저로**. WebView 안에서 열지 않음 |

### 연결 실패 화면 — 빈 흰 화면 금지

집 서버 특성상 **연결 실패가 자주 일어납니다.** Tailscale이 꺼져 있는 경우가 대부분입니다. 이때 WebView가 빈 흰 화면을 보여주면 사용자는 앱이 고장 났다고 생각합니다.

```
┌────────────────────────────────┐
│                                │
│         📡                     │
│  집 서버에 연결할 수 없습니다    │
│                                │
│  · Tailscale 이 켜져 있나요?    │
│  · 집 서버가 켜져 있나요?        │
│                                │
│        [ 다시 시도 ]            │
│        [ 설정 열기 ]            │
└────────────────────────────────┘
```

`onReceivedError` / `onReceivedHttpError`에서 이 화면으로 전환합니다.

**중요**: 이 상태에서도 **백그라운드 캡처는 계속 동작합니다.** 화면이 안 보이는 것과 데이터 수집이 멈추는 것은 별개입니다. 안내 문구에 "결제 내역은 계속 저장되고 있습니다"를 넣어 안심시킵니다.

### 설정 탭 — Compose 네이티브

WebView로 할 수 없는 것만 여기 둡니다.

```
┌────────────────────────────────┐
│ 서버 연결                       │
│   주소  https://familycard...  │
│   토큰  ●●●●●●●●  [QR 스캔]     │
│                                │
│ 권한 상태                       │
│   알림 접근        ✅  [설정]    │
│   문자 수신        ✅  [설정]    │
│   배터리 최적화 예외 ⚠️  [설정]   │
│                                │
│ 수집 상태                       │
│   마지막 전송   2분 전           │
│   대기 중       0건             │
│   [ 지금 전송 ]                 │
│                                │
│ 최근 전송 로그                   │
│   14:23  1건 전송 성공          │
│   14:08  1건 전송 성공          │
└────────────────────────────────┘
```

**권한 상태 3종을 항상 노출하는 이유**: 이 앱의 가장 위험한 실패 모드는 조용히 멈추는 것입니다. 알림 권한이 꺼지거나 배터리 최적화에 걸리면 아무 소리 없이 데이터가 안 올라갑니다. 사용자는 "이번 달엔 카드를 안 썼나 보다"라고 생각하게 됩니다.

전송 로그에도 **본문을 표시하지 않습니다.** 건수와 시각만.

---

## 서비스 생존

안드로이드는 백그라운드 서비스를 적극적으로 죽입니다. 대응:

| 항목 | 처리 |
|---|---|
| 재부팅 | `BOOT_COMPLETED` 리시버로 서비스 재시작 |
| 배터리 최적화 | `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` 다이얼로그 안내 |
| 제조사 최적화 | 삼성·샤오미 등은 자체 최적화가 더 공격적. 가이드 문서에 기종별 안내 |
| 서비스 종료 감지 | `onListenerDisconnected()`에서 재연결 시도 |

제조사별 설정은 코드로 해결할 수 없어서 [user-guide.md](../guide/user-guide.md)에 안내합니다.

---

## 권한

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.RECEIVE_SMS" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
<!-- 알림 접근은 권한이 아니라 시스템 설정에서 사용자가 직접 허용 -->
```

`READ_SMS`는 요청하지 않습니다. 수신 알림만 필요하고 과거 문자를 읽을 이유가 없습니다.

---

## 배포

Play Store에 올리지 않습니다. `RECEIVE_SMS`가 정책상 까다롭고, 가족용이라 필요도 없습니다.

**서명된 APK를 직접 설치**합니다.

```bash
cd android
./gradlew assembleRelease
# app/build/outputs/apk/release/app-release.apk
```

CD 워크플로우가 태그 push 시 자동으로 빌드해 **GitHub Release에 첨부**하므로, 가족은 릴리스 페이지 링크로 받으면 됩니다.

### keystore 백업 (중요)

**서명 키를 잃어버리면 덮어쓰기 업데이트가 불가능합니다.** 가족 전원이 앱을 지우고 다시 깔아야 하고, 그러면 큐에 남아 있던 미전송 데이터도 사라집니다.

최초 생성 시 안전한 곳에 백업하세요. → [admin-guide.md](../guide/admin-guide.md)

업데이트 시 `versionCode`를 올리면 덮어쓰기 설치됩니다.

---

## 테스트

### 유닛 테스트

```
✅ CaptureFilter — 카드사 패키지 → true
✅ CaptureFilter — 카카오톡 + 카드사 제목 → true
✅ CaptureFilter — 카카오톡 + 일반 대화 제목 → false ★
✅ CaptureFilter — 그 외 패키지 → false
✅ 업로드 응답 개수 불일치 → 큐 유지
✅ 업로드 성공 → 큐에서 삭제
```

### 실기기 검증

```
✅ 실제 결제 → 앱 대시보드에 원문 표시
✅ 기내모드 결제 → 복구 후 자동 업로드
✅ 재부팅 후 → 서비스 자동 시작
✅ 앱 진입 시 로그인 화면 없이 본인 데이터
✅ 서버 내린 상태 → 흰 화면 아닌 안내 화면
✅ 카카오톡 일반 대화 → 서버에 아무것도 안 올라감 ★★
```

★★ 표시는 개인정보 유출 방지 검증입니다. 앱을 배포하기 전에 반드시 통과해야 합니다.

---

## 관련 문서

- [02-ingest](02-ingest.md) — 서버 수집 엔드포인트
- [07-auth-scope](07-auth-scope.md) — 디바이스 토큰과 세션 교환
- [../guide/user-guide.md](../guide/user-guide.md) — 가족용 설치 안내
