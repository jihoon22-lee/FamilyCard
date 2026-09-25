import { describe, expect, it } from 'vitest';
import {
  parseMessage,
  money,
  monthDay,
  narrative,
  validatePatterns,
  type ParsingRule,
} from './index';
const rule: ParsingRule = {
  id: 'synthetic',
  issuer: 'TEST',
  version: 1,
  action: 'PARSE',
  priority: 100,
  isActive: true,
  matchPattern: '^\\[테스트카드\\]',
  extractPattern:
    '^\\[테스트카드\\] (?<cardToken>[0-9*]+) (?<amount>[0-9,]+)원 (?<installment>일시불|[0-9]+개월) (?<month>[0-9]{2})/(?<day>[0-9]{2}) (?<time>[0-9]{2}:[0-9]{2}) (?<merchant>.+)$',
  fieldMap: {
    amount: { type: 'money' },
    installment: { type: 'installment' },
    approvedAt: { type: 'datetime_md', from: ['month', 'day', 'time'] },
    merchant: { type: 'text' },
    cardToken: { type: 'card_token' },
    txType: { type: 'const', value: 'APPROVAL' },
  },
};
const raw = {
  body: '[테스트카드] 1*34 12,000원 3개월 08/10 14:23 테스트가맹점',
  source: 'SMS',
  receivedAt: new Date('2026-08-10T06:00:00Z'),
};
it('extracts exact integer amounts, masked token, installment and KST event time', () => {
  const result = parseMessage(raw, [rule]);
  expect(result.status).toBe('PARSED');
  if (result.status === 'PARSED')
    expect(result.fields).toMatchObject({
      amount: 12000,
      cardToken: '1*34',
      installmentMonths: 3,
      merchantName: '테스트가맹점',
      approvedAt: '2026-08-10T05:23:00.000Z',
      timePrecision: 'MINUTE',
    });
});
it('no rule is never ignored and first matched extraction failure never falls through', () => {
  expect(parseMessage(raw, [])).toEqual({ status: 'FAILED', reason: 'NO_RULE' });
  expect(
    parseMessage(raw, [{ ...rule, priority: 1, extractPattern: '^never$' }, rule]),
  ).toMatchObject({ status: 'FAILED', reason: 'EXTRACTION_FAILED' });
  expect(parseMessage(raw, [{ ...rule, action: 'IGNORE' }])).toMatchObject({
    status: 'IGNORED',
    reason: 'RULE_IGNORED',
  });
});
it('matches pathological nested repeats without backtracking; rejects unsupported and expanded patterns', () => {
  expect(
    parseMessage({ body: 'a'.repeat(10000) + '!', source: 'SMS', receivedAt: raw.receivedAt }, [
      { ...rule, matchPattern: '^(a+)+$' },
    ]),
  ).toMatchObject({ reason: 'NO_RULE' });
  expect(validatePatterns({ ...rule, matchPattern: '(?=a)' })).toBe(false);
  expect(validatePatterns({ ...rule, matchPattern: '(a{999}){999}' })).toBe(false);
});
it.each(['12,34', '-1', '1.1', 'NaN', '2147483648'])('rejects malformed KRW %s', (value) =>
  expect(() => money(value)).toThrow(),
);
it('keeps foreign minor units integral and permits only explicitly unknown KRW', () => {
  expect(money('1,234.56', 2)).toBe(123456);
  const result = parseMessage({ ...raw, body: 'USD 12.30' }, [
    {
      ...rule,
      matchPattern: '^USD',
      extractPattern: 'USD (?<foreign>[0-9.]+)',
      fieldMap: {
        foreignAmount: { type: 'foreign_money', from: 'foreign', scale: 2 },
        currency: { type: 'const', value: 'USD' },
        approvedAt: { type: 'received_at' },
        txType: { type: 'const', value: 'APPROVAL' },
      },
    },
  ]);
  expect(result.status).toBe('PARSED');
  if (result.status === 'PARSED')
    expect(result.fields).toMatchObject({ amount: null, foreignAmount: 1230, foreignScale: 2 });
});
it('year is based on receipt rather than upload, invalid leap days fail', () => {
  expect(monthDay('12', '31', '23:50', new Date('2027-01-01T00:00:00Z'))).toBe(
    '2026-12-31T14:50:00.000Z',
  );
  expect(() => monthDay('02', '29', undefined, new Date('2026-03-01T00:00:00Z'))).toThrow();
  expect(monthDay('02', '29', undefined, new Date('2024-03-01T00:00:00Z'))).toBe(
    '2024-02-28T15:00:00.000Z',
  );
});
it('ISO dates cannot normalize impossible calendar days or far-future times', () => {
  const isoRule = {
    ...rule,
    matchPattern: '.*',
    extractPattern: '(?<date>.+)',
    fieldMap: {
      approvedAt: { type: 'datetime_iso', from: 'date' },
      amount: { type: 'const', value: 1000 },
      txType: { type: 'const', value: 'APPROVAL' },
    },
  };
  expect(parseMessage({ ...raw, body: '2026-02-30T00:00:00Z' }, [isoRule])).toMatchObject({
    reason: 'INVALID_FIELDS',
  });
  expect(parseMessage({ ...raw, body: '2099-01-01T00:00:00Z' }, [isoRule])).toMatchObject({
    reason: 'INVALID_FIELDS',
  });
});
describe('RCS narrative', () => {
  it('reads approved structure without button/URL text and never changes the original', () => {
    const body = JSON.stringify({
      message: {
        generalPurposeCard: {
          content: {
            title: '안내',
            description: '가공된 본문',
            suggestions: [
              { action: { displayText: '가짜 결제 99,000원', url: 'https://example.invalid' } },
            ],
          },
        },
      },
    });
    expect(narrative(body, 'RCS')).toBe('안내\n가공된 본문');
    expect(body).toContain('suggestions');
    expect(
      narrative(JSON.stringify({ card: '가공된 본문', suggestions: ['not narrative'] }), 'RCS'),
    ).toBe('가공된 본문');
    expect(narrative(JSON.stringify({ unknown: '가공된 본문' }), 'RCS')).toBeNull();
  });
  it('captures observed partial-cancellation structure with wholly fabricated private values', () => {
    const text = '[KB국민카드] 5678 홍*동님 테스트병원 08/10 이용건 09/03 부분취소(-12,000원)';
    const cancel: ParsingRule = {
      ...rule,
      issuer: 'KB',
      matchPattern: '\\[KB국민카드\\].*부분취소',
      extractPattern:
        '\\[KB국민카드\\]\\s+(?<cardToken>[0-9]{4})\\s+[^\\s]+\\s+(?<merchant>.+?)\\s+(?<om>[0-9]{2})/(?<od>[0-9]{2})\\s+이용건\\s+(?<cm>[0-9]{2})/(?<cd>[0-9]{2})\\s+부분취소\\(-(?<amount>[0-9,]+)원\\)',
      fieldMap: {
        amount: { type: 'money' },
        cardToken: { type: 'card_token' },
        merchant: { type: 'text' },
        txType: { type: 'const', value: 'CANCELLATION' },
        approvedAt: { type: 'datetime_md', from: ['cm', 'cd'] },
        originalApprovedAt: { type: 'datetime_md', from: ['om', 'od'] },
      },
    };
    for (const envelope of [
      { message: { generalPurposeCard: { content: { title: '취소', description: text } } } },
      {
        card: 'template',
        layout: {
          widget: 'LinearLayout',
          children: [
            { widget: 'TextView', text: '취소' },
            { widget: 'LinearLayout', children: [{ widget: 'TextView', text }] },
          ],
        },
      },
    ]) {
      const result = parseMessage(
        {
          body: JSON.stringify(envelope),
          source: 'RCS',
          receivedAt: new Date('2026-09-04T00:01:00Z'),
        },
        [cancel],
      );
      expect(result.status).toBe('PARSED');
      if (result.status === 'PARSED')
        expect(result.fields).toMatchObject({
          amount: 12000,
          txType: 'CANCELLATION',
          timePrecision: 'DAY',
          approvedAt: '2026-09-02T15:00:00.000Z',
          originalApprovedAt: '2026-08-09T15:00:00.000Z',
        });
    }
  });
});

describe('RCS legacy TextView layout', () => {
  it('extracts observed cancellation structure without images, buttons or suggestions', () => {
    const text = '[KB국민카드] 5678 홍*동님 테스트병원 08/10 이용건 09/03 부분취소(-12,000원)';
    const body = JSON.stringify({
      card: 'legacy-template',
      layout: {
        widget: 'LinearLayout',
        children: [
          { widget: 'TextView', text: '취소' },
          { widget: 'ImageView', mediaUrl: 'https://example.com/ignore' },
          { widget: 'LinearLayout', children: [{ widget: 'TextView', text }] },
          {
            widget: 'Button',
            text: '승인 999,999원',
            children: [{ widget: 'TextView', text: 'ignore' }],
          },
          { widget: 'TextView', text: '승인 888,888원', action: { url: 'https://example.com' } },
        ],
      },
      suggestions: [{ action: { displayText: '카드이용내역 승인 777,777원' } }],
    });
    expect(narrative(body, 'RCS')).toBe('취소\n' + text);
  });
  it('rejects oversized/deep or unsupported layouts instead of parsing card metadata', () => {
    expect(
      narrative(
        JSON.stringify({
          card: 'metadata',
          layout: { widget: 'Unknown', children: [{ widget: 'TextView', text: 'fake' }] },
        }),
        'RCS',
      ),
    ).toBeNull();
    expect(
      narrative(
        JSON.stringify({
          layout: {
            widget: 'LinearLayout',
            children: Array.from({ length: 129 }, () => ({ widget: 'TextView', text: 'x' })),
          },
        }),
        'RCS',
      ),
    ).toBeNull();
    expect(
      narrative(
        JSON.stringify({ layout: { widget: 'TextView', text: '<html>unsupported</html>' } }),
        'RCS',
      ),
    ).toBeNull();
  });
});
