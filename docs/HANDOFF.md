# HANDOFF — 세션 인수인계

> **작업을 시작하기 전에 이 문서를 읽으세요.** 그리고 작업 단위를 마칠 때마다 갱신하세요.
> 이 문서가 최신이 아니면 다음 세션이 코드를 처음부터 읽어야 합니다.
>
> 갱신 절차: [AGENTS.md — 세션 종료 절차](../AGENTS.md)

**최종 갱신**: 2026-08-10 · Phase 0

---

## 현재 상태

**Phase 0 (문서 · CI/CD 환경) — 완료**

| Phase | 상태 |
|---|---|
| 0 — 문서 · CI/CD | ✅ 완료 |
| 1 — 프로젝트 스캐폴딩 | ⬜ 다음 |
| 2 — 수집 파이프라인 | ⬜ |
| 3 — 파서 + 카드 매칭 | ⬜ |
| 4 — 실적 엔진 | ⬜ |
| 5 — 관리자 대시보드 | ⬜ |
| 6 — 보정 · 운영 | ⬜ |

### 이번에 만든 것

문서와 CI/CD만 있습니다. **코드는 아직 한 줄도 없습니다.**

```
AGENTS.md                 ★ 작업 규칙 — 불변 규칙 7가지
CHANGELOG.md
README.md
.env.example  .gitignore  .editorconfig  .nvmrc
docker-compose.yml  docker-compose.prod.yml
.github/workflows/ci.yml  cd.yml
docs/
  HANDOFF.md              이 문서
  design/00~08            설계 문서 9종
  plan/roadmap.md, phase-0~6.md
  adr/0001~0005
  guide/user-guide.md, onboarding.md, admin-guide.md
```

브랜치: `claude/family-card-expense-tracker-fwxj6m`

---

## 지금 바로 할 일

**[Phase 1 — 프로젝트 스캐폴딩](plan/phase-1.md)** 을 시작합니다.

순서대로:

1. **`web/` 생성** — Next.js 15 App Router + TypeScript(`strict: true`) + Tailwind + shadcn/ui
   - **모바일 우선** 반응형. 주 사용처가 앱 안의 WebView(폰 화면)입니다
   - `package.json` 스크립트: `dev` `build` `typecheck` `lint` `format:check` `test` `db:seed`
     → CI(`.github/workflows/ci.yml`)가 이 이름들을 호출하므로 맞춰야 합니다

2. **`web/prisma/schema.prisma`** — [01-data-model](design/01-data-model.md)의 전체 스키마를 그대로
   - 11개 모델: `FamilyMember`(role 포함) `Device` `Card` `CardAlias` `RawMessage` `ParserRule` `Transaction` `Category` `MerchantRule` `CardBenefitRule` `Budget`
   - 인덱스를 빠뜨리지 마세요 — 특히 `RawMessage.dedupeHash` UNIQUE, `Transaction(cardId, amount, approvedAt)`
   - 금액은 전부 `Int` (원 단위 정수)

3. **`web/src/lib/auth/scope.ts`의 `visibleMemberIds()`** ★
   - 이 프로젝트에서 가장 중요한 함수입니다. 모든 조회가 여기를 거칩니다
   - → [07-auth-scope](design/07-auth-scope.md), [ADR 0005](adr/0005-scope-by-entrypoint.md)

4. **Auth.js Credentials** — 세션에 `memberId` · `role` · `scope` 탑재
   - 초대 코드(`INVITE_CODE`) 기반 가입, **첫 가입자가 ADMIN**

5. **`web/Dockerfile`** — 멀티스테이지 (`dev` / `prod` 타깃)
   - `docker-compose.yml`이 `target: dev`, `cd.yml`이 `target: prod`를 참조합니다

6. **화면 껍데기** — `(app)/page.tsx`(빈 대시보드), `(family)/page.tsx`(ADMIN 전용), 로그인, `/api/health`

7. **테스트** — `visibleMemberIds` SELF/FAMILY, MEMBER의 `/family` 접근 차단

---

## 진행 중 미완료 사항

없습니다. Phase 0은 완결된 상태입니다.

다만 **Phase 1에서 확인이 필요한 것**:

### CI가 실제로 동작하는지 검증할 것

`ci.yml`의 `detect` 잡은 `web/package.json`이 있을 때만 web 잡을 돌립니다. Phase 1에서 `web/`을 만든 뒤:

- CI가 web 잡을 실제로 실행하는지
- **일부러 타입 오류를 넣었을 때 빨간불이 뜨는지** (CI가 무늬만 도는 게 아닌지 확인)

`prisma migrate diff` 스텝은 `prisma/migrations`가 있어야 동작합니다. 마이그레이션을 만들기 전에는 실패할 수 있으니, 스키마와 초기 마이그레이션을 같은 커밋에 넣으세요.

### `pnpm test -- --coverage` 호출 형태

CI가 이 형태로 부릅니다. Vitest 설정 시 인자 전달이 맞는지 확인하고, 안 맞으면 `ci.yml`을 고치세요.

---

## 막힌 것 / 결정 대기

없습니다.

**Phase 2에서 사용자 확인이 필요해질 항목** (미리 알아둘 것):

- 가족 구성원 이름과 카드 목록 (카드사 · 뒤 4자리 · 카드명 · 결제일)
- 서버를 돌릴 장비와 Tailscale 주소
- 카드사 앱 패키지명 — **실기기에서 확인해야 함**. 검색으로 알아내려 하지 마세요
  ```bash
  adb shell pm list packages | grep -i card
  ```

---

## 환경 메모

### 로컬 실행 (Phase 1 이후)

```bash
cp .env.example .env
openssl rand -base64 32          # AUTH_SECRET 에
docker compose up -d postgres

cd web
pnpm install
pnpm prisma migrate dev
pnpm db:seed
pnpm dev                         # http://localhost:3000
```

### 시드 계정

Phase 1에서 만들 예정. `prisma/seed.ts`에 ADMIN 1명 + MEMBER 1명을 넣으세요 — 권한 테스트에 둘 다 필요합니다.

### 주의점

**불변 규칙 7가지**를 [AGENTS.md](../AGENTS.md)에서 확인하세요. 특히:

- `RawMessage`는 삭제하지 않는다
- 모든 조회는 `visibleMemberIds(session)` 경유
- 디바이스 세션은 절대 `FAMILY` scope로 발급하지 않는다
- 집계는 `amount`가 아니라 `netAmount` 기준
- **실제 카드 알림 원문·거래 데이터는 절대 커밋하지 않는다**

### Phase 2 → 3 순서를 지킬 것

**실제 알림 원문이 쌓이기 전에 파서를 만들지 마세요.** 추측으로 정규식을 짜면 실물이 도착했을 때 전부 다시 써야 합니다. → [roadmap](plan/roadmap.md)

---

## 문서 지도

| 궁금한 것 | 문서 |
|---|---|
| 작업 규칙 · 명령어 | [AGENTS.md](../AGENTS.md) |
| 전체 구조 | [design/00-overview.md](design/00-overview.md) |
| 스키마 | [design/01-data-model.md](design/01-data-model.md) |
| 왜 이렇게 결정했나 | [adr/](adr/) |
| 다음 Phase 작업 목록 | [plan/](plan/) |
| 서버 설치 · 운영 | [guide/admin-guide.md](guide/admin-guide.md) |
