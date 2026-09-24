# HANDOFF — 세션 인수인계

> 작업 전 [AGENTS.md](../AGENTS.md)와 이 문서를 읽고, 작업 단위를 마칠 때 갱신합니다.

**최종 갱신**: 2026-09-24 · 전송 정체 진단과 수동 재시도 보완
**작업 위치**: `/home/jihoon/projects/FamilyCard` (WSL ext4)
**작업 방식**: `fix/upload-retry-status` → PR → CI → `main`

## 최신 작업 — 전송 정체 진단

사용자가 v5로 RCS를 가져온 뒤에도 원문 목록 첫 날짜가 오래됐고, 지금 전송에서 서버
오류가 보인다고 보고했습니다. 목록은 `receivedAt desc`이며 운영 DB 원문 451건은 모두
NOTIFICATION입니다. 최신 원문과 기기의 ingest 마지막 인증 시각이 과거에 멈춰 있어
정렬 문제가 아니라 전송 완료가 안 된 상태입니다. 원문을 출력하지 않고 집계만 확인했습니다.

- 당일 DEVICE nonce 발급/소모 성공 확인: 대시보드 진입의 서버 주소·토큰은 정상.
- tailnet health 200, 무인증 ingest 401, 가공 1KB/512KB/3MB 무인증 요청 모두 401.
  최근 서버 로그에서 ingest 성공/서버 예외 흔적 없음. **실제 폰 업로드 실패 원인은 아직
  확정되지 않았고 HTTP 번호/최신 작업 상태 확인이 필요합니다.**
- `queue/UploadWorker.kt`: 수동 **지금 전송**은 기존 즉시 업로드 작업 체인을 REPLACE해
  백오프/의존 작업 뒤로 쌓이지 않도록 함. 수동 작업은 네트워크 제약 없이 실제 연결을
  시도하며 자동 작업은 CONNECTED 제약 유지. SQLite 원문과 15분 주기 작업은 보존.
  예약 완료를 비동기로 확인하고 작업 ID·실제 요청 시도 시각·배치 진행 상태를 기록.
- `queue/UploadDiagnostics.kt`: HTTP 번호와 DNS/timeout/TLS/connect 종류만 표시.
  예외의 원문/주소/토큰 문자열은 노출하지 않음.
- `net/IngestClient.kt`: 자동 리디렉션을 따르지 않아 토큰/원문이 다른 주소로 넘어가지
  않고 실제 이동 응답을 진단하도록 함.
- `ui/settings/CollectionStatusSection.kt`: 화면이 보일 때만 건수·상태를 자동 갱신하고
  예약 작업 실행/대기/실패 상태, 시도/응답 반영 시각 표시. 읽기 실패를 0건으로 숨기지 않음.
- Android 75 tests, lintDebug, assembleDebug 통과. 실제 HTTP 리디렉션 비추종과
  오류 문구의 민감정보 비노출을 가공 데이터로 검증.
- APK versionCode 6을 기존 tailnet 다운로드에 게시. 기존 서명 인증서 일치, 서버 healthy,
  health/APK 200과 다운로드 SHA-256 일치 확인. 실제 폰의 업로드 복구는 사용자 확인 대기.

다음 작업: v6에서 **지금 전송** → 표시된 HTTP 오류 번호 또는 연결 오류 종류와 대기 건수
확인 → 그 원인에 맞춰 수정. 운영 DB에 SMS/RCS 원문이 도착하기 전 Phase 3을 시작하지 않음.

## 최신 작업 — 삼성 RCS 취소 원문 누락

사용자가 APK v4 업데이트와 가져오기 실행을 알렸지만 특정 취소 메시지가 빠졌습니다.
상세정보의 종류 ‘대화’와 리치 카드 형태를 확인해 RCS 경로 누락으로 분류했습니다.
취소/부분취소 어휘는 기존 CaptureFilter에서 이미 허용합니다. 실제 이미지·금융 값은
Git이나 테스트에 복사하지 않았습니다.

- `history/SamsungRcsReader.kt`, `RcsHistoryImport.kt`: 삼성 시스템 provider 호환 조회,
  본문 전 발신자/수신 종류/기간 판정, JSON 원형 보존, SMS와 분리한 멱등 ID.
- `SmsHistoryWorker.kt`, `SmsHistorySection.kt`: SMS/RCS별 결과 건수와 미지원/크기 제외 안내.
  **사용자가 다시 가져오기를 실행할 때만** RCS를 읽습니다. 실시간 RCS 수집은 아직 없음.
- 서버에 `MessageSource.RCS` 추가. `SMS_SENDER`는 등록된 문자 발신자 분류를 공용으로 사용.
  RCS 64,000자 상한과 Android 업로드 크기 분할, 원문 목록 RCS 배지 추가.
- APK versionCode 5. 운영 enum migration 전후 기존 RawMessage 전체 행·ID 보존 확인,
  서버 반영/healthy와 tailnet APK 200·SHA-256 일치·기존 서명 인증서 일치 확인 완료.
- 운영 보존 백업: Git에서 제외된 `data/backups/before-rcs-20260924.dump` (private).
  복원 검증 DB `familycard_rcs_verify_20260924`는 운영과 분리하며 실제 데이터가 있으므로
  테스트 seed/reset에 사용하거나 덤프를 Git으로 옮기지 않습니다.
- 검증: Web 150 tests/typecheck/lint/format, Android 72 tests/lint/debug build 통과.
  격리 복원 DB migration 적용 전후 RawMessage 전체 행·ID 체크섬 동일, schema diff 없음.
  standalone HTTP + 격리 DB에서 4,000자를 넘는 가공 RCS JSON 신규/재전송 및
  본문/출처 일치 확인. 해당 검증 DB에는 별도 가공 원문 1건과 폐기한 테스트 기기가 추가됨.
- [ADR 0011](adr/0011-samsung-rcs-history.md)에 비표준 API 근거/제한과 결정 기록.

다음 확인: v5 덮어쓰기 설치 → **과거 문자 가져오기** 재실행 → RCS 저장 건수/지원 상태와
`/raw` 출처 확인. 사용자 폰에 직접 접근할 수 없어 실제 provider 호환은 아직 미검증입니다.
진단 시 운영 DB의 SMS 원문은 0건이었으므로 사용자의 v4 가져오기 결과·마지막 전송 문구도
확인 대기 중입니다. 파서와 금액 집계는 구현하지 않았습니다.

## 이번 세션 — 과거 SMS 가져오기

사용자가 SMS 발신자와 카카오 채널을 새로 등록한 뒤 과거 SMS 가져오기를 요청했습니다.
카카오 과거 대화는 범위 밖이며, 파서 구현은 아직 시작하지 않습니다.

- `android/app/src/main/java/com/familycard/collector/history/`: 사용자 실행 WorkManager,
  기간 고정, 실행 시/현재 허용 목록 교집합, 본문 별도 조회, DATE_SENT 기반 기존 SMS ID.
- `android/app/src/main/java/com/familycard/collector/ui/settings/SmsHistorySection.kt`:
  30/90/365일(기본 90일), READ_SMS 요청, 진행/결과 건수, 중지·권한 실패 안내.
- 발신 시각이 없는 항목은 임의의 시각으로 새 ID를 만들지 않고 제외 건수로 표시합니다.
- 기존 큐/서버 스키마·원문은 변경하지 않으며 APK는 versionCode 4, 같은 debug 서명입니다.
- 설계·제한·검증 근거는 [ADR 0010](adr/0010-sms-history-import.md).
- Android 59 tests(기존 45 + 가져오기 14), lintDebug, assembleDebug 통과.
  versionCode 4와 READ_SMS manifest, 기존 배포 APK와 같은 서명 인증서를 확인.
  실제 폰 권한/가져오기는 아직 미확인이며, APK 게시 경로는 기존 tailnet 다운로드를 사용.

다음 실기기 작업: 기존 앱 위에 APK 업데이트 → **과거 문자 가져오기** 실행·권한 허용 →
`/raw`의 SMS 출처 확인 → 같은 범위를 다시 가져와 서버 원문 건수가 늘지 않는지 확인.
제조사 문자 앱의 DATE_SENT/발신자/본문 보존과 실제 권한 허용은 폰에서 확인해야 합니다.
이 세션에서 사용자 폰의 과거 문자를 직접 읽거나 가져오기를 대신 실행한 것은 아닙니다.

## 이번 세션 — 수집 이후 진입 검토와 메모리

- 사용자가 한 달 이상 수집했음을 알림. 운영 DB 읽기 전용 집계에서 원문 451건 확인
  (CARD_APP 191, PAYMENT_APP 249, KAKAO_CHANNEL 11; 전부 PENDING).
  수신일이 있는 날짜는 14일, 기기 1대. 모든 가족/유형의 커버리지 충족을 뜻하지 않음.
  원문 내용·금융 정답값은 출력하거나 Git에 옮기지 않음.
- `familycard-web` 약 4.95GiB, DB 약 20MiB. 실행 명령은 `pnpm dev`.
  원문 본문 전체 크기보다 실행 프로세스가 훨씬 큼. 개발 서버 장기 실행이 원인 후보이며,
  장기간 증가 원인을 heap profile로 확정한 것은 아님.
- 기본 Compose를 기존 Dockerfile `prod` standalone으로 전환하고 Docker 개발 모드를
  `docker-compose.dev.yml`로 분리. DB 서비스·볼륨·마이그레이션은 변경하지 않음.
- 별도 코드 결함: `web/src/lib/db.ts` Proxy가 운영 모드에서 클라이언트를 캐시하지 않아
  속성 접근마다 연결 풀을 생성함. 모든 모드에서 프로세스 수명 동안 재사용하도록 수정.
  기존 실행은 개발 모드이므로 이 결함을 기존 4.95GiB의 직접 원인으로 단정하지 않음.
- Web 146 tests, typecheck/lint/format, Docker 운영 이미지 빌드 통과.
  별도 후보 서버에서 health/login/APK 200, 가상 SELF 세션 `/raw` 30회 200,
  무인증 ingest 401 확인. 후보 서버 메모리 약 107MiB (장기 측정 아님).
  운영 모드의 Secure 쿠키 이름 변경으로 웹 재로그인/앱 대시보드 재진입이 필요할 수 있음.
- 로컬 수집 web을 standalone으로 교체. healthy, 전환 직후 약 52MiB,
  원문 451건 보존과 tailnet health/login/APK 200 확인.
  Alpine wget의 localhost IPv6 연결 실패가 있어 두 Compose healthcheck를
  서버가 바인딩한 IPv4 `127.0.0.1`로 맞춤.
- PR CI에서 기존 경로 감지 job의 `pull-requests: read` 누락을 발견해 해당 job에만
  권한 추가. 감지 실패로 검증이 생략되면 `ci-ok`도 실패하도록 수정.
- Phase 2 전체 완료/태그와 Phase 3 파서 구현은 아직 진행하지 않음.

### 다음 할 일과 미확인 사항

1. `docs/plan/post-collection-execution.md` Gate C0: 폰 pending/rejected, 개인정보 canary,
   오프라인·재부팅 복구의 사용자 확인. 수집 기간만으로 통과 처리하지 않음.
2. 접근 제어된 `/raw`에서 승인·취소·할부·해외·복수 출처 양성/음성 반례 검토.
   `docs/plan/phase-3.md` P3-A 전에 가공 구조 픽스처와 정답 관계 검토 방식 확정.
3. `docs/plan/phase-2.md`의 운영 서명·백업/격리 복원 게이트 마감.
4. 서버 메모리는 운영 전환 직후뿐 아니라 다음 날과 수일 뒤에도 비교.

아래는 이전 세션 상세 기록이며 최초 원문 건수·다음 할 일은 위 최신 상태를 우선합니다.

## 한 줄 상태

Phase 2 코드에는 사용자가 카드사/결제 앱을 검색해 여러 개 등록하고, 카카오 공식 채널·SMS
발신자를 직접 관리하는 흐름이 있습니다. USB/ADB나 개발자 하드코딩은 사용자 온보딩에
필요하지 않습니다. APK도 tailnet FamilyCard 서버에서 받을 수 있습니다. 첫 실기기에서
발견된 `localhost` 대시보드 리디렉션은 canonical `APP_URL` 기준으로 수정했고, 앱 대시보드에서
서버에 전송된 본인 원문을 바로 볼 수 있고 사용자가 실기기 WebView 정상 진입을 확인했습니다.
첫 실기기 원문 1건은 ingest 200·accepted로 보존됐습니다. 이후 작업은
[수집 이후 통합 실행 계획](plan/post-collection-execution.md)의 Gate C0와 P3-A~H 순서를
따릅니다. 개인정보 canary·문구/출처 커버리지·운영 서명 배포가 남아 Phase 2와 `v0.2.0`은
미완료입니다. Windows 로그온 시 WSL을 시작하는 기존 복구 체인에는 FamilyCard를
`--no-recreate`로 기동하고 health를 기다리는 단계가 설치됐으며, 다음 자연스러운 cold
start에서 전체 경로 확인만 남았습니다.
**실제 원문 며칠치 전에는 Phase 3 파서를 시작하지 마세요.**

| Phase | 상태 |
|---|---|
| 0 문서·CI/CD | ✅ 완료 |
| 1 스캐폴딩·인증 | ✅ `v0.1.0` |
| **2 수집 파이프라인** | 🟡 첫 실기기 ingest·WebView 성공 / Gate C0 수집·서명 대기 |
| 3 파서·카드 매칭 | ⛔ 실제 원문과 복수 출처 대사 설계 전 시작 금지 |
| 4~7 | ⬜ |

이 앱은 PWA가 아니라 **네이티브 Android 수집기 + Next.js WebView 대시보드**입니다.

---

## 이번 작업에서 구현·확정한 것

### 수집 이후 통합 실행 계획

- “며칠 수집” 대신 개인정보 canary·복구·문구/출처 커버리지로 Phase 3 진입을 판정하는
  [Gate C0](plan/post-collection-execution.md#gate-c0--충분히-수집됐다의-판정-기준) 정의
- 사용 중인 카드, 카드사×출처 승인, 복수 출처 양성 묶음, 별도 연속 결제 음성 반례,
  취소·할부·해외 등 필수/해당 시 최소 표본 정의
- 실제 원문과 금융 정답값은 DB·`/raw` 안에만 두고, Git에는 완전히 가공한 구조 픽스처만
  넣는 분석 절차 정의
- Phase 3을 원문 인벤토리/ADR → 보존형 schema → 순수 파서 → 카드 매칭 → 복수 출처 대사
  → 취소 → 미확정·재파싱 → 월간 화면 순으로 분할
- 자동 처리율 95% 이상과 별개로 알려진 오병합·오카드 매칭 허용치 0건, 재파싱 2회 멱등,
  RawMessage ID 집합 보존을 Phase 3 완료 게이트로 명시
- Phase 4~7의 진입·완료 기준과 기능 브랜치/PR 권장 분할 정의

세부 구현은 아직 시작하지 않습니다. Gate C0 전에는 실제 원문 인벤토리와 파서 정규식을
추측으로 만들지 않습니다.

### 실기기 대시보드와 수집 원문 확인

- 증상: 앱 대시보드 진입 시 시스템 브라우저가 열리고 `https://localhost:3000` 연결 실패
- 원인: nonce를 소비한 GET이 `request.url`로 `/` 리디렉션을 만들었고, Tailscale Serve가
  전달한 내부 Host가 공개 origin 대신 사용됨
- 수정: POST 세션 URL과 같은 canonical `APP_URL`을 GET 최종 리디렉션에도 사용
- 회귀 테스트가 내부 요청 URL `https://localhost:3000`과 공개 `APP_URL`이 다른 조건을 고정
- 대시보드에 서버 보관 원문 건수와 **수집 원문 보기**(`/raw`) 버튼 추가
- 건수 조회도 `visibleMemberIds(session)`를 경유하며 DEVICE 세션에서는 본인 원문만 표시
- 서버 코드 변경이므로 이 수정만을 위한 APK 재설치는 필요 없음

최초 관찰 때 `familycard_live.RawMessage`는 0건이고 활성 폰에는 pending 1건이 남아 있었지만,
사용자가 **지금 전송**을 누른 뒤 `/api/ingest`가 200으로 신규 1건을 accepted했습니다. DB의
`RawMessage` 1건과 `Device.lastSeenAt` 갱신도 확인했습니다. 중복·거부는 0건이며 원문 내용은
로그·문서에 기록하지 않았습니다. 앱 화면에서 pending 0건과 `/raw` 1건을 확인하고 이 원문이
허용한 금융 알림인지 판정하는 것이 다음 게이트입니다.

### 검색·추천·다중 앱 선택

- `MAIN` + `LAUNCHER`에 응답하는 실행 가능 설치 앱만 조회
- 이름·패키지 검색과 체크박스 다중 선택, 한 번의 원자적 설정 저장
- 국내 주요 카드사 9개와 결제·자산 앱 9개의 공식 Play 패키지를 추천/검색 별칭으로 사용
- 공식 추천 → 카드·Card·페이·Pay·월렛·Wallet 이름 추천 → 그 외 앱 순으로 표시
- 공식 카탈로그는 자동 화이트리스트가 아니며 사용자가 최종 확인하기 전에는 수집하지 않음
- 설치 앱 목록 전체는 선택기 메모리에만 두고 저장·서버 전송·로그 출력하지 않음
- `QUERY_ALL_PACKAGES` 없이 launcher intent `<queries>`만 선언
- FamilyCard·카카오톡·기본 SMS 앱은 목록과 저장 정책 양쪽에서 차단

구현 파일:

- `android/app/src/main/java/com/familycard/collector/ui/settings/CaptureAppCatalog.kt`
- `android/app/src/main/java/com/familycard/collector/ui/settings/InstalledCaptureAppLoader.kt`
- `android/app/src/main/java/com/familycard/collector/ui/settings/CaptureAppPickerDialog.kt`
- `android/app/src/main/java/com/familycard/collector/settings/CaptureSourceStore.kt`

### tailnet APK 업데이트 전달

- 설정 화면에 현재 버전과 **최신 APK 받기** 버튼 추가
- 설정 서버와 같은 origin의 `/downloads/familycard.apk`를 외부 브라우저로 열어 다운로드
- 브라우저가 WebView DEVICE 쿠키를 공유하지 않으므로 이 exact 정적 파일만 세션 없이 허용
- `./gradlew publishDebugApk`가 debug APK를 Git에서 무시되는 고정 다운로드 경로에 게시
- 태그 CD는 서명 APK artifact를 GitHub Release와 web 이미지 양쪽에 동일하게 포함
- 앱 자체 설치 권한을 추가하지 않았고 Android의 최종 설치 확인과 서명 검증을 유지
- 현재 개발 서버의 tailnet HTTPS 다운로드가 `200`, APK MIME, 로컬과 같은 SHA-256임을 확인

구현 파일:

- `android/app/src/main/java/com/familycard/collector/settings/AppUpdateDownloadPolicy.kt`
- `android/app/src/main/java/com/familycard/collector/ui/settings/SettingsScreen.kt`
- `android/app/build.gradle.kts`
- `web/src/lib/auth/route-guard.ts`
- `.github/workflows/cd.yml`

### 사용자별 수집 대상

- 각 폰의 설정 화면에 **수집 대상** 섹션 추가
- 카드사 앱과 결제·자산 앱은 검색 가능한 설치 앱 화면에서 다중 추가
  - 실행 가능한 앱 목록만 메모리에서 조회하며 `QUERY_ALL_PACKAGES` 권한 없음
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
- `corepack pnpm test` ✅ — 16 files, **143 tests**
- `corepack pnpm build` ✅
- Prisma generate/validate/migrate deploy/status/schema diff ✅
- 로컬 DB migration 4개 적용 ✅
- 기존 가공 `RawMessage` 5건이 migration 전후 그대로이고 `originKind` 5건 모두 채워짐 ✅

### Android

- `./gradlew testDebugUnitTest` ✅ — **45 tests**
- `./gradlew lintDebug` ✅
- `./gradlew assembleDebug` ✅
- `./gradlew publishDebugApk` ✅ — versionCode 3, APK 서명 검증·서버 게시

`./gradlew ktlintCheck`는 저장소에 ktlint Gradle plugin/task가 없어 실행할 수 없습니다. 현재
CI 기준인 Android lint와 Kotlin 컴파일은 통과했습니다. AGENTS.md 명령과 실제 빌드 설정의
불일치는 별도 정리 대상입니다.

실제 검색·다중 앱 선택기, 알림 리스너, SMS 수신, SQLite v2→v3 업그레이드는 코드·빌드 검증까지이며
물리 기기 검증이 남았습니다. 자동 테스트에는 가공 데이터만 사용했습니다.

### 현재 실기기 검증 환경

- tailnet HTTPS는 비표준 포트 `3443`에서 개발 web으로 연결됨(정확한 origin은 private `.env`)
- 실제 수집 DB는 `familycard_live`, ADMIN은 이지훈, 활성 폰 1대
- versionCode 3 APK 덮어쓰기 설치와 카드사·결제 앱 등록 완료
- 첫 실기기 업로드 1건이 200·accepted, 서버 실제 `RawMessage` 1건으로 보존됨
- 사용자가 대시보드가 앱 내부에서 정상적으로 열리는 것을 확인
- 서버 `/raw` 200과 확인 시점 실제 `RawMessage` 2건 보존; pending/rejected는 수집 기간 중 계속 점검
- `/mnt/e/recovery` 로컬 Git `main`에 FamilyCard WSL 자동 복구가 병합됐고 설치본과 원본이
  byte-identical. systemd unit과 Windows 로그온 작업은 enabled이며 현재 DB·web은 healthy
- 자동 복구는 `docker compose up -d --no-recreate --wait`를 사용해 부팅을 배포와 분리.
  다음 자연스러운 Windows 로그온/WSL cold start의 로그와 `/raw` 보존 확인은 아직 남음
- 과거 가공 seed DB `familycard`는 보존하되 현재 web과 연결하지 않음
- 비밀번호·기기 토큰·실제 원문은 문서나 Git에 기록하지 않음

### 저장 데이터

현재 web과 분리된 과거 seed DB `familycard`에는 통합 검증용 가공 `RawMessage` **5건**,
`Transaction` 0건이 있습니다. migration은 5건을 모두 보존했습니다. 실제 수집 DB
`familycard_live`와 혼동하거나 어느 쪽의 `RawMessage`도 임의 삭제하지 마세요.

---

## 지금 바로 할 일 — USB 없이 실제 폰

상세 체크리스트는 [Phase 2 계획](plan/phase-2.md)과
[카드 알림 설정 가이드](guide/onboarding.md)가 기준입니다.

### 현재 우선순위 — Gate C0 표본 수집

- 자연스럽게 카드·결제 앱 알림을 계속 수집
- 가끔 앱 설정에서 pending 0·rejected 0, `/raw`에서 의도한 금융 알림만 있는지 확인
- 일반 카카오 대화·미등록 SMS/앱 canary 수행
- 같은 결제의 복수 출처, 별도 연속 결제, 취소·할부·해외 등 실제 사용하는 유형 확보
- 실제 원문은 캡처·복사하지 않고 앱/DB 안에서만 확인
- 상세 최소 표본은 [Gate C0 문구·출처 커버리지](plan/post-collection-execution.md#c0-2-문구출처-커버리지) 참조

### 0. 첫 pending 원문 전송·WebView 확인 ✅

1. 앱을 완전히 닫았다 열거나 대시보드의 **다시 시도**를 눌러 WebView가 앱 안에서 열리는지 확인
2. 설정 탭에 다시 들어가 pending 0건인지 확인 — 서버는 이미 1건을 accepted함
3. 대시보드 **수집 원문 보기**에서 본인 원문 1건과 올바른 출처 배지 확인
4. 이 원문이 등록한 금융 앱의 의도한 알림인지 확인하고 일반 대화·미등록 알림 canary 진행
5. 다시 실패하면 서버 `/api/ingest` 접근 로그부터 확인하고 실제 원문은 로그로 남기지 않음

이 단계는 서버 수정이라 APK를 다시 설치할 필요가 없습니다. pending 원문은 성공 응답 전까지
폰의 SQLite 큐에서 삭제되지 않습니다.

### 1. tailnet 전용 HTTPS 준비

```bash
sudo tailscale serve --bg localhost:3000
tailscale serve status
```

- Funnel 사용 금지: 인터넷 전체에 공개됩니다.
- 이미 443에 Funnel/Serve 설정이 있으면 기존 서비스를 임의로 바꾸지 말고 충돌을 확인합니다.
- `.env`의 `APP_URL`과 앱 서버 주소는 같은 `https://...ts.net` origin이어야 합니다.

### 2. 서버에서 디버그 APK를 받아 덮어쓰기 설치

```bash
cd /home/jihoon/projects/FamilyCard/android
./gradlew publishDebugApk
```

폰 브라우저에서 private `.env`의 `APP_URL` 뒤에 `/downloads/familycard.apk`를 붙인 주소를
엽니다. 현재 설치된 구버전에는 업데이트 버튼이 없으므로 이번 한 번은 주소를 직접 열고,
versionCode 3 설치 뒤부터 **설정 → 앱 업데이트 → 최신 APK 받기**를 씁니다. USB나 PC→폰
파일 복사는 필요 없습니다. Android 설치 확인은 직접 눌러야 합니다. 동일 개발 PC의 debug
서명으로 빌드해야 덮어쓰기가 가능하며 앱 삭제 전에는 pending/rejected 건수를 확인합니다.

### 3. 서버와 수집 대상 설정

1. 관리자가 `/family/devices`에서 해당 구성원의 기기 토큰을 발급
2. 폰의 FamilyCard 설정에서 HTTPS 서버 주소와 토큰 저장
3. **카드사 앱 추가**에서 검색해 실제 카드사 공식 앱을 여러 개 체크하고 등록
4. 토스·카카오페이·네이버페이 등을 쓴다면 **결제·자산 앱 추가**에서 일괄 선택
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
- 재부팅 뒤 수집 서버 자동 복구와 폰의 pending 캡처·전송
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
- [수집 이후 통합 실행 계획](plan/post-collection-execution.md)
- [수집 계약](plan/phase2-contract.md)
- [수집 설계](design/02-ingest.md)
- [Android 설계](design/08-android-app.md)
- [사용자 관리 출처 ADR](adr/0007-user-managed-capture-sources.md)
- [검색·다중 선택 ADR](adr/0008-searchable-multi-app-picker.md)
- [APK 업데이트 전달 ADR](adr/0009-tailnet-apk-update-delivery.md)
- [금융 앱 추천 카탈로그 조사](research/android-finance-app-catalog.md)
- [사용자 가이드](guide/user-guide.md)
- [관리자 가이드](guide/admin-guide.md)
- [이번 작업 워크스루](../workthrough/2026-08-30-device-session-and-raw-dashboard.md)
