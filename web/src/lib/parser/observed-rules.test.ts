import { describe, expect, it } from 'vitest';
import { parseMessage, validatePatterns } from './index';
import { observedRules } from './observed-rules';
const receivedAt = new Date('2026-09-27T03:00:00Z');
const cases = [
  [
    'kb-pay',
    'KB Pay',
    '[KB Pay 사용 알림] 신용 1234 09/21 12:34 12,000원 가공 상점( 승인 ',
    'NOTIFICATION',
    'com.kbcard.cxh.appcard',
    'CARD_APP',
    12000,
  ],
  [
    'hana-pay',
    '(결제) 12,000원',
    '가공 상점 / 신용(일시불,1*2*) / 09.21 12:34 / 누적 456,000원',
    'NOTIFICATION',
    'com.hanaskcard.paycla',
    'CARD_APP',
    12000,
  ],
  [
    'hana-foreign-krw',
    '결제',
    '(1*2*)홍*동 09/21 12:34/해외/승인/KRW 12,000/FAKE SHOP               해외 이용 안내 문구.',
    'NOTIFICATION',
    'com.hanaskcard.paycla',
    'CARD_APP',
    12000,
  ],
  [
    'samsung-approval',
    '삼성카드',
    '삼성1234승인 홍*동\n12,000원 일시불\n09/21 12:34 가공_상점\n누적456,000원',
    'NOTIFICATION',
    'com.kakao.talk',
    'KAKAO_CHANNEL',
    12000,
  ],
  [
    'samsung-cancel',
    '삼성카드',
    '[삼성카드]1234취소\n09/22 가공 상점\n-3,000원',
    'NOTIFICATION',
    'com.kakao.talk',
    'KAKAO_CHANNEL',
    3000,
  ],
  [
    'kb-rcs-cancel',
    '',
    '[KB국민카드] 1234 홍*동님 가공상점 09월21일 이용건 09월22일 취소완료(-12,000원)',
    'RCS',
    '15881688',
    'SMS_SENDER',
    12000,
  ],
  [
    'kb-rcs-cancel',
    '',
    '취소\n[KB국민카드] 1234 홍*동님 가공상점 09/21 이용건 09/22 부분취소(-3,000원)',
    'RCS',
    '15881688',
    'SMS_SENDER',
    3000,
  ],
  [
    'lotte-minute',
    '가공 상점',
    '12,000원 승인\n가공123카드(1*2*)\n일시불, 09/21 12:34\n누적금액 456,000원',
    'NOTIFICATION',
    'com.lcacApp',
    'CARD_APP',
    12000,
  ],
  [
    'lotte-day',
    '가공 상점',
    '12,000원(1건) 승인\r\n가공123카드(1*2*) \r\n09/21',
    'NOTIFICATION',
    'com.lcacApp',
    'CARD_APP',
    12000,
  ],
  [
    'samsung-foreign-krw-approval',
    '',
    '[Web발신]\n삼성1234해외승인 홍*동\nKRW 0\n09/21 12:34 FAKE SHOP',
    'SMS',
    '0220008100',
    'SMS_SENDER',
    0,
  ],
  [
    'samsung-foreign-usd-approval',
    '',
    '[Web발신]\n삼성1234해외승인 홍*동\nUSD 12.34\n09/21 12:34 FAKE SHOP',
    'SMS',
    '0220008100',
    'SMS_SENDER',
    null,
  ],
  [
    'samsung-foreign-usd-cancellation',
    '',
    '[Web발신]\n삼성1234해외취소 홍*동\nUSD -12.34\n09/22 12:34 FAKE SHOP',
    'SMS',
    '0220008100',
    'SMS_SENDER',
    null,
  ],
  [
    'kb-foreign-thb',
    '',
    '[Web발신]\nKB국민카드1234 해외승인\n홍*동\n1,234.56(THB) 09/21 12:34\nFAKE SHOP(  해외 이용 안내 URL',
    'SMS',
    '15881688',
    'SMS_SENDER',
    null,
  ],
  [
    'toss-0',
    '12,000원 결제',
    'KB국민카드 | 가공 상점(일시불)',
    'NOTIFICATION',
    'viva.republica.toss',
    'PAYMENT_APP',
    12000,
  ],
  [
    'toss-1',
    '12,000원 결제',
    '하나카드 | 가공 상점(일시불)',
    'NOTIFICATION',
    'viva.republica.toss',
    'PAYMENT_APP',
    12000,
  ],
  [
    'toss-2',
    '12,000원 결제',
    '롯데카드 | 가공 상점(일시불)',
    'NOTIFICATION',
    'viva.republica.toss',
    'PAYMENT_APP',
    12000,
  ],
] as const;
describe('observed formats with entirely synthetic private fields', () => {
  it.each(cases)(
    '%s parses within its source only',
    (id, title, body, source, packageName, originKind, amount) => {
      const raw = { title, body, source, packageName, originKind, receivedAt };
      const result = parseMessage(raw, observedRules);
      expect(result).toMatchObject({
        status: 'PARSED',
        ruleId: 'observed-v1-' + id,
        fields: { amount },
      });
      if (result.status === 'PARSED') {
        expect(result.fields.merchantName).not.toContain('누적');
        if (id === 'kb-rcs-cancel')
          expect(result.fields).toMatchObject({
            txType: 'CANCELLATION',
            timePrecision: 'DAY',
            originalApprovedAt: '2026-09-20T15:00:00.000Z',
          });
        if (id.includes('usd'))
          expect(result.fields).toMatchObject({
            currency: 'USD',
            foreignAmount: 1234,
            foreignScale: 2,
          });
      }
      for (const wrong of [
        { packageName: 'other.app' },
        { originKind: 'OTHER' },
        { source: 'MANUAL' },
      ])
        expect(parseMessage({ ...raw, ...wrong }, observedRules).status).toBe('FAILED');
    },
  );
  it('validates all RE2 patterns and rejects multi-event summaries, future/invalid dates, declines and advertising', () => {
    expect(observedRules.every(validatePatterns)).toBe(true);
    const [, title, body, source, packageName, originKind] = cases[0]!;
    const raw = { title, body, source, packageName, originKind, receivedAt };
    expect(
      parseMessage({ ...raw, body: body.replace('09/21', '02/30') }, observedRules),
    ).toMatchObject({ status: 'FAILED' });
    expect(parseMessage({ ...raw, body: '(광고) ' + body }, observedRules).status).toBe('IGNORED');
    expect(
      parseMessage({ ...raw, body: '승인거절: 잔여한도 12,000원' }, observedRules).status,
    ).toBe('IGNORED');
    const [, lt, lb, ls, lp, lo] = cases[8]!;
    expect(
      parseMessage(
        {
          title: lt,
          body: lb.replace('(1건)', '(2건)'),
          source: ls,
          packageName: lp,
          originKind: lo,
          receivedAt,
        },
        observedRules,
      ).status,
    ).toBe('FAILED');
  });
});
