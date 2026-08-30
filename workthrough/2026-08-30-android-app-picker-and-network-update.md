# Android 검색·다중 앱 선택과 tailnet APK 업데이트 전달

- 일자: 2026-08-30
- 브랜치: `feat/android-app-multi-picker`
- 범위: Phase 2 실기기 온보딩·배포 편의
- 상태: 구현·로컬 자동 검증·개발 서버 APK 게시 완료, 실기기 확인 대기

## 개요

카드사/결제 앱이 많이 설치된 폰에서도 수집 대상을 쉽게 구성하도록 기존 Android 단일 앱
선택기를 검색·추천·다중 선택 화면으로 교체했습니다. 국내 주요 공식 카드·결제 앱은 현재
Google Play 패키지를 조사해 위에 표시하되, 추천 목록과 실제 수집 화이트리스트를 분리해
사용자가 최종 확인하기 전에는 어떤 앱도 자동 등록하지 않습니다.

네이티브 변경 때마다 APK를 PC에서 폰으로 옮기던 흐름도 바꿨습니다. FamilyCard 서버가
`/downloads/familycard.apk`에서 최신 APK를 제공하고, 새 앱은 설정의 버튼으로 브라우저
다운로드를 시작합니다. Android의 마지막 설치 확인과 같은 서명키 검증은 그대로 둡니다.

## 문제와 요구사항

기존 `ACTION_PICK_ACTIVITY` 흐름에는 다음 문제가 있었습니다.

- 한 번에 앱 하나만 선택할 수 있어 카드사·결제 앱 수만큼 화면을 다시 열어야 함
- 기기 시스템 선택기에 검색이 없으면 긴 설치 앱 목록을 매번 스크롤해야 함
- 공식 앱 이름과 카드사명이 다른 경우 검색 단서가 없음
- 새 APK마다 별도 전송 수단으로 PC→폰 파일 이동이 필요함

동시에 다음 개인정보·배포 경계는 유지해야 했습니다.

- 미등록 앱 알림은 본문 추출이나 로컬 저장 전에 폐기
- 설치 앱 전체 권한인 `QUERY_ALL_PACKAGES`는 사용하지 않음
- 공식 앱 목록만으로 자동 수집 대상을 만들지 않음
- 카카오톡과 기본 SMS 앱 전체 등록 차단
- 기존 앱의 로컬 큐·수집 설정을 지우지 않는 덮어쓰기 설치
- APK와 실제 금융 데이터를 Git에 넣지 않음

## 최종 흐름

```text
카드사 앱 추가 / 결제·자산 앱 추가
              │
              ▼
 MAIN + LAUNCHER 실행 가능 앱만 메모리 조회
              │
              ▼
  공식 추천 → 이름 추천 → 그 외 앱
       검색 + 체크박스 다중 선택
              │
              ▼
       모든 알림 수집 범위 확인
              │
              ▼
 SharedPreferences 한 번의 commit
              │
              ▼
 기존 exact allowlist 필터가 다음 알림부터 적용
```

```text
Gradle/CD가 서명 APK 생성
          ├─ GitHub Release
          └─ web/public/downloads/familycard.apk
                              │
                     NAS web 이미지 pull
                              │
                              ▼
앱 설정 "최신 APK 받기" → 외부 브라우저 → Android 설치 확인
```

## 구현 내용

### 1. 최소 패키지 가시성

매니페스트에 `MAIN` + `LAUNCHER` intent query만 선언했습니다. `PackageManager` 조회도 같은
intent를 사용해 홈 화면에서 실행 가능한 앱만 반환합니다. 전체 결과는 선택기 상태에만 두고
SharedPreferences·서버·로그에 저장하지 않습니다.

FamilyCard 자체, `com.kakao.talk`, 현재 기본 SMS 앱은 표시 전에 제거합니다. 기존
`CaptureAppSelectionPolicy`도 그대로 유지해 UI 우회나 향후 호출 경로에서도 다시 거부합니다.

### 2. 공식 추천 카탈로그와 검색

2026-08-30 현재 Google Play 등록을 기준으로 주요 카드사 9개와 결제·자산 앱 9개 패키지를
확인했습니다. 카탈로그에는 패키지, 대상 종류, 표시 우선순위, 검색 별칭만 있습니다.

정렬 규칙은 다음과 같습니다.

1. 사용자가 연 카드사/결제 종류에 맞는 공식 카탈로그 앱
2. 실제 표시명에 카드·Card·페이·Pay·월렛·Wallet이 들어간 앱
3. 나머지 앱을 한글 표시명과 패키지 순으로 정렬

검색은 설치된 표시명과 패키지뿐 아니라 `삼성카드 → 모니모` 같은 카탈로그 별칭도 봅니다.
카탈로그에 없는 앱은 제거하지 않으므로 새로운 카드·결제 앱도 일반 검색으로 선택할 수
있습니다.

조사 출처와 유지 규칙은
`docs/research/android-finance-app-catalog.md`에 별도로 기록했습니다.

### 3. 다중 선택과 원자적 저장

전체 화면 Compose dialog에 검색창, 추천 그룹 header, 체크박스 목록과 선택 건수를
추가했습니다.

- 같은 종류로 이미 등록된 앱은 체크·비활성 표시
- 다른 종류로 등록된 앱은 선택 시 재분류됨을 표시
- 선택 결과를 앱 이름·패키지와 함께 한 번 더 확인
- 최대 8개 이름을 확인창에 보여주고 더 많으면 나머지 건수 표시
- `CaptureSourceStore.addAll()`이 모든 항목을 먼저 정규화한 뒤 한 번만 commit
- 하나라도 잘못된 항목이면 부분 저장 없이 전체 거부

카카오 공식 채널과 SMS 발신자의 기존 추가·삭제 흐름은 변경하지 않았습니다.

### 4. 서버 기반 APK 다운로드

Android 설정에 현재 `versionName`·`versionCode`와 **최신 APK 받기** 버튼을 추가했습니다.
서버 주소는 기존 `ServerUrlPolicy`로 다시 검증하고 다음 고정 경로에 버전·캐시 방지 쿼리를
붙입니다.

```text
<same-origin>/downloads/familycard.apk?installed=<code>&request=<timestamp>
```

외부 브라우저는 앱 WebView의 DEVICE 쿠키를 공유하지 않습니다. 따라서 미들웨어는
`/downloads/familycard.apk` exact path 한 개만 세션 없이 통과시키고, 비슷한 파일명이나
다른 다운로드 경로는 계속 로그인으로 보냅니다. APK에는 금융 데이터가 없고 서버 자체는
tailnet 안에서만 접근할 수 있습니다.

앱이 파일을 직접 설치하지 않으므로 `REQUEST_INSTALL_PACKAGES`를 추가하지 않았습니다.
다운로드 뒤 사용자가 Android 설치 확인을 누르며, 기존 앱 위 업데이트는 동일 서명키로 다시
검증됩니다.

### 5. 개발·릴리스 게시

로컬 개발은 다음 명령 하나로 debug 빌드와 정적 경로 복사를 수행합니다.

```bash
cd android
./gradlew publishDebugApk
```

생성된 `web/public/downloads/familycard.apk`는 중첩 `.gitignore`와 저장소의 `*.apk` 규칙으로
추적하지 않습니다.

태그 CD는 Android signed artifact를 먼저 만들고, 성공하면 같은 파일을 다음 두 곳에
사용합니다.

- GitHub Release 첨부 파일
- web Docker build context의 `public/downloads/familycard.apk`

프로덕션 이미지에서 APK SHA-256이 로컬 게시 파일과 같은 것도 컨테이너 내부에서
확인했습니다.

## 보안·개인정보 검토

- 공식 카탈로그는 추천 신호일 뿐 자동 allowlist가 아닙니다.
- 선택기 전체 설치 앱 목록을 저장·전송·로그 출력하지 않습니다.
- launcher intent 가시성만 선언하고 `QUERY_ALL_PACKAGES`를 요청하지 않습니다.
- 카카오톡과 기본 SMS 앱 전체 등록 차단을 유지합니다.
- APK 공개 예외는 정확한 파일 한 개이며 다른 보호 페이지/API에는 영향을 주지 않습니다.
- URL에 세션·기기 토큰을 넣지 않습니다.
- 앱 업데이트 설치 권한을 추가하지 않고 Android의 사용자 확인을 유지합니다.
- APK는 서명과 versionCode를 검증하며 signing key 백업 요구를 문서화했습니다.
- 실제 카드 원문·카드번호·거래·토큰을 코드, 테스트, 문서에 넣지 않았습니다.

## 검증

### Android

- `./gradlew testDebugUnitTest lintDebug --no-daemon` — 45 tests, lint 통과
- `./gradlew publishDebugApk --no-daemon` — debug APK 빌드·게시 통과
- `aapt2 dump badging` — package `com.familycard.collector`, versionCode 3 확인
- `apksigner verify --verbose --print-certs` — APK v2 서명 검증 통과

추가 테스트 범위:

- 공식 앱·키워드·일반 앱 추천 순서
- 공식 별칭, 표시명, 패키지의 대소문자 무관 검색
- 런처 Activity 중복 패키지 제거
- 여러 앱 저장과 기존 앱 재분류
- 잘못된 일괄 항목의 전체 거부
- APK URL의 HTTPS·debug localhost 정책과 캐시 방지 값

`./gradlew ktlintCheck`는 저장소에 ktlint plugin/task가 없어 실행되지 않았습니다. CI가
사용하는 Android lint와 Kotlin 컴파일은 통과했으며 AGENTS.md의 명령과 빌드 설정 불일치는
후속 정리 대상으로 남겼습니다.

### Web·배포

- `corepack pnpm format:check` — 통과
- `corepack pnpm typecheck` — 통과
- `corepack pnpm lint` — 통과
- `corepack pnpm test` — 16 files, 142 tests 통과
- `corepack pnpm build` — 통과
- `actionlint` — CI/CD workflow 문법 통과
- 개발 서버와 tailnet HTTPS 경로 — 인증 없는 `200`, Android APK MIME, 10,618,200 bytes
- tailnet 전체 다운로드 SHA-256 — 로컬 파일과 일치
- `docker build --target prod` — 통과
- 프로덕션 이미지 `/app/public/downloads/familycard.apk` — 로컬과 같은 SHA-256

추가 route guard 테스트는 정확한 APK 경로만 세션 없이 허용하고
`familycard.apk.bak`·`other.apk`는 계속 차단함을 고정합니다.

## 변경 파일

### Android

- `android/app/build.gradle.kts`
- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/java/com/familycard/collector/settings/AppUpdateDownloadPolicy.kt` (신규)
- `android/app/src/main/java/com/familycard/collector/settings/CaptureSourceStore.kt`
- `android/app/src/main/java/com/familycard/collector/ui/settings/CaptureAppCatalog.kt` (신규)
- `android/app/src/main/java/com/familycard/collector/ui/settings/CaptureAppPickerDialog.kt` (신규)
- `android/app/src/main/java/com/familycard/collector/ui/settings/InstalledCaptureAppLoader.kt` (신규)
- `android/app/src/main/java/com/familycard/collector/ui/settings/CaptureAppSelectionPolicy.kt`
- `android/app/src/main/java/com/familycard/collector/ui/settings/CaptureSourcesSection.kt`
- `android/app/src/main/java/com/familycard/collector/ui/settings/SettingsScreen.kt`
- `android/app/src/test/java/com/familycard/collector/settings/AppUpdateDownloadPolicyTest.kt` (신규)
- `android/app/src/test/java/com/familycard/collector/settings/CaptureSourceCodecTest.kt`
- `android/app/src/test/java/com/familycard/collector/ui/settings/CaptureAppPickerPolicyTest.kt` (신규)

### Web·CI

- `web/src/lib/auth/route-guard.ts`
- `web/src/lib/auth/route-guard.test.ts`
- `web/.dockerignore`
- `web/public/downloads/.gitignore` (신규)
- `.github/workflows/cd.yml`

### 문서

- `README.md`
- `CHANGELOG.md`
- `docs/HANDOFF.md`
- `docs/adr/0007-user-managed-capture-sources.md`
- `docs/adr/0008-searchable-multi-app-picker.md` (신규)
- `docs/adr/0009-tailnet-apk-update-delivery.md` (신규)
- `docs/design/07-auth-scope.md`
- `docs/design/08-android-app.md`
- `docs/guide/admin-guide.md`
- `docs/guide/onboarding.md`
- `docs/guide/user-guide.md`
- `docs/plan/phase-2.md`
- `docs/research/android-finance-app-catalog.md` (신규)

## 남은 실기기 확인

1. 현재 설치 앱을 versionCode 3으로 덮어쓰기하고 기존 서버·토큰·수집 설정 보존 확인
2. 앱 설정에서 검색, 공식 별칭, 다중 체크, 기존 앱 재분류와 삭제 확인
3. 일반 카카오 대화·개인 SMS·미등록 앱 알림 개인정보 canary
4. 실제 소액 결제와 카드사 앱+결제 앱 동시 알림의 `/raw` 출처별 도착 확인
5. 앱의 **최신 APK 받기** 버튼으로 동일 파일을 다시 열 수 있는지 확인
6. 운영 keystore 이중 백업·GitHub signing secrets·서명 release 덮어쓰기 검증

실제 원문이 며칠치 쌓이고 위 canary가 통과하기 전에는 Phase 3 파서를 시작하지 않습니다.
