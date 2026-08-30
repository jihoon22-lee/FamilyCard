# HANDOFF — 세션 인수인계

> 작업 전 [AGENTS.md](../AGENTS.md)와 이 문서를 읽고, 작업 단위를 마칠 때 갱신합니다.

**최종 갱신**: 2026-08-30 · Phase 2 수집 파이프라인 안전성 보강 및 로컬 통합 검증
**작업 위치**: `/home/jihoon/projects/FamilyCard` (WSL ext4)
**브랜치**: `main`

## 한 줄 상태

Phase 2 서버·Android·운영 배포 경로의 **코드 검증은 완료**됐지만, 운영 허용 목록과
실기기 검증이 없으므로 Phase 2와 `v0.2.0`은 아직 완료가 아닙니다. **Phase 3 파서를
시작하지 마세요.**

| Phase | 상태 |
|---|---|
| 0 문서·CI/CD | ✅ 완료 |
| 1 스캐폴딩·인증 | ✅ `v0.1.0` |
| **2 수집 파이프라인** | 🟡 코드·로컬 통합 완료 / 실기기·배포·원문 수집 대기 |
| 3 파서·카드 매칭 | ⛔ 실제 원문 며칠치 전에는 시작 금지 |
| 4~7 | ⬜ |

이 앱은 PWA가 아니라 **네이티브 Android 수집기 + Next.js WebView 대시보드**입니다.

---

## 이번 작업에서 확정한 것

### 개인정보 캡처 경계

- 운영 허용 목록은 의도적으로 모두 비어 있어 현재 빌드는 아무 알림도 수집하지 않음
- 카드 앱 패키지, 카카오 채널 제목, SMS 발신번호를 **실기기 exact 값**으로만 허용
- 카드사명 정규식과 SMS 본문 추정 fallback 제거
- SMS는 확인된 발신번호와 거래 어휘를 모두 요구
- 필터가 본문 추출·큐 저장보다 먼저 실행
- 펼침 알림은 BIG_TEXT → TEXT_LINES → TEXT 순서로 전체 문구 선택
- 큐/토큰은 Android 자동 백업·기기 이전 대상에서 제외
- `FLAG_SECURE`, release HTTPS, WebView 동일 origin 경계 적용

허용 목록 위치:
`android/app/src/main/java/com/familycard/collector/capture/CaptureFilter.kt`

### 유실·중복 방지

- Android가 캡처 사건마다 안정적인 `clientMessageId`를 만들고 큐에 보존
- 서버는 `deviceId + clientMessageId`로만 재전송 중복 판정
- 기존 내용+분 단위 해시가 정상 결제 두 건을 합치던 위험 제거
- 서버 응답을 항목별 ID·상태·사유로 확장
- 앱은 ID 집합과 요약 건수를 모두 검증
- 승인·중복만 삭제, 거부 원문은 로컬 rejected 테이블로 원자적 격리
- 새 원문 저장 직후 즉시 업로드, 15분 주기는 안전망
- 기존 Android v1 큐와 서버 `RawMessage`를 보존하는 migration

결정 기록: [ADR 0006](adr/0006-client-event-idempotency.md)

### 기기 폐기

- nonce가 발급 기기와 연결됨
- nonce 발급 뒤 폐기하면 쿠키 교환 거부
- DEVICE 쿠키에 `entrypoint`와 `deviceId` 포함
- 보호 조회마다 기기 활성·소유자 재확인
- 폐기 전에 발급된 WebView 세션도 다음 보호 조회부터 무효
- DEVICE scope는 role과 무관하게 항상 SELF

### 운영 경로

- 운영 Compose는 `FAMILYCARD_VERSION` 명시가 필수
- 별도 `familycard-migrate` 이미지가 web보다 먼저 migration 적용
- release APK는 서명 환경변수 4개 없이는 빌드 실패
- CD는 태그 소스를 사용하고 APK 서명을 검증
- 수동 CD tag 입력 반영, 빌드 실패 뒤 Release 생성 차단
- CI Android lint가 실제 `lintDebug` 실행
- 수집 요청 스트림 바이트 상한과 기본 보안 응답 헤더
- `deepmerge-ts`를 패치된 8.x로 override하여 현재 `pnpm audit --prod` 0건

---

## 검증 결과

### Web

- `pnpm format:check` ✅
- `pnpm lint` ✅
- `pnpm typecheck` ✅
- `pnpm test` ✅ — 16 files, **134 tests**
- `pnpm build` ✅
- Prisma generate/validate/migrate status/schema diff ✅
- 로컬 DB migration 3개 적용 ✅
- `pnpm audit --prod` ✅ — 알려진 취약점 0

### Android

- `./gradlew testDebugUnitTest` ✅ — **27 tests**
- `./gradlew lintDebug` ✅
- `./gradlew assembleDebug` ✅
- 일회성 임시 keystore로 `assembleRelease` 및 `apksigner verify` ✅

임시 키는 `/tmp` 아래 테스트 파일일 뿐 운영 키가 아닙니다. 저장소에는 없습니다.

### Docker·HTTP 통합

- production web 및 migrate target 빌드 ✅
- `docker-compose.prod.yml config` ✅
- migrate 이미지로 pending migration 없음 확인 ✅
- production 이미지에서 가공 데이터로 다음 확인 ✅
  - 새 사건 accepted
  - 같은 ID 재전송 duplicate
  - 같은 본문·시각의 새 ID accepted
  - 활성 DEVICE 세션 `/raw` 접근
  - 폐기 후 ingest 401
  - 폐기 전 발급·미소모 nonce 401
  - 폐기 전 발급된 쿠키 보호 조회 거부
- GitHub Actions `actionlint` ✅

로컬 개발 DB에는 가공된 `RawMessage` **5건**, `Transaction` 0건이 있습니다. 이번 통합
테스트가 만든 2건도 불변 규칙 1에 따라 삭제하지 않았습니다. 테스트 기기는 폐기 상태입니다.

---

## 지금 바로 할 일 — 순서 고정

상세 체크리스트는 [Phase 2 계획](plan/phase-2.md)의 “다음 작업”이 기준입니다.

### 1. tailnet 전용 HTTPS

```bash
sudo tailscale serve --bg localhost:3000
tailscale serve status
```

- **Funnel 사용 금지**: 인터넷 전체에 공개됩니다.
- 이미 443에 Funnel/Serve 설정이 있으면 먼저 상태와 충돌을 확인하고 사용자가 경로·포트를
  결정해야 합니다. 기존 외부 서비스를 임의로 바꾸지 마세요.
- `.env`의 `APP_URL`과 release 앱 주소는 같은 `https://...ts.net` origin이어야 합니다.

### 2. 실기기 설치·값 조사

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME="$HOME/android-sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"

cd android
./gradlew assembleDebug
adb devices
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell pm list packages | grep -iE 'card|shinhan|kb|samsung|hyundai|lotte|hana|nh|woori'
```

실제 카드 알림을 보며 패키지·카카오 제목·SMS 발신번호만 확인합니다. 원문, 이름, 금액,
가맹점, 카드번호는 코드·문서·이슈에 복사하지 않습니다.

### 3. 허용 목록 반영

- 수정:
  `android/app/src/main/java/com/familycard/collector/capture/CaptureFilter.kt`
- 테스트:
  `android/app/src/test/java/com/familycard/collector/capture/CaptureFilterTest.kt`
- 확인:
  `./gradlew testDebugUnitTest lintDebug assembleDebug`

검색 결과나 추정값은 넣지 않습니다. exact 값 하나씩 추가하고 adversarial 테스트도 같이 둡니다.

### 4. 개인정보 canary — 가족 배포 전 필수

다음을 받은 뒤 앱의 pending/rejected 건수와 서버 `/raw`가 증가하지 않는지 확인합니다.

- 평범한 카카오 개인·단체 대화
- 카드사명이 들어간 일반 대화방 제목
- “카드”, “승인”, “결제” 단어가 든 개인 SMS

하나라도 저장되면 배포를 중단하고 허용 목록을 다시 좁힙니다. 이미 서버에 들어간
`RawMessage`는 임의 삭제하지 말고 사용자와 처리 방침을 결정합니다.

### 5. 실제 수집 시나리오

- 실제 소액 결제 → 즉시 `/raw` 도착
- 기내모드 결제 → 네트워크 복구 뒤 자동 업로드
- 재부팅 → 이후 캡처·전송
- 서버 중단 → 흰 화면 대신 안내, pending 유지
- 기기 폐기 → 수집·새 nonce·기존 WebView 세션 모두 거부

Phase 2에서는 파서가 없으므로 거래 대시보드가 아니라 **`/raw`가 성공 기준**입니다.

### 6. 실제 서명·배포

- `familycard.jks` 생성
- keystore와 비밀번호를 서로 독립된 암호화 위치 두 곳에 백업
- GitHub Secrets: `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`,
  `KEY_PASSWORD`
- 후보 태그 전에는 `FAMILYCARD_VERSION`과 Compose pull/migrate/web 기동 확인
- 실기기 canary 전에는 `v0.2.0` 태그 금지

### 7. 며칠간 수집

카드사별 승인·취소·부분취소·할부·해외·마스킹 변형을 DB/`/raw` 안에서 목록화합니다.
그 데이터가 쌓인 뒤에만 Phase 3을 시작합니다. Git에는 가공 구조만 남깁니다.

---

## 아직 하지 말 것

- 실제 카드 원문을 fixture·문서·이슈·로그에 복사
- 운영 허용 목록을 검색 결과로 채우기
- Funnel이나 공유기 포트포워딩으로 FamilyCard 공개
- 실제 키 없이 `v0.2.0` 태그
- 실제 원문 며칠치 전 Phase 3 정규식 작성
- 통합 테스트가 만든 `RawMessage` 삭제

---

## 환경

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

## 자주 걸리는 함정

- Prisma 스키마 변경 뒤 `pnpm prisma generate` 필수
- `next dev`와 `next build`를 같은 `.next`에서 동시에 실행하지 않음
- API 핸들러 직접 테스트는 미들웨어를 통과하지 않으므로 production HTTP 통합도 실행
- `docker build | tail`은 pipefail 없으면 실패 코드를 숨김
- Next 라우트 그룹 이름은 URL에 나타나지 않음
- release APK는 서명 환경변수가 없으면 의도적으로 실패
- 운영 Compose는 `FAMILYCARD_VERSION` 없으면 의도적으로 실패

## 문서 지도

- [Phase 2 체크리스트](plan/phase-2.md)
- [수집 설계](design/02-ingest.md)
- [Android 설계](design/08-android-app.md)
- [권한 설계](design/07-auth-scope.md)
- [관리자 가이드](guide/admin-guide.md)
- [이번 작업 워크스루](../workthrough/2026-08-30-phase2-collection-hardening.md)
