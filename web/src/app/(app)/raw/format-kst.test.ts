import { describe, expect, it } from 'vitest';

import { formatKst } from './format-kst';

describe('formatKst', () => {
  it('UTC 를 KST(UTC+9)로 변환한다', () => {
    // 2026-08-10 15:30 UTC → 2026-08-11 00:30 KST (날짜가 넘어가는 경계값).
    const utc = new Date('2026-08-10T15:30:00.000Z');

    const formatted = formatKst(utc);

    expect(formatted).toContain('11');
    expect(formatted).toContain('00:30');
  });
});
