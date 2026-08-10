// dedupeHash — 멱등 수집의 핵심.
//
// 앱은 유실을 막기 위해 같은 메시지를 여러 번 보낼 수 있다(응답 유실, 밀린
// 큐 재전송, 수동 재전송). 서버가 멱등해야 앱이 마음 놓고 재시도할 수 있다.
// 이 해시가 그 안전장치다 — RawMessage.dedupeHash 의 UNIQUE 제약과 짝을
// 이룬다.
//
// 설계 근거 3가지 (docs/design/02-ingest.md "멱등성 — dedupeHash"):
//   1. deviceId 포함 — 부부가 같은 가족카드를 쓰면 동일한 문구의 알림이 두
//      폰에 각각 온다. 이건 중복이 아니라 서로 다른 사실이므로 반드시
//      구분해야 한다.
//   2. 분 단위 절삭 — 알림의 postTime과 SMS의 수신 시각은 같은 결제라도 몇
//      초 차이가 난다. 초까지 넣으면 같은 결제가 두 건으로 갈라진다.
//   3. title 미포함 — 카드사 앱이 알림 제목만 미묘하게 바꾸는 경우가 있다
//      ("신한카드" → "신한카드 승인"). 본문이 같고 같은 분에 온 같은 기기
//      메시지라면 같은 사건으로 본다. 그래서 이 입력 타입에 title 이 있어도
//      해시 계산에는 쓰지 않는다 — 호출부가 메시지 전체를 그대로 넘길 수
//      있게 시그니처에는 남겨 두되, 실수로 다시 넣지 않도록 여기 명시한다.
import { createHash } from 'node:crypto';

const DEDUPE_HASH_SEPARATOR = '|';

/**
 * receivedAt 을 "그 분의 0초 0밀리초"로 절삭한 뒤 UTC ISO 문자열로
 * 직렬화한다.
 *
 * 타임존 안정성: `toISOString()`은 항상 UTC 기준으로 찍는다. 로컬 타임존
 * 기준 필드(getMinutes 등)를 쓰면 서버를 KST 로 돌리는 배포 환경과 UTC 로
 * 돌리는 CI/개발 환경에서 같은 receivedAt 이 서로 다른 "분 경계"로 잘려
 * 해시가 갈라진다 — 실행 환경의 TZ 설정과 무관하게 항상 같은 문자열이
 * 나오도록 UTC 로 고정한다.
 */
export function truncateToMinute(receivedAt: Date): string {
  const truncated = new Date(receivedAt.getTime());
  truncated.setUTCSeconds(0, 0);
  return truncated.toISOString();
}

export interface DedupeHashInput {
  deviceId: string;
  packageName: string;
  // 해시 계산에는 쓰지 않는다 — 위 설계 근거 3.
  title: string;
  body: string;
  receivedAt: Date;
}

/** RawMessage.dedupeHash 에 저장할 값을 계산한다. */
export function computeDedupeHash(input: DedupeHashInput): string {
  const parts = [input.deviceId, input.packageName, input.body, truncateToMinute(input.receivedAt)];
  return createHash('sha256').update(parts.join(DEDUPE_HASH_SEPARATOR)).digest('hex');
}
