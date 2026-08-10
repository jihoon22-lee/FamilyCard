# HANDOFF — 세션 인수인계

> **작업을 시작하기 전에 이 문서를 읽으세요.** 그리고 작업 단위를 마칠 때마다 갱신하세요.
>
> 갱신 절차: [AGENTS.md — 세션 종료 절차](../AGENTS.md)

**최종 갱신**: 2026-08-11 · Phase 1 W3 완료 (Auth.js 인증 · scope 가시성 계층 · UI 셸)
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
| **1 — 프로젝트 스캐폴딩** | ✅ **완료 (3웨이브 전부)** — PR 머지 대기 |
| 2 — 수집 파이프라인 ← 목표 지점 | ⬜ |
| 3 — 파서 + 카드 매칭 | ⬜ |
| 4 — 실적 엔진 | ⬜ |
| 5 — 관리자 대시보드 | ⬜ |
| 6 — 보정 · 운영 | ⬜ |
| 7 — 실사용 검증 · 안정화 | ⬜ |

### Phase 1 웨이브

| 웨이브 | 범위 | 상태 |
|---|---|---|
| W1 | Next.js 스캐폴딩 · 툴링 · Dockerfile · `/api/health` | ✅ PR #1 머지 |
| W2 | Prisma 스키마 11모델 · 마이그레이션 · 시드 | ✅ PR #2 머지 |
| **W3-A** | **Auth.js + scope 계층 · 미들웨어** | ✅ 구현 완료, PR 리뷰 대기 |
| **W3-B** | **UI 셸 · 로그인/가입 화면** | ✅ 구현 완료, PR 리뷰 대기 |

`main` = `2aa5b43` (PR #5 squash 머지 완료)

### 지금 동작하는 것

- `GET /api/health` → `200 {"status":"ok"}`
- `pnpm db:seed` → 가족 2명(ADMIN/MEMBER), 카드 5장, 카테고리 7종
- 로그인 · 가입 · 로그아웃, 빈 대시보드(`/`), 빈 가족 화면(`/family`, ADMIN 전용)
- `visibleMemberIds()` 가시성 계층, 미들웨어 라우트 보호
- `typecheck` / `lint` / `format:check` / `test`(27건) / `build` 전부 통과
- Docker `dev`/`prod` 빌드 성공, prod 이미지로 권한 경계 6종 검증 완료
- CI 초록 (docs · web 잡, android는 디렉토리 없어 건너뜀)

---

## 지금 바로 할 일 — Phase 2 착수

**Phase 1은 완료됐습니다.** PR이 머지되면 `CHANGELOG.md`에 `v0.1.0` 섹션을 끊고 태그를 답니다 (이번 세션에서는 PR 생성까지만 — 머지는 지휘자가 CI 실효성 확인 후 직접 처리).

Phase 2의 목표는 실제 카드사 알림이 서버 DB에 원문 그대로 쌓이는 것입니다. 자세한 배경은 [docs/plan/phase-2.md](plan/phase-2.md), 설계는 [docs/design/02-ingest.md](design/02-ingest.md) 참고.

### 첫 착수 지점

**`web/src/app/api/ingest/route.ts`에 `POST /api/ingest` 구현.**

- `Device.tokenHash`로 `Authorization: Bearer <deviceToken>` 검증 (상수 시간 비교)
- `RawMessage.dedupeHash = sha256([deviceId, packageName, body, truncateToMinute(receivedAt)].join('|'))` —
  UNIQUE 충돌 시 `duplicates` 카운트
- 배열 배치 수신, 유효성 검사(빈 body, 4000자 초과, 미래 시각, 5년 이전) 후 `{ accepted, duplicates, rejected }` 응답
- 전부 `parseStatus: PENDING`으로 저장 — **파싱은 하지 않음**
- `Device` 모델은 Phase 1 W2에서 이미 생성돼 있어 바로 쓸 수 있습니다. 로컬 테스트용 토큰은
  `pnpm prisma studio`나 짧은 스크립트로 `Device` 행 하나를 직접 만들어 확보하세요
  (관리자용 기기 등록 화면·QR 발급은 다음 작업이며, `/api/ingest` 자체를 막지 않습니다)

이어질 작업(같은 서버: 수집 카테고리): 관리자 기기 등록 화면(토큰 1회 표시 + QR), `POST /api/auth/device-session`
(60초 1회용 nonce → **무조건 `scope: SELF`**, `web/src/lib/auth/scope.ts`의 `scopeForWebLogin()` 옆에
자리를 표시해 둔 디바이스 경로가 이걸로 채워집니다), `/raw` 원문 목록 화면.

안드로이드 캡처(`CardNotificationListener`, `SmsReceiver`, `CaptureFilter`)는 서버 쪽 `/api/ingest`가
curl로 검증된 뒤 착수하는 편이 안전합니다 — 실기기 없이도 서버 계약을 먼저 굳힐 수 있습니다.

### Phase 2 선행 준비물 (미리 확보)

- **카드사 앱 패키지명 — 반드시 실기기에서 확인.** 검색으로 추측하지 마세요
  ```bash
  adb shell pm list packages | grep -i card
  ```
- 가족 카드 목록 (카드사 · 뒤 4자리 · 카드명 · 결제일)
- 서버를 돌릴 장비의 Tailscale 주소
- Android SDK 설치 (`android/` 빌드용 — 이 WSL 환경엔 아직 없을 수 있음, `./gradlew` 실행 전 확인)

### 마무리 체크리스트 (Phase 2 완료 시)

- [ ] `pnpm typecheck` / `lint` / `format:check` / `test` / `build` 통과
- [ ] CI 실효성 확인 — 일부러 타입 오류를 넣어 빨간불이 뜨는지
- [ ] PR → `main` 머지 → `CHANGELOG.md`에 `v0.2.0` 섹션, 태그

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

### 7. `next build`는 `.env` 없이도 통과해야 합니다

모듈 로드 시점(top-level)에 `DATABASE_URL`을 요구하는 코드를 짜면 Docker 빌드가 깨집니다. `.dockerignore`가 `.env`를 빌드 컨텍스트에서 제외하기 때문에, 빌드 단계에는 그 값이 없습니다. 실제로 겪은 증상:

```
[Error: Failed to collect configuration for /]
cause: DATABASE_URL이 설정되지 않았습니다
```

해결은 `src/lib/db.ts`의 Prisma 클라이언트를 **첫 사용 시점까지 지연 생성**하는 것입니다. 빌드가 런타임 설정을 요구하지 않도록 항상 이렇게 짜세요.

### 8. `docker build ... | tail`은 종료 코드를 가립니다

파이프의 종료 코드는 파이프라인 마지막 명령(`tail`)의 것입니다. `docker build`가 실패해도 `tail`이 0으로 끝나면 `$?`는 0입니다. 실제로 이것 때문에 **실패한 빌드를 성공으로 오인**했습니다. 파이프로 출력을 자를 때는 `set -o pipefail`을 켜거나 `${PIPESTATUS[0]}`로 실제 종료 코드를 확인하세요.

---

## 막힌 것 / 결정 대기

Phase 1 종료 시점 기준으로 새로 막힌 것은 없습니다. Phase 2 착수 전 준비물은 위 "지금 바로 할 일" 절의 "Phase 2 선행 준비물"을 확인하세요.

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
| **Phase 2 수집 파이프라인 설계** | **[design/02-ingest.md](design/02-ingest.md)** |
| W3 인터페이스 계약 (참고용, 완료됨) | [plan/w3-contract.md](plan/w3-contract.md) |
| 전체 구조 | [design/00-overview.md](design/00-overview.md) |
| 스키마 | [design/01-data-model.md](design/01-data-model.md) |
| 권한 모델 | [design/07-auth-scope.md](design/07-auth-scope.md) |
| 왜 이렇게 결정했나 | [adr/](adr/) |
| Phase별 작업 목록 | [plan/](plan/) |
| 서버 설치 · 운영 | [guide/admin-guide.md](guide/admin-guide.md) |
