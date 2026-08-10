// 건별 유효성 검사 유닛 테스트. docs/plan/phase2-contract.md §2 표를 그대로
// 케이스로 옮긴다.
import { describe, expect, it } from 'vitest';

import { validateIngestMessage } from '@/lib/ingest/validate';

// 기준 시각을 고정해 "미래/과거" 판정을 결정적으로 검증한다.
const NOW = new Date('2026-08-10T05:23:07Z');

// 가공된 샘플 (AGENTS.md 불변 규칙 7).
function validMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: 'NOTIFICATION',
    packageName: 'com.example.testcard',
    title: '테스트카드 승인',
    body: '홍길동님 12,000원 일시불 08/10 14:23 테스트가맹점',
    receivedAt: '2026-08-10T05:20:00Z',
    ...overrides,
  };
}

describe('validateIngestMessage', () => {
  it('정상 메시지는 통과한다', () => {
    const result = validateIngestMessage(validMessage(), NOW);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.source).toBe('NOTIFICATION');
      expect(result.value.receivedAt).toBeInstanceOf(Date);
    }
  });

  it('SMS 도 허용한다', () => {
    const result = validateIngestMessage(validMessage({ source: 'SMS' }), NOW);

    expect(result.ok).toBe(true);
  });

  it('배열·null 등 객체가 아니면 거부한다', () => {
    expect(validateIngestMessage(null, NOW).ok).toBe(false);
    expect(validateIngestMessage('문자열', NOW).ok).toBe(false);
    expect(validateIngestMessage(42, NOW).ok).toBe(false);
  });

  it('source 가 NOTIFICATION/SMS 가 아니면 거부한다', () => {
    expect(validateIngestMessage(validMessage({ source: 'MANUAL' }), NOW).ok).toBe(false);
    expect(validateIngestMessage(validMessage({ source: 'STATEMENT' }), NOW).ok).toBe(false);
    expect(validateIngestMessage(validMessage({ source: '알수없음' }), NOW).ok).toBe(false);
    expect(validateIngestMessage(validMessage({ source: undefined }), NOW).ok).toBe(false);
  });

  it('packageName 이 빈 문자열이거나 없으면 거부한다', () => {
    expect(validateIngestMessage(validMessage({ packageName: '' }), NOW).ok).toBe(false);
    expect(validateIngestMessage(validMessage({ packageName: undefined }), NOW).ok).toBe(false);
    expect(validateIngestMessage(validMessage({ packageName: 123 }), NOW).ok).toBe(false);
  });

  it('body 가 빈 문자열이면 거부한다', () => {
    const result = validateIngestMessage(validMessage({ body: '' }), NOW);

    expect(result.ok).toBe(false);
  });

  it('body 길이가 4000자를 넘으면 거부한다', () => {
    const result = validateIngestMessage(validMessage({ body: 'a'.repeat(4001) }), NOW);

    expect(result.ok).toBe(false);
  });

  it('body 길이가 정확히 4000자면 통과한다 (경계값)', () => {
    const result = validateIngestMessage(validMessage({ body: 'a'.repeat(4000) }), NOW);

    expect(result.ok).toBe(true);
  });

  it('receivedAt 이 파싱 불가한 문자열이면 거부한다', () => {
    const result = validateIngestMessage(validMessage({ receivedAt: '이것은-날짜가-아님' }), NOW);

    expect(result.ok).toBe(false);
  });

  it('receivedAt 이 없거나 문자열이 아니면 거부한다', () => {
    expect(validateIngestMessage(validMessage({ receivedAt: undefined }), NOW).ok).toBe(false);
    expect(validateIngestMessage(validMessage({ receivedAt: 1234567890 }), NOW).ok).toBe(false);
  });

  it('receivedAt 이 5분 넘게 미래면 거부한다', () => {
    const sixMinutesLater = new Date(NOW.getTime() + 6 * 60 * 1000).toISOString();

    const result = validateIngestMessage(validMessage({ receivedAt: sixMinutesLater }), NOW);

    expect(result.ok).toBe(false);
  });

  it('receivedAt 이 5분 이내의 미래면 통과한다 (기기 시계 오차 허용)', () => {
    const fourMinutesLater = new Date(NOW.getTime() + 4 * 60 * 1000).toISOString();

    const result = validateIngestMessage(validMessage({ receivedAt: fourMinutesLater }), NOW);

    expect(result.ok).toBe(true);
  });

  it('receivedAt 이 5년보다 오래됐으면 거부한다', () => {
    const sixYearsAgo = new Date(NOW.getTime());
    sixYearsAgo.setUTCFullYear(sixYearsAgo.getUTCFullYear() - 6);

    const result = validateIngestMessage(
      validMessage({ receivedAt: sixYearsAgo.toISOString() }),
      NOW,
    );

    expect(result.ok).toBe(false);
  });

  it('title 은 빈 문자열이어도 통과한다', () => {
    const result = validateIngestMessage(validMessage({ title: '' }), NOW);

    expect(result.ok).toBe(true);
  });
});
