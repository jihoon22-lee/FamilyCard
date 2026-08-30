# Changelog

이 프로젝트의 주요 변경 사항을 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르며,
버전 체계는 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

버전은 Phase 완료 시점에 끊습니다.

| 버전 | 대응 Phase |
|---|---|
| `v0.1.0` | Phase 1 — 프로젝트 스캐폴딩 ✅ |
| `v0.2.0` | Phase 2 — 수집 파이프라인 |
| `v0.3.0` | Phase 3 — 파서 + 카드 매칭 |
| `v0.4.0` | Phase 4 — 실적 엔진 |
| `v0.5.0` | Phase 5 — 관리자 가족 대시보드 |
| `v0.6.0` | Phase 6 — 명세서 대사 · 운영 완비 |
| `v1.0.0` | Phase 7 — 실사용 검증 · 안정화 |

---

## [Unreleased]

### Added

- **Phase 2 서버 파트 — 수집 파이프라인**
  - `POST /api/ingest` — 디바이스 토큰 인증, 스트리밍 요청 크기 제한, 배열 배치 수신,
    `clientMessageId` 기반 멱등 저장. 요약과 항목별
    `accepted | duplicate | rejected` 결과를 반환하고 전부 `parseStatus: PENDING`으로 저장
  - 관리자용 디바이스 토큰 발급·폐기 화면 (`/family/devices`) — 토큰 원문 1회 표시
  - `POST /api/auth/device-session` — 60초 만료 1회용 nonce로 디바이스 토큰을
    웹 세션으로 교환 (`GET /api/auth/device-session?t=<nonce>`가 nonce를 소모하고
    세션 쿠키 발급). 이 경로로 만들어진 세션은 `Device.memberId`의 role과 무관하게
    항상 `scope: SELF`
  - `/raw` — 수집된 원문 목록 화면 (Phase 3 파서 작성의 근거 자료)
  - 대시보드의 서버 보관 원문 건수와 **수집 원문 보기** 진입 버튼. DEVICE 세션에서는
    `visibleMemberIds()`를 거쳐 본인 원문만 표시
  - `RawMessage.originKind` — 카드사 앱·결제/자산 앱·카카오 공식 채널·SMS 발신자를
    구분하고 기존 원문을 삭제 없이 보수적으로 분류하는 migration. `/raw`에 출처 배지 표시
- **Phase 2 안드로이드 수집기 앱** (`android/`) — 카드 결제 알림·문자를 캡처해 서버로
  전달하는 파이프. 파싱·집계는 하지 않음
  - `CardNotificationListener`(`NotificationListenerService`) · `SmsReceiver`(`RECEIVE_SMS`) ·
    `CaptureFilter` — 사용자가 등록한 exact 앱 패키지·카카오 채널·SMS 발신자만 허용하는
    fail-closed 경계. 알림은 판정 뒤 본문 추출, SMS는 발신자 판정 뒤 본문 결합·큐 적재
  - 설정의 **수집 대상** — 실행 가능한 설치 앱을 이름·패키지·공식 별칭으로 검색하고,
    국내 주요 카드/결제 앱과 카드·Card·페이·Pay 이름 추천을 먼저 보며 여러 앱을 한 번에
    추가. 기존 앱 재분류·삭제와 카카오 공식 채널·SMS 발신자 직접 관리도 유지
  - 설정의 **앱 업데이트** — 현재 버전을 표시하고 FamilyCard tailnet 서버의 고정 경로에서
    최신 APK 다운로드를 시작. 개발용 `publishDebugApk` 작업과 서명 APK를 web 이미지에
    함께 싣는 CD 경로 추가
  - 같은 결제의 카드사 앱·결제 앱 알림도 내용 중복 제거 없이 서로 다른 출처 원문으로 보존
  - 펼침형 알림 전체 본문 추출, 안정적 캡처 사건 ID, 저장 직후 즉시 업로드 예약
  - 오프라인 큐 v3(`QueueDatabase`, `origin_kind` 보존) → `UploadWorker`(즉시 + 주기 15분, 지수 백오프) →
    서버 항목별 ID·상태를 검증한 뒤 승인·중복만 삭제하고 거부 원문은 로컬 격리
  - 하단 탭 2개 — 대시보드(WebView, 1회용 nonce로 로그인 화면 없이 진입, 연결 실패
    전용 화면, 서버 호스트 외 URL은 시스템 브라우저로) / 설정(서버 주소·토큰, 권한 3종
    상태, 큐 건수·수동 전송)
  - 유닛 테스트 45건, Android lint, debug build, 임시 키 signed release와 APK 서명 검증 통과
  - **사용자 초기 목록은 비어 있음** — 각 폰에서 대상을 등록하기 전에는 아무것도 수집하지
    않으며, 손상 설정도 빈 목록으로 처리. 새 사용자 추가에 코드 수정·USB/ADB 조사 불필요
  - 설계 문서(`08-android-app`) 대비 변경 2건 — 근거는 해당 문서에 반영
    - `CaptureFilter`를 순수 함수(`String` 인자)로 분리. 설계 예시인
      `shouldCapture(sbn: StatusBarNotification)`대로면 판정이 안드로이드 프레임워크 타입에 묶여 JVM
      유닛 테스트가 불가능함. "카카오톡 일반 대화가 서버에 올라가지 않는다"는 이 앱의
      가장 중요한 보장이라 테스트로 고정해야 했음
    - 오프라인 큐를 Room 대신 `SQLiteOpenHelper`로 구현. Room은 KSP를 요구하고 KSP
      버전이 Kotlin 버전에 정확히 묶여(`<kotlin>-<ksp>`) 툴체인을 올릴 때마다 함께
      맞춰야 함. 이 큐는 관계 없는 단순 FIFO·격리 테이블이라 Room의 이점이 그 결합 비용을 넘지
      않음 — 큐가 복잡해지면(관계·마이그레이션·Flow) 그때 옮기는 편이 나음

- **운영 배포 경로**
  - 버전 고정 web/migration 이미지와 web 기동 전 `prisma migrate deploy`
  - Android release 서명 설정, CD 서명 검증, 수동 태그 실행 보정
  - GitHub Actions를 2026-08 현재 Node 24 기반 지원 major로 갱신
  - 기본 보안 응답 헤더와 Android 자동 백업 제외 규칙

### Security

- 본문·분 단위 해시가 동일한 정상 결제를 합칠 수 있던 멱등 정책을 클라이언트 사건 ID로 교체
- 카카오 카드사명 정규식과 SMS 본문 추정 fallback을 제거하고 exact allowlist로 축소
- 카카오톡과 기본 SMS 앱을 앱 전체 수집 대상으로 등록하지 못하게 하고, 카카오는 exact
  채널 제목·SMS는 exact 발신자로만 등록
- Android 앱 검색을 `MAIN` + `LAUNCHER` intent 가시성으로 제한하고 `QUERY_ALL_PACKAGES`는
  요청하지 않음. 조회한 설치 앱 목록은 선택기 메모리에만 두고 저장·서버 전송·로그를 금지
- 추천 카탈로그를 자동 화이트리스트와 분리해 사용자가 최종 확인하기 전에는 설치 여부나
  이름만으로 수집 범위가 넓어지지 않게 함
- 외부 브라우저용 APK 예외를 `/downloads/familycard.apk` exact path 하나로 제한하고,
  기기 토큰을 URL에 넣거나 앱 자체 설치 권한을 추가하지 않음
- 서버 응답이 불완전하거나 ID가 어긋나면 Android 큐를 전혀 변경하지 않도록 강화
- 기기 폐기 시 미소모 nonce뿐 아니라 이미 발급된 DEVICE 세션도 다음 보호 조회에서 무효화
- 수집 로그에서 제목·본문·항목별 ID를 모든 로그 레벨에 걸쳐 제외
- `deepmerge-ts`를 패치된 8.x로 강제해 전체 dependency audit 경고를 제거

### Fixed

- Tailscale Serve 같은 역방향 프록시 뒤에서 디바이스 세션 교환 후 `request.url`의 내부
  주소인 `https://localhost:3000`으로 이동해, Android WebView가 외부 브라우저를 열던 문제.
  대시보드 리디렉션도 세션 URL과 같은 canonical `APP_URL` origin을 사용하도록 수정

- 같은 가맹점·금액·분에 발생한 서로 다른 결제가 내용 기반 dedupe로 한 건으로 합쳐질 수 있던 문제
- Android가 HTTP 200 총건수만 보고 rejected 원문까지 삭제하던 유실 위험
- 새 원문이 최대 15분 동안 업로드되지 않던 지연과 200건 초과 백로그가 한 배치만 처리되던 문제
- 폐기 전에 발급된 디바이스 WebView 쿠키가 최대 30일간 계속 유효하던 문제
- 운영 Compose가 migration 없이 web을 먼저 시작할 수 있던 문제
- 수동 CD가 입력 tag를 무시하고 빌드 실패 뒤에도 Release를 만들 수 있던 문제

- 미들웨어가 `/api/ingest`를 세션 없는 요청으로 판단해 `307 → /login`으로
  차단하던 결함 — 디바이스 토큰 인증 경로가 핸들러에 닿기도 전에 막혀 수집
  파이프라인 전체가 동작하지 않았습니다. `route-guard.ts`에 `DEVICE_TOKEN_PATHS`
  집합을 별도로 두어 통과시키고, 회귀 방지 테스트를 추가했습니다
- 기기 등록 화면의 URL이 라우트 그룹 규칙상 `/devices`로 노출되어 미들웨어의
  `/family/**` 보호 대상에서 빠져 있던 문제 — `(family)/family/devices/`로
  이동해 URL을 `/family/devices`로 바로잡았습니다
- `gradlew` 실행 비트가 git에 기록되지 않아 CI의 android 잡이 `exit 126`
  (Permission denied)으로 실패하던 문제 — `/mnt/e`가 9p 파일시스템이라
  `chmod +x`가 파일시스템에 반영되지 않고, git이 모드 `100644`로 기록한 것이
  원인이었습니다. `git update-index --chmod=+x android/gradlew`로 파일시스템을
  우회해 인덱스에 직접 실행 비트를 기록해 고쳤습니다

### Changed

- 저장소 작업 규칙을 기능 브랜치 → PR → 필수 CI 통과 → GitHub 병합으로 고정하고
  `main` 직접 push를 금지
- Android 태그 artifact를 GitHub Release뿐 아니라 같은 버전의 web 이미지에도 포함해
  PC→폰 파일 이동 없이 tailnet 서버에서 받을 수 있도록 CD 순서를 연결
- 로컬 개발 저장소를 `/mnt/e/projects/FamilyCard`에서 WSL ext4의
  `/home/jihoon/projects/FamilyCard`로 이관했습니다. 기존 Docker PostgreSQL named volume은
  유지하고 private `.env`와 Android SDK 설정은 Git 밖에서 `0600` 권한으로 복원했습니다.

## [0.1.0] - 2026-08-11

### Added

- **Phase 1 W3 — 인증 · scope 가시성 계층 · UI 셸**
  - Auth.js v5 Credentials 인증 (이름 + 비밀번호, bcrypt)
  - `visibleMemberIds()` 가시성 계층 — 모든 조회의 단일 통로
  - 진입 경로 기반 scope 판정 (웹 로그인 시 ADMIN→FAMILY, MEMBER→SELF)
  - 초대 코드 기반 가입, 첫 가입자 ADMIN (Serializable 트랜잭션으로 경쟁 조건 처리)
  - 미들웨어 라우트 보호 (`/family/**` scope 검사)
  - 로그인·가입·빈 대시보드·빈 가족 화면 (모바일 우선)
- **Phase 1 W2 — Prisma 데이터 계층** (#2)
  - `prisma/schema.prisma` — 11개 모델 · 8개 enum, 설계 문서의 인덱스 전부 반영
  - 초기 마이그레이션, `prisma/seed.ts` (ADMIN 1 + MEMBER 1, 카드 5장, 카테고리 7종, upsert 멱등)
  - `src/lib/db.ts` — Prisma 클라이언트 싱글턴 (`@prisma/adapter-pg`)
  - `FamilyMember.passwordHash`(bcrypt) 및 `name`/`Category.name` UNIQUE — 설계 문서 누락분 보강
- **Phase 1 W1 — Next.js 스캐폴딩** (#1)
  - Next.js 15 App Router + TypeScript strict, React 19, Tailwind v4, shadcn/ui 기반
  - ESLint · Prettier · Vitest, 멀티스테이지 Dockerfile (`dev` / `prod`)
  - `GET /api/health`
- `docs/plan/w3-contract.md` — Phase 1 W3 인터페이스 계약 (병렬 작업용 경계면 정의)
- 프로젝트 문서 체계 구축 (Phase 0)
  - `AGENTS.md` — 작업 가이드라인, 불변 규칙 7가지, 커밋 규칙, 세션 종료 절차
  - `docs/HANDOFF.md` — 세션 인수인계 문서
  - `docs/design/` — 설계 문서 9종 (아키텍처 · 데이터 모델 · 수집 · 파서 · 카드매칭 · 취소 · 실적엔진 · 권한 · 안드로이드 앱)
  - `docs/plan/` — 로드맵 및 Phase 1~6 작업 체크리스트
  - `docs/adr/` — 주요 결정 기록 5건
  - `docs/guide/` — 사용자 가이드 · 카드사 알림 설정 · 관리자 가이드
- CI/CD 워크플로우
  - `.github/workflows/ci.yml` — web(타입체크 · 린트 · 마이그레이션 정합성 · 테스트 · 빌드) / android(유닛테스트 · 빌드 · 린트) 병렬 잡
  - `.github/workflows/cd.yml` — 태그 push 시 GHCR 이미지 배포 및 릴리스 APK 첨부
- 개발 환경 파일
  - `docker-compose.yml` (개발), `docker-compose.prod.yml` (NAS pull 배포)
  - `.env.example`, `.gitignore`, `.editorconfig`, `.nvmrc`

### Changed

- WSL 로컬 개발 환경 부트스트랩
  - PostgreSQL 16 → 17, Node 22 → 24로 개발 환경 버전 정렬
  - 로컬 개발 DB 포트 기본값을 5433으로 변경 (5432는 다른 프로젝트 컨테이너와 충돌 가능)
  - `postcss`, `sharp` 보안 권고 대응 (pnpm `overrides`)
- 버전 체계 변경 — Phase 6에서 바로 `v1.0.0`으로 가지 않고 실사용 검증 단계를 분리
  - `v0.6.0` = Phase 6 (보정 · 운영), `v1.0.0` = Phase 7 (신설 — 실사용 검증 · 안정화)
- Prisma 7 대응
  - `datasource.url`을 `schema.prisma`에서 `prisma.config.ts`로 이동 (P1012)
  - `ci.yml`의 `migrate diff` 스텝 — `--to-schema-datamodel` → `--to-schema`,
    `--shadow-database-url` 플래그 제거(→ `datasource.shadowDatabaseUrl`), shadow DB 생성 스텝 추가
  - `.env.example`에 `SHADOW_DATABASE_URL` 추가
- CI의 Prisma 스텝을 `schema.prisma` / `migrations` 존재 여부로 게이팅 —
  웨이브로 나눠 진행하는 동안에도 CI가 초록을 유지하도록
- `web/Dockerfile` — `builder`에 `prisma generate`, `prod`에 `libc6-compat`·`openssl` 추가
  (Prisma 네이티브 엔진 로드용)

### Fixed

- `src/lib/db.ts` — Prisma 클라이언트를 첫 사용 시점까지 지연 생성. 이전에는 모듈 로드 시점에
  `DATABASE_URL`을 요구해 **Docker 이미지 빌드가 실패**했습니다(`.dockerignore`가 `.env`를
  제외하므로 빌드 컨텍스트에 값이 없음). 빌드가 런타임 설정을 요구하지 않도록 고쳤습니다

---

<!--
작성 예시 — 실제 릴리스 시 아래 형태로 섹션을 끊습니다.

## [0.2.0] - 2026-09-01

### Added
- 안드로이드 수집기 앱 (알림 · SMS 캡처, 오프라인 큐)
- `POST /api/ingest` 멱등 수집 엔드포인트

### Fixed
- 오프라인 큐가 밀렸다 한꺼번에 올라올 때 중복 적재되던 문제

### Security
- 디바이스 세션 nonce 유효시간을 60초로 제한
-->

[Unreleased]: https://github.com/jihoon22-lee/FamilyCard/compare/v0.1.0...main
[0.1.0]: https://github.com/jihoon22-lee/FamilyCard/releases/tag/v0.1.0
