# FamilyCard

가족 카드 사용내역을 자동으로 모아 **카드 한 장 단위로** 월간 사용금액과 전월실적 달성 추정치를 보여주는 자가호스팅 시스템.

카드사 앱을 사람 수 × 카드사 수만큼 들락거리지 않아도 되고, 실적 미달로 혜택을 놓치는 일을 줄이는 것이 목적입니다.

---

## 어떻게 동작하나

```
[가족 폰 — 앱 하나]                    [집 서버 / NAS]
카드 결제 알림·문자 캡처  ──원문 전송──▶  파싱 · 카드 매칭 · 실적 계산
앱 안에서 본인 통계 확인  ◀──WebView──   대시보드 화면 제공
                                            ▲ Tailscale
                              관리자 PC 브라우저 → 가족 전체 통계
```

카드 결제 알림은 각자 본인 폰에만 오기 때문에, 가족 데이터를 합치려면 합류 지점(서버)이 필요합니다. 자세한 배경은 [ADR 0002](docs/adr/0002-server-required.md)를 보세요.

### 보이는 범위

| 진입 경로 | 보이는 것 |
|---|---|
| 안드로이드 앱 | **본인 카드만** (관리자도 동일) |
| 웹 로그인 — 일반 구성원 | 본인 카드만 |
| 웹 로그인 — 관리자 | **가족 전원** |

---

## 문서

**처음 오셨다면 목적에 맞는 것부터 읽으세요.**

| 나는… | 읽을 문서 |
|---|---|
| 가족이고, 앱을 쓰려고 한다 | [사용자 가이드](docs/guide/user-guide.md) → [카드사 알림 설정](docs/guide/onboarding.md) |
| 서버를 설치·운영한다 | [관리자 가이드](docs/guide/admin-guide.md) |
| 이 프로젝트를 개발한다 | **[AGENTS.md](AGENTS.md)** → [HANDOFF.md](docs/HANDOFF.md) → [로드맵](docs/plan/roadmap.md) |
| 설계 의도가 궁금하다 | [설계 개요](docs/design/00-overview.md) · [ADR 목록](docs/adr/) |

### 설계 문서

| 문서 | 내용 |
|---|---|
| [00-overview](docs/design/00-overview.md) | 전체 아키텍처 · 컴포넌트 경계 |
| [01-data-model](docs/design/01-data-model.md) | 스키마 · ERD · 인덱스 근거 |
| [02-ingest](docs/design/02-ingest.md) | 수집 파이프라인 · 멱등성 · 오프라인 큐 |
| [03-parser](docs/design/03-parser.md) | 파서 규칙 · 재파싱 · 실패 처리 |
| [04-card-matching](docs/design/04-card-matching.md) | 마스킹된 카드번호 매칭 |
| [05-cancellation](docs/design/05-cancellation.md) | 전액·부분·고아 취소 처리 |
| [06-benefit-engine](docs/design/06-benefit-engine.md) | 전월실적 산정 · 제외 항목 |
| [07-auth-scope](docs/design/07-auth-scope.md) | 권한 모델 · 위협 모델 |
| [08-android-app](docs/design/08-android-app.md) | 앱 구조 · 권한 · WebView |

---

## 빠른 시작 (개발)

**필요한 것**: Node 22 (`.nvmrc`), pnpm, Docker, JDK 17 (안드로이드 작업 시)

```bash
# 1. 환경 변수 준비
cp .env.example .env
openssl rand -base64 32     # 출력값을 .env 의 AUTH_SECRET 에 붙여넣기
# POSTGRES_PASSWORD, INVITE_CODE 도 바꿔주세요

# 2. DB 기동
docker compose up -d postgres

# 3. 웹 앱
cd web
pnpm install
pnpm prisma migrate dev
pnpm db:seed
pnpm dev                    # http://localhost:3000
```

전체를 컨테이너로 돌리려면 `docker compose up -d`.

명령어 전체 목록과 코딩 규칙은 [AGENTS.md](AGENTS.md)에 있습니다.

---

## 프로젝트 상태

Phase 0(문서·CI 환경) 진행 중입니다. 현재 진행 상황과 다음 할 일은 **[docs/HANDOFF.md](docs/HANDOFF.md)** 에서 확인하세요.

| Phase | 내용 | 상태 |
|---|---|---|
| 0 | 문서 · CI/CD 환경 | 진행 중 |
| 1 | 프로젝트 스캐폴딩 (Next.js · Prisma · Auth) | 대기 |
| 2 | 수집 파이프라인 (`/api/ingest` + 안드로이드 앱) | 대기 |
| 3 | 파서 + 카드 매칭 | 대기 |
| 4 | 실적 엔진 | 대기 |
| 5 | 관리자 가족 대시보드 + 분석 | 대기 |
| 6 | 명세서 대사 · 운영 | 대기 |

각 Phase의 작업 항목과 완료 기준은 [docs/plan/](docs/plan/)에 있습니다.

---

## 알아둘 한계

이 시스템은 카드사 API가 아니라 **결제 알림을 읽어서** 동작합니다. 그래서 구조적인 한계가 있습니다.

- 알림에는 **승인 시점 정보만** 담깁니다. 할부 변경이나 해외 결제의 환율 확정액은 늦게 반영되거나 누락됩니다
- 표시되는 전월실적은 **추정치**입니다. 카드사 계산과 완전히 일치하지 않을 수 있습니다
- 각 구성원이 카드사 앱에서 **결제 알림을 켜고 최소 금액을 0원으로** 맞춰야 합니다. 기본값이 "5만원 이상만 알림"인 카드사가 있어서, 그대로 두면 소액 결제가 통째로 누락됩니다 → [설정 방법](docs/guide/onboarding.md)

정확도 보정 수단으로 Phase 6에서 카드사 명세서 엑셀 대사 기능을 넣습니다.

---

## 보안

금융 민감정보를 다루므로 **외부 클라우드가 아니라 집 서버에 둡니다.**

- 외부 접속은 Tailscale로. 공유기 포트포워딩은 하지 않습니다
- 안드로이드 앱은 **카드사 관련 알림만** 캡처하고 나머지는 저장조차 하지 않습니다
- 디바이스 세션은 절대 가족 전체 조회 권한으로 승격되지 않습니다 — 폰을 잃어버려도 본인 데이터로 피해가 한정됩니다
- **실제 카드 알림 원문과 거래 데이터는 저장소에 커밋하지 않습니다.** 테스트 픽스처는 가공된 샘플만 씁니다

자세한 내용은 [07-auth-scope](docs/design/07-auth-scope.md)를 보세요.

---

## 라이선스

개인·가족용 프로젝트입니다.
