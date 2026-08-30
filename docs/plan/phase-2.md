# Phase 2 — 수집 파이프라인

> 버전 태그: `v0.2.0`
>
> **진행 상태 (2026-08-30)**: 서버·Android·운영 배포 경로의 코드와 로컬 통합 검증 완료.
> **Phase 자체는 미완료**입니다. 운영 허용 목록이 의도적으로 비어 있고, 실기기 개인정보
> 검증·실제 결제·서명 키·가족 배포·며칠치 원문 수집이 남았습니다.

## 목표

실제 결제 알림이 원문 그대로 서버에 쌓이는 것까지. **파싱은 하지 않습니다.**
Phase 2의 최종 산출물은 코드가 아니라 카드사별 실제 원문 변형입니다.

## 완료 기준

- [ ] 실기기 결제 원문이 `/raw`에 쌓임
- [ ] 기내모드에서 캡처한 원문이 네트워크 복구 후 자동 업로드
- [ ] 앱 WebView가 로그인 없이 SELF 범위로 열림
- [ ] 카카오톡 일반 대화와 개인 SMS가 로컬 큐·서버에 전혀 남지 않음
- [ ] 가족 전원의 카드사 문구가 최소 며칠치 모임
- [ ] 서명 키 백업과 릴리스 APK 배포 검증

## 완료한 코드

### 서버 수집

- [x] 디바이스 토큰 인증, 소유자를 토큰에서만 유도
- [x] 최대 200건 배치와 스트리밍 요청 바이트 상한
- [x] 필드 길이·시각·source 유효성 검사와 부분 거부
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
- [ ] QR 코드 생성·스캔 — 편의 기능으로 후속. 현재는 토큰 직접 붙여넣기

### 원문 화면

- [x] `/raw` 최신순·필터·페이지네이션
- [x] 모든 조회가 `visibleMemberIds(session)` 경유

### Android 캡처·개인정보

- [x] `NotificationListenerService`, SMS receiver
- [x] fail-closed exact allowlist
  - 운영 기본 패키지·카카오 채널·SMS 발신번호가 모두 빈 목록
  - 카드사명 정규식과 본문 fallback 제거
- [x] 필터가 본문 추출·큐 저장보다 먼저 실행
- [x] BIG_TEXT → TEXT_LINES → TEXT 본문 선택
- [x] 캡처 사건별 안정적 `clientMessageId`
- [x] 큐 저장 실패를 원문 없이 설정 화면에 노출
- [x] 앱 백업·기기 이전에서 토큰·큐 제외

### Android 큐·업로드

- [x] 보존형 SQLite v1→v2 마이그레이션
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

### 운영·배포

- [x] 운영 Compose가 명시 버전 이미지만 사용
- [x] 별도 migration 이미지가 web보다 먼저 `prisma migrate deploy`
- [x] release signing 환경변수 4종과 누락 시 명시적 빌드 실패
- [x] CD가 태그 소스를 체크아웃하고 APK 서명을 검증
- [x] 수동 CD의 tag 입력 반영, 빌드 실패 시 Release 생성 차단
- [x] CI Android lint를 실제 `lintDebug`로 실행
- [x] CI/CD Action을 Node 24 기반 지원 major로 갱신
- [x] 기본 보안 응답 헤더

## 완료한 자동·통합 검증

- [x] web format/lint/typecheck/test **134건**/production build
- [x] Prisma 3개 migration 적용·status·schema diff
- [x] Android unit test **27건**/lint/debug build
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

## 다음 작업 — 사람·실기기 필수

1. **tailnet 전용 HTTPS 준비**
   - `tailscale serve` 사용, Funnel은 사용하지 않음
   - `APP_URL`과 앱 서버 주소를 같은 HTTPS origin으로 설정
2. **디버그 APK 설치 후 허용 목록 조사**
   - 카드 앱 패키지명: adb로 확인
   - 카카오 채널 제목·SMS 발신번호: 실제 알림을 폰에서 확인
   - 원문·금액·가맹점은 Git이나 작업 메모에 복사하지 않음
3. `VerifiedCaptureAllowlist.value`에 확인된 exact 값만 추가하고 테스트
4. **개인정보 canary**
   - 일반 카카오 대화, 카드사 단어가 들어간 대화방, 개인 SMS 수신
   - 앱 pending/rejected 증가 없음, 서버 `/raw` 증가 없음 확인
5. 실제 소액 결제 → 즉시 업로드·`/raw` 확인
6. 기내모드→복구, 재부팅, 서버 중단, 기기 폐기 시나리오
7. 실제 keystore 생성·암호화 이중 백업·GitHub Secrets 4종 등록
8. `v0.2.0` 후보 태그로 CD와 설치/덮어쓰기 검증
9. 가족 전원 설치 후 며칠간 원문 수집·카드사별 변형 목록화

## 허용 목록 위치

`android/app/src/main/java/com/familycard/collector/capture/CaptureFilter.kt`

```kotlin
object VerifiedCaptureAllowlist {
    val value = CaptureAllowlist(
        cardAppPackages = setOf(/* adb로 확인한 값 */),
        kakaoChannelTitles = setOf(/* 실제 알림 제목 exact */),
        cardSmsSenders = setOf(/* 하이픈 제거 번호 */),
    )
}
```

목록을 채운 뒤 다음을 다시 실행합니다.

```bash
cd android
./gradlew testDebugUnitTest lintDebug assembleDebug
```

## Phase 3 진입 금지 조건

다음 중 하나라도 아니면 파서를 시작하지 않습니다.

- 실기기 개인정보 canary 통과
- 가족 카드사별 승인·취소·할부·해외 등 실제 문구가 며칠치 축적
- 실제 원문은 DB/`/raw` 안에만 있고 Git 작업물에는 없음

## 설계

- [수집 설계](../design/02-ingest.md)
- [Android 설계](../design/08-android-app.md)
- [권한 설계](../design/07-auth-scope.md)
- [ADR 0006](../adr/0006-client-event-idempotency.md)
