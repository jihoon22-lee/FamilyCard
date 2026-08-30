# HANDOFF — 세션 인수인계

> 작업 전 [AGENTS.md](../AGENTS.md)와 이 문서를 읽고, 작업 단위를 마칠 때 갱신합니다.

**최종 갱신**: 2026-08-30 · 사용자 관리형 수집 대상과 복수 출처 원문 구분 구현
**작업 위치**: `/home/jihoon/projects/FamilyCard` (WSL ext4)
**작업 방식**: `feat/android-capture-source-management` → PR → CI → `main`

## 한 줄 상태

Phase 2 코드에는 이제 사용자가 FamilyCard 안에서 카드사/결제 앱·카카오 공식 채널·SMS
발신자를 직접 추가·삭제하는 흐름과 `RawMessage.originKind`가 있습니다. USB/ADB나
개발자 하드코딩은 사용자 온보딩에 필요하지 않습니다. 자동 검증은 완료했지만 실제 폰의
개인정보 canary·결제 원문 수집·서명 배포가 남아 Phase 2와 `v0.2.0`은 미완료입니다.
**실제 원문 며칠치 전에는 Phase 3 파서를 시작하지 마세요.**

| Phase | 상태 |
|---|---|
| 0 문서·CI/CD | ✅ 완료 |
| 1 스캐폴딩·인증 | ✅ `v0.1.0` |
| **2 수집 파이프라인** | 🟡 코드·자동 검증 완료 / 실기기·서명·원문 수집 대기 |
| 3 파서·카드 매칭 | ⛔ 실제 원문과 복수 출처 대사 설계 전 시작 금지 |
| 4~7 | ⬜ |

이 앱은 PWA가 아니라 **네이티브 Android 수집기 + Next.js WebView 대시보드**입니다.

---

## 이번 작업에서 구현·확정한 것

### 사용자별 수집 대상

- 각 폰의 설정 화면에 **수집 대상** 섹션 추가
- 카드사 앱과 결제·자산 앱은 Android 시스템 앱 선택기로 추가
  - FamilyCard는 설치 앱 전체 목록을 직접 조회하지 않음
  - `QUERY_ALL_PACKAGES` 권한 없음
  - 사용자가 `CARD_APP` 또는 `PAYMENT_APP`으로 분류
  - 같은 패키지를 다시 추가하면 새 종류로 재분류
- 카카오 공식 채널 제목과 SMS 발신번호/발신자 ID는 앱 안에서 직접 추가
- 각 대상을 삭제할 수 있으며 삭제는 **이후 캡처만** 중단
- 설정은 앱 private SharedPreferences에만 저장되고 Android 자동 백업 대상이 아님
- 목록이 비었거나 JSON이 손상되면 아무것도 수집하지 않는 fail-closed 동작

구현 파일:

- `android/app/src/main/java/com/familycard/collector/capture/CaptureSource.kt`
- `android/app/src/main/java/com/familycard/collector/settings/CaptureSourceStore.kt`
- `android/app/src/main/java/com/familycard/collector/ui/settings/CaptureSourcesSection.kt`
- `android/app/src/main/java/com/familycard/collector/ui/settings/CaptureAppSelectionPolicy.kt`

### 개인정보 캡처 경계

- 미등록 일반 앱은 notification extras·제목·본문에 접근하기 전에 즉시 반환
- 등록 카드사/결제 앱은 exact 패키지 일치
- `com.kakao.talk`은 앱 전체 등록을 막고 exact 채널 제목 일치만 허용
- 기본 SMS 앱은 앱 전체 등록을 막고 exact 발신자만 허용
- SMS는 발신자 판정 뒤에만 분할 PDU 본문을 결합하고 거래 어휘를 검사
- 카카오톡 일반 대화와 미등록 SMS를 거부하는 JVM 테스트 유지·확장
- 앱 등록 확인창에 “이 앱의 모든 알림 본문이 대상”임을 명시

잔여 한계: Android가 카카오 공식 채널 인증값을 제공하지 않아 일반 대화방 이름을 공식
채널과 똑같이 만들면 제목만으로 구분할 수 없습니다. UI 경고와 실기기 canary가 필수입니다.

### 복수 출처 원문

- `source`(`NOTIFICATION | SMS`)와 별개로 `originKind` 추가
  - `CARD_APP`, `PAYMENT_APP`, `KAKAO_CHANNEL`, `SMS_SENDER`
  - `UNKNOWN_APP`은 Android v2 큐와 기존 서버 원문 보존 마이그레이션용
  - 서버 스키마에는 미래 입력용 `MANUAL_ENTRY`, `STATEMENT_UPLOAD`도 포함
- Android SQLite v3이 pending/rejected 양쪽에 `origin_kind`를 보존
- v1→v2→v3 업그레이드는 큐 행이나 테이블을 삭제하지 않음
- Prisma migration `20260830120000_capture_origin_kind`는 기존 `RawMessage`를 모두 유지하고
  확실한 범위에서만 출처를 backfill
- ingest API가 source/origin 조합과 카카오 패키지·제목을 검사
- `/raw`가 출처 배지를 표시하고 출처 종류/패키지 필터를 제공

같은 결제가 카드사 앱과 토스 등에서 동시에 오면 수집 단계에서는 두 원문을 모두
`accepted`합니다. 둘은 서로 다른 사건이며 네트워크 재전송 `duplicate`가 아닙니다.

### Phase 3 대사 게이트

현재 `Transaction.rawMessageId`는 Phase 1의 원문 1건↔거래 1건 모델입니다. 이를 복수
출처 원문에 그대로 적용하면 사용금액이 두 번 잡힙니다. 실제 원문을 모은 뒤 파서를 쓰기
전에 다음을 해야 합니다.

1. `docs/plan/phase-3.md`의 **복수 출처 대사** 체크리스트 수행
2. 복수 `RawMessage`를 거래 하나의 근거로 연결할 스키마 결정·migration
3. 같은 구성원·카드·금액·거래종류·승인시각·가맹점 기반의 보수적 대사
4. 애매한 후보는 임의 병합하지 않고 사람 확인 대상으로 표시
5. 원문은 모두 유지하면서 집계에는 의미 거래가 정확히 한 번만 기여하도록 테스트

결정 근거: [ADR 0007](adr/0007-user-managed-capture-sources.md). 실제 문구 없는 추측
정규식이나 의미 중복 로직은 아직 구현하지 않았습니다.

### 개발 워크플로우

- `AGENTS.md`에 `main` 직접 push 금지 추가
- 모든 변경은 기능 브랜치 → PR → 필수 CI 통과 → GitHub PR 병합
- 긴급 수정도 같은 절차이며 CI 우회 금지

---

## 검증 결과

### Web

- `corepack pnpm format:check` ✅
- `corepack pnpm lint` ✅
- `corepack pnpm typecheck` ✅
- `corepack pnpm test` ✅ — 16 files, **140 tests**
- `corepack pnpm build` ✅
- Prisma generate/validate/migrate deploy/status/schema diff ✅
- 로컬 DB migration 4개 적용 ✅
- 기존 가공 `RawMessage` 5건이 migration 전후 그대로이고 `originKind` 5건 모두 채워짐 ✅

### Android

- `./gradlew testDebugUnitTest` ✅ — **36 tests**
- `./gradlew lintDebug` ✅
- `./gradlew assembleDebug` ✅
- `./gradlew processReleaseManifest` ✅

실제 앱 선택기, 알림 리스너, SMS 수신, SQLite v2→v3 업그레이드는 코드·빌드 검증까지이며
물리 기기 검증이 남았습니다. 자동 테스트에는 가공 데이터만 사용했습니다.

### 저장 데이터

로컬 개발 DB에는 이전 통합 검증의 가공 `RawMessage` **5건**, `Transaction` 0건이 있습니다.
이번 migration은 5건을 모두 보존했습니다. 불변 규칙 1에 따라 삭제하지 마세요.

---

## 지금 바로 할 일 — USB 없이 실제 폰

상세 체크리스트는 [Phase 2 계획](plan/phase-2.md)과
[카드 알림 설정 가이드](guide/onboarding.md)가 기준입니다.

### 1. tailnet 전용 HTTPS 준비

```bash
sudo tailscale serve --bg localhost:3000
tailscale serve status
```

- Funnel 사용 금지: 인터넷 전체에 공개됩니다.
- 이미 443에 Funnel/Serve 설정이 있으면 기존 서비스를 임의로 바꾸지 말고 충돌을 확인합니다.
- `.env`의 `APP_URL`과 앱 서버 주소는 같은 `https://...ts.net` origin이어야 합니다.

### 2. 디버그 APK를 폰으로 전달해 설치

```bash
cd /home/jihoon/projects/FamilyCard/android
./gradlew assembleDebug
```

생성 파일:
`android/app/build/outputs/apk/debug/app-debug.apk`

USB는 필요 없습니다. 본인만 접근 가능한 전송 수단(Tailscale Taildrop 등)으로 APK를 폰에
보내고 파일을 눌러 설치합니다. 동일 개발 PC의 debug 서명으로 빌드해야 이후 덮어쓰기가
가능합니다. 앱 삭제 전에는 pending/rejected 건수를 확인하세요.

### 3. 서버와 수집 대상 설정

1. 관리자가 `/family/devices`에서 해당 구성원의 기기 토큰을 발급
2. 폰의 FamilyCard 설정에서 HTTPS 서버 주소와 토큰 저장
3. **카드사 앱 추가**로 실제 카드사 공식 앱 선택
4. 토스·카카오페이·네이버페이 등을 쓴다면 **결제·자산 앱 추가**로 각각 선택
5. 카카오 알림톡을 쓴다면 실제 알림의 공식 채널 제목 등록
6. SMS를 쓴다면 발신번호/발신자 ID 등록 후 문자 수신 권한 허용
7. 알림 접근과 배터리 최적화 예외 허용

구성원마다 본인이 쓰는 대상만 반복합니다. 새 구성원을 위해 APK 코드나 서버 목록을
수정하지 않습니다.

### 4. 개인정보 canary — 실제 결제 전 필수

다음을 받은 뒤 앱 pending/rejected와 서버 `/raw`가 증가하지 않는지 확인합니다.

- 평범한 카카오 개인·단체 대화
- 등록 공식 채널과 비슷하지만 정확히 같지 않은 일반 대화방
- “카드”, “승인”, “결제”가 포함된 미등록 발신자의 개인 SMS
- 미등록 일반 앱 알림

하나라도 저장되면 가족 배포를 중단합니다. 이미 서버에 들어간 `RawMessage`는 임의로
삭제하지 말고 사용자와 처리 방침을 결정합니다.

### 5. 실제 수집 시나리오

- 실제 소액 결제 → `/raw`에 올바른 출처 배지와 즉시 도착
- 카드사 앱+결제 앱 동시 알림 → `/raw`에 출처가 다른 원문 두 건
- 수집 대상 삭제 → 이후 알림만 중단, 기존 원문 유지
- 기내모드 결제 → 연결 복구 뒤 자동 업로드
- 재부팅 뒤 캡처·전송
- 서버 중단 → pending 유지와 안내 화면
- 구버전 앱 데이터가 있다면 v2→v3 업데이트 뒤 pending/rejected 건수와 전송 보존
- 기기 폐기 → 수집·새 nonce·기존 WebView 세션 모두 거부

Phase 2에서는 파서가 없으므로 거래 대시보드가 아니라 **`/raw`가 성공 기준**입니다.

### 6. 서명·가족 배포·며칠간 수집

- 운영 `familycard.jks` 생성 및 암호화 이중 백업
- GitHub Secrets: `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`
- 개인정보 canary 전에는 `v0.2.0` 태그 금지
- 가족 전원 설치 후 카드사별·출처별 승인/취소/할부/해외/마스킹 원문을 며칠간 축적
- 실제 내용은 DB와 접근 제어된 `/raw` 안에서만 보고 Git·이슈·메신저에 복사하지 않음

---

## 아직 하지 말 것

- 실제 카드 원문을 fixture·문서·이슈·로그에 복사
- 카카오톡 또는 문자 앱 전체를 우회 등록
- 본문을 먼저 저장한 뒤 나중에 필터링
- 복수 출처 중 하나를 수집 단계에서 우선순위로 폐기
- 실제 원문 며칠치 전 Phase 3 정규식·의미 중복 규칙 작성
- Funnel이나 공유기 포트포워딩으로 FamilyCard 공개
- 실제 키와 실기기 canary 없이 `v0.2.0` 태그
- `RawMessage` 삭제
- `main` 직접 push

---

## 환경과 문서 지도

| 항목 | 값 |
|---|---|
| Node | 24 (`.nvmrc`) |
| pnpm | 9.15.9, `corepack pnpm` 사용 |
| JDK | 21 |
| Android SDK | `~/android-sdk` |
| PostgreSQL | Docker 17-alpine, 로컬 포트 5433 |
| 저장소 | 공개 상태 — 실제 금융 데이터 커밋 절대 금지 |

`web/.env`는 루트 `.env`를 가리키는 심볼릭 링크입니다. 별도 파일로 덮어쓰지 않습니다.
개발 DB 시드는 운영에 적용하지 않습니다.

- [Phase 2 체크리스트](plan/phase-2.md)
- [수집 계약](plan/phase2-contract.md)
- [수집 설계](design/02-ingest.md)
- [Android 설계](design/08-android-app.md)
- [사용자 관리 출처 ADR](adr/0007-user-managed-capture-sources.md)
- [사용자 가이드](guide/user-guide.md)
- [관리자 가이드](guide/admin-guide.md)
- [이번 작업 워크스루](../workthrough/2026-08-30-android-capture-source-management.md)
