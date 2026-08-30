# AGENTS.md — 작업 가이드라인

이 저장소에서 작업하는 모든 사람과 AI 에이전트가 따르는 규칙입니다. **코드를 건드리기 전에 이 문서와 [docs/HANDOFF.md](docs/HANDOFF.md)를 먼저 읽으세요.**

---

## 프로젝트 한 문단 요약

가족 구성원의 안드로이드 폰에 설치된 앱이 카드 결제 알림·문자를 캡처해 집 서버로 **원문 그대로** 보냅니다. 서버(Next.js)가 그 원문을 파싱해 거래로 만들고, 카드 한 장 단위로 월간 사용금액과 전월실적 달성 추정치를 계산합니다. 가족은 앱 안의 WebView로 **본인 것만** 보고, 관리자는 웹 브라우저로 **가족 전체**를 봅니다.

---

## 디렉토리 구조

```
familycard/
├── AGENTS.md                이 문서
├── CHANGELOG.md             버전별 변경점
├── docker-compose.yml       개발용 (postgres + web)
├── docker-compose.prod.yml  NAS 배포용 (GHCR 이미지 pull)
├── web/                     Next.js 15 App Router — 서버의 전부
│   ├── prisma/              schema.prisma, migrations, seed
│   └── src/
│       ├── app/(app)/       scope=SELF 화면 — 앱 WebView + 일반 구성원 웹
│       ├── app/(family)/    scope=FAMILY 화면 — 관리자 전용
│       ├── app/api/         API 라우트
│       ├── lib/auth/        인증 · scope 판정 ★ 가시성 중앙 통제
│       ├── lib/parser/      알림 원문 → 필드 추출
│       ├── lib/cardmatch/   추출된 카드번호 → 실제 카드 매칭
│       └── lib/benefit/     전월실적 산정
├── android/                 Kotlin 앱 — 수집기 + WebView 대시보드
└── docs/
    ├── HANDOFF.md           ★ 세션 인수인계 — 항상 최신으로 유지
    ├── design/              설계 문서 (구현 전 반드시 참조)
    ├── plan/                Phase별 작업 체크리스트
    ├── adr/                 주요 결정 기록
    └── guide/               사용자 · 관리자 가이드
```

---

## 불변 규칙 (Invariants)

**아래 7가지는 설계의 근간입니다. 어기면 나중에 되돌리기 매우 어렵습니다.** 각 규칙 옆의 문서에 이유가 적혀 있으니, 어겨야 할 것 같으면 먼저 그 문서를 읽고 그래도 필요하다면 ADR을 추가하세요.

### 1. `RawMessage`는 삭제하지 않는다
수집한 알림 원문은 영구 보관합니다. `Transaction`은 원문에서 언제든 재생성 가능한 **파생 데이터**입니다. 파싱 규칙을 고친 뒤 과거 전체를 재파싱하는 것이 이 시스템의 핵심 복구 수단이라, 원문을 지우면 그 능력을 잃습니다.
→ [03-parser](docs/design/03-parser.md), [ADR 0004](docs/adr/0004-parse-on-server.md)

### 2. 모든 조회는 `visibleMemberIds(session)`를 경유한다
화면이나 API마다 `where { memberId: ... }`를 손으로 쓰면 언젠가 빠뜨리고, 그 순간 가족 데이터가 샙니다. 조회 경로를 하나로 모아두면 감사할 곳도 하나입니다.
```ts
// ✅ 이렇게
const txs = await prisma.transaction.findMany({
  where: { memberId: { in: visibleMemberIds(session) }, ...filters },
});

// ❌ 이렇게 하지 마세요
const txs = await prisma.transaction.findMany({ where: { memberId: params.memberId } });
```
→ [07-auth-scope](docs/design/07-auth-scope.md)

### 3. 디바이스 세션은 절대 `FAMILY` scope로 발급하지 않는다
`role`이 `ADMIN`이어도, 안드로이드 앱에서 들어온 세션은 **무조건 `SELF`** 입니다. scope는 role이 아니라 **진입 경로**로 먼저 결정됩니다. 폰 분실 시 피해를 본인 데이터로 한정하기 위한 장치입니다.
→ [ADR 0005](docs/adr/0005-scope-by-entrypoint.md)

### 4. 화이트리스트 외 알림은 앱에서 저장조차 하지 않는다
`NotificationListenerService`는 폰에 오는 **모든** 알림을 봅니다. 카카오톡 개인 대화도 포함됩니다. 카드사 알림톡을 받으려면 `com.kakao.talk`을 화이트리스트에 넣어야 하는데, 여기서 필터가 새면 가족 사생활이 통째로 서버에 쌓입니다. 화이트리스트 판정은 **로컬 큐에 넣기 전에** 하고, 걸러진 알림은 메모리에서도 즉시 버립니다. 일단 저장하고 나중에 거르는 구조는 금지입니다.
→ [08-android-app](docs/design/08-android-app.md)

### 5. 모든 집계는 `amount`가 아니라 `netAmount` 기준
`netAmount = amount - canceledAmount`. 취소가 실적에 반영되지 않으면 이 프로젝트의 존재 이유인 실적 추정이 틀립니다. 새 집계 쿼리를 쓸 때마다 확인하세요.
→ [05-cancellation](docs/design/05-cancellation.md)

### 6. 실적 수치는 UI에서 항상 "추정치"로 표기한다
알림 파싱은 부분취소·할부변경·해외 환율확정액을 완전히 따라가지 못합니다. 사용자가 이 숫자를 카드사 공식 수치로 오인하면 실제로 손해를 볼 수 있습니다. 실적을 보여주는 모든 화면에 추정치임을 명시하세요.
→ [06-benefit-engine](docs/design/06-benefit-engine.md)

### 7. 실제 카드 알림 원문·카드번호·거래내역은 절대 커밋하지 않는다
파서 테스트를 짜다 보면 실제 문자를 그대로 픽스처에 붙여넣기 쉽습니다. 그러면 가족의 거래내역이 GitHub에 영구히 남습니다. 픽스처는 **가공된 샘플**만 씁니다.
```
✅ "[○○카드] 홍길동님 12,000원 일시불 08/10 14:23 테스트가맹점"
❌ 실제 문자 복붙 (실제 가맹점명·금액·카드 뒷번호)
```
가맹점명·금액·카드번호·이름을 전부 가짜로 바꾸되, **구두점과 공백 구조는 실물 그대로** 유지해야 파서 테스트가 의미 있습니다.

---

## 개발 명령어

```bash
# ── 최초 설정 ──────────────────────────────────────────
cp .env.example .env
openssl rand -base64 32                # AUTH_SECRET 에 붙여넣기
docker compose up -d postgres
cd web && pnpm install

# ── 일상 개발 ──────────────────────────────────────────
pnpm dev                               # 개발 서버 (http://localhost:3000)
pnpm build                             # 프로덕션 빌드
pnpm typecheck                         # tsc --noEmit
pnpm lint                              # eslint
pnpm format                            # prettier --write
pnpm test                              # vitest run
pnpm test:watch                        # vitest

# ── 데이터베이스 ───────────────────────────────────────
pnpm prisma migrate dev --name <설명>   # 스키마 변경 후 마이그레이션 생성
pnpm prisma migrate deploy             # 운영 반영
pnpm prisma studio                     # DB GUI
pnpm db:seed                           # 시드 데이터

# ── 안드로이드 ─────────────────────────────────────────
cd android
./gradlew assembleDebug                # 디버그 APK
./gradlew testDebugUnitTest            # 유닛 테스트
./gradlew ktlintCheck                  # 린트
./gradlew assembleRelease              # 서명 릴리스 APK (keystore 필요)
```

---

## 코딩 규칙

### TypeScript
- `strict: true`. `any` 대신 `unknown` + 좁히기. 불가피하면 이유를 주석으로
- 서버 컴포넌트를 기본으로, `'use client'`는 상호작용이 필요한 잎 컴포넌트에만
- 금액은 **정수 원 단위**로 다룹니다. 부동소수점 금지 (Prisma `Int`, 필요시 `BigInt`)
- 날짜는 DB에 UTC로 저장하고 표시할 때 KST로 변환. 카드사 사이클 계산은 **KST 기준**이라 경계에서 어긋나기 쉬우니 주의
- 에러는 삼키지 말고 로깅 후 재던지기. API 라우트는 사용자에게 보일 메시지와 내부 로그를 분리

### 파일·네이밍
- 컴포넌트 `PascalCase.tsx`, 그 외 `kebab-case.ts`
- 라이브러리 모듈은 `index.ts`로 공개 API를 명시하고 내부 구현은 숨기기

### Kotlin
- Jetpack Compose + Material 3. 4칸 들여쓰기
- 백그라운드 작업은 `WorkManager`. 직접 스레드를 만들지 않습니다
- 캡처 로직에 로그를 남길 때 **알림 본문을 로그에 찍지 마세요** (규칙 4·7의 연장)

### 테스트
- 파서·카드매칭·취소·실적 계산은 **유닛 테스트 필수**. 이 4개가 이 프로젝트의 핵심 로직입니다
- 권한(scope) 관련 변경은 **반드시 테스트를 동반**합니다. "타인 데이터가 안 보이는지"를 명시적으로 검증하세요
- 픽스처는 규칙 7에 따라 가공된 샘플만

---

## 커밋 규칙

[Conventional Commits](https://www.conventionalcommits.org)를 씁니다. CHANGELOG 작성과 연결됩니다.

```
feat:     새 기능           → CHANGELOG "Added"
fix:      버그 수정         → CHANGELOG "Fixed"
docs:     문서만 변경
refactor: 동작 변화 없는 구조 개선
test:     테스트 추가·수정
chore:    빌드·설정·의존성
perf:     성능 개선         → CHANGELOG "Changed"
security: 보안 관련         → CHANGELOG "Security"
```

예시:
```
feat(parser): 신한카드 승인/취소 알림 파싱 규칙 추가
fix(benefit): 부분취소가 실적에서 두 번 차감되던 문제 수정
docs(handoff): Phase 2 완료 상태 반영
```

### 커밋 금지 목록
`.env` · `*.keystore` · `*.jks` · `local.properties` · DB 덤프 · **실제 카드 알림 원문이나 거래 데이터가 담긴 모든 파일**

### 브랜치와 PR (필수)

- `main`에 직접 커밋하거나 push하지 않습니다.
- 모든 변경은 `feat/...`, `fix/...`, `docs/...` 등 별도 브랜치에서 작업합니다.
- 브랜치를 원격에 push하고 PR을 만든 뒤, 필수 CI가 모두 통과한 것을 확인해야 병합합니다.
- CI 실패를 우회하거나 검증 전 병합하지 않습니다. 긴급 수정도 같은 절차를 따릅니다.
- 병합은 GitHub PR 기능으로 수행합니다. 로컬에서 `main`에 merge한 뒤 push하는 방식은 금지합니다.

---

## 세션 종료 절차 (필수)

이 프로젝트는 Phase 6까지 가고 세션이 여러 번 끊깁니다. **작업 단위를 마칠 때마다 아래를 수행하세요.** 이걸 빼먹으면 다음 세션이 코드를 처음부터 읽어야 합니다.

1. **`docs/HANDOFF.md` 갱신** — 현재 상태 / 다음 할 일 / 미완료 사항 / 막힌 것
   - "다음 할 일"은 **파일 경로까지 구체적으로**. "파서 작업"이 아니라 "`web/src/lib/parser/rules/shinhan.ts`에 취소 케이스 추가"
   - 작업하다 만 것, 임시로 둔 것, `TODO` 주석 위치를 빠짐없이
2. **`CHANGELOG.md`의 `Unreleased` 섹션 갱신**
3. **`docs/plan/phase-N.md` 체크박스 갱신**
4. 기능 브랜치에 커밋·push → PR 생성 → CI 통과 확인 → PR 병합

Phase를 완료했다면 추가로: `CHANGELOG.md`에 버전 섹션을 끊고 태그(`v0.N.0`)를 붙입니다. 태그를 push하면 CD가 GHCR 이미지와 릴리스 APK를 만듭니다.

---

## 작업 순서에 대한 주의

**Phase 2(수집)를 완주하기 전에 Phase 3(파서)를 시작하지 마세요.**

실제 카드사 알림 문구를 모으기 전에 정규식을 짜면 추측으로 짜게 되고, 실물이 도착하면 전부 다시 써야 합니다. Phase 2의 산출물인 "쌓인 원문"이 Phase 3의 입력입니다.

Phase 간 의존관계는 [docs/plan/roadmap.md](docs/plan/roadmap.md)에 정리돼 있습니다.

---

## 막혔을 때

- **설계 의도가 이해되지 않을 때** → `docs/design/`의 해당 문서, 그다음 `docs/adr/`
- **왜 이런 제약이 있는지 모를 때** → ADR에 배경·대안·결론이 적혀 있습니다
- **문서에 답이 없을 때** → 추측으로 진행하지 말고 사용자에게 확인하고, 결정되면 ADR로 남기세요
