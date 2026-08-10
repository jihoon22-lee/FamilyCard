# HANDOFF — 세션 인수인계

> **작업을 시작하기 전에 이 문서를 읽으세요.** 그리고 작업 단위를 마칠 때마다 갱신하세요.
>
> 갱신 절차: [AGENTS.md — 세션 종료 절차](../AGENTS.md)

**최종 갱신**: 2026-08-11 · Phase 2 서버 파트 완료 (`/api/ingest` · 디바이스 토큰·세션 · `/raw`), 안드로이드 앱 남음
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
| **1 — 프로젝트 스캐폴딩** | ✅ **완료 (3웨이브 전부)** |
| **2 — 수집 파이프라인** | 🟡 **서버 파트 완료** · 안드로이드 앱 남음 ← 목표 지점 |
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
- **`POST /api/ingest`** — 디바이스 토큰 인증 · 배치 수집 · `dedupeHash` 멱등 ·
  유효성 검사. 실서버 `curl`로 기본 수집 / 재전송 중복 / 제목만 바뀐 재전송 /
  잘못된 토큰(401) / 미래 시각(rejected) / 부분 실패(2 성공 + 1 거부) 전부 확인
- **`/family/devices`** — 디바이스 토큰 발급(1회 표시) · 폐기 (ADMIN 전용, MEMBER는 `307 → /`)
- **`POST /api/auth/device-session`** — 60초 1회용 nonce로 디바이스 토큰 → 세션 교환.
  **ADMIN 기기 토큰으로 발급해도 세션은 항상 `scope: SELF`**임을 실서버로 확인
  (그 세션으로 `/family` 접근 시 `307 → /`)
- **`/raw`** — 수집된 원문 목록, 실서버에서 3건 전부 표시 확인
- `typecheck` / `lint` / `format:check` / `test`(129건) / `build` 전부 통과
- Docker `dev`/`prod` 빌드 성공, prod 이미지로 권한 경계 6종 검증 완료
- CI 초록 (docs · web 잡, android는 디렉토리 없어 건너뜀)

---

## 지금 바로 할 일 — Phase 2 안드로이드 앱 착수

**Phase 2 서버 파트는 완료됐습니다.** `POST /api/ingest`, 디바이스 토큰 발급·폐기
(`/family/devices`), `POST /api/auth/device-session`, `/raw` 전부 실서버로 검증했습니다. 남은 건
**안드로이드 수집기 앱 하나**뿐입니다. `v0.2.0` 태그는 이 앱까지 끝나야 답니다 — 아직 달지 않았습니다.

목표·완료 기준은 [docs/plan/phase-2.md](plan/phase-2.md)의 "안드로이드" 이하 섹션, 설계는
[docs/design/08-android-app.md](design/08-android-app.md) 전체를 먼저 읽으세요. 서버 계약은
이미 굳어 있으므로([docs/plan/phase2-contract.md](plan/phase2-contract.md) §1~§3) 앱은 그
계약대로 호출하기만 하면 됩니다.

### 첫 착수 지점

`android/` 디렉터리 자체가 아직 없습니다. 순서대로:

1. **Gradle 프로젝트 뼈대 생성** — [08-android-app](design/08-android-app.md) "구조" 절의
   패키지 레이아웃대로 모듈을 만듭니다 (`capture/`, `queue/`, `net/`, `ui/`).
2. **`CaptureFilter` 부터 구현** — 이 앱에서 ★가장 중요한 코드★이고, `NotificationListenerService`나
   실기기 없이도 **순수 Kotlin 유닛 테스트**로 완성할 수 있는 유일한 조각입니다. 실기기·SDK
   설정이 끝나기 전에 먼저 짜고 테스트를 통과시켜 두세요.
   - 카드사 패키지 화이트리스트 → `true`
   - `com.kakao.talk` + 카드사 패턴 제목 → `true`
   - `com.kakao.talk` + 일반 대화 제목 → **`false`** ★★ (design/08-android-app.md "테스트" 참고)
   - 그 외 패키지 → `false`
3. 그다음 `CardNotificationListener` / `SmsReceiver`가 `CaptureFilter`를 **Room에 넣기 전에** 호출하도록 배선.
4. Room `PendingMessage` + DAO → `UploadWorker`(서버는 이미 있으므로 `POST /api/ingest`에 바로 붙습니다) →
   화면(WebView 대시보드 + 설정 탭) 순서로 진행.

### ★★ 선행 준비물 — 착수 전에 반드시 확보

아래 중 하나라도 없으면 중간에 멈춥니다. 시작 전에 전부 확인하세요.

- **Android SDK (cmdline-tools) 설치.** 이 WSL 환경에는 아직 없습니다(`ANDROID_HOME` 미설정,
  `android/` 없음 — 이번 세션에 확인함). `./gradlew` 실행 전 SDK·플랫폼·빌드툴 설치부터.
- **실기기에서 카드사 앱 패키지명 확인 — 검색으로 알아내려 하지 말 것.**
  ```bash
  adb shell pm list packages | grep -i card
  ```
  `CaptureFilter`의 화이트리스트가 이 목록에 의존합니다. 잘못 추측하면 카카오톡 일반 대화가
  새는 방향으로 실패할 수 있습니다.
- **가족 카드 목록** (카드사 · 뒤 4자리 · 카드명 · 결제일) — 시딩·매칭 확인용.
- **서버를 돌릴 장비의 Tailscale 주소** — 앱 설정 탭의 서버 주소 입력, WebView 연결 대상.

### 마무리 체크리스트 (Phase 2 전체 완료 시)

- [ ] `CaptureFilter` 유닛 테스트 전부 통과 (카카오톡 일반 대화 → false 포함)
- [ ] 실기기: 실제 결제 → 서버 원문 표시 / 기내모드 복구 후 자동 업로드 / 재부팅 후 서비스 자동 시작 /
      서버 내린 상태 → 안내 화면
- [ ] **실기기: 카카오톡 일반 대화 → 서버에 아무것도 안 올라감** ★★ (배포 전 필수)
- [ ] keystore 생성·백업, CI Secrets 등록, CD가 릴리스 APK를 GitHub Release에 첨부하는지 확인
- [ ] `pnpm typecheck` / `lint` / `format:check` / `test` / `build` 통과 (서버 쪽 회귀 없는지)
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

### 9. 유닛 테스트가 미들웨어를 통과하지 않습니다

라우트 핸들러(`POST()`, `GET()` 등)를 직접 호출하는 테스트는 Next.js 미들웨어를 거치지 않습니다. `POST /api/ingest`가 실제로는 미들웨어의 세션 검사에 걸려 `307 → /login`으로 막히고 있었는데, 유닛 테스트 129건이 전부 초록이었습니다 — 전부 핸들러를 직접 호출했기 때문입니다. **실서버 `curl` 통합 확인에서만** 드러났습니다.

새 API를 추가하면 유닛 테스트가 통과해도 **실서버에 `curl`로 한 번은 직접 쳐서 확인**하세요. 특히 세션 쿠키 없이 다른 방식(디바이스 토큰 등)으로 인증하는 경로는 미들웨어가 세션 기준으로만 판단하기 쉬워 이 함정에 걸리기 좋습니다.

### 10. 라우트 그룹은 URL에 나타나지 않습니다

Next.js의 `(groupName)/` 라우트 그룹은 파일 조직용일 뿐 URL 경로에 포함되지 않습니다. `(family)/devices/page.tsx`로 만들면 URL은 `/devices`이지 `/family/devices`가 아닙니다. 실제로 이렇게 만들어졌다가, 미들웨어가 `/family/**` 문자열로 보호 대상을 판단하는 코드였던 탓에 그 화면이 **1차 방어선 없이** 떠 있었습니다(레이아웃의 `requireFamilyScope()` 2차 방어선만 동작). `(family)/family/devices/`로 옮겨 URL과 미들웨어 검사 대상을 일치시켰습니다.

라우트 그룹 밑에 새 화면을 추가할 때는 실제 렌더링 URL을 브라우저 주소창으로 직접 확인하고, 미들웨어가 그 URL 문자열을 검사 대상에 포함하는지 대조하세요.

### 11. `next dev`가 도는 중에 `next build`를 돌리지 마세요

둘 다 같은 `.next` 디렉터리를 씁니다. `next dev`가 떠 있는 상태에서 `next build`를 돌리면 그 산출물을 덮어써서, 실행 중인 dev 서버가 `Cannot find module './chunks/vendor-chunks/...'` 류의 에러로 죽습니다. 실제로 겪었고, `.next` 삭제 후 dev 서버 재시작으로 복구했습니다. 빌드를 확인하려면 dev 서버를 먼저 내리거나 별도 워크트리에서 돌리세요.

---

## 막힌 것 / 결정 대기

Phase 2 서버 파트 종료 시점 기준으로 새로 막힌 것은 없습니다. 안드로이드 앱 착수 전 준비물은 위 "지금 바로 할 일" 절의 "선행 준비물"을 확인하세요 — 특히 Android SDK 미설치와 카드사 패키지명 미확인은 착수를 바로 막습니다.

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
