import { describe, expect, it } from 'vitest';

import { computeDedupeHash } from '@/lib/ingest/dedupe';

const base = {
  deviceId: 'device-test-1',
  clientMessageId: '11111111-1111-4111-8111-111111111111',
};

describe('computeDedupeHash — 클라이언트 사건 ID', () => {
  it('같은 기기와 clientMessageId 재전송은 같은 해시다', () => {
    expect(computeDedupeHash(base)).toBe(computeDedupeHash({ ...base }));
  });

  it('같은 기기에서 서로 다른 사건 ID는 다른 해시다', () => {
    expect(computeDedupeHash(base)).not.toBe(
      computeDedupeHash({
        ...base,
        clientMessageId: '22222222-2222-4222-8222-222222222222',
      }),
    );
  });

  it('같은 사건 ID라도 기기가 다르면 별개다', () => {
    expect(computeDedupeHash(base)).not.toBe(
      computeDedupeHash({ ...base, deviceId: 'device-test-2' }),
    );
  });
});
