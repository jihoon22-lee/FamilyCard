# 코드 리뷰 후속 작업 계획

> 작성일: 2026-09-26 · 근거: 2026-09-25 전체 코드 리뷰(웹·Android·운영 스크립트)
> 리뷰 시점 검증: typecheck/lint/format 통과, 단위 테스트 31파일 230건 통과
> (DB 통합 테스트·Android 테스트는 리뷰에서 재실행하지 않음)

이 문서는 리뷰에서 나온 수정 항목의 범위·순서·완료 기준입니다. 진행 원칙은
[단계별 통합 실행 계획](staged-execution-plan.md)과 [ADR 0014](../adr/0014-development-and-release-gates.md)를 따릅니다.

## 진행 원칙

- 항목별 기능 브랜치 → PR → 필수 CI → GitHub 병합. `main` 직접 커밋 금지.
- **버전·태그·APK 게시는 이 계획 때문에 따로 하지 않습니다.** 변경은 CHANGELOG `Unreleased`에
  누적하고, 기존 계획대로 전체 조건 충족 후 한 번만 올립니다.
- 운영 서버/DB에 새로 배포하지 않습니다. 검증은 격리 DB(`familycard_test`, 명시된
  `familycard_verify_*`)에서만 합니다. `FAMILYCARD_TEST_DATABASE_URL`을 `familycard_live`로 지정하지 않습니다.
- 픽스처는 가공 표본만 사용합니다(AGENTS 불변 규칙 7).
- 각 항목 완료 시 이 문서 체크박스와 [HANDOFF](../HANDOFF.md)를 갱신하고 PR 번호를 남깁니다.

## 항목 요약

| ID  | 심각도 | 제목                                            | 주요 경로                                               | 상태   |
| --- | ------ | ----------------------------------------------- | ------------------------------------------------------- | ------ |
| R01 | 중     | 카드 취소 투영의 전체 이력 재계산 제거          | `web/src/lib/processing/`, `reconciliation/`            | 완료 (#44, #49) |
| R02 | 중     | XLSX 날짜 셀 정밀도 오판(DAY → SECOND)          | `web/src/lib/statements/file.ts`, `parse.ts`            | 완료 (#43) |
| R03 | 중     | 가입 닫기·웹 세션 철회 수단                     | `web/src/lib/auth/`, `prisma/schema.prisma`             | 완료 (#45) |
| R04 | 하     | 재처리 실행이 일시 충돌로 영구 FAILED           | `web/src/lib/reprocessing/index.ts`                     | 완료 (#46) |
| R05 | 하     | 대표 원문 분리 시 나머지 근거가 함께 묶임       | `web/src/lib/review/index.ts`, `app/(app)/review/`      | 완료 (#47) |
| R06 | 참고   | 배치 상한 불일치 시 폰 큐 정체·카카오 제목 위험 | `web/src/app/api/ingest/`, `android/.../queue/`, 가이드 | 완료 (#48) |

권장 순서: **R02 → R01 → R03 → R04 → R05 → R06**.
R02는 작고 독립적이라 먼저 끝내고, R01은 설계 검증이 필요해 별도 브랜치에서 충분히 시간을 씁니다.
R01과 R05는 둘 다 `refreshCardProjection`을 건드리므로 R01 병합 후 R05를 시작합니다.

---

## R01 — 카드 취소 투영의 전체 이력 재계산 제거

**문제.** `refreshCardProjection()`(`web/src/lib/processing/index.ts:118`)은 원문 1건을 처리할 때마다
해당 카드의 MERGED 제외 전체 거래를 읽고 `projectCancellations()`를 다시 돌립니다.

- 카드 거래가 `LEDGER_LIMIT`(10,000)를 넘으면 매 처리가 `LEDGER_LIMIT`로 실패 → 5회 후 FAILED.
  그 카드의 신규 원문이 모두 처리되지 않습니다(하루 10건에서 15건이면 약 2년에서 3년).
- 한도 전에도 메시지당 O(카드 이력) 읽기, Serializable 트랜잭션의 넓은 읽기 집합으로 P2034 증가.
- 호출처: `processing/index.ts`(처리), `review/index.ts`(수동 입력·병합·분리), `statements/`(명세서 반영).

**설계 조건.** 취소 연결은 `lookbackDays = 60` 안에서만 원거래를 찾지만, 잔여액 소진 순서 때문에
한 취소의 연결 변경이 뒤 취소로 연쇄될 수 있습니다. 단순히 "±60일"로 자르면 전체 재계산과
결과가 달라질 수 있으므로 **동등성을 테스트로 증명한 창(window) 방식**만 채택합니다.

**작업.**

- [x] 설계 메모/ADR 추가(0023): 창 계산 규칙과 연쇄 처리 방식 결정
  - 후보 A: 변경 시각 T 기준 `[T − 2×lookback, T + lookback]`를 재계산하고, 창 밖 취소가 소비한
    원거래 잔여액은 DB의 기존 `canceledAmount`/`canceledTxId`에서 고정값으로 주입.
    창 경계의 연결이 바뀌면 창을 넓혀 반복(최대 N회 후 전체 재계산 fallback).
  - 후보 B: 연결이 바뀌지 않은 첫 지점에서 멈추는 증분 재계산.
  - 결정 기준: 전체 재계산과의 결과 동일성, 구현 단순성, 최악 비용.
- [x] `reconciliation/`에 창 단위 투영 함수 추가(순수 함수 유지), 기존 `projectCancellations`는 기준 구현으로 보존
- [x] **동등성 속성 테스트:** 무작위 가공 원장(부분취소·다중 취소·수동 연결·DAY 정밀도·경계 60일 포함)에서
      "변경 1건 후 창 재계산 결과 == 전체 재계산 결과"를 수천 회 검증
- [x] `refreshCardProjection` 호출부 3곳을 새 함수로 교체, 카드 평생 `LEDGER_LIMIT` 제거
      (창 안 건수 상한은 유지하고 초과 시 명확한 오류)
- [x] 격리 DB 통합 테스트: 단일 카드 12,000건 가공 원장에서 신규 처리 성공, 처리당 읽기 행 수가 창 크기에 비례
- [x] 기존 `processing-database`, `review-database`, `statements-database` 테스트 전부 통과
- [x] 취소 투영 전체 재계산 도구(관리자 전용, 드라이런 기본) — 규칙 변경·복구 시 전 이력 정합성 재확인용

**완료 기준.** 동등성 속성 테스트 통과, 1만 건 초과 카드에서 처리 성공, 기존 테스트 회귀 0,
누적 성능 검증(13개월 5,000+500건) 재실행에서 처리 시간·메모리가 기존 이하.

---

선택: ADR 0023의 후보 의존성 연결 성분 방식. 고정 시간 창의 잔여액 추정 대신 연쇄 후보를 완전히 포함합니다.
무작위 변경 3,000회 동등성, 과거 12,000건 카드 처리, 격리 DB 포함 245 tests 통과.

## R02 — XLSX 날짜 셀 정밀도 오판

**문제.** `readStatementFile()`이 Date 셀을 `"YYYY-MM-DD 00:00:00"`으로 바꾸고
(`web/src/lib/statements/file.ts:82`), `parseRow()`의 날짜 전용 판정(`parse.ts:59` 앞)이 실패해
`timePrecision: 'SECOND'`가 됩니다(리뷰 중 임시 테스트로 확인, CSV는 영향 없음).
명세서 CREATE 거래가 자정 정각 거래로 취급되어 중복 판정(DAY 규칙 대신 ±2분)과
취소 경계(`projectCancellations`의 DAY 경계)가 어긋납니다.

**작업.**

- [x] 실패하는 회귀 테스트 먼저 작성: XLSX Date 셀(시각 00:00:00) → `timePrecision === 'DAY'`
- [x] 시각 성분이 0인 Date 셀은 `YYYY-MM-DD`로 변환(`file.ts`). 시각이 있는 셀은 기존대로 유지
- [x] 결정 기록: 실제 00:00:00 거래가 날짜 전용으로 해석되는 한계를 코드 주석과 ADR 0021 보강에 명시
      (카드 명세서의 날짜 전용 셀이 대부분이라 DAY 쪽이 안전한 기본값)
- [x] 이미 보관된 명세서 영향 확인: `StatementImport` 원본은 보존되므로, 격리 DB에서 XLSX로 CREATE된
      거래의 `timePrecision` 분포를 조회해 보정 필요 여부 판단(운영 DB 직접 수정 금지, 필요 시 재매핑 경로 사용)

**완료 기준.** 회귀 테스트 통과, `statements.test.ts`·`statements-database.test.ts` 통과.

---

검증: 수정 전 자정 회귀 실패를 확인했고 수정 후 격리 DB 포함 40파일 243건 통과.
격리 복원 DB의 XLSX 대표 원문 거래는 0건으로 기존 보정 대상 없음(운영 조회·수정 없음).

## R03 — 가입 닫기와 웹 세션 철회

**문제.**

- `INVITE_CODE`가 만료 없는 고정값이고 비우면 가입 시 예외가 납니다(`web/src/lib/auth/actions.ts:77`).
  가족 등록 후에도 코드를 아는 tailnet 사용자는 계속 가입할 수 있습니다.
- WEB 세션은 30일 JWT만 신뢰합니다(`session.ts:22`는 DEVICE만 DB 재확인).
  비밀번호 변경·역할 변경·강제 로그아웃 경로가 없어 쿠키 유출 시 `AUTH_SECRET` 교체 외 수단이 없습니다.

개인용 tailnet 서비스 범위에 맞춰 **최소 조치만** 합니다(레이트 리밋 인프라·2FA 등은 범위 밖).

**작업.**

- [x] `INVITE_CODE` 미설정/빈 값 = 가입 닫힘. 가입 화면에 "가입이 닫혀 있습니다" 표시, 예외 대신 안내 반환
- [x] 초대 코드 비교를 `timingSafeEqual` 기반으로 변경
- [x] `FamilyMember.sessionVersion Int @default(0)` 추가(보존형 migration), JWT에 실어 발급
- [x] `getAppSession()`에서 WEB 세션도 `sessionVersion`·존재 여부를 확인(DEVICE 경로와 같은 1회 조회)
- [x] 관리자 전용 "구성원 모든 웹 세션 종료"(sessionVersion 증가)와 본인 비밀번호 변경(현재 비밀번호 확인 + 증가)
- [x] 테스트: 가입 닫힘, 버전 불일치 세션 거부, 다른 구성원 세션 종료 권한(FAMILY만), DEVICE 세션 영향 없음
- [x] 관리자 가이드에 "가족 등록 후 INVITE_CODE 비우기" 절차 추가

**완료 기준.** scope 관련 변경이므로 "타인 세션을 종료/조회할 수 없음" 테스트 포함(AGENTS 테스트 규칙),
migration은 백업·격리 복원 DB에서 적용 검증.

---

검증: 격리 복원 DB 보존형 migration 적용, 253 tests + 토큰 경계 2 tests 통과 (#45).

## R04 — 재처리 실행이 일시 충돌로 영구 FAILED

**문제.** `advanceRun()`은 `serializable()` 3회 재시도 후에도 P2034면 catch(`reprocessing/index.ts:327`)에서
실행을 `FAILED/PROCESSING_ERROR`로 확정합니다. APPLY 중 처리 스케줄러와 같은 `ProcessingJob`을
두고 경합하면 발생할 수 있고, 사용자는 미리보기부터 다시 해야 합니다.

**작업.**

- [x] P2034(재시도 소진)는 FAILED로 바꾸지 않고 PENDING 유지, 다음 주기에 재시도. `error`에 `TRANSACTION_RETRY` 기록
- [x] 연속 일시 실패 횟수 상한(예: 20주기) 초과 시에만 FAILED
- [x] 테스트: P2034를 주입한 `advanceRun`이 PENDING으로 남고 다음 호출에서 진행

**완료 기준.** `reprocessing-database.test.ts` 통과 + 신규 테스트.

---

검증: 격리 DB 포함 256 tests, typecheck/lint/format 통과 (#46). 카운터 보존형 migration, 갱신 시각/횟수 CAS로 다른 작업자의 진행 보호.

## R05 — 대표 원문 분리 동작 정리

**문제.** 근거 3개 이상 거래에서 대표 원문(A)을 분리하면 A가 남고 **나머지 B·C가 함께** 새 거래로
이동합니다(`review/index.ts:295`). 사용자는 "A만 떼어내기"를 기대할 가능성이 큽니다.

**작업.**

- [x] 동작 결정: (a) A만 새 거래로 옮기고 기존 거래의 대표를 B로 교체, 또는 (b) 현행 유지 + 화면 문구로 명시
      — `Transaction.rawMessageId` 대표 교체가 unique 제약·재처리 경로에 주는 영향을 확인한 뒤 선택
- [x] 결정에 맞춰 구현 또는 `/review` 문구 수정
- [x] 테스트: 근거 3개 거래에서 각 원문 분리 시 결과 거래 수·근거 배치·취소 재투영 확인

**완료 기준.** `review-database.test.ts` 통과 + 신규 케이스. R01 병합 후 진행.

---

결정 (b): 대표 rawMessageId는 고유 제약과 재처리 upsert 식별자이므로 유지합니다. 대표 원문 선택 시 나머지 전체가 함께 이동한다는 설명/버튼을 명시합니다. 세 근거 각각 선택에 대해 근거 배치·거래 수·수동 취소 연결·원문 보존을 검증합니다 (#47).

## R06 — 참고 항목(운영/문서)

- [x] **배치 상한 불일치:** 서버 `INGEST_MAX_BATCH_SIZE` < 앱 배치(200)이면 모든 업로드가 413이고
      앱은 413을 재시도하지 않아 큐가 정체됩니다. 서버 설정 하한(200) 검증 또는 앱에서 413 시 배치 반감 재시도.
      앱 변경은 최종 APK 한 번 게시에 포함(중간 게시 없음).
- [x] **카카오 채널 제목 일치:** 1:1 대화 알림 제목은 상대 표시 이름이라, 친구/단톡방 이름이 등록 채널명과
      같으면 사적 대화가 수집될 수 있습니다. 사용자 가이드에 경고 추가, `collection-validation.md`의
      개인정보 canary 항목에 "채널명과 같은 이름의 개인 대화" 케이스 추가.

---

## 전체 완료 시 확인

```bash
cd web
corepack pnpm typecheck && corepack pnpm lint && corepack pnpm format:check && corepack pnpm test
# 격리 DB 통합 테스트는 familycard_test 또는 명시된 familycard_verify_* 에서만
cd ../android && ./gradlew testDebugUnitTest lintDebug writeDebugApkMetadata   # R06 앱 변경 시
python3 -m unittest discover -s scripts -p 'test_*.py'
```

- [x] Web typecheck/lint/format·격리 DB 268 tests·Python 23 tests 통과. Android 코드 변경이 없어 조건부 Android 재실행은 해당 없음. CHANGELOG `Unreleased`에 R01~R06 반영
- [x] HANDOFF "남은 일"에서 이 계획 항목 정리

R06은 서버 설정 하한 보정 방식을 선택했습니다. Android 변경/중간 APK 게시 없음. 200 미만·잘못된 설정 8종과 유효 상한 300의 HTTP 경계를 검증했습니다.

R01 성능 보강 #49: 수동 고정 연결을 직접 방문해 가공 5,500건 원장 처리 402~457ms → 9~22ms, 반환 행 2건, 전체 재계산 대비 차이 0건.
