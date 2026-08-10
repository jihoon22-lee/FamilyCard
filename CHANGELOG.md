# Changelog

이 프로젝트의 주요 변경 사항을 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르며,
버전 체계는 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

버전은 Phase 완료 시점에 끊습니다.

| 버전 | 대응 Phase |
|---|---|
| `v0.1.0` | Phase 1 — 프로젝트 스캐폴딩 |
| `v0.2.0` | Phase 2 — 수집 파이프라인 |
| `v0.3.0` | Phase 3 — 파서 + 카드 매칭 |
| `v0.4.0` | Phase 4 — 실적 엔진 |
| `v0.5.0` | Phase 5 — 관리자 가족 대시보드 |
| `v1.0.0` | Phase 6 — 명세서 대사 · 운영 완비 |

---

## [Unreleased]

### Added

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

- Prisma 7 대응
  - `datasource.url`을 `schema.prisma`에서 `prisma.config.ts`로 이동 (P1012)
  - `ci.yml`의 `migrate diff` 스텝 — `--to-schema-datamodel` → `--to-schema`,
    `--shadow-database-url` 플래그 제거(→ `datasource.shadowDatabaseUrl`), shadow DB 생성 스텝 추가
  - `.env.example`에 `SHADOW_DATABASE_URL` 추가
- CI의 Prisma 스텝을 `schema.prisma` / `migrations` 존재 여부로 게이팅 —
  웨이브로 나눠 진행하는 동안에도 CI가 초록을 유지하도록
- `web/Dockerfile` — `builder`에 `prisma generate`, `prod`에 `libc6-compat`·`openssl` 추가
  (Prisma 네이티브 엔진 로드용)

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

[Unreleased]: https://github.com/jihoon22-lee/FamilyCard/commits/claude/family-card-expense-tracker-fwxj6m
