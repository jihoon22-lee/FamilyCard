# Phase 2 수집 파이프라인 안전성 보강

## 개요

- 작업일: 2026-08-30
- 범위: Next.js 수집 API, 디바이스 세션, Prisma migration, Android 캡처·큐·WebView,
  운영 Compose·CI/CD, Phase 2 문서
- 결과: 코드와 로컬 production 통합 검증 완료
- 상태: Phase 2는 **실기기 허용 목록·개인정보 canary·실제 원문 축적 전이라 미완료**

이번 작업은 기능을 더 많이 보이는 것보다, 실제 금융 원문을 받기 전에 유실·오수집·권한
잔존·배포 실패 경로를 닫는 데 집중했다. 모든 테스트와 HTTP 통합에는 가공 데이터만
사용했고 실제 카드 원문은 저장소에 넣지 않았다.

## 배경

기존 Phase 2 코드는 서버와 Android의 기본 흐름은 완성됐지만 실제 배포 전에 다음 위험이
남아 있었다.

1. 카드사명 정규식과 SMS 본문 fallback이 일반 카카오 대화·개인 문자를 오인할 수 있음
2. 본문+분 단위 dedupe가 같은 금액의 정상 결제 두 건을 하나로 합칠 수 있음
3. 서버가 총건수만 반환해 Android가 어떤 큐 행이 거부됐는지 알 수 없음
4. 거부 건을 큐에서 함께 삭제하면 유일한 원문이 사라짐
5. 새 캡처가 최대 15분 대기하고, 큰 백로그는 한 배치만 처리됨
6. 기기 폐기 전에 발급된 WebView 세션이 쿠키 만료까지 남음
7. 운영 migration과 Android 서명 경로가 배포에서 강제되지 않음
8. CI Android lint가 실제 존재하지 않는 task를 허용 실패로 처리함
9. 문서가 QR·거래 대시보드·추정 필터를 이미 동작하는 것처럼 안내함

## 핵심 결정

### exact allowlist, fail closed

`VerifiedCaptureAllowlist`의 카드 앱 패키지, 카카오 채널 제목, SMS 발신번호는 모두
빈 목록으로 시작한다. 실기기에서 직접 확인한 exact 값만 허용한다.

```kotlin
val value = CaptureAllowlist(
    cardAppPackages = emptySet(),
    kakaoChannelTitles = emptySet(),
    cardSmsSenders = emptySet(),
)
```

- 카카오톡 제목 정규식 제거
- SMS 본문만 보고 카드사 발신자로 추정하는 fallback 제거
- SMS는 확인된 발신번호와 거래 어휘를 모두 요구
- 필터 통과 전에 본문을 로컬 변수·큐·로그에 남기지 않음

현재 빌드가 아무것도 수집하지 않는 것은 의도된 안전 상태다.

### 캡처 사건 ID 기반 멱등성

Android가 사건마다 UUID를 만들고 큐에 저장한다. 알림은 key·postTime·본문, SMS는
발신자·수신 시각·본문을 입력으로 사용한다. 알림 레코드가 같은 key/time으로 본문만
업데이트돼도 별도 원문으로 보존한다.

```ts
sha256(`client-message-v1|${deviceId}|${clientMessageId}`)
```

서버는 `dedupeHash UNIQUE`와 `(deviceId, clientMessageId) UNIQUE`로 같은 큐 사건의
재전송만 중복 처리한다. 내용이 우연히 같은 별도 결제는 합치지 않는다.

결정 근거는
[ADR 0006](../docs/adr/0006-client-event-idempotency.md)에 기록했다.

### 항목별 결과와 로컬 격리

`/api/ingest` 응답에 모든 `clientMessageId`의 상태와 선택적 사유를 넣었다. Android는
결과 ID 집합, 중복, 길이, 요약 건수를 전부 검증한다.

```json
{
  "accepted": 1,
  "duplicates": 0,
  "rejected": 1,
  "results": [
    { "clientMessageId": "...001", "status": "accepted" },
    { "clientMessageId": "...002", "status": "rejected", "reason": "invalid_body" }
  ]
}
```

- accepted/duplicate: pending 삭제
- rejected: 원문+사유를 rejected 테이블에 INSERT 후 pending 삭제
- 위 격리와 삭제: 한 SQLite 트랜잭션
- 응답이 애매함: 어떤 행도 변경하지 않음

영구 HTTP·프로토콜 오류에서는 periodic work 자체를 실패 상태로 끝내지 않는다. 큐를
유지하고 이번 실행만 종료해 다음 주기·설정 저장·새 캡처가 복구 기회를 만든다.

## 구현 변경

### Android 캡처·보존

- 펼침형 알림 본문 선택: BIG_TEXT → TEXT_LINES → TEXT
- 같은 OS 콜백의 로컬 enqueue를 멱등 처리
- 큐 저장 실패를 본문 없이 설정 화면에 노출
- 저장 성공 직후 unique one-time WorkManager 예약
- SQLite v1→v2 보존 migration, rejected 원문 격리 테이블
- 200건씩 큐가 빌 때까지 한 worker에서 연속 처리
- 앱 자동 백업·기기 이전에서 DB·토큰·파일 제외
- 앱 스크린샷·최근 앱 미리보기 차단

### Android 네트워크·화면

- release 주소는 경로 없는 HTTPS origin만 허용
- debug는 manifest overlay로 cleartext를 켜되 코드상 localhost 계열만 허용
- 세션 URL의 scheme·host·port가 설정 origin과 정확히 일치해야 함
- 메인 프레임 네트워크 오류와 HTTP 4xx/5xx 안내 화면
- 연결 실패 화면의 설정 버튼을 실제 설정 탭에 연결
- SMS runtime permission 요청
- pending/rejected 건수와 캡처 저장 오류 표시
- 불필요한 `POST_NOTIFICATIONS`,
  `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` manifest 권한 제거

### 서버 수집

- UUID `clientMessageId` 필수, 배치 내 중복 ID 전체 거부
- 원시 요청 스트림을 읽는 동안 6MB 상한 강제
- 200×최대 필드의 JSON escape 최악값도 허용하도록 배치/바이트 상한 일치
- 패키지·제목·본문 길이, 공백, NUL, 엄격한 ISO-8601 시각 검사
- 항목별 결과·거부 사유 반환
- 수집 로그에는 기기 ID와 건수만 기록
- 기존 `RawMessage`에 legacy ID를 채워 보존하는 migration

### 디바이스 인증·폐기

- 토큰은 64자 hex 형식을 먼저 검사하고 SHA-256 해시로 조회
- tokenHash sentinel 외에 `revokedAt`도 다시 확인
- nonce 레코드에 `deviceId` 연결
- nonce 소비 시 원 기기 활성·동일 소유 재확인
- DEVICE JWT에 `entrypoint`와 `deviceId` 포함
- `getAppSession()`이 보호 조회마다 기기 폐기·소유자 변경 확인
- 구버전 entrypoint 없는 쿠키는 세션으로 인정하지 않음

### 운영·공급망

- `migrate` Docker target과 GHCR migration 이미지
- 운영 Compose가 명시 `FAMILYCARD_VERSION`을 요구
- migration 성공 뒤에만 web 기동
- Android release signing 환경변수 4종 필수
- CD에서 `apksigner verify`, 수동 tag 반영, 빌드 실패 뒤 Release 차단
- CI Android `lintDebug` 실제 실행
- actionlint 오류 제거
- 기본 CSP/frame/referrer/nosniff/permissions/HSTS 헤더
- `deepmerge-ts >=8.0.2` override로 high advisory 제거

## 주요 파일

| 영역 | 파일 |
|---|---|
| 캡처 경계 | `android/app/src/main/java/com/familycard/collector/capture/CaptureFilter.kt` |
| 본문·사건 ID | `NotificationBodyExtractor.kt`, `CaptureEventId.kt` |
| 큐·격리 | `QueueDatabase.kt`, `CapturedMessageStore.kt`, `UploadPolicy.kt`, `UploadWorker.kt` |
| Android 주소·UI | `ServerUrlPolicy.kt`, `DashboardScreen.kt`, `SettingsScreen.kt` |
| Android 배포 | `AndroidManifest.xml`, `app/build.gradle.kts`, `android/lint.xml` |
| 수집 서버 | `web/src/app/api/ingest/route.ts`, `web/src/lib/ingest/**` |
| 세션 폐기 | `web/src/lib/auth/session.ts`, `config.ts`, `api/auth/device-session/**` |
| 스키마 | `web/prisma/schema.prisma`, `20260830090000_phase2_collection_hardening/` |
| 운영 | `web/Dockerfile`, `docker-compose.prod.yml`, `.github/workflows/{ci,cd}.yml` |
| 설계·인수인계 | `docs/design/02-ingest.md`, `08-android-app.md`, `docs/HANDOFF.md` |

## 검증

| 대상 | 결과 |
|---|---|
| Web format/lint/typecheck | 통과 |
| Web Vitest | 16 files, **134 tests** 통과 |
| Next.js production build | 통과 |
| Prisma generate/validate/status/diff | 통과, 3 migrations 최신 |
| Production dependency audit | 알려진 취약점 0 |
| Android unit test | **27 tests** 통과 |
| Android lint/debug APK | 통과 |
| Release manifest | cleartext=false, 불필요 권한 없음 |
| 임시 키 release APK | 빌드 및 `apksigner verify` 통과 |
| Docker prod/migrate targets | 빌드·migration 실행 통과 |
| Production HTTP 통합 | 새 ID/중복/동일 본문 새 ID/폐기 3경로 통과 |
| Compose config, actionlint | 통과 |

HTTP 통합으로 생성된 가공 `RawMessage`는 불변 규칙에 따라 삭제하지 않았다. 현재 로컬
개발 DB는 가공 원문 5건, 거래 0건이다.

## 남은 작업

코드로 대신할 수 없는 실기기 단계다.

1. tailnet 전용 HTTPS Serve 준비(Funnel 금지)
2. adb와 실제 알림으로 패키지·카카오 채널 제목·SMS 발신번호 확인
3. exact allowlist와 adversarial 테스트 반영
4. 일반 대화·개인 SMS 개인정보 canary
5. 실제 결제·기내모드·재부팅·서버 중단·기기 폐기 검증
6. 실제 keystore 생성, 암호화 이중 백업, GitHub Secrets 등록
7. 가족 설치 후 며칠간 카드사별 실제 원문 변형 축적
8. 전부 통과한 뒤 `v0.2.0`; 그 전에는 Phase 3 시작 금지

자세한 순서는 [HANDOFF](../docs/HANDOFF.md)와
[Phase 2 계획](../docs/plan/phase-2.md)을 따른다.
