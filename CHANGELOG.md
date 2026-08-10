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
