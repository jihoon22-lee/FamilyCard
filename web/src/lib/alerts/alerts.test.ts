import { describe, it, expect } from 'vitest';
import { benefitAlertKinds } from './index';
import { validateSubscription } from './push';
describe('alert conditions and push endpoints', () => {
  it('warns only near the minimum tier deadline and tracks observed threshold drops', () => {
    const input = {
      now: new Date('2026-09-25T00:00:00Z'),
      end: new Date('2026-09-29T15:00:00Z'),
      total: 100000,
      minimum: 300000,
      previousThreshold: 300000,
      achievedThreshold: null,
      sameRule: true,
    };
    expect(benefitAlertKinds(input)).toEqual({ low: true, drop: true });
    expect(benefitAlertKinds({ ...input, total: 240000, sameRule: false })).toEqual({
      low: false,
      drop: false,
    });
    expect(benefitAlertKinds({ ...input, end: new Date('2026-10-10T00:00:00Z') })).toEqual({
      low: false,
      drop: true,
    });
  });
  it('rejects internal/redirect-like hosts and malformed encryption keys', () => {
    const keys = {
      p256dh: Buffer.alloc(65, 1).toString('base64url'),
      auth: Buffer.alloc(16, 1).toString('base64url'),
    };
    for (const endpoint of [
      'https://127.0.0.1/push',
      'https://fcm.googleapis.com.evil.example/push',
      'http://fcm.googleapis.com/push',
      'https://user:pass@fcm.googleapis.com/push',
    ])
      expect(() => validateSubscription({ endpoint, keys })).toThrow();
    expect(
      validateSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic', keys })
        .keys,
    ).toEqual(keys);
    expect(() =>
      validateSubscription({
        endpoint: 'https://fcm.googleapis.com/test',
        keys: { ...keys, auth: 'x' },
      }),
    ).toThrow();
  });
});
