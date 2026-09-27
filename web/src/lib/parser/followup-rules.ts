import type { ParsingRule } from './types';
import { observedRules } from './observed-rules';

// Additional observed formats. Existing revisions and administrator edits stay intact.
const source = (packageName: string, originKind = 'PAYMENT_APP') => [
  { source: 'NOTIFICATION', packageName, originKind },
];
function ignore(id: string, sources: unknown, pattern: string): ParsingRule {
  return {
    id: `observed-v2-${id}`,
    issuer: 'OTHER',
    version: 1,
    action: 'IGNORE',
    priority: 1100,
    isActive: true,
    matchPattern: pattern,
    extractPattern: pattern,
    fieldMap: { _sources: sources },
  };
}
const toss = observedRules.find((rule) => rule.id === 'observed-v1-toss-1')!;
export const followupRules: readonly ParsingRule[] = [
  {
    ...toss,
    id: 'observed-v2-toss-hana-overseas',
    matchPattern: toss.matchPattern.replace('원 결제', '원 {2}해외결제'),
    extractPattern: toss.extractPattern.replace('원 결제', '원 {2}해외결제'),
  },
  ignore(
    'toss-exchange-quote',
    source('viva.republica.toss'),
    String.raw`^(?:미국 달러|싱가포르 달러|유럽 유로|일본 엔) [\d,]+\.\d{1,2}원\n(?:어제보다 [\d,]+\.\d{1,2}원 (?:올랐어요|내렸어요)\.|최근 \d+개월 [^\n]+ 가장 낮은 환율이에요\.)\s*$`,
  ),
  ignore('samsungpay-ad-direction-mark', source('com.samsung.android.spay'), '^\u200e\\(광고\\)'),
  ignore(
    'samsung-bill',
    source('com.kakao.talk', 'KAKAO_CHANNEL'),
    String.raw`^삼성카드\n\[삼성카드\]\d{2}/\d{2}결제금액 [\d,]+원 \(\d{2}/\d{2}출금,`,
  ),
  ignore(
    'lotte-bill',
    source('com.lcacApp', 'CARD_APP'),
    String.raw`^이용대금 안내 \(\d{2}/\d{2}\)[^\n]*\n\d{2}/\d{2} 국민 [\d,]+원 결제 `,
  ),
];
