# Phase 2 — 수집 파이프라인

> 버전 태그: `v0.2.0`

> **진행 상태 (2026-08-11)**: **서버 파트 완료.** `POST /api/ingest`, 디바이스 토큰·세션 교환,
> `/family/devices`, `/raw` 화면 전부 실서버 `curl`/브라우저 검증 완료 (PR로 병합).
> **안드로이드 앱은 아직 착수 전** — 캡처·큐·업로드·화면·배포·실기기 테스트가 전부 남았습니다.
> QR 코드는 후속으로 미룸(아래 참고). 다음 세션은 [08-android-app](../design/08-android-app.md)부터.

## 목표

실제 결제 알림이 서버에 쌓이는 것까지. **파싱은 하지 않습니다.**

이 Phase의 진짜 산출물은 코드가 아니라 **DB에 쌓인 실제 카드사 알림 원문**입니다. 그게 Phase 3의 입력입니다.

## 완료 기준

- 실기기에 APK를 깔고 실제 결제를 하면 서버에 원문이 쌓임
- 기내모드에서 발생한 알림도 네트워크 복구 후 자동 업로드
- 앱 대시보드 탭이 로그인 화면 없이 열림
- **카카오톡 일반 대화가 서버에 올라가지 않음** (필수)
- 가족 전원의 카드사 알림 문구가 최소 며칠치 모임

## 작업

### 서버: 수집
- [x] `POST /api/ingest`
  - `Authorization: Bearer <deviceToken>` 인증, 해시 조회
  - 배열 배치 수신 (`INGEST_MAX_BATCH_SIZE` 상한)
  - `dedupeHash` 생성 → UNIQUE 충돌 시 `duplicates` 카운트
  - 응답 `{ accepted, duplicates, rejected }`
  - 전부 `parseStatus: PENDING`으로 저장
- [x] 유효성 검사 — 빈 본문, 4000자 초과, 미래 시각, 5년 이전
- [x] `Device.lastSeenAt` 갱신
- [x] 로그에 **본문을 남기지 않음** — 구현은 설계 초안의 `LOG_LEVEL=debug` 예외를
      두지 않았습니다. 어떤 로그 레벨에서도 `body`·`title`을 남기지 않습니다
      (이유는 [02-ingest](../design/02-ingest.md) "관찰 가능성" 참고)

### 서버: 디바이스 토큰 · 세션
- [x] 관리자용 기기 등록 화면 — 구성원 선택 → 토큰 발급
- [x] 토큰 원문은 **1회만 표시**
- [ ] QR 코드 — **후속.** `package.json`에 QR 라이브러리가 없어 이번 범위에 넣지
      않았습니다. 현재는 토큰을 큰 고정폭 글씨로 보여주고 복사 버튼을 제공합니다
- [x] 기기 폐기 기능
- [x] `POST /api/auth/device-session` — 60초 만료 1회용 nonce
- [x] nonce 소모 → **`scope: SELF`** 세션 쿠키 (role 참조 금지)

### 서버: 원문 확인 화면
- [x] `/raw` — 수집된 원문 목록 (파싱 전이므로 원문 그대로 표시)
  - 이 화면이 Phase 3 파서 작성의 근거 자료가 됩니다

### 안드로이드: 캡처
- [ ] `CardNotificationListener` — `NotificationListenerService`
- [ ] `SmsReceiver` — `RECEIVE_SMS`
- [ ] **`CaptureFilter`** ★ 가장 중요
  - 카드사 앱 패키지 화이트리스트 (**실기기에서 패키지명 확인**)
  - `com.kakao.talk`은 **제목이 카드사 패턴일 때만**
  - 판정은 Room에 넣기 **전에**. 걸러진 것은 메모리에서도 즉시 폐기

### 안드로이드: 큐 · 업로드
- [ ] Room `PendingMessage` + DAO
- [ ] `UploadWorker` — `WorkManager` 주기 + 네트워크 연결 트리거
- [ ] 지수 백오프 재시도
- [ ] **서버 응답 개수 확인 후에만** 큐에서 삭제
- [ ] `BOOT_COMPLETED` 재시작
- [ ] 배터리 최적화 예외 요청

### 안드로이드: 화면
- [ ] 하단 탭 2개 (대시보드 / 설정)
- [ ] 대시보드 — WebView
  - JS · DOM storage 활성화, `allowFileAccess=false`, `allowContentAccess=false`
  - 뒤로가기 `goBack()`, 당겨서 새로고침
  - **연결 실패 전용 화면** + 재시도 (빈 흰 화면 금지)
  - 서버 호스트 외 URL은 시스템 브라우저로
- [ ] 설정 — 서버 주소·토큰(QR 스캔), 권한 3종 상태, 전송 로그·큐 건수·수동 전송

### 배포
- [ ] keystore 생성 및 **백업** (잃으면 전원 재설치)
- [ ] `signingConfigs` 설정, CI Secrets 등록
- [ ] CD가 릴리스 APK를 GitHub Release에 첨부하는지 확인

### 테스트
- [x] `curl`로 수집 → 적재 확인
- [x] 같은 요청 재전송 → `duplicates: 1`, **중복 행 없음**
- [x] 잘못된 토큰 → 401
- [x] 미래 시각 → `rejected`
- [ ] `CaptureFilter` 유닛 테스트 (특히 카카오톡 일반 대화 → false)
- [ ] 실기기: 실제 결제 → 원문 표시
- [ ] 실기기: 기내모드 → 복구 후 자동 업로드
- [ ] 실기기: 재부팅 → 서비스 자동 시작
- [ ] 실기기: 서버 내린 상태 → 안내 화면
- [ ] **실기기: 카카오톡 일반 대화 → 서버에 아무것도 안 올라감** ★★

## 설계 문서 참조

- [02-ingest](../design/02-ingest.md) — `dedupeHash` 규칙, 유효성 검사
- [08-android-app](../design/08-android-app.md) — 필터, 큐, WebView
- [07-auth-scope](../design/07-auth-scope.md) — 토큰 · 세션 교환

## 주의

### 파서를 만들지 않는다

Phase 2에서 파싱을 시작하고 싶은 유혹이 있습니다. 원문이 쌓이는 걸 보면 바로 규칙을 쓰고 싶어집니다.

하지만 **며칠치가 모여야 각 카드사의 문구 변형(할부, 취소, 해외, 마스킹)을 볼 수 있습니다.** 첫날 본 한 건으로 규칙을 만들면 나머지를 다 놓칩니다.

원문 수집을 완주하고 넘어가세요.

### 카드사 패키지명은 실기기에서 확인

패키지명을 검색으로 알아내려 하지 마세요. 부정확하고 앱이 바뀌면 달라집니다. 실기기에 앱을 깔고 확인하세요.

```bash
adb shell pm list packages | grep -i card
```

### 개인정보 유출 검증을 배포 전에

★★ 표시한 카카오톡 테스트는 **가족에게 앱을 배포하기 전에** 통과해야 합니다. 이후에 발견하면 이미 서버에 개인 대화가 쌓인 뒤입니다.

## 다음

[Phase 3 — 파서 + 카드 매칭](phase-3.md)
