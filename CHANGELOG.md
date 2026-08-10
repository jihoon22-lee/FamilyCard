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
  - `POST /api/ingest` — 디바이스 토큰 인증, 배열 배치 수신, `dedupeHash` 기반
    멱등 수집 (`{ accepted, duplicates, rejected }` 응답), 전부 `parseStatus: PENDING`
    저장, 유효성 검사(빈 본문·4000자 초과·미래 시각·5년 이전), 부분 실패 시에도
    배치 전체가 죽지 않음
  - 관리자용 디바이스 토큰 발급·폐기 화면 (`/family/devices`) — 토큰 원문 1회 표시
  - `POST /api/auth/device-session` — 60초 만료 1회용 nonce로 디바이스 토큰을
    웹 세션으로 교환 (`GET /api/auth/device-session?t=<nonce>`가 nonce를 소모하고
    세션 쿠키 발급). 이 경로로 만들어진 세션은 `Device.memberId`의 role과 무관하게
    항상 `scope: SELF`
  - `/raw` — 수집된 원문 목록 화면 (Phase 3 파서 작성의 근거 자료)
- **Phase 2 안드로이드 수집기 앱** (`android/`) — 카드 결제 알림·문자를 캡처해 서버로
  전달하는 파이프. 파싱·집계는 하지 않음
  - `CardNotificationListener`(`NotificationListenerService`) · `SmsReceiver`(`RECEIVE_SMS`) ·
    `CaptureFilter` — 화이트리스트 판정 후에만 큐에 적재, 걸러진 알림은 메모리에서도 즉시
    폐기. SMS는 카드사명 + 거래 어휘가 함께 있을 때만 수집(개인 문자 오탐 방지)
  - 오프라인 큐(`QueueDatabase`) → `UploadWorker`(`WorkManager` 주기 15분 + 네트워크
    연결 트리거, 지수 백오프 30초) → 서버 응답 개수(`accepted+duplicates+rejected`)가
    보낸 개수와 같을 때만 큐 삭제(`UploadPolicy`)
  - 하단 탭 2개 — 대시보드(WebView, 1회용 nonce로 로그인 화면 없이 진입, 연결 실패
    전용 화면, 서버 호스트 외 URL은 시스템 브라우저로) / 설정(서버 주소·토큰, 권한 3종
    상태, 큐 건수·수동 전송)
  - 유닛 테스트 21건(★★ 카카오톡 일반 대화 → 미수집 포함) 통과, `assembleDebug` 성공
    (APK 10MB), APK 매니페스트 확인(권한 5종·컴포넌트 4개, `READ_SMS` 없음), CI의
    android 잡이 처음으로 실제 실행되어 통과
  - **카드사 앱 패키지 화이트리스트는 코드만 있고 목록은 비어 있음** — 실기기에서
    패키지명을 확인해야 채울 수 있는 값이라 이번 범위에는 넣지 않음. 목록이 비어 있는
    동안은 카드사 **앱** 알림은 전혀 잡히지 않고, 카카오톡 알림톡 패턴 매칭만 동작함
  - 설계 문서(`08-android-app`) 대비 변경 2건 — 근거는 해당 문서에 반영
    - `CaptureFilter`를 순수 함수(`String` 인자)로 분리. 설계 예시(`shouldCapture(sbn:
      StatusBarNotification)`)대로면 판정이 안드로이드 프레임워크 타입에 묶여 JVM
      유닛 테스트가 불가능함. "카카오톡 일반 대화가 서버에 올라가지 않는다"는 이 앱의
      가장 중요한 보장이라 테스트로 고정해야 했음
    - 오프라인 큐를 Room 대신 `SQLiteOpenHelper`로 구현. Room은 KSP를 요구하고 KSP
      버전이 Kotlin 버전에 정확히 묶여(`<kotlin>-<ksp>`) 툴체인을 올릴 때마다 함께
      맞춰야 함. 이 큐는 테이블 하나짜리 FIFO라 Room의 이점이 그 결합 비용을 넘지
      않음 — 큐가 복잡해지면(관계·마이그레이션·Flow) 그때 옮기는 편이 나음

### Fixed

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
