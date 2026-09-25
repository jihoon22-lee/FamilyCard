# HANDOFF — 세션 인수인계

> 작업 전 [AGENTS.md](../AGENTS.md)와 이 문서를 읽고, 작업 단위를 마칠 때 갱신합니다.

**최종 갱신**: 2026-09-25 · S09 운영 알림
**작업 위치**: `/home/jihoon/projects/FamilyCard` (WSL ext4)
**작업 방식**: `feat/operational-alerts` → PR → CI → `main` → 브랜치 정리

## 최신 작업 — 운영 알림과 선택 푸시

- PR #38 명세서 대사 CI 통과·병합·브랜치 정리.
- `web/src/lib/alerts/`, `/alerts`: 수집 상태 6시간 지연·마감 임박 최소 실적 미달·관찰된
  달성 구간 하락, 중복 방지·본인 확인 처리. 원문 수집과 별도의 1시간 주기.
- 선택 웹 푸시: 사용자 허용 브라우저, 금융 내용 없는 일반 안내만 전송. 구독/전달 scope,
  폐기 기기/권한 변경·공급자 HTTPS·키 길이·lease/실패 제한. 외부 실제 전송은 하지 않음.
- `20260925000500_operational_alerts` 격리 migration 적용. 두 Compose 기본 비활성,
  운영 .env/서버는 변경하지 않음. [ADR 0022](adr/0022-opt-in-operational-alerts.md) 참조.
- Web 239 tests: 조건 경계·하락/중복·타인 비노출·ADMIN 폰 가족 구독 차단·mock 전송.
- standalone 후보에서 DEVICE 세션 알림 목록/타인 비노출, 실제 Server Action의 본인 확인
  쓰기/타인 쓰기 거부와 static worker 200 검증. 원문 기준 946건 누락/변경 0.
- `data/secrets/web-push.env`에 VAPID 키 1회 생성(0600, Git 제외). 운영 미적용, 백업 필요.
- 다음: 백업 보존 정책/독립 저장소 연결 준비, 전체 복원·성능/메모리·사용 문서 정리 (S09/S10).
  실기기 푸시·canary/복구·공식 조건/명세서 대조·외부 키 백업은 최종 검증 대기.

## 최신 작업 — 명세서 대사

- PR #37 가족 분석/보고서 CI 통과·병합·브랜치 정리.
- `web/src/lib/statements/`, `/statements`: CSV/XLSX 미리보기·컬럼/의미 매핑,
  원본 파일·모든 행 보존·소유자별 중복 업로드 방지·미연결 행 매핑 수정.
- 일치/누락/금액 차이/모호한 후보 검토, 선택 행 연결/누락 생성/금액 보정·감사 이력.
  순액/청구액을 승인액으로 덮어쓰지 않으며 미연결 기존 거래를 삭제/취소하지 않음.
- 명세서 행은 별도 해석 경로. 알림 재처리에서 보존. 원본 다운로드도 scope 검사.
- 파일/ZIP/XML/행/셀/대사 건수·동시 업로드 상한. 수식/DTD/엔티티 거부.
  [ADR 0021](adr/0021-statement-provenance-and-reconciliation.md)에 지원 범위 기록.
- Web 235 tests/typecheck/lint/format와 보안 감사(알려진 취약점 0), standalone 빌드 통과.
  후보 DEVICE 세션에서 명세서 화면/원본 바이트 다운로드/타인 파일 404 검증.
  원문 기준 946건 누락/변경 0, 운영 신규 유입은 별도(확인 시 952건).
- 다음: `web/src/lib/alerts/` 수집 지연·실적 미달/소급 변화 알림과 선택 전달 경로,
  운영 보존 정책/최종 복원·성능 검증. 실제 명세서 대조/외부 백업 목적지는 미완료.

## 최신 작업 — 가족 분석·예산·보고서

- PR #36 실적 추정 CI 통과·병합·브랜치 정리. 이전 후보 이미지도 정리.
- `web/src/lib/analytics/`, `/analytics`, `/family`, `/family/members/[id]`: 가족×카드,
  실적 추정치 요약·미확정 원문·기기 상태, 13개월 추이·분류 비중·예산 초과.
- `web/src/lib/budgets/`: 개인/가족·분류별 월 예산, 같은 조합 갱신과 판단 이력.
- `/api/reports`: 본인/선택 구성원 XLSX/PDF. literal 셀·한국어 폰트·no-store·건수/동시 생성 제한.
- Web 229 tests/typecheck/lint/format 통과. 소유권/ADMIN 폰/일반 웹/가족 웹,
  순액/예산/내보내기 범위·엑셀 재읽기 검증. 가공 PDF 3쪽 렌더링/한글/마지막 행 확인.
- 의존성 감사 알려진 취약점 0. [ADR 0020](adr/0020-scoped-analytics-and-reports.md) 참조.
- standalone 후보에서 분석·엑셀/PDF 다운로드와 타인 memberId 거부, ADMIN 폰 가족
  접근 차단/ADMIN 웹 드릴다운 확인. PDFKit 동적 폰트 모듈 누락을 tracing include로 수정.
- 다음: `web/src/lib/statements/` XLSX/CSV 원본·행 보존, 컬럼 매핑·중복 업로드·대사/보정 (S09).
  외부 백업/서명 키 백업 목적지·실기기/한 사이클 대조 등 최종 검증은 계속 미완료.

## 최신 작업 — 실적 추정과 최소 분류

- PR #35 지속 재처리 CI 통과·병합·브랜치 정리.
- `web/src/lib/benefit/`, `/benefits`: KST 사이클·정수 구간/제외·최소 금액·취소 정책,
  공식 조건 출처/유효 기간/결제일 버전 보존. 거래별 사유·불확실·부족 금액을 추정치로 표시.
- `web/src/lib/classification/`, `/family/categories`, 거래 분류 폼: 관리자 공용 분류,
  구성원별 정확 가맹점 학습·수동 분류/포함 판단 보존. 파서와 독립된 benefitOverride.
- `20260925000400_benefit_versions` 보존 migration을 격리 DB에 적용. 운영 미적용.
- [ADR 0019](adr/0019-benefit-versions-and-decisions.md): 고아 취소 불확실 차감,
  과거 규칙/결제일, 기록 snapshot과 excludeReason 의미·최소 금액 정책 한계.
- Web 224 tests: 실적 경계/취소/KST/윤년, 타인 접근 차단, 소유자별 학습,
  과거 규칙·수동 판단·snapshot·원문 보존을 격리 DB에서 검증.
- standalone 후보의 실제 DEVICE 세션으로 `/benefits` 구성된 추정치 화면 200과
  타인 카드 표식 비노출 확인. 원문 기준 946건 누락/변경 0.
- 다음: `/family` 가족×카드 현황과 구성원 드릴다운, 예산/비교/보고서 (S08).
  실제 상품 약관 등록·카드사 한 사이클 대조는 미완료. 버전/배포는 최종 한 번까지 보류.

## 최신 작업 — 지속 재처리

- PR #34 규칙 관리 CI 통과·병합·브랜치 정리.
- `web/src/lib/reprocessing/`, `/reprocess`, `/api/reparse`: 범위 미리보기/반영,
  원문 ID 대상 고정·20건 배치·동시 실행/재시작 복구·중복 반영 방지·설정 변경 중단.
- `20260925000300_reprocessing_runs` migration을 격리 DB에 적용. 운영 미적용.
- 미리보기는 파싱/카드 연결 예상으로 명시. 악화 확인과 수동 보존, 본인 작업 scope,
  same-origin/4KiB API 검증. [ADR 0018](adr/0018-persistent-reprocessing.md) 참조.
- Web 217 tests/typecheck/lint/format, standalone 빌드 통과. 격리 DB에서 25건 동시
  배치/상태 변경 후 대상 보존/중복 요청/설정 변경/타인 접근 검증.
- 후보 서버 실제 DEVICE 세션으로 미리보기 API→백그라운드 완료→반영 API 확인,
  새 화면 200/타인 비노출. 후보 컨테이너·임시 env 정리.
- 다음: `web/src/lib/benefit/`, 실적 규칙 기간/버전/제외·최소 가맹점 분류와 추정치 UI (S07).
  실제 카드 규칙 등록·실기기·한 사이클 대조는 미완료, 최종 버전/배포는 한 번까지 보류.

## 최신 작업 — 규칙 관리

- PR #33 카드/검토 UI CI 통과·병합·브랜치 정리.
- `web/src/lib/parser-rules/`, `/family/rules`: 관리자 WEB/FAMILY만 규칙 편집,
  샘플·최근 100개 실패/미확정 시험, 활성화 전 샘플 성공/사용자 확인, 버전 충돌 감지.
- 모든 저장의 revision/감사 기록. 복원은 버전을 되돌리지 않고 새 비활성 버전 생성.
- 원문에서 숫자 그룹 초안만 제안. 카드사/금액/날짜 의미를 추측해 활성화하지 않음.
- Web 212 tests/typecheck/lint 통과. 관리자 폰/일반 웹의 규칙 접근 거부,
  실패 샘플 활성화 방지·버전 충돌·이력 복원 실제 격리 DB 검증.
- 다음: `web/src/lib/reprocessing/`의 지속 범위 미리보기/반영과 작업 진행 화면.
  규칙 시험은 파싱만 평가하며 카드/대사/취소 최종 결과는 실제 재처리와 검토가 필요.

## 최신 작업 — 카드 관리·검토·월 사용액

- PR #32 지속 처리 CI 통과·병합·로컬/원격 브랜치 정리.
- `/cards`: 구성원별 카드 등록/수정/비활성화, 같은 끝번호 허용, 카드/별칭 유효 기간.
- `/review`: 사유별 미확정 원문, 수동 거래·카드 지정/별칭 학습, 취소 원거래 선택,
  동일 거래 병합·근거 분리. 판단 이력과 수동 보존, 대표 원문 키 충돌 없이 재분리.
- `/transactions`와 `/`: KST 월/카드 필터·페이지, 확정 승인 순사용액과 확인 필요/원화 미확정 건수.
  취소는 승인 순사용액에 한 번 반영. 고아 취소는 검토 건수로 표시하고 임의 차감하지 않음.
- 수동 쓰기는 SERIALIZABLE + 롤백된 충돌만 제한 재시도. 수동 입력 요청 키 중복 방지.
- 격리 DB 포함 Web 209 tests: 타인 카드·원문·거래 접근 차단, 원문 보존, 병합/분리 반복,
  부분취소 수정·초과액 롤백, 월 합계와 KST 경계 확인.
- standalone 후보에서 실제 DEVICE 세션으로 `/`, `/cards`, `/review`, `/transactions` 200과
  타인 표식 비노출/타인 rawId 접근 차단 확인. 원문 기준 946건 누락/변경 0.
- 다음: `web/src/lib/parser-rules/` 규칙 버전/rollback/초안/시험 적용,
  `web/src/lib/reprocessing/` 지속 범위 재처리·dry-run, 이후 S07 실적 엔진.
- 운영 DB/서버/게시 APK/버전/태그는 그대로. 아래 과거 기록의 이전 진입 금지는
  최신 승인 ADR 0014가 대체하며, 실기기 검증은 최종 배포 전 조건으로 남음.

## 최신 작업 — 지속 처리와 자동 실행

- PR #31 순수 엔진 CI 통과·병합·로컬/원격 브랜치 정리.
- `web/src/lib/processing/`: 원문/작업 원자적 저장, 누락 작업 복구, lease·세대 CAS,
  실패 지연 재시도(5회), SERIALIZABLE 거래/근거/취소 반영과 수동/기존 거래 보존.
- `web/src/instrumentation.ts`: 명시 설정 true일 때 Node 서버 내 겹치지 않는 15초 처리.
  두 Compose와 .env.example 기본값 false. 운영 root .env/서버/DB/버전은 변경하지 않음.
- 격리 DB 포함 전체 Web 205 tests/typecheck/lint/format 통과. 새 재처리 세대가 생기면
  이전 처리의 변경이 롤백되는 실제 경합과 만료 lease 복구 검증.
- standalone 후보 HTTP ingest→작업 생성→자동 파싱·카드 연결 성공. 원문 보존 확인,
  후보 컨테이너·임시 env 정리. 기준 원문 946건 누락/변경 0 (운영 새 유입은 별도).
- [ADR 0017](adr/0017-persistent-processing.md): 현재 카드 projection 10,000건/인접 후보
  1,000건 상한. 초과는 LEDGER_LIMIT로 남기고 불완전한 합계를 자동 확정하지 않음.
- 다음: 카드 관리·규칙 버전/rollback·미확정 검토 UI, 지속 재처리 요청과 dry-run,
  카드별 월 사용액을 구현. 새 기능 운영 배포/버전은 최종 한 번까지 보류.

## 최신 작업 — 파서·매칭·취소 엔진

- PR #30 거래 근거 모델 CI 통과·병합, 로컬/원격 브랜치 정리.
- `web/src/lib/parser/`: RE2JS 2.8.6, 입력/패턴/반복/규칙/캐시 상한,
  priority 첫 매치·명시 IGNORE·사유별 실패, RCS 설명만 추출, 정수 금액/외화 scale/KST 달력 검증.
- `web/src/lib/cardmatch/`: 구성원·카드사·유효 기간을 거쳐 유일한 카드만 연결.
  끝번호/마스킹/별칭 충돌과 식별자 없음은 미확정. 원문 토큰은 보존.
- `web/src/lib/reconciliation/`: 독립 출처+고유 사건 식별 근거가 충분한 경우만 자동 병합,
  유사 후보는 REVIEW. 취소 합계는 원점 재계산, 수동 연결 우선, 당일 날짜 정밀도 지원.
- Web 202 unit tests/typecheck/lint, 보안 감사 알려진 취약점 0. DB 통합 1개는 명시 격리 DB/CI에서 실행.
- 실제 카드사 규칙/카드를 자동 등록하지 않음. KB 부분취소는 사용자 첨부 구조를 가공한 테스트.
  [ADR 0016](adr/0016-safe-parsing-and-reconciliation.md)에 실행 한계와 사건 번호 의미 기록.
- 다음: `web/src/lib/processing/`의 지속 job/lease/재시도/재처리와 실제 DB 연결,
  카드·규칙 관리/검토 UI와 권한 테스트. 운영 배포·버전 변경 없음.

## 최신 작업 — 승인된 개발 진행과 S03

- 사용자가 ADR 0014를 명시적으로 승인. AGENTS/실행 계획에 격리 개발 예외 반영.
  실기기 Gate C0는 최종 배포 조건으로 남음. 이 순서 변경 승인을 반복 요청하지 않음.
- [ADR 0015](adr/0015-transaction-evidence-and-processing.md): 대표 원문 키 유지 +
  TransactionEvidence, 규칙 action/version/revision, ProcessingJob, ReviewDecision,
  수동/명세서 소유자와 StatementImport 원본 보관 모델.
- 같은 카드 끝번호 충돌과 유효 기간, 원화 미확정 amount=null/외화 scale,
  날짜 정밀도/원결제일, 검토·병합 상태 추가. 원문을 수정·삭제하지 않는 migration.
- `web/src/lib/raw/index.ts`로 원문 scope 공용화. 기기 원문은 기기 소유자,
  기기 없는 원문만 명시 소유자를 사용. 원문 목록에 nullable 기기 대응.
- 격리 DB `familycard_verify_20260924_232520`에 migration 적용, schema diff 0.
  기존 거래/규칙을 모사한 가공 데이터로 근거·revision·job backfill 검증.
  운영 원문 기준 946건 누락/변경 0. 운영 DB migration/버전/배포는 수행하지 않음.
- Web 178 unit tests/typecheck/lint/format 통과. 별도 DB 통합 테스트는 가공 데이터를
  트랜잭션 롤백으로 검증하고 CI의 familycard_test 또는 명시적 격리 DB에서만 실행.
- 원문 구조만 확인: RCS generalPurposeCard.content 17건/card 문자열 13건.
  등록 카드/거래/파싱 규칙은 운영에서 모두 0. 추측한 카드나 규칙을 자동 등록하지 않음.
- 다음: `web/src/lib/parser/`의 안전한 규칙 실행·금액/KST·RCS 정규화,
  `web/src/lib/cardmatch/`와 취소/복수 근거 대사 엔진, 지속 작업·관리 UI 순으로 진행.

## 최신 작업 — 정기 백업과 진행 순서

- 사용자가 전체 계획 진행을 재요청. 실기기 대기와 독립된 S09 백업 자동화를 선행.
- `scripts/backup-database.py`, `scripts/systemd/familycard-backup.*`: 일일 private dump,
  동시 잠금·fsync·기존 파일 덮어쓰기 방지·실패 시 이전 정상 백업 보존.
- `scripts/monitor-resources.py`: 백업 실패/36시간 지연/파일 누락·크기 변경 감시.
- Python 17 tests와 systemd unit 검증 통과. 실제 dump와 archive 읽기 성공.
- `familycard_verify_20260924_232520`에 새 백업 복원, 기준 원문 946건 누락/변경 0.
  운영 원문·스키마는 그대로이며 새 복원 DB도 실제 데이터라 삭제/seed/reset 금지.
- [ADR 0014 제안](adr/0014-development-and-release-gates.md): 실기기 검증은 최종 배포
  조건으로 남기고 S03~S09 개발은 격리 DB에서 진행하는 구체적 순서 변경안.
  사용자에게 선택을 요청한 뒤 위 최신 기록처럼 승인됨. 배포 검증 완료를 뜻하지 않음.
- 버전/태그/게시 APK/운영 이미지는 변경하지 않음. PR #28 CI 통과·병합·브랜치 정리 완료.
- 다음: 결정이 승인되면 `AGENTS.md`와 실행 계획에 개발 순서 예외 반영 후 S03.
  기존 순서 유지라면 `docs/plan/collection-validation.md` 미확인 결과와 키 백업 장소 대기.

## 최신 작업 — 최종 업데이트 사전 검증

- APK 버전/패키지/SHA-256 메타데이터 생성 작업과 앱 **최신 버전 확인** 추가.
  4KiB 상한·다른 패키지/리디렉션 거부·없음/오류를 최신으로 숨기지 않음.
  빌드 폴더만 생성하며 public APK/JSON은 아직 게시하지 않음. 최종 게시 때 두 파일 동시 반영.
- PR #27 상태 보고는 CI 통과 후 병합, 로컬/원격 브랜치와 후보 이미지 정리.

- Web 176 tests/typecheck/lint/format, Android 102 tests/lint/debug build·메타데이터 생성 통과.
  생성 JSON의 버전/패키지/해시가 실제 APK와 일치, public 메타데이터 미게시 확인.
- `scripts/verify-apk-update.py`: 게시 APK와 후보의 서명 검증·패키지·인증서·versionCode 비교.
  자동 게시나 버전 변경은 하지 않음. Python 전체 9 tests 통과.
- 실제 양쪽 APK는 패키지/인증서 일치·code 7 유지이며, 버전 미증가만 사전 검사에 걸리는
  것을 확인. 전체 작업 종료 시 딱 한 번 버전 증가 후 통과시키는 것이 의도한 순서.
- [최종 업데이트 가이드](guide/safe-final-update.md)에 데이터 보존·migration·배포·정리,
  Play Protect 경고 구분과 공식 문서 근거, 서명 전환의 미충족 조건을 기록.
- 운영 키 백업 장소 두 곳을 사용자에게 요청. 답변 전 키 생성/교체/외부 전송은 하지 않음.
- Gate C0 실기기 개인정보·오프라인/재부팅·RCS·커버리지 조건과 S02-E 키 전환은 미완료.
  S03 이후 구현이나 전체 완료/최종 버전 발행으로 간주하지 않음.

## 최신 작업 — 원문 없는 기기 상태 신호

- 원문이 없는 동안에도 15분 주기 상태 보고: 앱 빌드, 대기/격리 건수, 로컬 저장/전송/RCS
  시각과 권한 플래그. 자유 문자열·원문·발신자·허용 목록은 보내지 않음.
- `web/src/app/api/device-status/route.ts`: 4KiB 상한·엄격한 필드 검사,
  토큰 소유 기기만 갱신하고 폐기 경합 차단. 별도 토큰 인증 경로를 미들웨어에 등록.
- `web/src/lib/device-status/`, `/collection`, 기기 관리에 상태 표시. visibleMemberIds 경유,
  구버전/미보고와 6시간 이상 미수신 구분. 최근 보고만으로 수집 성공을 보장하지 않음.
- Android `status/DeviceStatusWorker.kt`: 원문 업로드와 독립된 WorkManager.
  앱 시작/재부팅 복구, 실패해도 원문 큐는 유지. 폰 설정에 마지막 보고 시각·실패 표시.
- `Device.statusReportedAt/statusSnapshot` nullable 추가. 격리 복원 DB에만 migration 적용,
  schema diff 0, 기준 원문 944건 누락/변경 0. 검증 당시 운영 원문 946건(신규 유입 별도).
- Web 175 tests/typecheck/lint/format, Android 99 tests/lint/debug build 통과.
  Docker standalone + 격리 DB에서 실제 HTTP 상태 수신/저장·타기기/본문/크기 거부·
  SELF 격리·폐기 토큰/세션 거부 검증 성공. 후보 컨테이너·임시 env 정리, 원문 추가 없음.
  운영 DB migration·버전·APK 게시·운영 이미지 교체는 보류.
- [ADR 0013](adr/0013-device-status-heartbeat.md). 최종 배포 때 운영 migration 후 새 서버/앱 순서.
- PR #25 격리함, #26 자원 감시 CI 통과 후 병합·로컬/원격 브랜치 정리.
  자원 감시 user timer 설치/활성화, 첫 실행 success. 운영 앱/이미지는 이전 버전 유지.

## 최신 작업 — 자원 관찰

- `scripts/monitor-resources.py`: 원문·환경·로그를 읽지 않는 메모리/연결/디스크/health 관찰.
  조회 실패를 0으로 숨기지 않음. private 90일 지표 보관, 외부 전송·자동 재시작 없음.
- `scripts/systemd/familycard-monitor.*`: 15분 주기 사용자 timer. 경로는 현재 저장소 기준.
- `scripts/test_monitor_resources.py` 5 tests 통과. CI docs job에서 계속 검사.
- 현재 첫 관찰 web 약 86MiB, health 200/13ms, 경고/실패 없음. 장기 안정성 완료 아님.
- [운영 절차](guide/resource-monitoring.md). 버전·APK·운영 이미지 변경 없음.
- 다음: S02-C 상태 신호, S02-D 수일 추이, S02-E 업데이트/서명 보존. 실기기 Gate C0 대기.

## 최신 작업 — 격리 원문 상세·재전송

- PR #24 원문 화면 개선은 Web/docs/ci-ok 성공 후 병합하고 로컬·원격 브랜치 정리.
- Android `queue/QueueDatabase.kt`: 원문 없는 20건 페이지, 개별 상세,
  같은 사건 ID/원문으로 대기열 저장을 검증한 뒤 격리함에서 원자적으로 이동.
- 재실패 시 다시 격리, DB 실패/상이한 ID 충돌은 전체 롤백. 기존 격리 적용에도 저장 검증 추가.
- `ui/settings/RejectedMessagesDialog.kt`: 사유 안내·상세·한 건씩 재전송.
  예약 실패 시 대기열 유지, 알 수 없는 서버 문자열이나 예외를 그대로 노출하지 않음.
- Android 97 tests(신규 SQLite 7개)/lintDebug/assembleDebug 통과.
  Robolectric SQLite 테스트로 실패·재실패·충돌·페이지 경계를 검증. 테스트 데이터는 가공됨.
- 스키마·버전·공개 APK 변경 없음. 신규 APK는 빌드만 하고 게시하지 않음.
- 다음: S02-C 상태 신호, S02-D 감시 스크립트. 실기기 Gate C0는 미확인 유지.

## 사용자 최신 지시와 현재 작업

- 버전·태그·APK 업데이트는 **전체 작업 완료 후 딱 한 번**. 중간 작업은 Unreleased에 누적.
- 기존 9개 브랜치의 로컬/원격 HEAD가 merged PR #15~23의 HEAD와 같은지, squash merge가
  origin/main에 있는지 확인한 뒤 삭제. main과 기본 워크트리 하나만 유지. 백업/검증 DB 보존.
- `/raw` 기본 정렬을 서버 도착순으로 변경. 메시지 수신순 선택, SMS/RCS 필터,
  수신·도착 시각(KST)과 전송 완료·분석 상태 구분. 모든 조회의 visibleMemberIds 경계 유지.
- 동일 시각 ID 보조 정렬, 소수/무한/비정상 페이지 방어. Web 155 tests/typecheck/lint 통과.
- DB migration·기존 원문 변경·버전 변경 없음. 최종 묶음 배포 전까지 운영 UI는 기존 버전.
- 다음: `android/.../queue/QueueDatabase.kt`와 `ui/settings/` 격리함 복구,
  S02-C 기기 상태 신호와 S02-D 자원 감시. Gate C0 실기기 조건은 여전히 미확인.

## 최신 작업 — 보안 수정과 복구 기준선

S00 계획 문서를 PR #22로 병합한 뒤 S02-A/B를 진행했습니다.

- Next.js/eslint-config-next 15.5.24, sharp 0.35.4, Vitest 계열 4.1.11,
  mysql2 3.24.4(보안 하한 3.23.1), fast-uri 3.1.6, js-yaml 4.x 4.3.2로 보안 수정.
- 전체 감사 12건·운영용 9건 → 모두 알려진 취약점 0건. CI에 High/Critical 감사 관문 추가.
- Web 150 tests/typecheck/lint/format, Prisma 생성, Docker standalone 빌드 통과.
- 격리 복원 DB + 새 이미지에서 가공 RCS 신규/재전송·세션·nonce 재사용 거부·SELF 격리·
  폐기 토큰/세션 거부를 HTTP로 검증. 후보 컨테이너·임시 환경 파일 정리.
- 운영 배포 healthy, tailnet health/login/APK 200·무인증 ingest 401,
  기존 v7 APK 해시 동일. 운영 컨테이너 Next.js 15.5.24 / sharp 0.35.4 확인.
- 새 private 백업 `data/backups/familycard-live-20260924T221728Z.dump` (UTC, 0600),
  격리 DB `familycard_verify_20260924_221728`. 기준 원문 944건 누락/필드 변경 0.
  격리 DB에는 가공 원문 2건과 폐기한 검증 기기가 추가됨. 실제 복원 데이터가 있으므로
  seed/reset 대상으로 쓰거나 Git으로 옮기지 않음.
- 기존 이미지 복구 태그 `familycard-web:before-security-20260925`. DB migration 없음.
- 배포 직후 web 메모리 약 67MiB. 장기 안정성 검증 완료로 해석하지 않음.
- 근거: [보안 기준선](research/security-baseline-2026-09-25.md),
  [백업·복원](guide/backup-restore.md).

다음: S02-C/D의 상태 신호·자원 감시, S02-E 서명 전환과 업데이트 보존 경로를 진행.
S01의 RCS 자동 보충·재부팅·오프라인·개인 메시지 비수집은 사용자 확인 대기.
`docs/plan/collection-validation.md`에 근거가 생긴 항목만 갱신하고 Gate C0 전 파서 구현 금지.

## 최신 작업 — 단계별 통합 실행 계획

사용자가 전체 검토안을 먼저 문서로 남기고 단계별로 실행하도록 승인했습니다.
[단계별 통합 실행 계획](plan/staged-execution-plan.md)에 S00~S10, 경로·체크박스·선행 조건·
완료 기준·기존/신규 범위를 정리하고 [수집 검증표](plan/collection-validation.md)를 연결했습니다.

- S01 실기기 확인과 S02 보안·운영 작업은 병행 가능. Gate C0 전 S03 파서 단계 시작 금지.
- 원문 보존 검증은 작업 전 기준 ID/본문 보존과 신규 유입을 구분하도록 수정.
- 지속 처리 작업·규칙 버전·RCS 구조 처리·격리함 복구·상태 신호·서명 전환을 명시.
- 실적용 최소 분류는 Phase 4에 선행, 혜택 한도 기반 카드 추천은 산정 근거 확보 후 진행.
- 다음 작업: `web/package.json`/`web/pnpm-lock.yaml`의 S02-A 감사·수정·검증, 실제 배포
  이미지 포함 여부 점검. 이후 S02-B 현재 백업·격리 복원과 S01 실기기 결과 반영.
- 사용자에게 RCS 자동 보충·재부팅·오프라인 복구·미등록 메시지 비수집의 확인 결과 요청.
  답변 없는 항목은 미확인으로 유지. 계획 문서화 자체로 Phase 2 완료 처리하지 않음.

## 최신 확인 — 정상 연결에서 새 알림 자동 전송

사용자가 **확인 필요(rejected) 0건**, 업데이트 뒤 새 알림이 **지금 전송을 누르지 않아도
원문 목록에 도착함**을 확인했습니다. `visibleMemberIds` 범위의 읽기 전용 집계에서도
직전 941건 이후 NOTIFICATION 3건이 추가돼 총 944건임을 확인했습니다.

- 총 원문: NOTIFICATION 905건, SMS 9건, RCS 30건. 활성 기기는 1대.
- 로컬 rejected 0건과 수동 버튼 미사용은 사용자 확인에 근거하며, 서버 집계는 새 원문
  도착을 확인하는 보조 증거입니다. 원문·기기 토큰·금융 값은 출력하지 않았습니다.
- 정상 연결에서 기존 알림 경로의 자동 전송 검증을 완료로 반영했습니다. 사용자 보고의
  업데이트 버전은 특정하지 않았으며, 이 확인을 v7 RCS 자동 보충 검증으로 간주하지 않습니다.
- RCS 자동 보충 활성화/새 RCS 도착, 오프라인·재부팅 복구, 개인정보 canary와 동일 기간
  재가져오기 중복 없음은 별도 확인 대기입니다. Phase 2 완료나 Phase 3 진입은 아직 아님.
- 이번 변경은 문서뿐이며 앱 재배포와 DB 변경 없음.

## 직전 작업 — 앞으로 추가될 문구와 RCS 지속 수집

사용자가 새 카드·출처·문구의 보존 → 미확정 표시 → 규칙 추가 → 과거 재처리 계획을
승인했습니다. `docs/plan/post-collection-execution.md`와 `docs/plan/phase-3.md`에
미래 형식의 전체 흐름과 중복/취소 이중 차감 방지 완료 기준을 명시했습니다.

이번 구현은 Phase 2의 수집 보완입니다. 파서·거래 집계·미확정 UI는 아직 구현하지 않았습니다.

- `history/RcsAutoWorker.kt`, `RcsAutoScan.kt`: 사용자가 켠 기기에서 15분 주기 RCS 보충.
  최근 하루부터 시작, 하루 겹침 재확인, 최대 7일씩 중단 구간을 이어받고 성공한 구간만 기록.
  네트워크 없이 로컬 큐에 보존. 기존 사건 ID와 서버 유일 제약으로 재전송을 처리.
- `settings/RcsAutoSettings.kt`: 원문 없는 상태와 조회 위치, 활성화 세대 보관.
  끄기/재활성화와 경합하는 이전 실행의 저장·진행 갱신 차단. 실패/권한/미지원 상태 표시.
- `ui/settings/ContinuousMessageSection.kt`: 자동 보충 선택·즉시 확인·상태/시각 표시.
  앱 시작/재부팅은 이미 켜둔 설정만 복구. 기본값 꺼짐.
- 등록 발신자의 **모든 문구 보관**은 별도 확인창 뒤 켜며 기본 거래 어휘 필터는 유지.
  광고·인증번호 포함 가능성 안내. SMS 실시간/수동·RCS 수동/자동 경로에 동일 적용.
  미등록 발신자·기간·수신 종류·크기 제한은 유지, 작업 중 범위 확대는 금지.
- [ADR 0012](adr/0012-continuous-message-capture.md)에 수동 RCS 전용 결정의 확장과
  모든 문구 보관의 경계·한계 기록. 서버/SQLite 스키마 변경과 기존 원문 삭제 없음.
- Android 90 tests, lintDebug, debug APK 빌드 통과. APK versionCode 7을 기존 다운로드에 게시.
  기존 서명 인증서 일치, 서버 healthy, tailnet health/APK 200·다운로드 SHA-256 일치 확인.
  실기기 신규 기능 검증은 대기.

다음 작업:

1. v7 업데이트 뒤 **설정 → 새 문자 수집 보완**에서 RCS 자동 보충을 켜고 최근 확인 결과,
   신규 RCS 도착, 끄기, 재부팅·오프라인 후 복구를 확인 (`docs/plan/phase-2.md`).
2. 모든 문구 보관의 범위를 확인해 선택하고 미등록 개인 문자가 수집되지 않는지 실기기 확인.
   이전에 제외된 새 형식은 해당 기간 수동 가져오기로 보충.
3. 확인 필요(rejected) 0건과 새 알림 자동 전송은 위 최신 확인으로 완료. 앞으로도 수집 중 점검.
4. `docs/plan/post-collection-execution.md` Gate C0의 실제 문구 커버리지·서명 배포·백업과
   실기기 확인을 마친 뒤 `docs/plan/phase-3.md` P3-A/B부터 진행. 현재 Phase 2 미완료.

알려진 제한: OS 절전·강제 종료로 주기가 지연될 수 있음. 하루보다 오래된 시각으로 뒤늦게
추가/수정된 RCS는 자동 겹침 범위 밖일 수 있어 수동 가져오기 필요. `RawMessage`는 계속
PENDING이며 새 문구를 거래로 자동 확정하는 기능은 후속 Phase 3 범위.

## 최신 확인 — 실기기 전송 복구

v6 게시 후 사용자가 **대기 0건·전송 완료 490건**을 보고했습니다. 운영 DB를
`visibleMemberIds` 범위에서 읽기 전용으로 조회해 신규 490건 도착을 확인했습니다.

- 신규 원문: NOTIFICATION 451건, SMS 9건, RCS 30건. 기존 포함 총 941건.
- 서버 최종 수신일과 기기 `lastSeenAt`이 당일로 갱신됨.
- 첨부 화면의 수신 시간대에 RCS 부분취소 원문 1건이 있는지 조건부 건수로 확인.
  본문·금액·가맹점·카드번호·이름은 출력하거나 Git에 복사하지 않음.
- 이번 대기열 전송 복구와 실제 삼성 RCS/SMS 도착은 확인 완료. 기존 정체의 정확한
  HTTP 오류나 시스템 상태는 관측하지 못했으므로 단일 근본 원인으로 단정하지 않음.
- 읽기 전용 확인과 문서 갱신만 수행. 앱 재배포·DB 변경·파서 구현 없음.

다음 작업: `docs/plan/phase-2.md`의 동일 기간 SMS/RCS 재가져오기 시 중복 없음,
RCS 자동 보충·오프라인/재부팅 복구를 실기기에서 확인. 일반 알림 자동 전송과 rejected 0건은
위 최신 확인 참고.
`docs/plan/post-collection-execution.md` Gate C0의 개인정보·문구 커버리지·서명 배포도
남아 있습니다. **이번 전송 성공만으로 Phase 2 완료나 Phase 3 진입을 선언하지 않습니다.**

## 직전 작업 — 전송 정체 진단

사용자가 v5로 RCS를 가져온 뒤에도 원문 목록 첫 날짜가 오래됐고, 지금 전송에서 서버
오류가 보인다고 보고했습니다. 목록은 `receivedAt desc`이며 당시 운영 DB 원문 451건은 모두
NOTIFICATION이었습니다. 최신 원문과 기기의 ingest 마지막 인증 시각이 과거에 멈춰 있어
정렬 문제가 아니라 전송 미완료로 확인했습니다. 원문을 출력하지 않고 집계만 확인했습니다.

- 당일 DEVICE nonce 발급/소모 성공 확인: 대시보드 진입의 서버 주소·토큰은 정상.
- tailnet health 200, 무인증 ingest 401, 가공 1KB/512KB/3MB 무인증 요청 모두 401.
  당시 최근 서버 로그에서 ingest 성공/서버 예외 흔적 없음. 정확한 실패 원인은 미확정이며,
  위 실기기 전송 성공 확인으로 이번 대기열 복구 여부는 해소됨.
- `queue/UploadWorker.kt`: 수동 **지금 전송**은 기존 즉시 업로드 작업 체인을 REPLACE해
  백오프/의존 작업 뒤로 쌓이지 않도록 함. 수동 작업은 네트워크 제약 없이 실제 연결을
  시도하며 자동 작업은 CONNECTED 제약 유지. SQLite 원문과 15분 주기 작업은 보존.
  예약 완료를 비동기로 확인하고 작업 ID·실제 요청 시도 시각·배치 진행 상태를 기록.
- `queue/UploadDiagnostics.kt`: HTTP 번호와 DNS/timeout/TLS/connect 종류만 표시.
  예외의 원문/주소/토큰 문자열은 노출하지 않음.
- `net/IngestClient.kt`: 자동 리디렉션을 따르지 않아 토큰/원문이 다른 주소로 넘어가지
  않고 실제 이동 응답을 진단하도록 함.
- `ui/settings/CollectionStatusSection.kt`: 화면이 보일 때만 건수·상태를 자동 갱신하고
  예약 작업 실행/대기/실패 상태, 시도/응답 반영 시각 표시. 읽기 실패를 0건으로 숨기지 않음.
- Android 75 tests, lintDebug, assembleDebug 통과. 실제 HTTP 리디렉션 비추종과
  오류 문구의 민감정보 비노출을 가공 데이터로 검증.
- APK versionCode 6을 기존 tailnet 다운로드에 게시. 기존 서명 인증서 일치, 서버 healthy,
  health/APK 200과 다운로드 SHA-256 일치 확인. 실제 폰의 업로드 복구는 위 최신 확인 참고.

## 이전 작업 — 삼성 RCS 취소 원문 누락

사용자가 APK v4 업데이트와 가져오기 실행을 알렸지만 특정 취소 메시지가 빠졌습니다.
상세정보의 종류 ‘대화’와 리치 카드 형태를 확인해 RCS 경로 누락으로 분류했습니다.
취소/부분취소 어휘는 기존 CaptureFilter에서 이미 허용합니다. 실제 이미지·금융 값은
Git이나 테스트에 복사하지 않았습니다.

- `history/SamsungRcsReader.kt`, `RcsHistoryImport.kt`: 삼성 시스템 provider 호환 조회,
  본문 전 발신자/수신 종류/기간 판정, JSON 원형 보존, SMS와 분리한 멱등 ID.
- `SmsHistoryWorker.kt`, `SmsHistorySection.kt`: SMS/RCS별 결과 건수와 미지원/크기 제외 안내.
  **사용자가 다시 가져오기를 실행할 때만** RCS를 읽습니다. 실시간 RCS 수집은 아직 없음.
- 서버에 `MessageSource.RCS` 추가. `SMS_SENDER`는 등록된 문자 발신자 분류를 공용으로 사용.
  RCS 64,000자 상한과 Android 업로드 크기 분할, 원문 목록 RCS 배지 추가.
- APK versionCode 5. 운영 enum migration 전후 기존 RawMessage 전체 행·ID 보존 확인,
  서버 반영/healthy와 tailnet APK 200·SHA-256 일치·기존 서명 인증서 일치 확인 완료.
- 운영 보존 백업: Git에서 제외된 `data/backups/before-rcs-20260924.dump` (private).
  복원 검증 DB `familycard_rcs_verify_20260924`는 운영과 분리하며 실제 데이터가 있으므로
  테스트 seed/reset에 사용하거나 덤프를 Git으로 옮기지 않습니다.
- 검증: Web 150 tests/typecheck/lint/format, Android 72 tests/lint/debug build 통과.
  격리 복원 DB migration 적용 전후 RawMessage 전체 행·ID 체크섬 동일, schema diff 없음.
  standalone HTTP + 격리 DB에서 4,000자를 넘는 가공 RCS JSON 신규/재전송 및
  본문/출처 일치 확인. 해당 검증 DB에는 별도 가공 원문 1건과 폐기한 테스트 기기가 추가됨.
- [ADR 0011](adr/0011-samsung-rcs-history.md)에 비표준 API 근거/제한과 결정 기록.

실제 provider 호환과 SMS/RCS 서버 도착은 v6 전송 복구 뒤 위 최신 확인에서 검증했습니다.
같은 기간 재가져오기의 실기기 중복 방지는 확인 대기입니다. 파서와 금액 집계는
구현하지 않았습니다.

## 이번 세션 — 과거 SMS 가져오기

사용자가 SMS 발신자와 카카오 채널을 새로 등록한 뒤 과거 SMS 가져오기를 요청했습니다.
카카오 과거 대화는 범위 밖이며, 파서 구현은 아직 시작하지 않습니다.

- `android/app/src/main/java/com/familycard/collector/history/`: 사용자 실행 WorkManager,
  기간 고정, 실행 시/현재 허용 목록 교집합, 본문 별도 조회, DATE_SENT 기반 기존 SMS ID.
- `android/app/src/main/java/com/familycard/collector/ui/settings/SmsHistorySection.kt`:
  30/90/365일(기본 90일), READ_SMS 요청, 진행/결과 건수, 중지·권한 실패 안내.
- 발신 시각이 없는 항목은 임의의 시각으로 새 ID를 만들지 않고 제외 건수로 표시합니다.
- 기존 큐/서버 스키마·원문은 변경하지 않으며 APK는 versionCode 4, 같은 debug 서명입니다.
- 설계·제한·검증 근거는 [ADR 0010](adr/0010-sms-history-import.md).
- Android 59 tests(기존 45 + 가져오기 14), lintDebug, assembleDebug 통과.
  versionCode 4와 READ_SMS manifest, 기존 배포 APK와 같은 서명 인증서를 확인.
  실제 폰 권한/가져오기는 아직 미확인이며, APK 게시 경로는 기존 tailnet 다운로드를 사용.

실기기 과거 SMS 서버 도착은 v6 전송 복구 뒤 확인됐습니다. 다음 실기기 작업은 같은
범위를 다시 가져와 기존 항목이 중복 저장되지 않는지 확인하는 것입니다. 모든 문자
형식의 DATE_SENT/발신자/본문 보존 검증을 완료한 것은 아닙니다. 사용자 폰의 가져오기를
대신 실행한 것은 아니며, 이번에는 서버의 도착 건수만 확인했습니다.

## 이번 세션 — 수집 이후 진입 검토와 메모리

- 사용자가 한 달 이상 수집했음을 알림. 운영 DB 읽기 전용 집계에서 원문 451건 확인
  (CARD_APP 191, PAYMENT_APP 249, KAKAO_CHANNEL 11; 전부 PENDING).
  수신일이 있는 날짜는 14일, 기기 1대. 모든 가족/유형의 커버리지 충족을 뜻하지 않음.
  원문 내용·금융 정답값은 출력하거나 Git에 옮기지 않음.
- `familycard-web` 약 4.95GiB, DB 약 20MiB. 실행 명령은 `pnpm dev`.
  원문 본문 전체 크기보다 실행 프로세스가 훨씬 큼. 개발 서버 장기 실행이 원인 후보이며,
  장기간 증가 원인을 heap profile로 확정한 것은 아님.
- 기본 Compose를 기존 Dockerfile `prod` standalone으로 전환하고 Docker 개발 모드를
  `docker-compose.dev.yml`로 분리. DB 서비스·볼륨·마이그레이션은 변경하지 않음.
- 별도 코드 결함: `web/src/lib/db.ts` Proxy가 운영 모드에서 클라이언트를 캐시하지 않아
  속성 접근마다 연결 풀을 생성함. 모든 모드에서 프로세스 수명 동안 재사용하도록 수정.
  기존 실행은 개발 모드이므로 이 결함을 기존 4.95GiB의 직접 원인으로 단정하지 않음.
- Web 146 tests, typecheck/lint/format, Docker 운영 이미지 빌드 통과.
  별도 후보 서버에서 health/login/APK 200, 가상 SELF 세션 `/raw` 30회 200,
  무인증 ingest 401 확인. 후보 서버 메모리 약 107MiB (장기 측정 아님).
  운영 모드의 Secure 쿠키 이름 변경으로 웹 재로그인/앱 대시보드 재진입이 필요할 수 있음.
- 로컬 수집 web을 standalone으로 교체. healthy, 전환 직후 약 52MiB,
  원문 451건 보존과 tailnet health/login/APK 200 확인.
  Alpine wget의 localhost IPv6 연결 실패가 있어 두 Compose healthcheck를
  서버가 바인딩한 IPv4 `127.0.0.1`로 맞춤.
- PR CI에서 기존 경로 감지 job의 `pull-requests: read` 누락을 발견해 해당 job에만
  권한 추가. 감지 실패로 검증이 생략되면 `ci-ok`도 실패하도록 수정.
- Phase 2 전체 완료/태그와 Phase 3 파서 구현은 아직 진행하지 않음.

### 다음 할 일과 미확인 사항

1. `docs/plan/post-collection-execution.md` Gate C0: 폰 pending/rejected, 개인정보 canary,
   오프라인·재부팅 복구의 사용자 확인. 수집 기간만으로 통과 처리하지 않음.
2. 접근 제어된 `/raw`에서 승인·취소·할부·해외·복수 출처 양성/음성 반례 검토.
   `docs/plan/phase-3.md` P3-A 전에 가공 구조 픽스처와 정답 관계 검토 방식 확정.
3. `docs/plan/phase-2.md`의 운영 서명·백업/격리 복원 게이트 마감.
4. 서버 메모리는 운영 전환 직후뿐 아니라 다음 날과 수일 뒤에도 비교.

아래는 이전 세션 상세 기록이며 최초 원문 건수·다음 할 일은 위 최신 상태를 우선합니다.

## 한 줄 상태

Phase 2 코드에는 사용자가 카드사/결제 앱을 검색해 여러 개 등록하고, 카카오 공식 채널·SMS
발신자를 직접 관리하는 흐름이 있습니다. USB/ADB나 개발자 하드코딩은 사용자 온보딩에
필요하지 않습니다. APK도 tailnet FamilyCard 서버에서 받을 수 있습니다. 첫 실기기에서
발견된 `localhost` 대시보드 리디렉션은 canonical `APP_URL` 기준으로 수정했고, 앱 대시보드에서
서버에 전송된 본인 원문을 바로 볼 수 있고 사용자가 실기기 WebView 정상 진입을 확인했습니다.
첫 실기기 원문 1건은 ingest 200·accepted로 보존됐습니다. 이후 작업은
[수집 이후 통합 실행 계획](plan/post-collection-execution.md)의 Gate C0와 P3-A~H 순서를
따릅니다. 개인정보 canary·문구/출처 커버리지·운영 서명 배포가 남아 Phase 2와 `v0.2.0`은
미완료입니다. Windows 로그온 시 WSL을 시작하는 기존 복구 체인에는 FamilyCard를
`--no-recreate`로 기동하고 health를 기다리는 단계가 설치됐으며, 다음 자연스러운 cold
start에서 전체 경로 확인만 남았습니다.
**실제 원문 며칠치 전에는 Phase 3 파서를 시작하지 마세요.**

| Phase                 | 상태                                                      |
| --------------------- | --------------------------------------------------------- |
| 0 문서·CI/CD          | ✅ 완료                                                   |
| 1 스캐폴딩·인증       | ✅ `v0.1.0`                                               |
| **2 수집 파이프라인** | 🟡 첫 실기기 ingest·WebView 성공 / Gate C0 수집·서명 대기 |
| 3 파서·카드 매칭      | ⛔ 실제 원문과 복수 출처 대사 설계 전 시작 금지           |
| 4~7                   | ⬜                                                        |

이 앱은 PWA가 아니라 **네이티브 Android 수집기 + Next.js WebView 대시보드**입니다.

---

## 이번 작업에서 구현·확정한 것

### 수집 이후 통합 실행 계획

- “며칠 수집” 대신 개인정보 canary·복구·문구/출처 커버리지로 Phase 3 진입을 판정하는
  [Gate C0](plan/post-collection-execution.md#gate-c0--충분히-수집됐다의-판정-기준) 정의
- 사용 중인 카드, 카드사×출처 승인, 복수 출처 양성 묶음, 별도 연속 결제 음성 반례,
  취소·할부·해외 등 필수/해당 시 최소 표본 정의
- 실제 원문과 금융 정답값은 DB·`/raw` 안에만 두고, Git에는 완전히 가공한 구조 픽스처만
  넣는 분석 절차 정의
- Phase 3을 원문 인벤토리/ADR → 보존형 schema → 순수 파서 → 카드 매칭 → 복수 출처 대사
  → 취소 → 미확정·재파싱 → 월간 화면 순으로 분할
- 자동 처리율 95% 이상과 별개로 알려진 오병합·오카드 매칭 허용치 0건, 재파싱 2회 멱등,
  RawMessage ID 집합 보존을 Phase 3 완료 게이트로 명시
- Phase 4~7의 진입·완료 기준과 기능 브랜치/PR 권장 분할 정의

세부 구현은 아직 시작하지 않습니다. Gate C0 전에는 실제 원문 인벤토리와 파서 정규식을
추측으로 만들지 않습니다.

### 실기기 대시보드와 수집 원문 확인

- 증상: 앱 대시보드 진입 시 시스템 브라우저가 열리고 `https://localhost:3000` 연결 실패
- 원인: nonce를 소비한 GET이 `request.url`로 `/` 리디렉션을 만들었고, Tailscale Serve가
  전달한 내부 Host가 공개 origin 대신 사용됨
- 수정: POST 세션 URL과 같은 canonical `APP_URL`을 GET 최종 리디렉션에도 사용
- 회귀 테스트가 내부 요청 URL `https://localhost:3000`과 공개 `APP_URL`이 다른 조건을 고정
- 대시보드에 서버 보관 원문 건수와 **수집 원문 보기**(`/raw`) 버튼 추가
- 건수 조회도 `visibleMemberIds(session)`를 경유하며 DEVICE 세션에서는 본인 원문만 표시
- 서버 코드 변경이므로 이 수정만을 위한 APK 재설치는 필요 없음

최초 관찰 때 `familycard_live.RawMessage`는 0건이고 활성 폰에는 pending 1건이 남아 있었지만,
사용자가 **지금 전송**을 누른 뒤 `/api/ingest`가 200으로 신규 1건을 accepted했습니다. DB의
`RawMessage` 1건과 `Device.lastSeenAt` 갱신도 확인했습니다. 중복·거부는 0건이며 원문 내용은
로그·문서에 기록하지 않았습니다. 앱 화면에서 pending 0건과 `/raw` 1건을 확인하고 이 원문이
허용한 금융 알림인지 판정하는 것이 다음 게이트입니다.

### 검색·추천·다중 앱 선택

- `MAIN` + `LAUNCHER`에 응답하는 실행 가능 설치 앱만 조회
- 이름·패키지 검색과 체크박스 다중 선택, 한 번의 원자적 설정 저장
- 국내 주요 카드사 9개와 결제·자산 앱 9개의 공식 Play 패키지를 추천/검색 별칭으로 사용
- 공식 추천 → 카드·Card·페이·Pay·월렛·Wallet 이름 추천 → 그 외 앱 순으로 표시
- 공식 카탈로그는 자동 화이트리스트가 아니며 사용자가 최종 확인하기 전에는 수집하지 않음
- 설치 앱 목록 전체는 선택기 메모리에만 두고 저장·서버 전송·로그 출력하지 않음
- `QUERY_ALL_PACKAGES` 없이 launcher intent `<queries>`만 선언
- FamilyCard·카카오톡·기본 SMS 앱은 목록과 저장 정책 양쪽에서 차단

구현 파일:

- `android/app/src/main/java/com/familycard/collector/ui/settings/CaptureAppCatalog.kt`
- `android/app/src/main/java/com/familycard/collector/ui/settings/InstalledCaptureAppLoader.kt`
- `android/app/src/main/java/com/familycard/collector/ui/settings/CaptureAppPickerDialog.kt`
- `android/app/src/main/java/com/familycard/collector/settings/CaptureSourceStore.kt`

### tailnet APK 업데이트 전달

- 설정 화면에 현재 버전과 **최신 APK 받기** 버튼 추가
- 설정 서버와 같은 origin의 `/downloads/familycard.apk`를 외부 브라우저로 열어 다운로드
- 브라우저가 WebView DEVICE 쿠키를 공유하지 않으므로 이 exact 정적 파일만 세션 없이 허용
- `./gradlew publishDebugApk`가 debug APK를 Git에서 무시되는 고정 다운로드 경로에 게시
- 태그 CD는 서명 APK artifact를 GitHub Release와 web 이미지 양쪽에 동일하게 포함
- 앱 자체 설치 권한을 추가하지 않았고 Android의 최종 설치 확인과 서명 검증을 유지
- 현재 개발 서버의 tailnet HTTPS 다운로드가 `200`, APK MIME, 로컬과 같은 SHA-256임을 확인

구현 파일:

- `android/app/src/main/java/com/familycard/collector/settings/AppUpdateDownloadPolicy.kt`
- `android/app/src/main/java/com/familycard/collector/ui/settings/SettingsScreen.kt`
- `android/app/build.gradle.kts`
- `web/src/lib/auth/route-guard.ts`
- `.github/workflows/cd.yml`

### 사용자별 수집 대상

- 각 폰의 설정 화면에 **수집 대상** 섹션 추가
- 카드사 앱과 결제·자산 앱은 검색 가능한 설치 앱 화면에서 다중 추가
  - 실행 가능한 앱 목록만 메모리에서 조회하며 `QUERY_ALL_PACKAGES` 권한 없음
  - 사용자가 `CARD_APP` 또는 `PAYMENT_APP`으로 분류
  - 같은 패키지를 다시 추가하면 새 종류로 재분류
- 카카오 공식 채널 제목과 SMS 발신번호/발신자 ID는 앱 안에서 직접 추가
- 각 대상을 삭제할 수 있으며 삭제는 **이후 캡처만** 중단
- 설정은 앱 private SharedPreferences에만 저장되고 Android 자동 백업 대상이 아님
- 목록이 비었거나 JSON이 손상되면 아무것도 수집하지 않는 fail-closed 동작

구현 파일:

- `android/app/src/main/java/com/familycard/collector/capture/CaptureSource.kt`
- `android/app/src/main/java/com/familycard/collector/settings/CaptureSourceStore.kt`
- `android/app/src/main/java/com/familycard/collector/ui/settings/CaptureSourcesSection.kt`
- `android/app/src/main/java/com/familycard/collector/ui/settings/CaptureAppSelectionPolicy.kt`

### 개인정보 캡처 경계

- 미등록 일반 앱은 notification extras·제목·본문에 접근하기 전에 즉시 반환
- 등록 카드사/결제 앱은 exact 패키지 일치
- `com.kakao.talk`은 앱 전체 등록을 막고 exact 채널 제목 일치만 허용
- 기본 SMS 앱은 앱 전체 등록을 막고 exact 발신자만 허용
- SMS는 발신자 판정 뒤에만 분할 PDU 본문을 결합하고 거래 어휘를 검사
- 카카오톡 일반 대화와 미등록 SMS를 거부하는 JVM 테스트 유지·확장
- 앱 등록 확인창에 “이 앱의 모든 알림 본문이 대상”임을 명시

잔여 한계: Android가 카카오 공식 채널 인증값을 제공하지 않아 일반 대화방 이름을 공식
채널과 똑같이 만들면 제목만으로 구분할 수 없습니다. UI 경고와 실기기 canary가 필수입니다.

### 복수 출처 원문

- `source`(`NOTIFICATION | SMS`)와 별개로 `originKind` 추가
  - `CARD_APP`, `PAYMENT_APP`, `KAKAO_CHANNEL`, `SMS_SENDER`
  - `UNKNOWN_APP`은 Android v2 큐와 기존 서버 원문 보존 마이그레이션용
  - 서버 스키마에는 미래 입력용 `MANUAL_ENTRY`, `STATEMENT_UPLOAD`도 포함
- Android SQLite v3이 pending/rejected 양쪽에 `origin_kind`를 보존
- v1→v2→v3 업그레이드는 큐 행이나 테이블을 삭제하지 않음
- Prisma migration `20260830120000_capture_origin_kind`는 기존 `RawMessage`를 모두 유지하고
  확실한 범위에서만 출처를 backfill
- ingest API가 source/origin 조합과 카카오 패키지·제목을 검사
- `/raw`가 출처 배지를 표시하고 출처 종류/패키지 필터를 제공

같은 결제가 카드사 앱과 토스 등에서 동시에 오면 수집 단계에서는 두 원문을 모두
`accepted`합니다. 둘은 서로 다른 사건이며 네트워크 재전송 `duplicate`가 아닙니다.

### Phase 3 대사 게이트

현재 `Transaction.rawMessageId`는 Phase 1의 원문 1건↔거래 1건 모델입니다. 이를 복수
출처 원문에 그대로 적용하면 사용금액이 두 번 잡힙니다. 실제 원문을 모은 뒤 파서를 쓰기
전에 다음을 해야 합니다.

1. `docs/plan/phase-3.md`의 **복수 출처 대사** 체크리스트 수행
2. 복수 `RawMessage`를 거래 하나의 근거로 연결할 스키마 결정·migration
3. 같은 구성원·카드·금액·거래종류·승인시각·가맹점 기반의 보수적 대사
4. 애매한 후보는 임의 병합하지 않고 사람 확인 대상으로 표시
5. 원문은 모두 유지하면서 집계에는 의미 거래가 정확히 한 번만 기여하도록 테스트

결정 근거: [ADR 0007](adr/0007-user-managed-capture-sources.md). 실제 문구 없는 추측
정규식이나 의미 중복 로직은 아직 구현하지 않았습니다.

### 개발 워크플로우

- `AGENTS.md`에 `main` 직접 push 금지 추가
- 모든 변경은 기능 브랜치 → PR → 필수 CI 통과 → GitHub PR 병합
- 긴급 수정도 같은 절차이며 CI 우회 금지

---

## 검증 결과

### Web

- `corepack pnpm format:check` ✅
- `corepack pnpm lint` ✅
- `corepack pnpm typecheck` ✅
- `corepack pnpm test` ✅ — 16 files, **143 tests**
- `corepack pnpm build` ✅
- Prisma generate/validate/migrate deploy/status/schema diff ✅
- 로컬 DB migration 4개 적용 ✅
- 기존 가공 `RawMessage` 5건이 migration 전후 그대로이고 `originKind` 5건 모두 채워짐 ✅

### Android

- `./gradlew testDebugUnitTest` ✅ — **45 tests**
- `./gradlew lintDebug` ✅
- `./gradlew assembleDebug` ✅
- `./gradlew publishDebugApk` ✅ — versionCode 3, APK 서명 검증·서버 게시

`./gradlew ktlintCheck`는 저장소에 ktlint Gradle plugin/task가 없어 실행할 수 없습니다. 현재
CI 기준인 Android lint와 Kotlin 컴파일은 통과했습니다. AGENTS.md 명령과 실제 빌드 설정의
불일치는 별도 정리 대상입니다.

실제 검색·다중 앱 선택기, 알림 리스너, SMS 수신, SQLite v2→v3 업그레이드는 코드·빌드 검증까지이며
물리 기기 검증이 남았습니다. 자동 테스트에는 가공 데이터만 사용했습니다.

### 현재 실기기 검증 환경

- tailnet HTTPS는 비표준 포트 `3443`에서 개발 web으로 연결됨(정확한 origin은 private `.env`)
- 실제 수집 DB는 `familycard_live`, ADMIN은 이지훈, 활성 폰 1대
- versionCode 3 APK 덮어쓰기 설치와 카드사·결제 앱 등록 완료
- 첫 실기기 업로드 1건이 200·accepted, 서버 실제 `RawMessage` 1건으로 보존됨
- 사용자가 대시보드가 앱 내부에서 정상적으로 열리는 것을 확인
- 서버 `/raw` 200과 확인 시점 실제 `RawMessage` 2건 보존; pending/rejected는 수집 기간 중 계속 점검
- `/mnt/e/recovery` 로컬 Git `main`에 FamilyCard WSL 자동 복구가 병합됐고 설치본과 원본이
  byte-identical. systemd unit과 Windows 로그온 작업은 enabled이며 현재 DB·web은 healthy
- 자동 복구는 `docker compose up -d --no-recreate --wait`를 사용해 부팅을 배포와 분리.
  다음 자연스러운 Windows 로그온/WSL cold start의 로그와 `/raw` 보존 확인은 아직 남음
- 과거 가공 seed DB `familycard`는 보존하되 현재 web과 연결하지 않음
- 비밀번호·기기 토큰·실제 원문은 문서나 Git에 기록하지 않음

### 저장 데이터

현재 web과 분리된 과거 seed DB `familycard`에는 통합 검증용 가공 `RawMessage` **5건**,
`Transaction` 0건이 있습니다. migration은 5건을 모두 보존했습니다. 실제 수집 DB
`familycard_live`와 혼동하거나 어느 쪽의 `RawMessage`도 임의 삭제하지 마세요.

---

## 지금 바로 할 일 — USB 없이 실제 폰

상세 체크리스트는 [Phase 2 계획](plan/phase-2.md)과
[카드 알림 설정 가이드](guide/onboarding.md)가 기준입니다.

### 현재 우선순위 — Gate C0 표본 수집

- 자연스럽게 카드·결제 앱 알림을 계속 수집
- 가끔 앱 설정에서 pending 0·rejected 0, `/raw`에서 의도한 금융 알림만 있는지 확인
- 일반 카카오 대화·미등록 SMS/앱 canary 수행
- 같은 결제의 복수 출처, 별도 연속 결제, 취소·할부·해외 등 실제 사용하는 유형 확보
- 실제 원문은 캡처·복사하지 않고 앱/DB 안에서만 확인
- 상세 최소 표본은 [Gate C0 문구·출처 커버리지](plan/post-collection-execution.md#c0-2-문구출처-커버리지) 참조

### 0. 첫 pending 원문 전송·WebView 확인 ✅

1. 앱을 완전히 닫았다 열거나 대시보드의 **다시 시도**를 눌러 WebView가 앱 안에서 열리는지 확인
2. 설정 탭에 다시 들어가 pending 0건인지 확인 — 서버는 이미 1건을 accepted함
3. 대시보드 **수집 원문 보기**에서 본인 원문 1건과 올바른 출처 배지 확인
4. 이 원문이 등록한 금융 앱의 의도한 알림인지 확인하고 일반 대화·미등록 알림 canary 진행
5. 다시 실패하면 서버 `/api/ingest` 접근 로그부터 확인하고 실제 원문은 로그로 남기지 않음

이 단계는 서버 수정이라 APK를 다시 설치할 필요가 없습니다. pending 원문은 성공 응답 전까지
폰의 SQLite 큐에서 삭제되지 않습니다.

### 1. tailnet 전용 HTTPS 준비

```bash
sudo tailscale serve --bg localhost:3000
tailscale serve status
```

- Funnel 사용 금지: 인터넷 전체에 공개됩니다.
- 이미 443에 Funnel/Serve 설정이 있으면 기존 서비스를 임의로 바꾸지 말고 충돌을 확인합니다.
- `.env`의 `APP_URL`과 앱 서버 주소는 같은 `https://...ts.net` origin이어야 합니다.

### 2. 서버에서 디버그 APK를 받아 덮어쓰기 설치

```bash
cd /home/jihoon/projects/FamilyCard/android
./gradlew publishDebugApk
```

폰 브라우저에서 private `.env`의 `APP_URL` 뒤에 `/downloads/familycard.apk`를 붙인 주소를
엽니다. 현재 설치된 구버전에는 업데이트 버튼이 없으므로 이번 한 번은 주소를 직접 열고,
versionCode 3 설치 뒤부터 **설정 → 앱 업데이트 → 최신 APK 받기**를 씁니다. USB나 PC→폰
파일 복사는 필요 없습니다. Android 설치 확인은 직접 눌러야 합니다. 동일 개발 PC의 debug
서명으로 빌드해야 덮어쓰기가 가능하며 앱 삭제 전에는 pending/rejected 건수를 확인합니다.

### 3. 서버와 수집 대상 설정

1. 관리자가 `/family/devices`에서 해당 구성원의 기기 토큰을 발급
2. 폰의 FamilyCard 설정에서 HTTPS 서버 주소와 토큰 저장
3. **카드사 앱 추가**에서 검색해 실제 카드사 공식 앱을 여러 개 체크하고 등록
4. 토스·카카오페이·네이버페이 등을 쓴다면 **결제·자산 앱 추가**에서 일괄 선택
5. 카카오 알림톡을 쓴다면 실제 알림의 공식 채널 제목 등록
6. SMS를 쓴다면 발신번호/발신자 ID 등록 후 문자 수신 권한 허용
7. 알림 접근과 배터리 최적화 예외 허용

구성원마다 본인이 쓰는 대상만 반복합니다. 새 구성원을 위해 APK 코드나 서버 목록을
수정하지 않습니다.

### 4. 개인정보 canary — 실제 결제 전 필수

다음을 받은 뒤 앱 pending/rejected와 서버 `/raw`가 증가하지 않는지 확인합니다.

- 평범한 카카오 개인·단체 대화
- 등록 공식 채널과 비슷하지만 정확히 같지 않은 일반 대화방
- “카드”, “승인”, “결제”가 포함된 미등록 발신자의 개인 SMS
- 미등록 일반 앱 알림

하나라도 저장되면 가족 배포를 중단합니다. 이미 서버에 들어간 `RawMessage`는 임의로
삭제하지 말고 사용자와 처리 방침을 결정합니다.

### 5. 실제 수집 시나리오

- 실제 소액 결제 → `/raw`에 올바른 출처 배지와 즉시 도착
- 카드사 앱+결제 앱 동시 알림 → `/raw`에 출처가 다른 원문 두 건
- 수집 대상 삭제 → 이후 알림만 중단, 기존 원문 유지
- 기내모드 결제 → 연결 복구 뒤 자동 업로드
- 재부팅 뒤 수집 서버 자동 복구와 폰의 pending 캡처·전송
- 서버 중단 → pending 유지와 안내 화면
- 구버전 앱 데이터가 있다면 v2→v3 업데이트 뒤 pending/rejected 건수와 전송 보존
- 기기 폐기 → 수집·새 nonce·기존 WebView 세션 모두 거부

Phase 2에서는 파서가 없으므로 거래 대시보드가 아니라 **`/raw`가 성공 기준**입니다.

### 6. 서명·가족 배포·며칠간 수집

- 운영 `familycard.jks` 생성 및 암호화 이중 백업
- GitHub Secrets: `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`
- 개인정보 canary 전에는 `v0.2.0` 태그 금지
- 가족 전원 설치 후 카드사별·출처별 승인/취소/할부/해외/마스킹 원문을 며칠간 축적
- 실제 내용은 DB와 접근 제어된 `/raw` 안에서만 보고 Git·이슈·메신저에 복사하지 않음

---

## 아직 하지 말 것

- 실제 카드 원문을 fixture·문서·이슈·로그에 복사
- 카카오톡 또는 문자 앱 전체를 우회 등록
- 본문을 먼저 저장한 뒤 나중에 필터링
- 복수 출처 중 하나를 수집 단계에서 우선순위로 폐기
- 실제 원문 며칠치 전 Phase 3 정규식·의미 중복 규칙 작성
- Funnel이나 공유기 포트포워딩으로 FamilyCard 공개
- 실제 키와 실기기 canary 없이 `v0.2.0` 태그
- `RawMessage` 삭제
- `main` 직접 push

---

## 환경과 문서 지도

| 항목        | 값                                          |
| ----------- | ------------------------------------------- |
| Node        | 24 (`.nvmrc`)                               |
| pnpm        | 9.15.9, `corepack pnpm` 사용                |
| JDK         | 21                                          |
| Android SDK | `~/android-sdk`                             |
| PostgreSQL  | Docker 17-alpine, 로컬 포트 5433            |
| 저장소      | 공개 상태 — 실제 금융 데이터 커밋 절대 금지 |

`web/.env`는 루트 `.env`를 가리키는 심볼릭 링크입니다. 별도 파일로 덮어쓰지 않습니다.
개발 DB 시드는 운영에 적용하지 않습니다.

- [Phase 2 체크리스트](plan/phase-2.md)
- [수집 이후 통합 실행 계획](plan/post-collection-execution.md)
- [수집 계약](plan/phase2-contract.md)
- [수집 설계](design/02-ingest.md)
- [Android 설계](design/08-android-app.md)
- [사용자 관리 출처 ADR](adr/0007-user-managed-capture-sources.md)
- [검색·다중 선택 ADR](adr/0008-searchable-multi-app-picker.md)
- [APK 업데이트 전달 ADR](adr/0009-tailnet-apk-update-delivery.md)
- [금융 앱 추천 카탈로그 조사](research/android-finance-app-catalog.md)
- [사용자 가이드](guide/user-guide.md)
- [관리자 가이드](guide/admin-guide.md)
- [이번 작업 워크스루](../workthrough/2026-08-30-device-session-and-raw-dashboard.md)
