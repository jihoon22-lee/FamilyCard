# Phase 2 — 수집 파이프라인

> 버전 태그: `v0.2.0`
>
> **진행 상태 (2026-08-30)**: 서버·Android·운영 배포 경로와 사용자 관리형 수집 대상의
> 코드·자동 검증 완료, 첫 실기기 원문 1건 ingest 성공. **Phase 자체는 미완료**입니다.
> 실기기 개인정보 canary·실제 결제 문구 분류·서명 키·가족 배포·며칠치 원문 수집이
> 남았습니다.

## 목표

실제 결제 알림이 원문 그대로 서버에 쌓이는 것까지. **파싱은 하지 않습니다.**
Phase 2의 최종 산출물은 코드가 아니라 카드사별 실제 원문 변형입니다.

## 완료 기준

- [ ] 실기기 결제 원문이 `/raw`에 쌓임
- [ ] 기내모드에서 캡처한 원문이 네트워크 복구 후 자동 업로드
- [x] 앱 WebView가 로그인 없이 SELF 범위로 열림
- [ ] 카카오톡 일반 대화와 개인 SMS가 로컬 큐·서버에 전혀 남지 않음
- [ ] 가족 전원의 카드사 문구가 최소 며칠치 모임
- [ ] 서명 키 백업과 릴리스 APK 배포 검증
- [ ] [수집 이후 실행 계획의 Gate C0](post-collection-execution.md#gate-c0--충분히-수집됐다의-판정-기준) 통과

## 완료한 코드

### 서버 수집

- [x] 디바이스 토큰 인증, 소유자를 토큰에서만 유도
- [x] 최대 200건 배치와 스트리밍 요청 바이트 상한
- [x] 필드 길이·시각·source 유효성 검사와 부분 거부
- [x] `originKind`로 카드사 앱·결제 앱·카카오 채널·SMS 출처 구분
- [x] `clientMessageId` 기반 멱등성
  - 동일 ID 재전송은 duplicate
  - 동일 본문·동일 시각의 새 ID는 별도 accepted
  - 기존 `RawMessage`를 보존하는 Prisma 마이그레이션
- [x] 항목별 `accepted | duplicate | rejected` 응답
- [x] 모두 `parseStatus: PENDING` 저장
- [x] 인증 요청마다 `Device.lastSeenAt` 갱신
- [x] 로그에는 기기 ID와 건수만 기록

### 디바이스 토큰·세션

- [x] `/family/devices` 토큰 발급(원문 1회 표시)·폐기
- [x] 60초·1회용 nonce 세션 교환
- [x] DEVICE 세션은 role과 무관하게 항상 SELF
- [x] nonce를 발급 기기에 연결
- [x] 발급 후 폐기된 기기의 미소모 nonce 거부
- [x] 이미 발급된 DEVICE 쿠키도 보호 조회마다 기기 활성 상태 재검증
- [x] 역방향 프록시의 내부 Host와 무관하게 canonical `APP_URL`로 대시보드 리디렉션
- [ ] QR 코드 생성·스캔 — 편의 기능으로 후속. 현재는 토큰 직접 붙여넣기

### 원문 화면

- [x] `/raw` 최신순·필터·페이지네이션
- [x] `/raw` 세부 출처 배지
- [x] 모든 조회가 `visibleMemberIds(session)` 경유
- [x] 앱 대시보드에 서버 보관 원문 건수와 `/raw` 진입 버튼 표시

### Android 캡처·개인정보

- [x] `NotificationListenerService`, SMS receiver
- [x] 사용자 관리형 fail-closed exact allowlist
  - 카드사 앱·결제/자산 앱 시스템 선택 및 추가·삭제·재분류
  - 카카오 공식 채널 제목·SMS 발신자 추가·삭제
  - 초기/손상 목록은 모두 거부, 카카오톡·기본 SMS 앱 전체 등록 차단
  - 카드사명 정규식과 본문 fallback 제거
- [x] 알림 필터가 본문 추출·큐 저장보다 먼저, SMS 발신자 필터가 본문 결합보다 먼저 실행
- [x] BIG_TEXT → TEXT_LINES → TEXT 본문 선택
- [x] 캡처 사건별 안정적 `clientMessageId`
- [x] 큐 저장 실패를 원문 없이 설정 화면에 노출
- [x] 앱 백업·기기 이전에서 토큰·큐 제외

### Android 큐·업로드

- [x] 보존형 SQLite v1→v2→v3 마이그레이션 (`origin_kind` 추가)
- [x] pending 큐와 rejected 원문 격리함
- [x] 응답 ID 집합·중복·요약 건수 1:1 검증
- [x] 승인·중복만 삭제, 거부는 원문+사유 격리
- [x] 격리 INSERT와 pending 삭제를 한 트랜잭션으로 적용
- [x] 저장 직후 즉시 업로드 + 15분 주기 안전망
- [x] 백로그를 같은 worker에서 연속 배치 처리
- [x] 네트워크/HTTP/인증/프로토콜 오류를 구분해 큐 보존

### Android 화면·보안

- [x] WebView와 설정 하단 탭
- [x] release는 HTTPS origin만, debug HTTP는 로컬 호스트만
- [x] 서버 세션 URL과 scheme·host·port 동일성 검사
- [x] WebView 파일/content 접근 차단, 외부 링크 분리
- [x] 네트워크·메인 HTTP 오류 안내와 실제 설정 탭 이동
- [x] `FLAG_SECURE`로 스크린샷·최근 앱 미리보기 차단
- [x] 실제 SMS 런타임 권한 요청과 권한 화면 복귀 갱신
- [x] pending·rejected 건수, 캡처 저장 오류 표시
- [x] 등록 앱 전체 알림 수집 경고와 삭제 시 기존 원문 보존 안내
- [x] 실행 가능한 설치 앱 검색·공식/이름 추천·다중 선택·원자적 일괄 저장
- [x] FamilyCard 서버의 고정 APK 다운로드 경로와 앱 설정 다운로드 버튼

### 운영·배포

- [x] 운영 Compose가 명시 버전 이미지만 사용
- [x] 별도 migration 이미지가 web보다 먼저 `prisma migrate deploy`
- [x] release signing 환경변수 4종과 누락 시 명시적 빌드 실패
- [x] CD가 태그 소스를 체크아웃하고 APK 서명을 검증
- [x] 서명 APK artifact를 web 이미지 고정 다운로드 경로에도 포함
- [x] 수동 CD의 tag 입력 반영, 빌드 실패 시 Release 생성 차단
- [x] CI Android lint를 실제 `lintDebug`로 실행
- [x] CI/CD Action을 Node 24 기반 지원 major로 갱신
- [x] 기본 보안 응답 헤더

## 완료한 자동·통합 검증

- [x] web format/lint/typecheck/test **143건**/production build
- [x] Prisma 4개 migration 적용·status·schema diff
- [x] Android unit test **45건**/lint/debug build
- [x] 임시 키 signed release build + `apksigner verify`
- [x] production web/migrate Docker 이미지 빌드
- [x] production Compose config와 migration 컨테이너 실행
- [x] production 이미지 HTTP 통합
  - 신규/재전송/동일 본문 새 ID
  - 활성 DEVICE 세션
  - 폐기 토큰·미소모 nonce·기존 쿠키 거부
- [x] GitHub Actions YAML `actionlint`

통합 검증에는 가공 데이터만 사용했습니다. 생성된 `RawMessage`는 불변 규칙 1에 따라
삭제하지 않았고, 거래로 파싱하지 않았습니다.

## 실기기 진행과 다음 작업

1. [x] **tailnet 전용 HTTPS 준비**
   - `tailscale serve` 사용, Funnel은 사용하지 않음
   - `APP_URL`과 앱 서버 주소를 같은 HTTPS origin으로 설정
2. [x] **APK 설치·업데이트와 앱 안의 수집 대상 등록**
   - 카드사 앱·결제/자산 앱 등록 완료, 카카오/SMS는 사용하는 경우 각 폰에서 추가
   - 원문·금액·가맹점은 Git이나 작업 메모에 복사하지 않음
3. [ ] **개인정보 canary**
   - 일반 카카오 대화, 카드사 단어가 들어간 대화방, 개인 SMS 수신
   - 앱 pending/rejected 증가 없음, 서버 `/raw` 증가 없음 확인
4. [ ] 같은 결제를 카드사 앱+결제 앱으로 동시에 알리는 조합에서 `/raw` 원문 2건과 출처 배지 확인
5. [x] 첫 실기기 원문 → 즉시 업로드·서버 `RawMessage` 보존 확인
6. [ ] 수집 대상 삭제 후 새 알림만 중단되고 기존 원문이 유지되는지 확인
7. [ ] 기내모드→복구, 재부팅, 서버 중단, 기기 폐기 시나리오
8. [ ] 실제 keystore 생성·암호화 이중 백업·GitHub Secrets 4종 등록
9. [ ] `v0.2.0` 후보 태그로 CD와 설치/덮어쓰기 검증
10. [ ] 가족 전원 설치 후 [Gate C0 커버리지](post-collection-execution.md#c0-2-문구출처-커버리지) 충족

## 사용자 수집 대상 설정

개발자가 패키지 목록을 수정하거나 USB/ADB로 조사하지 않습니다. 사용자마다 Android 앱의
**설정 → 수집 대상**에서 본인이 쓰는 것만 관리합니다.

- 카드사 앱 추가: 검색 가능한 설치 앱 화면 → 공식 추천 또는 검색 → 여러 앱 체크 → 등록
- 결제·자산 앱 추가: 같은 화면에서 토스·카카오페이·네이버페이 등을 일괄 등록
- 카카오 공식 채널 추가: 알림에 표시되는 채널 제목 exact 입력
- SMS 발신자 추가: 문자에 표시되는 번호 또는 발신자 ID 입력
- 삭제: 이후 캡처만 중단하며 큐/서버의 기존 원문은 유지

구현 경계는 `CaptureSourceStore.kt`와 `CaptureFilter.kt`, UI는
`CaptureSourcesSection.kt`입니다. 실기기 등록값은 로컬 private 설정이라 Git에 들어가지
않습니다.

```bash
cd android
./gradlew testDebugUnitTest lintDebug assembleDebug
```

## Phase 3 진입 금지 조건

다음 중 하나라도 아니면 파서를 시작하지 않습니다. 상세 판정표는
[알림 수집 이후 통합 실행 계획](post-collection-execution.md)이 기준입니다.

- 실기기 개인정보 canary 통과
- 가족 카드사·출처별 승인과 해당되는 취소·할부·해외·복수 출처 반례 축적
- 실제 원문은 DB/`/raw` 안에만 있고 Git 작업물에는 없음
- Phase 3 migration 전 운영 DB 보존 백업·격리 복원 확인

## 설계

- [수집 설계](../design/02-ingest.md)
- [Android 설계](../design/08-android-app.md)
- [권한 설계](../design/07-auth-scope.md)
- [ADR 0006](../adr/0006-client-event-idempotency.md)
- [ADR 0007](../adr/0007-user-managed-capture-sources.md)
- [알림 수집 이후 통합 실행 계획](post-collection-execution.md)
