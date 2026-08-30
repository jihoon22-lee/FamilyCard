# Android 사용자 관리형 수집 대상과 복수 출처 원문 구분

- 일자: 2026-08-30
- 브랜치: `feat/android-capture-source-management`
- 범위: Phase 2 수집 파이프라인
- 상태: 코드·자동 검증 완료, 실기기 canary 대기

## 개요

FamilyCard의 수집 허용 목록을 개발자 하드코딩 방식에서 **각 사용자가 자기 Android 앱
안에서 관리하는 방식**으로 바꿨습니다. 카드사 앱뿐 아니라 토스·카카오페이·네이버페이
같은 결제·자산 앱을 시스템 선택기로 등록할 수 있고, 카카오 공식 채널 제목과 SMS
발신자도 추가·삭제할 수 있습니다.

한 결제가 카드사 앱과 결제 앱에서 동시에 통지되는 경우에는 어느 한쪽을 수집 단계에서
버리지 않습니다. 모든 `RawMessage`에 세부 출처인 `originKind`를 붙여 각각 보존하고,
실제 원문이 축적된 뒤 Phase 3에서 의미 거래 한 건으로 대사하도록 설계 게이트를
추가했습니다.

## 배경과 문제

이전 구현은 `VerifiedCaptureAllowlist`의 세 집합이 코드에 비어 있었습니다.

```kotlin
CaptureAllowlist(
    cardAppPackages = emptySet(),
    kakaoChannelTitles = emptySet(),
    cardSmsSenders = emptySet(),
)
```

개인정보 측면에서는 안전했지만 실제 사용자가 추가될 때마다 개발자가 패키지·채널·발신자를
조사하고 APK를 다시 배포해야 했습니다. USB/ADB는 개발 진단 도구일 뿐 가족 온보딩
인터페이스가 될 수 없습니다. 또한 `source=NOTIFICATION`만으로는 카드사 앱과 토스 알림을
구분할 수 없어 향후 중복 집계 방지 근거가 부족했습니다.

## 최종 흐름

```text
사용자 설정
  ├─ 카드사 앱 선택 ──────────────── CARD_APP
  ├─ 결제·자산 앱 선택 ───────────── PAYMENT_APP
  ├─ 카카오 공식 채널 제목 입력 ──── KAKAO_CHANNEL
  └─ SMS 발신자 입력 ─────────────── SMS_SENDER
              │
              ▼
       private 로컬 설정
              │
      exact match, fail-closed
              │
              ▼
  SQLite pending(origin_kind 포함)
              │
              ▼
  POST /api/ingest → RawMessage(originKind, PENDING)
              │
              ▼
  /raw 출처 배지·필터 → Phase 3 교차 출처 대사
```

## 구현 내용

### 1. 출처 모델과 로컬 저장소

`CaptureOriginKind`와 `CaptureSourceConfig`를 추가했습니다.

```kotlin
enum class CaptureOriginKind(val wireValue: String) {
    CARD_APP("CARD_APP"),
    PAYMENT_APP("PAYMENT_APP"),
    KAKAO_CHANNEL("KAKAO_CHANNEL"),
    SMS_SENDER("SMS_SENDER"),
    UNKNOWN_APP("UNKNOWN_APP"),
}

data class CaptureSourceConfig(
    val kind: CaptureOriginKind,
    val identifier: String,
    val displayName: String,
)
```

- 패키지·채널·SMS 발신자·표시명 길이와 제어문자를 검사합니다.
- 숫자/영문 SMS 발신자 ID는 같은 규칙으로 정규화합니다.
- 앱은 패키지 기준으로 유일해 카드사 앱↔결제 앱 재분류 시 기존 분류를 교체합니다.
- JSON에 알 수 없는 종류나 손상 값이 있으면 해당 항목을 무시합니다.
- 전체 JSON을 읽지 못하면 빈 목록으로 처리해 수집 범위를 넓히지 않습니다.
- `SharedPreferences.commit()`을 사용해 UI의 저장 성공과 필터 반영 시점을 일치시켰습니다.
- 로컬 표시명은 서버로 보내지 않습니다.

### 2. 설정 UI

설정 탭에 다음 기능을 추가했습니다.

- 카드사 앱 추가
- 결제·자산 앱 추가
- 카카오 공식 채널 추가
- SMS 발신자와 선택 표시명 추가
- 종류별 등록 목록과 삭제 확인
- 앱 전체 알림 본문 수집 범위 경고
- 삭제가 과거 원문을 지우지 않는다는 안내

앱은 `ACTION_PICK_ACTIVITY`에 launcher intent를 넣어 Android 시스템 선택기를 엽니다.
FamilyCard가 설치 앱 전체 목록을 직접 조회하지 않으므로 `QUERY_ALL_PACKAGES` 권한은
추가하지 않았습니다. 선택한 component의 패키지와 표시명만 사용합니다.

다음 패키지는 앱 전체 출처로 막습니다.

- FamilyCard 자체
- `com.kakao.talk` — exact 공식 채널 제목 경로만 허용
- 현재 기본 SMS 앱 — exact SMS 발신자 경로만 허용

기본 SMS 앱은 등록 시뿐 아니라 알림 수신 시점에도 다시 차단합니다. 등록 후 기본 앱이
바뀌는 경우에도 개인 문자 알림이 광범위하게 수집되지 않게 하기 위해서입니다.

### 3. 본문보다 앞선 필터

일반 알림은 다음 순서를 따릅니다.

1. 사용자 설정 로드
2. 미등록 일반 앱과 현재 기본 SMS 앱을 package 단계에서 반환
3. 카카오만 필터에 필요한 제목을 읽어 exact 채널 비교
4. 허용된 뒤에만 BIG_TEXT/TEXT_LINES/TEXT 본문 추출
5. 큐 저장

SMS는 `SmsMessage`를 발신자별로 묶은 뒤 **발신자 설정을 먼저 검사**하고, 허용된 그룹만
분할 본문을 결합합니다. 그다음 승인·취소·결제 등 거래 어휘를 확인합니다.

### 4. Android 큐 v3

`PendingMessage`와 pending/rejected SQLite 테이블에 `origin_kind`를 추가했습니다.

- 새 DB: `origin_kind TEXT NOT NULL`
- v2→v3: `ALTER TABLE ... ADD COLUMN` 후 모든 기존 행 backfill
- SMS → `SMS_SENDER`
- 카카오톡 → `KAKAO_CHANNEL`
- 그 밖의 기존 앱 알림 → 추측하지 않고 `UNKNOWN_APP`
- v1→v3 직접 업그레이드도 기존 원문과 사건 ID를 보존
- pending/rejected 테이블을 migration에서 DROP하지 않음

서버 거부로 rejected 격리할 때도 `origin_kind`가 같이 이동합니다.

### 5. ingest 계약과 Prisma

Android 요청에 `originKind`가 포함됩니다.

```json
{
  "clientMessageId": "11111111-1111-4111-8111-111111111111",
  "source": "NOTIFICATION",
  "originKind": "PAYMENT_APP",
  "packageName": "com.example.testpay",
  "title": "테스트페이 결제",
  "body": "가공된 테스트 원문",
  "receivedAt": "2026-08-10T14:23:07+09:00"
}
```

서버는 다음을 검사합니다.

- 허용된 origin enum인지
- `SMS`는 `SMS_SENDER`와만 조합되는지
- `NOTIFICATION`은 앱/카카오/기존 앱 종류와 조합되는지
- `KAKAO_CHANNEL`이면 package가 `com.kakao.talk`이고 제목이 비어 있지 않은지
- 카카오톡 package가 다른 앱 종류로 위장하지 않는지

Prisma에는 미래 수동/명세서 경로까지 포함한 `CaptureOriginKind` enum과
`RawMessage.originKind`를 추가했습니다. migration은 기존 서버 원문을 삭제하지 않고
SMS·카카오·수동·명세서는 확정 가능한 종류로, 나머지 앱은 `UNKNOWN_APP`으로 채웁니다.

로컬 개발 DB에서 기존 가공 원문 5건이 migration 전후 동일하고 5건 모두 새 필드가
채워진 것을 확인했습니다.

### 6. `/raw` 출처 분석

원문 카드에 다음 세부 출처 배지를 표시합니다.

- 카드사 앱
- 결제·자산 앱
- 카카오 공식 채널
- SMS 발신자
- 기존 앱(미분류)

출처 종류와 패키지명 필터를 함께 제공해 같은 결제의 복수 앱 원문과 출처별 문구를
분리해 볼 수 있습니다. 조회는 기존처럼 반드시 `visibleMemberIds(session)`를 경유합니다.

### 7. 복수 출처와 의미 중복

수집 재전송 중복과 같은 결제의 교차 출처 알림을 구분했습니다.

- 같은 `clientMessageId` 재전송: 서버 `duplicate`, 새 RawMessage 없음
- 카드사 앱과 결제 앱의 별도 OS 사건: ID와 origin이 다르므로 둘 다 `accepted`

이번 Phase에서 내용 기반 의미 중복 제거는 구현하지 않았습니다. 실제 문구 없이 금액·시각
추정으로 합치면 같은 금액을 연달아 결제한 정상 두 사건을 잃을 수 있기 때문입니다.

현재 `Transaction.rawMessageId` 1:1 모델은 복수 출처 거래에 충분하지 않습니다. Phase 3
시작 전에 실제 원문을 보고 연결 테이블 또는 canonical/duplicate 관계를 결정해야 합니다.
자동 대사가 애매하면 합치지 않고 사람 확인 대상으로 보내며, 어떤 관계를 택해도 모든
`RawMessage`는 영구 보존해야 합니다.

## 보안 검토

- 미등록 알림 본문을 후보 용도로도 저장하지 않습니다.
- 손상·빈 설정은 전부 거부합니다.
- 카카오톡과 문자 앱 전체 등록을 UI와 런타임 양쪽에서 제한합니다.
- 등록 금융 앱 전체 알림이 대상이라는 남는 위험을 등록 확인창에 노출합니다.
- 카카오 제목 충돌과 SMS 발신자 위조 가능성을 문서에 명시했습니다.
- 설정·큐는 Android 자동 백업 대상이 아닙니다.
- 실제 거래 원문, 카드번호, 가맹점은 코드·테스트·문서에 넣지 않았습니다.
- 기존 서버/폰 원문을 삭제하는 migration이나 코드 경로를 추가하지 않았습니다.

## 검증

### Android

- `./gradlew testDebugUnitTest` — 36 tests 통과
- `./gradlew lintDebug` — 통과
- `./gradlew assembleDebug` — 통과
- `./gradlew processReleaseManifest` — 통과

추가 테스트 범위:

- 빈 목록 fail-closed
- 카드사 앱과 결제 앱 종류 구분
- exact 카카오 채널과 일반 대화 trap
- 잘못 저장된 카카오 앱 전체 설정 무시
- 기본 SMS 앱 런타임 차단
- SMS 발신자 정규화와 거래 어휘
- 손상 JSON·UNKNOWN_APP 설정 거부
- 앱 패키지 재분류 시 마지막 분류 유지
- ingest JSON originKind 전송

### Web/DB

- `corepack pnpm format:check`
- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test` — 16 files, 140 tests 통과
- `corepack pnpm build`
- Prisma generate/validate/migrate deploy/status/schema diff
- migration 뒤 기존 RawMessage 건수 보존 확인

추가 테스트 범위:

- source/origin 조합과 카카오 식별자 거부
- originKind 저장
- 같은 본문의 CARD_APP/PAYMENT_APP 두 사건 모두 accepted
- `/raw` originKind 매핑·필터
- 기존 scope 필터 유지

### 실기기에서 남은 검증

- 시스템 앱 선택기에서 실제 카드사/결제 앱 추가와 재분류
- 카카오 공식 채널·SMS 발신자 추가/삭제
- 일반 카카오 대화·개인 SMS canary
- 한 결제의 카드사 앱+결제 앱 동시 원문 2건 도착
- 수집 대상 삭제 뒤 새 알림만 중단
- SQLite v2→v3 pending/rejected 보존
- 기내모드·재부팅·서버 장애·기기 폐기

## 변경 파일

### Android

- `android/app/src/main/java/com/familycard/collector/capture/CaptureSource.kt` (신규)
- `android/app/src/main/java/com/familycard/collector/capture/CaptureFilter.kt`
- `android/app/src/main/java/com/familycard/collector/capture/CardNotificationListener.kt`
- `android/app/src/main/java/com/familycard/collector/capture/SmsReceiver.kt`
- `android/app/src/main/java/com/familycard/collector/settings/CaptureSourceStore.kt` (신규)
- `android/app/src/main/java/com/familycard/collector/ui/settings/CaptureSourcesSection.kt` (신규)
- `android/app/src/main/java/com/familycard/collector/ui/settings/CaptureAppSelectionPolicy.kt` (신규)
- `android/app/src/main/java/com/familycard/collector/ui/settings/SettingsScreen.kt`
- `android/app/src/main/java/com/familycard/collector/queue/PendingMessage.kt`
- `android/app/src/main/java/com/familycard/collector/queue/QueueDatabase.kt`
- `android/app/src/main/java/com/familycard/collector/net/IngestClient.kt`
- `android/app/src/test/java/com/familycard/collector/capture/CaptureFilterTest.kt`
- `android/app/src/test/java/com/familycard/collector/settings/CaptureSourceCodecTest.kt` (신규)
- `android/app/src/test/java/com/familycard/collector/ui/settings/CaptureAppSelectionPolicyTest.kt` (신규)
- `android/app/src/test/java/com/familycard/collector/net/IngestClientTest.kt`
- `android/app/src/test/java/com/familycard/collector/queue/UploadPolicyTest.kt`

### Web/DB

- `web/prisma/schema.prisma`
- `web/prisma/migrations/20260830120000_capture_origin_kind/migration.sql` (신규)
- `web/src/lib/ingest/validate.ts`
- `web/src/lib/ingest/validate.test.ts`
- `web/src/lib/ingest/ingest.ts`
- `web/src/lib/ingest/ingest.test.ts`
- `web/src/app/api/ingest/route.test.ts`
- `web/src/app/(app)/raw/query.ts`
- `web/src/app/(app)/raw/query.test.ts`
- `web/src/app/(app)/raw/page.tsx`

### 설계·가이드·프로세스

- `AGENTS.md`
- `CHANGELOG.md`
- `README.md`
- `docs/HANDOFF.md`
- `docs/adr/0001-collection-method.md`
- `docs/adr/0007-user-managed-capture-sources.md` (신규)
- `docs/design/01-data-model.md`
- `docs/design/02-ingest.md`
- `docs/design/03-parser.md`
- `docs/design/08-android-app.md`
- `docs/guide/admin-guide.md`
- `docs/guide/onboarding.md`
- `docs/guide/user-guide.md`
- `docs/plan/phase-2.md`
- `docs/plan/phase-3.md`
- `docs/plan/phase2-contract.md`
- `workthrough/2026-08-30-android-capture-source-management.md` (신규)

## 다음 단계

1. 별도 브랜치를 push하고 PR을 생성합니다.
2. PR의 docs/web/android/`ci-ok`가 모두 통과한 뒤 GitHub에서 병합합니다.
3. debug APK를 USB 없이 폰으로 전달해 설치합니다.
4. 앱 안에서 실제 수집 대상을 등록하고 개인정보 canary를 먼저 수행합니다.
5. 실제 소액 결제·복수 앱 동시 알림·오프라인 복구를 확인합니다.
6. 가족별 원문을 며칠간 모은 뒤에만 Phase 3 대사 스키마와 파서를 구현합니다.
