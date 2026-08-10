# Phase 1 — 프로젝트 스캐폴딩

> 버전 태그: `v0.1.0`
>
> **진행 상황**: W1 ✅ (PR #1) · W2 ✅ (PR #2) · **W3 남음**
> 다음 작업은 [HANDOFF](../HANDOFF.md)와 [W3 인터페이스 계약](w3-contract.md) 참고.

## 목표

빈 대시보드까지. 데이터는 없지만 **인증과 가시성 계층이 동작**하는 상태를 만듭니다.

## 완료 기준

- `docker compose up` 후 `/api/health`가 200
- 로그인하면 빈 대시보드가 뜸
- 세션에 `role`과 `scope`가 담김
- `visibleMemberIds()`가 동작하고 테스트가 있음
- CI가 실제 코드를 검증(초록)

## 작업

### W1 — 프로젝트 생성 ✅ (PR #1)
- [x] `web/` — Next.js 15 App Router + TypeScript (`strict: true`)
- [x] Tailwind v4 + shadcn/ui, **모바일 우선** 브레이크포인트
- [x] ESLint + Prettier
- [x] Vitest 설정
- [x] `web/Dockerfile` — 멀티스테이지(`dev` / `prod` 타깃)
- [x] `src/app/api/health/route.ts`

### W2 — 데이터베이스 ✅ (PR #2)
- [x] `prisma/schema.prisma` — [01-data-model](../design/01-data-model.md)의 전체 스키마 (11모델 · 8 enum)
- [x] 인덱스 전부 — `RawMessage.dedupeHash` UNIQUE, `Transaction(cardId, amount, approvedAt)` 포함
- [x] 초기 마이그레이션
- [x] `prisma/seed.ts` — ADMIN 1 + MEMBER 1, 카드 5장, 카테고리 7종, upsert 멱등
- [x] `src/lib/db.ts` — Prisma 클라이언트 싱글턴 (`@prisma/adapter-pg`)
- [x] 설계 문서 누락 보강 — `FamilyMember.passwordHash`, `name` UNIQUE, `Category.name` UNIQUE
- [x] Prisma 7 대응 — `prisma.config.ts`, `ci.yml`의 `migrate diff` 플래그 수정

### W3-A — 인증 · 가시성 ★ ⬜ 다음 작업
> [W3 인터페이스 계약](w3-contract.md)을 먼저 읽으세요.

- [ ] `src/lib/auth/types.ts` — `AppSession` · `MemberRole` · `SessionScope`
- [ ] `src/lib/auth/session.ts` — `getAppSession()` · `requireSession()` · `requireFamilyScope()`
- [ ] **`src/lib/auth/scope.ts`의 `visibleMemberIds()`**
- [ ] `src/lib/auth/actions.ts` — 로그인 · 가입 · 로그아웃 (bcryptjs 설치돼 있음)
- [ ] 초대 코드(`INVITE_CODE`) 기반 가입, **첫 가입자가 ADMIN**
- [ ] `src/middleware.ts` — `/family/**`에 `scope === 'FAMILY'` 검사
- [ ] 세션 쿠키 `httpOnly` + `sameSite: strict`

### W3-B — 화면 껍데기 ⬜ 다음 작업
- [ ] `app/layout.tsx` · `app/login/page.tsx` · `app/signup/page.tsx`
- [ ] `src/app/(app)/page.tsx` — 빈 대시보드
- [ ] `src/app/(family)/family/page.tsx` — 빈 가족 화면 (ADMIN 전용)
- [ ] 로그아웃 동선

### 테스트 ⬜
- [ ] `visibleMemberIds(SELF)` → `[본인]`
- [ ] `visibleMemberIds(FAMILY)` → `[전원]`
- [ ] MEMBER 세션으로 `/family` 접근 → 리다이렉트
- [ ] 잘못된 초대 코드로 가입 실패

### 검증 ⬜
- [ ] CI가 `web/` 코드를 실제로 검증하는지 확인 (일부러 타입 오류를 넣어 빨간불이 뜨는지)
- [ ] **Docker 빌드 — `dev`/`prod` 두 타깃 모두 아직 한 번도 실행되지 않음** (원격 환경에 데몬이 없었음)

## 설계 문서 참조

- 스키마 전체: [01-data-model](../design/01-data-model.md)
- 권한 구현: [07-auth-scope](../design/07-auth-scope.md)

## 주의

### `role`과 `scope`를 지금 넣는다

실제로 쓰이는 것은 Phase 5지만, 나중에 얹으면 **이미 작성된 모든 쿼리를 다시 뒤져야** 하고 그중 빠뜨린 하나가 곧 데이터 유출입니다. → [ADR 0005](../adr/0005-scope-by-entrypoint.md)

### 모바일 우선

주 사용처는 앱 안의 WebView, 즉 폰 화면입니다. PC는 보조입니다. 처음부터 이 순서로 잡아야 나중에 갈아엎지 않습니다.

### 금액은 `Int`

원 단위 정수. 부동소수점 금지. 스키마 단계에서 못 박습니다.

## 다음

[Phase 2 — 수집 파이프라인](phase-2.md)
