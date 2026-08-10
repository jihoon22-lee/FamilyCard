# HANDOFF — 세션 인수인계

> **작업을 시작하기 전에 이 문서를 읽으세요.** 그리고 작업 단위를 마칠 때마다 갱신하세요.
>
> 갱신 절차: [AGENTS.md — 세션 종료 절차](../AGENTS.md)

**최종 갱신**: 2026-08-11 · Phase 2 서버 + 안드로이드 앱 **코드** 완료 (PR #6, #7 머지). 남은 건
**실기기 검증뿐**입니다 — 아직 아무도 실기기에 설치해보지 않았습니다.
**작성 환경**: 로컬 WSL (클라우드 원격 컨테이너에서 전환 완료)

---

## 환경

원격 컨테이너로는 Phase 2(Docker 빌드, 안드로이드 APK 빌드, 실기기 adb 연결, Tailscale·NAS 배포)를 완주할 수 없어서 로컬 WSL로 전환했습니다. **전환은 끝났습니다.**

| 항목 | 상태 |
|---|---|
| 저장소 위치 | `/mnt/e/projects/FamilyCard` |
| 기본 브랜치 | `main` — 원격에는 `main`만 남아 있음. 옛 `claude/family-card-expense-tracker-fwxj6m`는 삭제 완료 |
| JDK | 21.0.11 (`JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64`) |
| Android SDK | `~/android-sdk` (`ANDROID_HOME=~/android-sdk`, `platform-tools`에 `adb` 포함) |
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
| **2 — 수집 파이프라인** | 🟡 **코드 완료 · 실기기 검증 대기** ← 목표 지점 |
| 3 — 파서 + 카드 매칭 | ⬜ (원문이 며칠치 쌓이기 전엔 착수 금지 — 아래 "Phase 3로 넘어가는 조건") |
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
- **안드로이드 수집기 앱(`android/`)** — 캡처(`CardNotificationListener`/`SmsReceiver`/
  `CaptureFilter`) · 오프라인 큐(`QueueDatabase`) · `UploadWorker` · WebView 대시보드 ·
  설정 탭까지 전부 구현. 유닛 테스트 21건 통과(★★ 카카오톡 일반 대화 → 미수집 포함),
  `assembleDebug` 성공(APK 10MB), 매니페스트 확인(권한 5종·컴포넌트 4개, `READ_SMS` 없음).
  **실기기에는 아직 아무도 설치해보지 않았고, 카드사 앱 패키지 화이트리스트도 비어 있습니다**
  (아래 "지금 바로 할 일" 참고)
- CI 초록 — docs · web · **android**(최초로 실제 실행되어 통과, 2m45s) 전부

  > `gradlew` 실행 비트가 git에 커밋되지 않아 CI android 잡이 `exit 126`으로 죽었던 결함을
  > 고쳤습니다. 원인·해결은 아래 "이 환경에서 배운 것 — 6" 참고.

---

## 지금 바로 할 일 — Phase 2 실기기 검증

**서버도 안드로이드 앱도 코드는 끝났습니다** (PR #6, #7 머지). 남은 건 사람 손으로만 할 수 있는
일 — **실기기에 깔고, 실제로 결제하고, 결과를 확인하는 것**뿐입니다. 이 절차를 스크립트로 대신할
수 없습니다. 아래 순서대로 하나씩 직접 따라 하세요. `v0.2.0` 태그는 이 전부가 끝나야 답니다 —
아직 달지 않았습니다.

### 1. 앱 설치

먼저 셸 환경을 맞춥니다 (SDK는 `~/android-sdk`에 이미 설치돼 있습니다):

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME=~/android-sdk
export PATH="$ANDROID_HOME/platform-tools:$PATH"
```

빌드하고 폰에 설치합니다. 폰은 USB로 연결하고 **개발자 옵션 > USB 디버깅**을 켜 두세요
(연결 시 뜨는 "USB 디버깅을 허용하시겠습니까?" 팝업도 승인). WSL에서 USB 기기가 안 잡히면
`adb devices`가 빈 목록을 보여줍니다 — 그 경우 Windows 쪽에서 USB/IP로 폰을 WSL에 붙여주는
절차(`usbipd`)가 먼저 필요합니다.

```bash
cd android
./gradlew assembleDebug
# app/build/outputs/apk/debug/app-debug.apk

adb devices              # 폰이 목록에 보이는지 먼저 확인
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### 2. 카드사 앱 패키지명 확인 — 가장 먼저 할 일

**검색으로 알아내려 하지 마세요.** 카드사 앱 패키지명은 검색 결과가 부정확하고 앱이 바뀌면
달라집니다. 반드시 실기기에서 직접 확인하세요:

```bash
adb shell pm list packages | grep -iE 'card|shinhan|kb|samsung|hyundai|lotte|hana|nh|woori'
```

확인한 값을 `android/app/src/main/java/com/familycard/collector/capture/CaptureFilter.kt`의
`cardAppPackages`에 채웁니다(현재 빈 집합입니다):

```kotlin
val cardAppPackages: Set<String> = setOf(
    "com.shinhancard.smartshinhan",  // ← 실제로 확인한 값으로 교체
    // …
)
```

그다음 `android/app/src/test/java/com/familycard/collector/capture/CaptureFilterTest.kt`의
`` `카드사 앱 패키지 목록은 실기기 확인 전까지 비어 있다` `` 테스트를 지우고, 바로 위의
`` `카드사 앱 목록에 있으면 제목과 무관하게 수집한다` `` 테스트가 실제 값으로 검증하는지
확인하세요(그 테스트는 이미 `cardAppPackages`를 순회하므로 목록만 채우면 자동으로 실제
검증이 됩니다). 채운 뒤 `./gradlew testDebugUnitTest`로 다시 통과 확인하고 `assembleDebug`로
재설치하세요.

### 3. 권한 켜기

앱 설정 탭에 권한 상태 3종이 표시됩니다. 전부 ✅가 될 때까지:

- **알림 접근** — 설정 > 알림 > 특수 앱 접근 > 알림 접근 (또는 앱 설정 탭의 "설정" 버튼이
  바로 이 화면으로 보냅니다)
- **문자 수신** — 앱 설치 시 권한 팝업, 또는 앱 정보 > 권한
- **배터리 최적화 예외** — 꺼두지 않으면 안드로이드가 백그라운드에서 앱을 조용히 죽여
  알림을 놓칠 수 있습니다

### 4. 기기 토큰 발급

1. 관리자 계정으로 웹에 로그인 → `/family/devices` 접속
2. 구성원 선택 → 기기 이름 입력(예: "아빠 폰") → 발급
3. **토큰 원문은 이 화면에서 1회만 표시됩니다.** 새로고침하면 다시 못 봅니다 — 즉시 복사해
   앱 설정 탭의 "기기 토큰" 필드에 붙여넣고 저장하세요. 서버 주소(Tailscale 주소)도 함께
   입력합니다.

### 5. ★★ 개인정보 유출 검증 — 가족에게 배포하기 전에 반드시

**이 앱에서 가장 중요한 확인입니다.** 카카오톡으로 평범한 일반 대화(가족 단톡방, 친구 등)를
몇 건 받은 뒤, 서버에 **아무것도** 올라가지 않았는지 확인합니다:

```bash
docker compose exec -T postgres psql -U familycard -d familycard \
  -c 'select "packageName", "receivedAt" from "RawMessage" order by "receivedAt" desc limit 20;'
```

또는 웹의 `/raw` 화면에서 최근 항목을 확인해도 됩니다. **결과에 카카오톡(`com.kakao.talk`)
일반 대화가 한 건이라도 보이면 그 자리에서 배포를 중단하세요.** `CaptureFilter`의
`CARD_SENDER_PATTERN` 판정이 새고 있다는 뜻이고, 이미 가족의 사생활이 서버에 올라간
상태이므로 고친 뒤에도 해당 `RawMessage` 행을 확인해 처리해야 합니다(불변 규칙 1에 따라
삭제는 하지 않되, 최소한 원인 파악 전까지 다른 사람이 `/raw`에서 보지 못하게 하는 등의 조치를
사용자와 상의하세요).

### 6. 나머지 실기기 검증

- [ ] 실제 결제 → `/raw`에 원문이 표시되는지
- [ ] 기내모드로 전환한 뒤 결제 → 기내모드 해제(네트워크 복구) 후 자동 업로드되는지
- [ ] 폰 재부팅 → 알림 리스너·업로드 주기 작업이 자동으로 다시 도는지
- [ ] 서버(`docker compose down`)를 내린 상태에서 대시보드 탭을 열어 **흰 화면이 아니라
      안내 화면**이 뜨는지, "결제 내역은 계속 저장되고 있습니다" 문구가 보이는지
- [ ] 앱 진입 시 로그인 화면 없이 바로 본인 데이터가 보이는지 (1회용 nonce 로그인 흐름)

### 7. keystore 생성 · 백업

```bash
keytool -genkey -v -keystore familycard.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias familycard
```

**⚠️ 키를 잃어버리면 덮어쓰기 업데이트가 불가능합니다.** 그러면 가족 전원이 앱을 지우고
새로 깔아야 하고, 그 순간 **각자 폰 큐에 남아 있던 미전송 결제 알림이 전부 사라집니다** —
서버에 못 올린 데이터는 영원히 복구되지 않습니다. `familycard.jks`와 비밀번호는 암호화된
외장 저장소나 비밀번호 관리자 등 안전한 곳에 보관하고, **저장소에는 절대 커밋하지 마세요**
(`.gitignore`에 이미 등록돼 있습니다).

CI가 릴리스 APK를 자동 서명하게 하려면 GitHub Secrets에 등록합니다:

```bash
base64 -w0 familycard.jks   # 이 값을 KEYSTORE_BASE64 에
```

| Secret | 값 |
|---|---|
| `KEYSTORE_BASE64` | 위 base64 문자열 |
| `KEYSTORE_PASSWORD` | keystore 비밀번호 |
| `KEY_ALIAS` | `familycard` |
| `KEY_PASSWORD` | 키 비밀번호 |

전체 절차·대안(로컬 빌드로 CI 서명 우회)은 [admin-guide.md §6](guide/admin-guide.md)을
참고하세요.

### 8. Phase 3로 넘어가는 조건

가족이 **며칠간 실제로 카드를 써서** 각 카드사의 실제 알림 문구가 `/raw`에 모여야 합니다.
**원문이 쌓이기 전에 파서를 만들지 마세요** — 추측으로 정규식을 짜면 실물이 도착했을 때 전부
다시 써야 합니다([AGENTS.md — 작업 순서에 대한 주의](../AGENTS.md) 참고).

Phase 3의 첫 작업은 코드가 아니라 **`/raw`에서 카드사별 문구 변형을 목록화하는 것**입니다:
승인·취소·할부·해외결제·카드번호 마스킹 형태가 카드사마다 어떻게 다른지 최소 며칠치를
모아 표로 정리한 뒤에 파서 작업을 시작하세요.

### 완료 체크리스트 (Phase 2 전체 종료 시)

- [ ] 카드사 앱 패키지 화이트리스트를 실기기 확인 값으로 채움, 관련 테스트 실제 검증으로 교체
- [ ] 실기기: 실제 결제 → 원문 표시 / 기내모드 복구 후 자동 업로드 / 재부팅 후 서비스 자동
      시작 / 서버 내린 상태 → 안내 화면
- [ ] **실기기: 카카오톡 일반 대화 → 서버에 아무것도 안 올라감** ★★ (배포 전 필수, 아직 미완)
- [ ] keystore 생성·백업, CI Secrets 등록, CD가 릴리스 APK를 GitHub Release에 첨부하는지 확인
- [ ] 가족 전원 설치 완료, 각자 본인 데이터만 보임 확인
- [ ] 며칠간 원문 수집 → 카드사별 문구 변형 목록화(Phase 3 착수 조건)
- [ ] `CHANGELOG.md`에 `v0.2.0` 섹션을 끊고 태그

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

**실제로 문 사례 (PR #7)**: `android/gradlew`를 커밋했는데 CI의 android 잡이 `Permission denied`(exit 126)로 죽었습니다. 원인은 이 항목 그대로였습니다 — `chmod +x android/gradlew`를 실행해도 9p가 권한 비트를 무시해 실제 파일 모드는 그대로였고, git이 인덱스에 실행 비트 없는 `100644`로 기록했습니다. CI 러너(ext4)에서 그 모드 그대로 체크아웃되니 `./gradlew`가 실행 권한 없이 걸린 것입니다.

파일시스템을 거치지 않고 **git 인덱스에 직접** 실행 비트를 기록하면 우회됩니다:

```bash
git update-index --chmod=+x android/gradlew
git commit -m "fix(android): gradlew 실행 비트를 git 인덱스에 기록"
```

`/mnt/e`에서 실행 파일(`gradlew`, 셸 스크립트 등)을 새로 커밋할 때는 `chmod +x`로 끝냈다고
믿지 말고 `git ls-files -s <파일>`로 모드가 `100755`인지 항상 확인하세요. `100644`면 위 명령으로
고친 뒤 커밋하세요.

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

코드로 막힌 것은 없습니다. 남은 전부가 **사람이 실기기로 직접 해야 하는 일**입니다 — 위
"지금 바로 할 일 — Phase 2 실기기 검증"을 그대로 따라 하세요. 특히 2번(카드사 앱 패키지명
실기기 확인)을 하지 않으면 카드사 앱 알림이 전혀 캡처되지 않고, 5번(카카오톡 유출 검증)을
통과하기 전에는 가족에게 배포할 수 없습니다.

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
