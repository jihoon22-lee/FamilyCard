// dedupeHash — 멱등 수집의 핵심.
//
// 앱은 유실을 막기 위해 같은 메시지를 여러 번 보낼 수 있다(응답 유실, 밀린
// 큐 재전송, 수동 재전송). 서버가 멱등해야 앱이 마음 놓고 재시도할 수 있다.
// 이 해시가 그 안전장치다 — RawMessage.dedupeHash 의 UNIQUE 제약과 짝을
// 이룬다.
//
// 본문·분 단위 추정은 같은 문구의 정상 결제 두 건을 합칠 수 있다. Android가
// 캡처 시 생성해 큐 재전송 동안 유지하는 clientMessageId를 기준으로 삼아,
// "같은 사건의 재시도"만 중복 처리한다.
import { createHash } from 'node:crypto';

const DEDUPE_HASH_VERSION = 'client-message-v1';

export interface DedupeHashInput {
  deviceId: string;
  clientMessageId: string;
}

/** RawMessage.dedupeHash 에 저장할 값을 계산한다. */
export function computeDedupeHash(input: DedupeHashInput): string {
  return createHash('sha256')
    .update(`${DEDUPE_HASH_VERSION}|${input.deviceId}|${input.clientMessageId}`)
    .digest('hex');
}
