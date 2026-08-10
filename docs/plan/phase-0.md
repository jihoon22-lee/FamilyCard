# Phase 0 — 문서 및 개발 환경 구축

> **산출물은 코드가 아니라 문서와 워크플로우입니다.**

## 목표

Phase 6까지 가는 동안 세션이 여러 번 끊깁니다. 매번 코드를 처음부터 읽지 않아도 이어받을 수 있는 기반을 먼저 만듭니다.

## 완료 기준

**신규 세션이 `AGENTS.md` + `docs/HANDOFF.md`만 읽고 다음 작업을 시작할 수 있으면** 완료입니다.

## 작업

### 저장소 기본 파일
- [x] `.gitignore` — 비밀 정보, **실데이터**, 빌드 산출물
- [x] `.editorconfig`, `.nvmrc`
- [x] `.env.example` — 전체 키를 주석과 함께
- [x] `docker-compose.yml` (개발)
- [x] `docker-compose.prod.yml` (NAS pull 배포)
- [x] `README.md` — 개요 · 문서 색인 · 빠른 시작

### 가이드라인 문서
- [x] `AGENTS.md` — 불변 규칙 7가지, 명령어, 코딩 규칙, 커밋 규칙, 세션 종료 절차
- [x] `CHANGELOG.md` — Keep a Changelog + SemVer, Phase↔버전 대응표

### 설계 문서 (`docs/design/`)
- [x] `00-overview.md` — 아키텍처 · 핵심 결정 4가지
- [x] `01-data-model.md` — 스키마 · ERD · 인덱스 근거
- [x] `02-ingest.md` — 수집 · 멱등성(`dedupeHash`) · 오프라인 큐
- [x] `03-parser.md` — `ParserRule` 구조 · 재파싱 · 실패 처리
- [x] `04-card-matching.md` — 마스킹 매칭 5단계 · `CardAlias` 학습
- [x] `05-cancellation.md` — 전액/부분/고아 취소 · 실적 차감 시점
- [x] `06-benefit-engine.md` — 실적 산정 · 제외 항목 · KST 경계
- [x] `07-auth-scope.md` — 권한 모델 · 위협 모델
- [x] `08-android-app.md` — 앱 구조 · 화이트리스트 필터 · WebView

### 결정 기록 (`docs/adr/`)
- [x] `0001-collection-method.md` — CODEF vs 알림 파싱
- [x] `0002-server-required.md` — 단일 앱이 불가능한 이유
- [x] `0003-webview-dashboard.md` — 네이티브 UI 대신 WebView
- [x] `0004-parse-on-server.md` — 앱에서 파싱하지 않는 이유
- [x] `0005-scope-by-entrypoint.md` — scope를 진입 경로로 결정

### 작업 계획 (`docs/plan/`)
- [x] `roadmap.md` — Phase 의존관계 · 버전 태그 · 완료 기준
- [x] `phase-0.md` ~ `phase-6.md`

### 사용자 문서 (`docs/guide/`)
- [x] `user-guide.md` — 가족용 설치 · 사용법
- [x] `onboarding.md` — 카드사별 결제알림 설정 (**임계값 0원**)
- [x] `admin-guide.md` — 설치 · 토큰 발급 · 실적 튜닝 · 백업 · 복구

### 인수인계
- [x] `docs/HANDOFF.md` — 고정 양식 + Phase 0 완료 시점 상태

### CI/CD
- [x] `.github/workflows/ci.yml`
  - web 잡: 타입체크 · 린트 · **`prisma migrate diff`** · 테스트 · 빌드
  - android 잡: 유닛테스트 · 빌드 · ktlint
  - `paths-filter` + 디렉토리 존재 확인으로 변경 없는 잡은 건너뛰기
  - docs 잡: 문서 링크 검사 + **비밀 파일 커밋 방지 검사**
  - `ci-ok` 관문 잡 — 브랜치 보호에서 이것 하나만 요구하면 됨
  - **코드가 아직 없어도 실패하지 않음** (Phase 1 전이므로)
- [x] `.github/workflows/cd.yml`
  - 태그 `v*` push 시 GHCR 이미지 빌드·푸시
  - 릴리스 APK 빌드 → GitHub Release 첨부 (keystore secret 없으면 건너뜀)
  - Release 노트를 CHANGELOG에서 추출

### 마무리
- [x] 문서 간 상호 링크 확인 (깨진 링크 없음)
- [x] 워크플로우 · compose YAML 문법 검증
- [x] 커밋 · 푸시
- [ ] PR 생성 — **보류.** 저장소가 비어 있던 상태로 첫 푸시가 들어가면서
      `claude/family-card-expense-tracker-fwxj6m`가 기본 브랜치가 되어,
      머지 대상(base)이 없습니다. `main`을 기본 브랜치로 세운 뒤 Phase 1부터
      PR 흐름으로 전환할지 결정이 필요합니다.

## 주의

### CI는 Phase 1 전에도 통과해야 한다

Phase 0 시점에는 `web/`과 `android/` 디렉토리가 없습니다. CI가 그 상태에서 빨간불이면 Phase 1 내내 신호가 무의미해집니다.

디렉토리 존재 여부를 확인하고 없으면 건너뛰도록 작성합니다.

### 실데이터 커밋 방지를 먼저

`.gitignore`에 실데이터 패턴을 넣는 것을 **다른 작업보다 먼저** 했습니다. 나중에 넣으면 그 사이에 한 번 커밋된 것이 히스토리에 영원히 남습니다.

→ [불변 규칙 7](../../AGENTS.md)

## 다음

[Phase 1 — 스캐폴딩](phase-1.md)
