// dedupeHash 유닛 테스트.
//
// 이 해시가 깨지면 두 가지 방향으로 사고가 난다: 너무 느슨하면(과도하게
// 같다고 판정) 서로 다른 결제가 하나로 합쳐지고, 너무 엄격하면(과도하게
// 다르다고 판정) 재전송이 중복 적재로 이어진다. 설계 근거 3가지를 각각
// 정확히 테스트로 고정한다. → docs/design/02-ingest.md "멱등성"
import { describe, expect, it } from 'vitest';

import { computeDedupeHash, truncateToMinute } from '@/lib/ingest/dedupe';

// 가공된 샘플. 실제 카드 알림 원문을 쓰지 않는다 (AGENTS.md 불변 규칙 7).
const base = {
  deviceId: 'device-아빠폰',
  packageName: 'com.example.testcard',
  title: '테스트카드 승인',
  body: '홍길동님 12,000원 일시불 08/10 14:23 테스트가맹점',
  receivedAt: new Date('2026-08-10T05:23:07.123Z'),
};

describe('computeDedupeHash', () => {
  it('같은 입력 → 같은 해시', () => {
    expect(computeDedupeHash(base)).toBe(computeDedupeHash({ ...base }));
  });

  it('title 만 다르면 같은 해시 — 카드사가 제목만 바꿔 재전송하는 경우를 흡수한다', () => {
    const hashA = computeDedupeHash({ ...base, title: '테스트카드 승인' });
    const hashB = computeDedupeHash({ ...base, title: '테스트카드' });

    expect(hashA).toBe(hashB);
  });

  it('deviceId 가 다르면 다른 해시 — 두 폰에 온 같은 문구는 서로 다른 사실이다', () => {
    const hashA = computeDedupeHash({ ...base, deviceId: 'device-아빠폰' });
    const hashB = computeDedupeHash({ ...base, deviceId: 'device-엄마폰' });

    expect(hashA).not.toBe(hashB);
  });

  it('packageName 이 다르면 다른 해시', () => {
    const hashA = computeDedupeHash({ ...base, packageName: 'com.example.shinhan' });
    const hashB = computeDedupeHash({ ...base, packageName: 'com.example.kb' });

    expect(hashA).not.toBe(hashB);
  });

  it('body 가 다르면 다른 해시', () => {
    const hashA = computeDedupeHash({ ...base, body: '12,000원 결제' });
    const hashB = computeDedupeHash({ ...base, body: '13,000원 결제' });

    expect(hashA).not.toBe(hashB);
  });

  it('같은 분 안의 다른 초 → 같은 해시', () => {
    const hashA = computeDedupeHash({ ...base, receivedAt: new Date('2026-08-10T05:23:00Z') });
    const hashB = computeDedupeHash({ ...base, receivedAt: new Date('2026-08-10T05:23:59Z') });

    expect(hashA).toBe(hashB);
  });

  it('분 경계를 넘으면 다른 해시', () => {
    const hashA = computeDedupeHash({ ...base, receivedAt: new Date('2026-08-10T05:23:59Z') });
    const hashB = computeDedupeHash({ ...base, receivedAt: new Date('2026-08-10T05:24:00Z') });

    expect(hashA).not.toBe(hashB);
  });
});

describe('truncateToMinute — 타임존 안정성', () => {
  it('초·밀리초를 0으로 절삭한 UTC ISO 문자열을 돌려준다', () => {
    expect(truncateToMinute(new Date('2026-08-10T05:23:47.789Z'))).toBe('2026-08-10T05:23:00.000Z');
  });

  it('원본 Date 객체를 변형하지 않는다', () => {
    const original = new Date('2026-08-10T05:23:47.789Z');
    const originalTime = original.getTime();

    truncateToMinute(original);

    expect(original.getTime()).toBe(originalTime);
  });

  it('실행 환경의 TZ 설정과 무관하게 항상 같은 값을 낸다', () => {
    // toISOString() 은 항상 UTC 를 기준으로 찍으므로 process.env.TZ 를
    // 무엇으로 바꿔도(로컬 getMinutes() 등을 안 쓰는 한) 결과가 흔들리지
    // 않아야 한다. 실제로 TZ 를 바꿔서 회귀를 방지한다.
    const originalTz = process.env.TZ;
    const date = new Date('2026-08-10T05:23:47.789Z');

    process.env.TZ = 'Asia/Seoul';
    const seoulResult = truncateToMinute(date);

    process.env.TZ = 'UTC';
    const utcResult = truncateToMinute(date);

    process.env.TZ = originalTz;

    expect(seoulResult).toBe(utcResult);
    expect(seoulResult).toBe('2026-08-10T05:23:00.000Z');
  });
});
