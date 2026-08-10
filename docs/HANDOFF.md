# HANDOFF — 세션 인수인계

> **작업을 시작하기 전에 이 문서를 읽으세요.** 그리고 작업 단위를 마칠 때마다 갱신하세요.
>
> 갱신 절차: [AGENTS.md — 세션 종료 절차](../AGENTS.md)

**최종 갱신**: 2026-08-10 · WSL 환경 부트스트랩 완료 (Phase 1 W2 이후, W3 착수 전)
**작성 환경**: 로컬 WSL (클라우드 원격 컨테이너에서 전환 완료)

---

## 환경

원격 컨테이너로는 Phase 2(Docker 빌드, 안드로이드 APK 빌드, 실기기 adb 연결, Tailscale·NAS 배포)를 완주할 수 없어서 로컬 WSL로 전환했습니다. **전환은 끝났습니다.**

| 항목 | 상태 |
|---|---|
| 저장소 위치 | `/mnt/e/projects/FamilyCard` |
| 기본 브랜치 | `main` — 원격에는 `main`만 남아 있음. 옛 `claude/family-card-expense-tracker-fwxj6m`는 삭제 완료 |
| JDK | 21.0.11 (`JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64`) |
| Docker | 29.7.0 / compose v5.3.1, 정상 동작 |
| PostgreSQL | 17-alpine (Docker) |
| Node | 24 (`.nvmrc`) |
| 개발 DB 포트 | 5433 (`.env`의 `POSTGRES_PORT` — 5432는 다른 프로젝트가 점유하고 있을 수 있어 피함) |

### WSL에서 시작하기

```bash
git clone https://github.com/jihoon22-lee/FamilyCard.git
cd FamilyCard

cp .env.example .env
openssl rand -base64 32          # 출력값을 .env 의 AUTH_SECRET 에
# POSTGRES_PASSWORD, INVITE_CODE 도 바꾸세요

docker compose up -d postgres

cd web
pnpm install
pnpm prisma migrate deploy
pnpm prisma generate
pnpm db:seed
pnpm dev                         # http://localhost:3000
```

동작 확인: `curl http://localhost:3000/api/health` → `{"status":"ok"}`

### `web/.env`는 루트 `.env`의 심볼릭 링크

`prisma.config.ts`가 `dotenv/config`로 **cwd 기준**으로 `.env`를 읽는데, Prisma 명령은 `web/` 디렉터리에서 실행됩니다. 그래서 `web/.env` → `../.env` 심볼릭 링크로 만들어 루트의 `.env` 하나만 관리하면 되게 했습니다. `web/.env`를 별도 파일로 만들지 마세요 — 링크가 깨집니다.

### 저장소는 개발 기간 동안 public 유지

`jihoon22-lee/FamilyCard`는 공개 저장소입니다. 가족 금융 데이터를 다루지만 **개발 기간 동안은 public으로 유지**하기로 결정했습니다. 운영 단계로 넘어갈 때 private으로 전환할 예정입니다. 지금은 실데이터가 없고, [불변 규칙 7](../AGENTS.md)과 CI 검사가 실제 알림 원문·거래 데이터 커밋을 막고 있습니다.

---

## 현재 상태

| Phase | 상태 |
|---|---|
| 0 — 문서 · CI/CD | ✅ 완료 |
| **1 — 프로젝트 스캐폴딩** | 🔄 **3웨이브 중 2개 완료** |
| 2 — 수집 파이프라인 | ⬜ |
| 3 — 파서 + 카드 매칭 | ⬜ |
| 4 — 실적 엔진 ← 목표 지점 | ⬜ |
| 5 — 관리자 대시보드 | ⬜ |
| 6 — 보정 · 운영 | ⬜ |
| 7 — 실사용 검증 · 안정화 | ⬜ |

### Phase 1 웨이브

| 웨이브 | 범위 | 상태 |
|---|---|---|
| W1 | Next.js 스캐폴딩 · 툴링 · Dockerfile · `/api/health` | ✅ PR #1 머지 |
| W2 | Prisma 스키마 11모델 · 마이그레이션 · 시드 | ✅ PR #2 머지 |
| **W3-A** | **Auth.js + scope 계층 · 미들웨어** | ⬜ **다음 작업** |
| **W3-B** | **UI 셸 · 로그인/가입 화면** | ⬜ **다음 작업** |

`main` = `42cea13`

### 지금 동작하는 것

- `GET /api/health` → `200 {"status":"ok"}`
- `pnpm db:seed` → 가족 2명(ADMIN/MEMBER), 카드 5장, 카테고리 7종
- `typecheck` / `lint` / `format:check` / `test` / `build` 전부 통과
- CI 초록 (docs · web 잡, android는 디렉토리 없어 건너뜀)

**아직 로그인 화면도 대시보드도 없습니다.** W3가 그걸 만듭니다.

---

## 지금 바로 할 일 — Phase 1 W3

**[docs/plan/w3-contract.md](plan/w3-contract.md)를 먼저 읽으세요.** W3-A와 W3-B가 공유하는 함수 시그니처·폼 필드명·파일 소유권이 정의돼 있습니다. 두 작업을 병렬로 진행할 수 있게 만든 것입니다.

### W3-A — Auth.js + scope 계층

담당 파일: `web/src/lib/auth/**`, `web/src/middleware.ts`, `web/src/app/api/auth/**`

- [ ] `src/lib/auth/types.ts` — `AppSession` / `MemberRole` / `SessionScope`
- [ ] `src/lib/auth/session.ts` — `getAppSession()` · `requireSession()` · `requireFamilyScope()`
- [ ] **`src/lib/auth/scope.ts` — `visibleMemberIds()`** ★ 이 프로젝트에서 가장 중요한 함수
- [ ] `src/lib/auth/actions.ts` — `signInAction` / `signUpAction` / `signOutAction`
  - 인증은 `FamilyMember.name` + 비밀번호. **`bcryptjs`는 이미 설치돼 있습니다**
  - **첫 가입자가 ADMIN** — `FamilyMember`가 비어 있으면 ADMIN, 아니면 MEMBER. 경쟁 조건은 트랜잭션으로
- [ ] `src/middleware.ts` — `/family/**`에 `scope === 'FAMILY'` 검사
- [ ] 세션 쿠키 `httpOnly` + `sameSite: strict`
- [ ] 테스트
  - `visibleMemberIds(SELF)` → `[본인]` / `(FAMILY)` → `[전원]`
  - MEMBER 세션으로 `/family` 접근 → 리다이렉트
  - 잘못된 초대 코드로 가입 실패

**디바이스 세션(`scope: SELF` 강제)은 Phase 2 담당입니다.** W3에서는 웹 로그인만 다룹니다. 다만 `scope` 타입과 판정 구조는 지금 만듭니다.

### W3-B — UI 셸

담당 파일: `web/src/app/(app)/**`, `(family)/**`, `login/**`, `signup/**`, `layout.tsx`, `src/components/**`

- [ ] `app/layout.tsx` — 루트 레이아웃
- [ ] `app/login/page.tsx` · `app/signup/page.tsx`
- [ ] `app/(app)/layout.tsx` — `requireSession()` / `app/(app)/page.tsx` — 빈 대시보드
- [ ] `app/(family)/layout.tsx` — `requireFamilyScope()` / `app/(family)/family/page.tsx` — 빈 가족 화면
- [ ] 로그아웃 동선
- [ ] **모바일 우선** — 주 사용처가 앱 안의 WebView(폰 화면)

W3-B는 `src/lib/auth/`를 **import만** 하고 수정하지 않습니다. W3-A가 아직 안 끝났어도 계약서의 시그니처를 신뢰하고 진행하세요.

### 마무리

- [ ] `pnpm typecheck` / `lint` / `format:check` / `test` / `build` 통과
- [ ] **CI 실효성 확인** — 일부러 타입 오류를 넣어 빨간불이 뜨는지. CI가 무늬만 도는 상태를 방지
- [ ] PR → `main` 머지 → `CHANGELOG.md`에 `v0.1.0` 섹션, 태그

---

## 이 환경에서 배운 것 (반복하지 마세요)

### 1. Prisma 7의 파괴적 변경 세 가지

설계 문서는 Prisma 6 기준으로 쓰였습니다. 실제로는:

| 변경 | 대응 |
|---|---|
| `datasource.url`을 `schema.prisma`에 못 씀 (P1012) | `prisma.config.ts`에서 공급 |
| `migrate diff`의 `--to-schema-datamodel` → `--to-schema` | `ci.yml` 수정 완료 |
| `--shadow-database-url` 플래그 제거 | `prisma.config.ts`의 `datasource.shadowDatabaseUrl` |
| 드라이버 어댑터 필요 | `@prisma/adapter-pg` (`src/lib/db.ts`) |

`.env`에 **`SHADOW_DATABASE_URL`이 필요합니다.** `.env.example`을 확인하고 없으면 추가하세요.

### 2. 스키마 변경 후 `prisma generate`를 반드시 다시 돌릴 것

`migrate dev`가 exit 0으로 끝나도 생성된 클라이언트가 갱신 전 상태일 수 있습니다. 실제로 겪었습니다 — `name`에 UNIQUE를 추가했는데 `upsert`의 `where`가 여전히 `id`만 받아 시드가 실패했습니다.

```bash
pnpm prisma generate    # 스키마를 고쳤으면 항상
```

### 3. 서브에이전트에 위임하기 전에 환경을 먼저 검증할 것

W2 첫 시도에서 **2시간 반을 날렸습니다.** 지시서에 `docker compose up -d postgres`를 넣었는데 그 환경에 Docker 데몬이 없었습니다. 될 수 없는 일을 붙잡고 있었습니다.

작업을 맡기기 전에 **지시한 명령이 실제로 동작하는지 직접 확인**하세요.

### 4. 에이전트 보고를 그대로 믿지 말 것

실제로 걸러낸 것들:
- "standalone 아님" → 확인해보니 정상이었음 (`next.config.ts`에 `output: 'standalone'` 있음)
- CI 영향을 보고하지 않음 → 직접 종료코드를 확인해 빨간불을 미리 잡음

### 5. `/mnt/e`는 9p 파일시스템이라 inotify가 동작하지 않습니다

WSL에서 Windows 드라이브(`/mnt/e`)는 9p 프로토콜로 마운트됩니다. 리눅스의 파일 변경 감지(inotify)를 지원하지 않습니다. 실측 결과 `fs.watch` 이벤트가 **0건** 발생했습니다 (같은 테스트를 ext4에서 돌리면 1건). 파일 쓰기 성능도 떨어집니다 — 작은 파일 500개를 쓰는 데 ext4 대비 **약 47배** 느립니다 (1.172s vs 0.025s).

그래서 `web/next.config.ts`에 `watchOptions: { pollIntervalMs: 1000 }`을 넣었습니다. **이게 없으면 `next dev`의 HMR이 에러 없이 조용히 멈춥니다** — 파일을 고쳐도 반영이 안 되는데 에러 로그도 안 뜨니 원인을 찾기 어렵습니다. 저장소를 리눅스 파일시스템(`~/`)으로 옮기지 않는 한 이 설정을 지우지 마세요.

### 6. `/mnt/e`에서는 `chmod`가 먹지 않습니다

9p 파일시스템이 권한 비트를 무시해서, `.env`를 `600`으로 잠그려 해도 실제로는 `777`로 유지됩니다. `.gitignore`가 커밋 위험은 막아주지만, 파일 권한으로 접근을 제한하는 방어선은 이 환경에서 쓸 수 없습니다.

---

## 막힌 것 / 결정 대기

### 1. Docker 빌드가 한 번도 검증되지 않았습니다

`web/Dockerfile`의 `dev`/`prod` 두 타깃 모두 **원격 환경에 데몬이 없어 실행해보지 못했습니다.** WSL로 옮긴 뒤 가장 먼저 확인하세요.

```bash
docker build --target dev  -t familycard-dev  ./web
docker build --target prod -t familycard-prod ./web
docker run --rm -p 3000:3000 --env-file .env familycard-prod
```

특히 `prod` 스테이지는 Prisma 네이티브 엔진 때문에 `libc6-compat`·`openssl`을 넣어뒀는데, **이게 맞는지 실행으로만 확인할 수 있습니다.** 이미지는 빌드되는데 런타임에 엔진 로드가 실패하는 형태로 나타납니다.

### 2. Phase 2에서 필요해질 것 (미리 준비)

- 가족 구성원 이름과 카드 목록 (카드사 · **뒤 4자리** · 카드명 · 결제일)
- 서버를 돌릴 장비와 Tailscale 주소
- **카드사 앱 패키지명 — 실기기에서 확인해야 합니다.** 검색으로 알아내려 하지 마세요
  ```bash
  adb shell pm list packages | grep -i card
  ```

---

## 환경 메모

### 시드 계정

```
김도현  ADMIN   비밀번호: devpassword
김하은  MEMBER  비밀번호: devpassword
```

**개발 전용입니다.** 운영 DB에 시드를 돌리지 마세요.

카드 5장이 들어가는데, 그중 `김도현`의 SHINHAN 카드 2장은 뒷자리가 `1234`/`1834`로 **의도적으로 비슷하게** 배치돼 있습니다. Phase 3의 마스킹 매칭 충돌(`1*34` → 후보 2장 → `NEEDS_CARD`)을 재현하기 위한 것이니 지우지 마세요.

### 불변 규칙

[AGENTS.md](../AGENTS.md)의 7가지를 확인하세요. 특히:

1. `RawMessage`는 삭제하지 않는다
2. 모든 조회는 `visibleMemberIds(session)` 경유
3. 디바이스 세션은 절대 `FAMILY` scope로 발급하지 않는다
5. 집계는 `amount`가 아니라 `netAmount` 기준
7. **실제 카드 알림 원문·거래 데이터는 절대 커밋하지 않는다**

### Phase 2 → 3 순서

**실제 알림 원문이 쌓이기 전에 파서를 만들지 마세요.** 추측으로 정규식을 짜면 실물이 도착했을 때 전부 다시 써야 합니다. → [roadmap](plan/roadmap.md)

---

## 문서 지도

| 궁금한 것 | 문서 |
|---|---|
| 작업 규칙 · 명령어 | [AGENTS.md](../AGENTS.md) |
| **W3 인터페이스 계약** | **[plan/w3-contract.md](plan/w3-contract.md)** |
| 전체 구조 | [design/00-overview.md](design/00-overview.md) |
| 스키마 | [design/01-data-model.md](design/01-data-model.md) |
| 권한 모델 | [design/07-auth-scope.md](design/07-auth-scope.md) |
| 왜 이렇게 결정했나 | [adr/](adr/) |
| Phase별 작업 목록 | [plan/](plan/) |
| 서버 설치 · 운영 | [guide/admin-guide.md](guide/admin-guide.md) |
