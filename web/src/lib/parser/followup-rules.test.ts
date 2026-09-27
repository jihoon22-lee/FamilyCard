import { describe, expect, it } from 'vitest';
import { parseMessage, validatePatterns } from './index';
import { followupRules } from './followup-rules';
import { observedRules } from './observed-rules';
const rules = [...observedRules, ...followupRules];
const receivedAt = new Date('2026-09-27T03:00:00Z');
const parse = (
  title: string,
  body: string,
  packageName = 'viva.republica.toss',
  originKind = 'PAYMENT_APP',
) =>
  parseMessage({ title, body, packageName, originKind, source: 'NOTIFICATION', receivedAt }, rules);
describe('additional observed formats (synthetic values)', () => {
  it('validates every additional rule', () => {
    for (const rule of followupRules) expect(validatePatterns(rule)).toBe(true);
  });
  it('parses the observed overseas KRW approval without inventing a card number', () => {
    const result = parse('12,000원  해외결제', '하나카드 | FAKE SHOP    SAMPLE CITY(일시불)');
    expect(result.status).toBe('PARSED');
    if (result.status === 'PARSED')
      expect(result.fields).toMatchObject({
        issuer: 'HANA',
        amount: 12000,
        cardToken: '',
        timePrecision: 'RECEIVED',
        txType: 'APPROVAL',
      });
    expect(parse('12,000원  해외결제취소', '하나카드 | FAKE SHOP(일시불)').status).toBe('FAILED');
    expect(
      parse('12,000원  해외결제', '하나카드 | FAKE SHOP(일시불)', 'com.example.other').status,
    ).toBe('FAILED');
  });
  it('ignores only complete exchange quotations from the observed source', () => {
    for (const currency of ['미국 달러', '싱가포르 달러', '유럽 유로', '일본 엔']) {
      for (const body of [
        '어제보다 1.23원 올랐어요.',
        '어제보다 1.23원 내렸어요.',
        '최근 3개월 중 가장 낮은 환율이에요.',
      ]) {
        expect(parse(`${currency} 1,234.56원`, body).status).toBe('IGNORED');
        expect(parse(`${currency} 1,234.56원`, body, 'com.example.other').status).toBe('FAILED');
      }
    }
    expect(parse('12,000원 결제', '하나카드 | 미국 달러 환율(일시불)').status).toBe('PARSED');
    expect(parse('미국 달러 1,234.56원', '해외승인 가공상점').status).toBe('FAILED');
  });
  it('handles the observed invisible advertisement prefix without hiding approvals', () => {
    expect(
      parse('\u200e(광고) 가공 혜택', '\u200e가공 안내', 'com.samsung.android.spay').status,
    ).toBe('IGNORED');
    expect(parse('\u200e결제', '12,000원 가공상점', 'com.samsung.android.spay').status).toBe(
      'FAILED',
    );
  });
  it('separates bill settlement notices from individual purchases and cancellations', () => {
    expect(
      parse(
        '삼성카드',
        '[삼성카드]09/14결제금액 456,000원 (09/14출금,09/01기준) 가공 안내',
        'com.kakao.talk',
        'KAKAO_CHANNEL',
      ).status,
    ).toBe('IGNORED');
    expect(
      parse(
        '이용대금 안내 (09/14) 가공 안내',
        '09/14 국민 456,000원 결제 예정',
        'com.lcacApp',
        'CARD_APP',
      ).status,
    ).toBe('IGNORED');
    expect(
      parse(
        '삼성카드',
        '[삼성카드]1234취소\n09/22 가공상점\n-3,000원',
        'com.kakao.talk',
        'KAKAO_CHANNEL',
      ).status,
    ).toBe('PARSED');
    expect(
      parse(
        '삼성카드',
        '[삼성카드]09/14결제금액 456,000원 (09/14출금,09/01기준)',
        'com.kakao.talk',
        'PAYMENT_APP',
      ).status,
    ).toBe('FAILED');
  });
});
