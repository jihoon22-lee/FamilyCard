import type { ParsingRule } from './types';

// Only formats observed in the retained corpus. Values in fixtures are synthetic.
// Source restrictions are part of each rule, not a guess based on an amount alone.
const text = (from: string) => ({ type: 'text', from });
const constant = (value: string) => ({ type: 'const', value });
const date = (withTime = true) => ({
  type: 'datetime_md',
  from: withTime ? ['month', 'day', 'time'] : ['month', 'day'],
});
const money = { type: 'money', from: 'amount' };
const token = { type: 'card_token', from: 'token' };
const md = String.raw`(?<month>\d{2})[/.](?<day>\d{2})`;
const time = String.raw`(?<time>\d{2}:\d{2})`;
const amount = String.raw`(?<amount>[\d,]+)`;
type Source = { source: string; packageName: string; originKind: string };
const app = (packageName: string): Source[] => [
  { source: 'NOTIFICATION', packageName, originKind: 'CARD_APP' },
];
const sms = (packageName: string): Source[] =>
  ['SMS', 'RCS'].map((source) => ({ source, packageName, originKind: 'SMS_SENDER' }));
const kb = app('com.kbcard.cxh.appcard');
const hana = app('com.hanaskcard.paycla');
const lotte = app('com.lcacApp');
const samsung = [
  { source: 'NOTIFICATION', packageName: 'com.kakao.talk', originKind: 'KAKAO_CHANNEL' },
];
function rule(
  id: string,
  issuer: string,
  sources: Source[],
  pattern: string,
  fields: Record<string, unknown>,
  priority = 1000,
): ParsingRule {
  return {
    id: 'observed-v1-' + id,
    issuer,
    version: 1,
    action: 'PARSE',
    priority,
    isActive: true,
    matchPattern: pattern,
    extractPattern: pattern,
    fieldMap: { _sources: sources, ...fields },
  };
}
const approval = {
  txType: constant('APPROVAL'),
  amount: money,
  cardToken: token,
  approvedAt: date(),
  merchant: text('merchant'),
};
const cancellation = { ...approval, txType: constant('CANCELLATION') };
export const observedRules: readonly ParsingRule[] = [
  rule(
    'kb-pay',
    'KB',
    kb,
    String.raw`^KB Pay\n\[KB Pay 사용 알림\] 신용 (?<token>\d{4}) ${md} ${time} ${amount}원 (?<merchant>.+) 승인\s*$`,
    approval,
  ),
  rule(
    'kb-foreign-thb',
    'KB',
    sms('15881688'),
    String.raw`(?:^|\n)\[Web발신\]\nKB국민카드(?<token>\d{4}) 해외승인\n[^\n]+\n(?<amount>[\d,.]+)\(THB\) ${md} ${time}\n(?<merchant>.+?) {2,}[^\n]+$`,
    {
      ...approval,
      amount: { type: 'const', value: null },
      currency: constant('THB'),
      foreignAmount: { type: 'foreign_money', from: 'amount', scale: 2 },
    },
  ),
  rule(
    'hana-pay',
    'HANA',
    hana,
    String.raw`^\(결제\) ${amount}원\n(?<merchant>.+) / 신용\((?<installment>일시불|\d{1,2}개월),(?<token>[\d*]{4})\) / ${md} ${time} / .+$`,
    { ...approval, installment: { type: 'installment', from: 'installment' } },
  ),
  rule(
    'hana-foreign-krw',
    'HANA',
    hana,
    String.raw`^결제\n\((?<token>[\d*]{4})\)[^\n]+ ${md} ${time}/해외/승인/KRW ${amount}/(?<merchant>.+?) {2,}[^\n]+$`,
    approval,
  ),
  rule(
    'samsung-approval',
    'SAMSUNG',
    samsung,
    String.raw`^삼성카드\n삼성(?<token>\d{4})승인 [^\n]+\n${amount}원 (?<installment>일시불|\d{1,2}개월)\n${md} ${time} (?<merchant>[^\n]+)\n누적[\d,]+원\s*$`,
    { ...approval, installment: { type: 'installment', from: 'installment' } },
  ),
  rule(
    'samsung-cancel',
    'SAMSUNG',
    samsung,
    String.raw`^삼성카드\n\[삼성카드\](?<token>\d{4})취소\n${md} (?<merchant>[^\n]+)\n-${amount}원\s*$`,
    { ...cancellation, approvedAt: date(false) },
  ),
  rule(
    'kb-rcs-cancel',
    'KB',
    sms('15881688'),
    String.raw`(?:^|\n)\[KB국민카드\] (?<token>\d{4}) \S+ (?<merchant>.+?) (?<originalMonth>\d{2})(?:월|/)(?<originalDay>\d{2})일? 이용건 (?<month>\d{2})(?:월|/)(?<day>\d{2})일? (?:취소완료|부분취소)\(-${amount}원\)\s*$`,
    {
      ...cancellation,
      approvedAt: date(false),
      originalApprovedAt: { type: 'datetime_md', from: ['originalMonth', 'originalDay'] },
    },
  ),
  rule(
    'lotte-minute',
    'LOTTE',
    lotte,
    String.raw`^(?<merchant>[^\n]+)\n${amount}원 승인\r?\n[^\n]+카드\((?<token>[\d*]{4})\)\s*\r?\n(?<installment>일시불|\d{1,2}개월), ${md} ${time}\r?\n누적금액 [\d,]+원\s*$`,
    { ...approval, installment: { type: 'installment', from: 'installment' } },
  ),
  // A one-event summary has no approval time. Multi-event summaries are not individual transactions.
  rule(
    'lotte-day',
    'LOTTE',
    lotte,
    String.raw`^(?<merchant>[^\n]+)\n${amount}원\(1건\) 승인\r?\n[^\n]+카드\((?<token>[\d*]{4})\)\s*\r?\n${md}\s*$`,
    { ...approval, approvedAt: date(false) },
  ),
  ...(['APPROVAL', 'CANCELLATION'] as const).flatMap((kind) =>
    (kind === 'APPROVAL' ? ['KRW', 'USD'] : ['USD']).map((currency) =>
      rule(
        `samsung-foreign-${currency.toLowerCase()}-${kind.toLowerCase()}`,
        'SAMSUNG',
        sms('0220008100'),
        String.raw`(?:^|\n)\[Web발신\]\n삼성(?<token>\d{4})해외${kind === 'APPROVAL' ? '승인' : '취소'} [^\n]+\n${currency} ${kind === 'CANCELLATION' ? '-' : ''}(?<amount>[\d,.]+)\n${md} ${time} (?<merchant>[^\n]+)\s*$`,
        {
          ...approval,
          txType: constant(kind),
          currency: constant(currency),
          ...(currency === 'USD'
            ? {
                amount: { type: 'const', value: null },
                foreignAmount: { type: 'foreign_money', from: 'amount', scale: 2 },
              }
            : {}),
        },
      ),
    ),
  ),
  ...(['KB국민카드', '하나카드', '롯데카드'] as const).map((label, i) =>
    rule(
      `toss-${i}`,
      ['KB', 'HANA', 'LOTTE'][i]!,
      [{ source: 'NOTIFICATION', originKind: 'PAYMENT_APP', packageName: 'viva.republica.toss' }],
      String.raw`^${amount}원 결제\n${label} \| (?<merchant>.+)\((?<installment>일시불|\d{1,2}개월)\)\s*$`,
      {
        txType: constant('APPROVAL'),
        amount: money,
        approvedAt: { type: 'received_at' },
        merchant: text('merchant'),
        installment: { type: 'installment', from: 'installment' },
      },
    ),
  ),
  {
    ...rule('declined', 'OTHER', [...kb, ...samsung, ...sms('15881688')], '승인거절', {}, 900),
    action: 'IGNORE',
  },
  {
    ...rule(
      'advertisement',
      'OTHER',
      [
        ...kb,
        ...hana,
        ...lotte,
        ...samsung,
        ...sms('15881688'),
        ...app('net.ib.android.smcard'),
        ...app('com.shinhan.sbanking'),
        ...[
          'viva.republica.toss',
          'com.kakaopay.app',
          'com.naverfin.payapp',
          'com.samsung.android.spay',
        ].map((packageName) => ({
          source: 'NOTIFICATION',
          originKind: 'PAYMENT_APP',
          packageName,
        })),
      ],
      String.raw`^(?:[^\n]*\n)?(?:\[Web발신\]\s*)?\(광고\)`,
      {},
      900,
    ),
    action: 'IGNORE',
  },
];
