# HANDOFF — 현재 상태와 다음 작업

> 작업 전에 [AGENTS.md](../AGENTS.md)를 읽습니다. 과거 세션 기록은
> [개발 이력](history/handoff-2026-09-25-development.md)에 보존했습니다.

**기준일:** 2026-09-26 · **작업 위치:** `/home/jihoon/projects/FamilyCard` (WSL ext4)

## 가장 중요한 상태

- 사용자 승인 [ADR 0014](adr/0014-development-and-release-gates.md)에 따라 S03~S09를
  기능 브랜치/격리 DB에서 구현했습니다. 실기기 검증을 반복 요청하며 개발을 멈추지 않습니다.
- 거래/실적/분석/명세서/알림의 구현·격리 검증은 완료했지만 **운영에 새 기능을 배포하지 않았습니다**.
  현재 운영은 기존 수집 서버입니다. 운영 DB에 새 migration/카드/파서 규칙을 자동 적용하지 않았습니다.
- 사용자가 요청한 버전 업데이트는 **전체 작업과 최종 조건 확인 뒤 한 번**입니다.
  APK **versionCode 7 / versionName 0.2.0**, Web package **0.1.0**, Git 태그 **v0.1.0**을 유지합니다.
  후보 APK는 빌드했지만 게시하지 않았습니다. 사전 검사는 code 미증가만을 이유로 게시 불가입니다.
- 실기기 조건이 끝나기 전 최종 버전/새 기능 운영 배포를 하지 않는다는 승인 결정을 유지합니다.
  [수집 검증표](plan/collection-validation.md)의 미확인을 통과로 바꾸지 않습니다.

## 최신 사용자 확인과 백업 (2026-09-25)

- 사용자 확인: 네트워크 재연결 후 전송 복구 성공. 폰 재부팅은 아직 안 했으며 추후 확인 예정.
  일반적인 정상 동작 보고를 개인정보/RCS 등 모든 항목의 성공으로 확대하지 않습니다.
- 사용자 승인 장소 PC + Google Drive에 현재 게시본과 일치하는 개발 서명 키를 AES256으로 백업했습니다.
  PC `~/FamilyCard-Backups/`, Drive의 비공유 `FamilyCard Backups` 폴더에 저장했습니다.
  원격 재다운로드 SHA-256/복호화/복원 키 일치 검증 성공. 새 키 발급·교체·GitHub Secrets 변경 없음.
- 복호화 암호는 `data/secrets/backup-passphrase` (0600), 별도 PC 밖 보관은 사용자 확인 대기.
  검증 상세 `data/verification/signing-backup.json`; 실제 키/암호/Drive ID는 Git에 넣지 않습니다.
- 이번 백업은 서명 키만 포함합니다. DB 자동 외부 백업과 web-push 키의 별도 백업은 미완료입니다.

## 구현과 검증 근거

[최종 개발 검증](research/final-development-verification-2026-09-25.md)에 범위/한계를 정리했습니다.

| 항목 | 결과 |
|---|---|
| Web | 241 tests (격리 DB 포함), typecheck/lint/format, 보안 감사 알려진 취약점 0 |
| Android | 102 tests, lintDebug, APK/메타데이터 빌드 성공; 게시/버전 변경 없음 |
| 운영 스크립트 | Python 23 tests, systemd unit 검증 |
| 복원 | 새 운영 백업 955건, migration 10개, 기준 원문 누락/변경 0, 복원/검증 약 3초 |
| 누적 성능 | 13개월 가공 승인 5,000 + 취소 500, 63회 요청/보고서와 후보 재시작 검증 |
| 후보 메모리 | 추가 반복 조회 164~165MiB, PDF 포함 최대 관측 218MiB (순간 peak/장기 누수 보장 아님) |
| 운영 관찰 | 기존 수집 서버 3시간여/15개 표본 약 87~94MiB, 마지막 오류·경고 없음 |
| 원문 형식 | [955건 값 없는 집계](research/raw-format-inventory-2026-09-25.md), 거래 정답셋 아님 |

RCS legacy 형식은 `card` 문자열이 아니라 `layout/LinearLayout/TextView.text`에 본문을 담습니다.
13건의 취소 계열을 읽도록 보완했고, 실제 부분취소 1건의 메모리상 파싱 성공을 값 출력/규칙
저장 없이 확인했습니다. 가공 샘플은 화면 줄바꿈 대신 실제 공백 구조를 따릅니다.

PDFKit standalone 파일 추적은 `node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/**/*`를 사용합니다.
symlink 경로를 직접 복사하면 패키지 디렉터리를 가릴 수 있어 CI에서 실제 패키지 PDF/XLSX 생성도 검사합니다.
실적 계산은 기간+필요 원거래만 조회하고 날짜 포맷터를 재사용합니다. 새 운영 이미지의 V8
old-space는 256MiB, Compose web 기본 상한은 512MiB입니다. 이 상한은 기존 운영 컨테이너에
재생성 없이 적용된 것이 아닙니다. 자원 감시는 384MiB부터 경고합니다.

## 현재 기능 경로

- `web/src/lib/parser/`, `cardmatch/`, `reconciliation/`, `processing/`: 안전한 규칙 실행,
  카드 후보/보수적 중복·취소, 작은 지속 작업/lease/세대/재시도. 실제 값 없는 가공 회귀.
- `/cards`, `/review`, `/transactions`: 카드/별칭/기간, 수동 판단·병합/분리·취소 연결,
  KST 월 순사용액. 원문/수동 판단 보존과 모든 조회/변경 scope.
- `/family/rules`, `/reprocess`, `/api/reparse`: 버전/샘플/구조 초안·비활성 복원,
  대상 ID가 고정된 지속 미리보기/반영. 미리보기는 파싱/카드 연결 예상이며 금융 정답 시뮬레이션은 아님.
- `/benefits`, `web/src/lib/benefit/`, `classification/`: 공식 조건/기간/결제일 버전,
  두 취소 정책·분류/수동 제외·추정치 사유/snapshot. 실제 상품 조건은 추측 등록하지 않음.
- `/analytics`, `/family`, `/family/members/[id]`, `/api/reports`: 범위별 분석·예산·보고서.
  XLSX 10,000건/PDF 2,000건, 생성 1개씩, 한국어 폰트 포함.
- `/statements`, `web/src/lib/statements/`: 한 카드 CSV/XLSX 2MiB/1,000행,
  원본/행 보존·매핑 수정·연결/보정. 순액/청구액으로 원승인을 덮어쓰지 않음.
- `/alerts`, `web/src/lib/alerts/`: 상태 보고/실적 알림과 선택 웹 푸시.
  푸시에는 일반 안내만 포함하며 이번 작업에서 실제 외부 푸시를 보내지 않음.

상세 결정은 ADR [0015](adr/0015-transaction-evidence-and-processing.md)~[0022](adr/0022-opt-in-operational-alerts.md)를 참고합니다.
`FAMILYCARD_PROCESSING_ENABLED`, `FAMILYCARD_ALERTS_ENABLED`는 기본 false입니다.

## 운영·복원·비밀 자료

- 운영 컨테이너 `familycard-web`, `familycard-db`; 실제 수집 DB `familycard_live`.
  private `.env`의 tailnet HTTPS `3443` → 로컬 web `3000`, DB 로컬 `5433`.
- `web/.env`는 루트 `.env` 심볼릭 링크입니다. 덮어쓰거나 내용을 출력하지 않습니다.
- `familycard-backup.timer` 일일, `familycard-monitor.timer` 15분 주기 활성화.
  정기 백업과 보존 계획/선택 외부 복사의 unit을 검증했습니다.
- `data/backups/` 실제 dump와 `pinned.json`, 모든 실제 복원 DB는 삭제/seed/reset 금지.
  외부 백업 경로 미정이므로 복사/보존 삭제는 꺼져 있습니다. [보존 가이드](guide/backup-retention.md).
- 새 최종 복원 DB: `familycard_verify_20260925_020243`.
  실제 기준 원문 955건 + 별도 가공 누적 원문 5,500건을 보존합니다. 검증 기기는 폐기했습니다.
  기준 해시/복원 정보는 private `data/verification/final-restore-baseline.json`에 있습니다.
- 이전 복원 DB `familycard_verify_20260924_221728`, `familycard_verify_20260924_232520`,
  `familycard_rcs_verify_20260924`도 보존합니다. 마지막 것은 RCS 확인, 가운데는 개발 회귀용입니다.
- `data/secrets/web-push.env`, `data/secrets/backup-passphrase`를 0600으로 준비했습니다.
  운영 환경/외부 저장소에는 적용·전송하지 않았고 독립 백업이 필요합니다. 내용을 출력하지 않습니다.
- 운영 복구 이미지 `familycard-web:before-security-20260925`는 보존합니다.
  검증 후보 컨테이너/임시 env/이미지는 검증 종료 시 정리합니다.
- 마지막 게시 APK SHA-256:
  `d2e559d1f32d89bfa885ec8379ca0256ceeb4d39f77175a997425b9edd00a384`.
  같은 package/서명 유지 검사 후 최종 versionCode를 올릴 때만 게시합니다.

## 코드 리뷰 후속 진행

- R02 (#43): XLSX 자정 Date 셀은 DAY, 시각이 있으면 SECOND. 회귀 재현 후 격리 DB 포함 243 tests 통과.
- 격리 DB XLSX 대표 거래 0건, 보정 대상 없음. R01 (#44): ADR 0023 후보 연결 성분 투영, 관리자 드라이런 복구 도구, 격리 245 tests 통과.
- 카드 과거 12,000건에서도 처리 성공, 거래 조회 반환 합계 1,000건 미만. R03 (#45): 가입 닫힘/고정 길이 digest 비교, WEB sessionVersion 검증, `/account` 비밀번호 변경과 `/family/sessions` 철회.
- 보존형 migration 12개를 격리 DB에 적용. 기존 웹 쿠키는 최종 배포 후 재로그인 필요, DEVICE 영향 없음. R04 (#46): P2034 소진 시 PENDING/TRANSACTION_RETRY 유지, 20회 연속 충돌만 FAILED, 진행 성공 시 카운터 초기화.
- 격리 DB 13 migrations / 256 tests, typecheck/lint/format 통과. R05 (#47): 대표는 기존 거래에 남고 나머지 전체를 함께 이동하는 기존 동작을 화면에 명시.
- 근거 3개 각각 선택 시 배치/취소 연결/원문 보존 회귀 추가. R06 (#48): 서버 배치 하한 200 보정, 카카오 채널명 중복 경고/실기기 canary 추가.
- 후속 R01~R06 구현 완료: Web 격리 DB 268 tests, typecheck/lint/format 및 Python 23 tests 통과.
  Android 소스 변경/재빌드/게시 없음. 후보 컨테이너/이미지 정리, 실제 원문/백업/복원 DB 보존.

## 남은 일 — 새 개발을 처음부터 반복하지 않기

> 2026-09-26 코드 리뷰 후속 수정 항목(R01~R06)은 [코드 리뷰 후속 계획](plan/code-review-followup-2026-09-26.md)을 따릅니다.

1. `docs/plan/collection-validation.md`: 실제 폰의 개인정보 canary·RCS 보충/권한·오프라인·재부팅·수집 대상 삭제,
   가족 확대/지원 범위 결과를 사용자에게 받아 기록합니다. 자동 테스트로 대체하지 않습니다.
2. `docs/guide/safe-final-update.md`: 운영 서명 전환/큐·설정 보존과 **복호화 암호의 PC 밖 별도 보관**이 미확인입니다.
   현재 서명 키의 PC/Drive 암호화 복사와 복원 검증은 완료했습니다. 운영 키 전환과 GitHub 서명 Secrets는 미설정입니다.
3. 실제 카드/명의/종류/결제일을 확인하고 `/cards`, `/family/rules`에 검토한 값을 설정합니다.
   별도 연속 결제/복수 출처 정답셋, 오병합/오카드 0과 자동 처리율 목표는 아직 평가하지 않았습니다.
4. `docs/plan/phase-4.md`, `phase-6.md`, `phase-7.md`: 공식 조건·실제 명세서·가족 모든 카드 한 사이클 대조와
   다음 사이클 개선, 실제 브라우저 푸시 수신, 자연 WSL/폰 재시작과 장기 자원 관찰은 미완료입니다.
5. 독립 DB 백업 목적지가 정해지면 `data/secrets/backup-offsite.env` 설정 → 암호화 복사/복원 확인을 합니다.
   확인 전 `FAMILYCARD_PRUNE_BACKUPS=true`를 켜지 않습니다.
6. 최종 조건 충족 후에만 버전/CHANGELOG/태그를 **한 번** 갱신하고 PR·CI·GitHub 병합,
   DB migration → 호환 서버 → APK 게시 → 실기기 보존 확인 순서로 진행합니다.

## 작업 규칙과 빠른 검증

`main` 직접 커밋/push 금지. 기능 브랜치 → PR → 정확한 HEAD 필수 CI → GitHub 병합 후
로컬/원격 브랜치를 정리합니다. 추가 워크트리는 만들지 않았습니다. 실제 금융 자료/키/백업은 Git에 넣지 않습니다.

```bash
cd web
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm test
# DB 통합 테스트: familycard_test 또는 명시된 familycard_verify_* 연결에서만 실행
# FAMILYCARD_TEST_DATABASE_URL을 실제 수집 DB로 지정하지 말 것
```

Python 검증은 `python3 -m unittest discover -s scripts -p 'test_*.py'`입니다.
Android는 `./gradlew testDebugUnitTest lintDebug writeDebugApkMetadata`까지 실행합니다.
최종 버전 변경 전 `publishDebugApk`를 실행하지 않습니다. `ktlintCheck` task는 없으므로
AGENTS 명령을 실제 CI의 `lintDebug`로 바로잡았습니다.
