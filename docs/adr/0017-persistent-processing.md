# ADR 0017 — 지속 처리 작업과 복구

- 상태: 채택, 운영 활성화는 최종 배포 검증 뒤
- 날짜: 2026-09-25

원문과 ProcessingJob을 한 번의 nested create로 저장한다. 원문별 고유 작업은 중복 수신으로
증식하지 않고, 기존/누락 작업은 scope 안에서 한 번에 100개씩 복구한다.

처리기는 2분 lease와 세대 번호를 이용한다. 경쟁 시 compare-and-set으로 한 작업을 맡고,
결과 반영 마지막에도 lease/세대가 같은지 검사한다. 세대가 바뀌면 거래/원문 메타데이터
변경 전체를 롤백한다. 프로세스 중단 뒤 만료 lease를 다시 맡는다. 실패는 원문을 유지하고
최대 5회 제한된 지연 재시도 후 FAILED로 남긴다. 내부 예외 내용은 저장/출력하지 않는다.

거래 쓰기·근거 연결·취소 재계산은 SERIALIZABLE 트랜잭션이다. 동시 처리 충돌은 재시도한다.
같은 raw를 두 번 처리해도 근거는 하나이며, 여러 source의 충분한 근거는 같은 canonical
거래로 연결한다. 수동 거래/연결은 재파싱으로 덮어쓰지 않는다. 공유 근거의 필드 충돌은
EVIDENCE_CONFLICT로 표시하고 기존 거래를 유지한다. 파싱 실패/새 IGNORE도 이전 거래를 지우지 않는다.

한 번에 기본 20개를 처리한다. 단일 카드의 projection 조회는 10,000개, 시간 인접 후보는
1,000개를 상한으로 둔다. 상한 초과는 LEDGER_LIMIT 실패로 표시하며 부분 집계를 확정하지 않는다.
범위를 확장하기 전 실제 데이터로 비용을 측정해 페이지/기간별 계산으로 확장해야 한다.

자가호스팅 Next.js Node 서버의 [instrumentation register](https://nextjs.org/docs/15/app/api-reference/file-conventions/instrumentation)를
사용해 시작한다. 겹치지 않는 15초 주기이며 `FAMILYCARD_PROCESSING_ENABLED=true`일 때만 활성화한다.
기본값 false. 내부 HTTP 관리 토큰이나 공개 처리 API를 새로 만들지 않는다. 서버가 여러 개여도
DB lease와 SERIALIZABLE 경합 처리로 조정한다. 서버리스 주기 실행을 지원한다고 주장하지 않는다.

검증은 격리 DB에서 수행한다. 가공 복수 출처 승인/부분취소·두 번 재처리·수동 금액 보존·
파싱 실패 시 기존 거래 보존·타인 재처리 거부·만료 lease·세대 교체 롤백을 검증한다.
standalone 후보 서버에서 HTTP ingest→작업 생성→자동 처리→카드 연결을 확인한다.
