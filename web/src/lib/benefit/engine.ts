import { monthRange, kstDayStart } from '@/lib/time';
import { netAmount } from '@/lib/reconciliation';
export const EXCLUSIONS = {
  TAX: '세금',
  INSURANCE: '4대 보험',
  GIFT_CARD: '상품권',
  PREPAID: '선불 충전',
  APT_FEE: '관리비',
  TRANSIT: '후불 교통',
  TUITION: '등록금',
  UTILITY_GAS: '도시가스',
  UTILITY_ELEC: '전기',
  UTILITY_WATER: '수도',
  TELECOM: '통신',
  INTERNET: '인터넷',
} as const;
export type ExclusionCode = keyof typeof EXCLUSIONS;
export interface Tier {
  threshold: number;
  benefitDesc: string;
  monthlyCap: number;
}
export interface BenefitConfig {
  periodType: 'PREV_CALENDAR_MONTH' | 'STATEMENT_CYCLE';
  tiers: Tier[];
  exclusions: ExclusionCode[];
  minPerTxAmount: number;
  cancellationPolicy: 'DEDUCT_FROM_ORIGINAL' | 'DEDUCT_FROM_CANCEL_PERIOD';
}
export interface BenefitEntry {
  id: string;
  cardId: string | null;
  amount: number | null;
  canceledAmount: number;
  approvedAt: Date;
  txType: 'APPROVAL' | 'CANCELLATION';
  state: 'CONFIRMED' | 'REVIEW' | 'MERGED';
  canceledTxId: string | null;
  merchantName: string;
  benefitOverride: string | null;
  categoryCode: string | null;
  excludeReason: string | null;
}
export interface Evaluation {
  transactionId: string;
  contribution: number;
  reason: string | null;
  uncertain: boolean;
}
const KST = 9 * 3600000;
export function cycle(
  benefitMonth: string,
  period: BenefitConfig['periodType'],
  statementDay: number,
) {
  const { start } = monthRange(benefitMonth);
  const local = new Date(start.getTime() + KST),
    year = local.getUTCFullYear(),
    month = local.getUTCMonth();
  if (period === 'PREV_CALENDAR_MONTH')
    return { start: new Date(Date.UTC(year, month - 1, 1) - KST), end: start };
  if (!Number.isInteger(statementDay) || statementDay < 1 || statementDay > 31)
    throw new Error('Invalid cycle day');
  const boundary = (offset: number) =>
    new Date(
      Date.UTC(
        year,
        month + offset,
        Math.min(statementDay, new Date(Date.UTC(year, month + offset + 1, 0)).getUTCDate()) + 1,
      ) - KST,
    );
  return { start: boundary(-1), end: boundary(0) };
}
export function validateConfig(value: unknown): BenefitConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid config');
  const c = value as Record<string, unknown>;
  if (
    !['PREV_CALENDAR_MONTH', 'STATEMENT_CYCLE'].includes(String(c.periodType)) ||
    !['DEDUCT_FROM_ORIGINAL', 'DEDUCT_FROM_CANCEL_PERIOD'].includes(String(c.cancellationPolicy)) ||
    !Number.isInteger(c.minPerTxAmount) ||
    Number(c.minPerTxAmount) < 0 ||
    Number(c.minPerTxAmount) > 2147483647 ||
    !Array.isArray(c.tiers) ||
    c.tiers.length < 1 ||
    c.tiers.length > 20 ||
    !Array.isArray(c.exclusions) ||
    c.exclusions.some((x) => typeof x !== 'string' || !Object.hasOwn(EXCLUSIONS, x))
  )
    throw new Error('Invalid config');
  let previous = -1;
  for (const t of c.tiers) {
    if (
      !t ||
      typeof t !== 'object' ||
      !Number.isInteger(t.threshold) ||
      t.threshold < 0 ||
      t.threshold > 2147483647 ||
      t.threshold <= previous ||
      typeof t.benefitDesc !== 'string' ||
      t.benefitDesc.length > 300 ||
      !Number.isInteger(t.monthlyCap) ||
      t.monthlyCap < 0 ||
      t.monthlyCap > 2147483647
    )
      throw new Error('Invalid tiers');
    previous = t.threshold;
  }
  return c as unknown as BenefitConfig;
}
const patterns: Record<ExclusionCode, RegExp> = {
  TAX: /국세|지방세|위택스|홈택스/,
  INSURANCE: /국민연금|건강보험|고용보험|산재보험/,
  GIFT_CARD: /상품권|기프트카드/,
  PREPAID: /선불.*충전|교통카드.*충전/,
  APT_FEE: /아파트.*관리비/,
  TRANSIT: /후불.*교통/,
  TUITION: /대학.*등록금/,
  UTILITY_GAS: /도시가스/,
  UTILITY_ELEC: /전기요금|한국전력/,
  UTILITY_WATER: /수도요금|상하수도/,
  TELECOM: /이동통신|휴대폰요금/,
  INTERNET: /인터넷요금|유선방송/,
};
function exclusion(t: BenefitEntry, config: BenefitConfig, amount: number): string | null {
  if (t.benefitOverride === 'EXCLUDE') return 'MANUAL_EXCLUDE';
  if (t.benefitOverride === 'INCLUDE') return null;
  for (const code of config.exclusions) {
    if (t.categoryCode === code) return 'CATEGORY_' + code;
    if (patterns[code].test(t.merchantName)) return 'MERCHANT_' + code;
  }
  return amount < config.minPerTxAmount ? 'MIN_AMOUNT' : null;
}
function integer(n: number) {
  if (!Number.isSafeInteger(n)) throw new Error('Unsafe benefit total');
  return n;
}
export function estimate(
  config: BenefitConfig,
  cardId: string,
  range: { start: Date; end: Date },
  entries: readonly BenefitEntry[],
  originalConfigs: ReadonlyMap<string, BenefitConfig> = new Map(),
) {
  validateConfig(config);
  const eligible = entries.filter((t) => t.cardId === cardId && t.state !== 'MERGED');
  const byId = new Map(eligible.map((t) => [t.id, t]));
  const evaluations: Evaluation[] = [];
  const inside = (t: BenefitEntry) => t.approvedAt >= range.start && t.approvedAt < range.end;
  for (const t of eligible.filter(inside)) {
    if (t.state !== 'CONFIRMED' || t.amount === null) {
      evaluations.push({
        transactionId: t.id,
        contribution: 0,
        reason: t.amount === null ? 'KRW_UNKNOWN' : 'REVIEW',
        uncertain: true,
      });
      continue;
    }
    const net = netAmount(t)!;
    if (t.txType === 'APPROVAL') {
      // Cancel-period accounting restores the canceled part of net, then deducts only this cycle's cancellations.
      const basis =
        config.cancellationPolicy === 'DEDUCT_FROM_ORIGINAL'
          ? net
          : integer(net + t.canceledAmount);
      const reason = exclusion(t, config, basis);
      evaluations.push({
        transactionId: t.id,
        contribution: reason ? 0 : basis,
        reason,
        uncertain: false,
      });
    } else {
      const original = t.canceledTxId ? byId.get(t.canceledTxId) : null;
      if (!original) {
        const reason = exclusion(t, config, t.amount);
        evaluations.push({
          transactionId: t.id,
          contribution: reason ? 0 : -net,
          reason: reason ?? 'ORPHAN_CANCELLATION_ESTIMATE',
          uncertain: true,
        });
        continue;
      }
      if (config.cancellationPolicy === 'DEDUCT_FROM_ORIGINAL') continue;
      if (original.state !== 'CONFIRMED' || original.amount === null) {
        evaluations.push({
          transactionId: t.id,
          contribution: 0,
          reason: 'ORIGINAL_UNCONFIRMED',
          uncertain: true,
        });
        continue;
      }
      const originalConfig = originalConfigs.get(original.id);
      if (!originalConfig && !inside(original)) {
        evaluations.push({
          transactionId: t.id,
          contribution: 0,
          reason: 'ORIGINAL_RULE_UNKNOWN',
          uncertain: true,
        });
        continue;
      }
      const reason = exclusion(
        original,
        originalConfig ?? config,
        netAmount(original)! + original.canceledAmount,
      );
      const manual = t.benefitOverride === 'EXCLUDE' ? 'MANUAL_EXCLUDE' : reason;
      evaluations.push({
        transactionId: t.id,
        contribution: manual ? 0 : -net,
        reason: manual ?? 'CANCEL_PERIOD',
        uncertain: false,
      });
    }
  }
  const total = integer(evaluations.reduce((sum, e) => integer(sum + e.contribution), 0));
  const achieved = [...config.tiers].reverse().find((t) => total >= t.threshold) ?? null;
  const next = config.tiers.find((t) => total < t.threshold) ?? null;
  return {
    total,
    achieved,
    next,
    remaining: next ? integer(next.threshold - total) : 0,
    evaluations,
    uncertain: evaluations.filter((e) => e.uncertain).length,
    excluded: evaluations.filter((e) => e.contribution === 0 && e.reason).length,
  };
}
export function validEffectiveDate(value: string) {
  return kstDayStart(value);
}
