# 디바이스 세션 canonical 리디렉션과 수집 원문 대시보드

## 개요

실기기에서 FamilyCard 대시보드를 누르면 앱 WebView 대신 시스템 브라우저가 열리고
`https://localhost:3000` 연결 실패가 표시되는 문제를 수정했습니다. 디바이스 세션의 최종
리디렉션을 공개 `APP_URL` 기준으로 만들고, 대시보드에서 서버에 전송된 본인 원문 건수와
`/raw` 목록에 바로 접근할 수 있게 했습니다.

Android APK 코드는 바뀌지 않았습니다. 실행 중인 서버가 수정되면 기존 설치 앱에서 바로
적용됩니다.

## 상황과 원인

디바이스 WebView 로그인 흐름은 다음과 같습니다.

```text
Android → POST /api/auth/device-session
        ← 공개 APP_URL의 60초·1회용 nonce URL
WebView → GET nonce URL
        ← 세션 쿠키 + 대시보드 / 리디렉션
```

POST 응답은 이미 `APP_URL`을 사용했지만, GET의 마지막 단계는 `request.url`을 기준으로
리디렉션을 만들었습니다. Tailscale Serve가 백엔드에 내부 Host인 `localhost:3000`을 전달하자
Next.js 요청 URL도 내부 origin이 되었습니다. Android의 same-origin WebView 경계는 이를
정상적으로 외부 origin으로 판단해 시스템 브라우저로 넘겼고, 폰에서 `localhost`는 폰 자신을
뜻하므로 연결에 실패했습니다.

수집 상태도 조사했습니다. 최초 확인 시 실제 서버 `RawMessage`는 0건이고 폰에는 pending
1건이 남아 있었으며, 서버 로그에 그 폰의 `/api/ingest` 요청은 아직 없었습니다. 반면 같은
폰의 디바이스 세션 POST는 200이어서 서버 주소·토큰·tailnet 연결 자체는 정상임을 확인했습니다.
사용자가 **지금 전송**을 누른 뒤 해당 1건은 200 응답으로 신규 accepted됐고 DB 보관과
`Device.lastSeenAt` 갱신까지 확인했습니다. 실제 원문의 제목·본문·발신자 정보는 조회하거나
로그·문서에 기록하지 않았습니다.

## 변경 사항

### 1. canonical 대시보드 리디렉션

- 파일: `web/src/app/api/auth/device-session/route.ts`
- nonce를 소비하고 쿠키를 만든 뒤 `/`로 이동할 때 `request.url` 대신 `resolveAppUrl()` 사용
- 공개 세션 URL 발급과 최종 대시보드 이동이 같은 origin 정책을 공유
- Host 헤더 기반 외부 리디렉션 가능성도 함께 제거

```typescript
const response = NextResponse.redirect(new URL("/", resolveAppUrl()), {
  status: 302,
});
```

### 2. 프록시 환경 회귀 테스트

- 파일: `web/src/app/api/auth/device-session/route.test.ts`
- 내부 요청 URL은 `https://localhost:3000`, 공개 설정은 별도 HTTPS origin으로 구성
- 정상 nonce 소비 후 `Location`이 내부 Host가 아니라 공개 `APP_URL`인지 검증
- POST가 반환하는 nonce URL도 같은 공개 origin인지 함께 검증

### 3. 앱 대시보드의 원문 진입점

- 파일: `web/src/app/(app)/page.tsx`
- 서버에 보관된 가시 범위 원문 건수 표시
- **수집 원문 보기** 버튼으로 기존 `/raw` 화면 연결
- 아직 폰 pending 큐에만 있는 항목은 성공적으로 전송된 뒤 표시된다고 안내
- Phase 2에서 거래가 없다는 문구를 수집 데이터가 없다는 의미로 오해하지 않게
  `거래 분석 기능을 준비하고 있습니다`로 수정

### 4. 가시 범위가 적용된 건수 조회

- 파일: `web/src/app/(app)/raw/query.ts`
- `countRawMessages(session)` 추가
- 목록 조회와 마찬가지로 `visibleMemberIds(session)` 결과를 `Device.memberId` 조건에 적용
- DEVICE/SELF 세션에서는 본인 원문만, 관리자 FAMILY 세션에서는 허용된 가족 범위만 계산

- 파일: `web/src/app/(app)/raw/query.test.ts`
- SELF 세션이 본인 member ID만 사용해 건수를 세는지 명시적으로 검증

### 5. 문서 갱신

- `CHANGELOG.md`: 대시보드 원문 진입 추가와 localhost 리디렉션 수정 기록
- `docs/HANDOFF.md`: 실기기 현재 상태, 첫 pending 전송 확인 절차, 다음 게이트 기록
- `docs/plan/phase-2.md`: canonical 리디렉션과 대시보드 `/raw` 진입 완료 항목 추가
- `docs/design/08-android-app.md`: 역방향 프록시 Host 경계 명시
- `docs/guide/user-guide.md`, `docs/guide/onboarding.md`: 앱 안에서 전송 원문 확인하는 방법 반영

## 검증 결과

### 표적 회귀 테스트

```text
corepack pnpm test -- \
  src/app/api/auth/device-session/route.test.ts \
  src/app/(app)/raw/query.test.ts

Test Files  2 passed (2)
Tests      21 passed (21)
```

### 전체 Web 검증

```text
corepack pnpm format:check  통과
corepack pnpm typecheck     통과
corepack pnpm lint          통과
corepack pnpm test          16 files, 143 tests 통과
corepack pnpm build         production build 통과
```

### 실행 환경 확인

- tailnet HTTPS `GET /api/health`: 200
- tailnet HTTPS `POST /api/ingest` 경로: 인증 없는 진단 요청이 예상대로 401에 도달
- 개발 서버 HMR이 변경된 대시보드·세션 라우트를 다시 컴파일
- 최초 실제 서버 `RawMessage`: 0건 → 수동 재시도 후 1건
- 실기기 `/api/ingest`: requested 1, accepted 1, duplicate 0, rejected 0, HTTP 200
- 활성 기기의 `lastSeenAt` 갱신 확인
- 실제 금융 원문·기기 토큰·비밀번호는 출력 또는 커밋하지 않음

## 다음 단계

1. 기존 설치 앱에서 대시보드가 WebView 내부에 열리는지 실기기 확인
2. 설정 화면에서 pending 0건 확인
3. 대시보드 **수집 원문 보기**에서 서버 원문 1건과 출처 배지 확인
4. 개인정보 canary로 의도하지 않은 알림이 저장되지 않는지 확인
5. 기능 브랜치 PR의 전체 CI 통과 후 GitHub에서 병합
