import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import { visibleMemberIds } from '@/lib/auth/scope';
import type { AppSession } from '@/lib/auth/types';
import { serializable } from '@/lib/database';
import { InputError } from '@/lib/cards';
import { cycle, estimate, validateConfig, validEffectiveDate, type BenefitConfig } from './engine';
export { EXCLUSIONS, cycle, estimate } from './engine';
export type { BenefitConfig } from './engine';
interface RuleInput {
  cardId: string;
  expectedVersion: number;
  effectiveFrom: string;
  effectiveTo?: string;
  sourceUrl: string;
  config: unknown;
}
export async function saveBenefitRule(
  session: AppSession,
  input: RuleInput,
  db: PrismaClient = prisma,
) {
  const visible = await visibleMemberIds(session);
  let config: BenefitConfig, from: Date, to: Date | null;
  try {
    config = validateConfig(input.config);
    from = validEffectiveDate(input.effectiveFrom);
    to = input.effectiveTo ? validEffectiveDate(input.effectiveTo) : null;
    const url = new URL(input.sourceUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      input.sourceUrl.length > 1000 ||
      (to && to <= from)
    )
      throw new Error('Invalid source or period');
  } catch {
    throw new InputError('공식 약관 HTTPS 주소·적용 기간·구간/제외 설정을 확인해주세요.');
  }
  return serializable(db, async (tx) => {
    const card = await tx.card.findFirst({
      where: { id: input.cardId, memberId: { in: visible } },
      include: { benefitRule: true },
    });
    if (!card) throw new InputError('카드를 찾을 수 없습니다.');
    if ((card.benefitRule?.version ?? 0) !== input.expectedVersion)
      throw new InputError('다른 변경이 있습니다. 새로고침해주세요.');
    const data = {
      periodType: config.periodType,
      tiers: config.tiers as unknown as Prisma.InputJsonValue,
      exclusions: config.exclusions as Prisma.InputJsonValue,
      minPerTxAmount: config.minPerTxAmount,
      cancellationPolicy: config.cancellationPolicy,
      version: input.expectedVersion + 1,
      effectiveFrom: from,
      effectiveTo: to,
      sourceUrl: input.sourceUrl,
    };
    const saved = await tx.cardBenefitRule.upsert({
      where: { cardId: card.id },
      create: { ...data, cardId: card.id },
      update: data,
    });
    await tx.benefitRuleRevision.create({
      data: {
        ruleId: saved.id,
        version: saved.version,
        effectiveFrom: from,
        effectiveTo: to,
        configuration: {
          ...config,
          statementDay: card.statementDay,
          sourceUrl: input.sourceUrl,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.reviewDecision.create({
      data: {
        memberId: card.memberId,
        actorMemberId: session.memberId,
        action: 'SAVE_BENEFIT_RULE',
        entityId: saved.id,
        before: { version: input.expectedVersion },
        after: {
          version: saved.version,
          effectiveFrom: from.toISOString(),
          sourceUrl: input.sourceUrl,
        },
      },
    });
    return saved;
  });
}
export async function benefitCards(session: AppSession, db: PrismaClient = prisma) {
  const visible = await visibleMemberIds(session);
  return db.card.findMany({
    where: { memberId: { in: visible } },
    include: {
      member: { select: { name: true } },
      benefitRule: { include: { revisions: { orderBy: { version: 'desc' }, take: 501 } } },
    },
    orderBy: { nickname: 'asc' },
  });
}
function configuration(json: Prisma.JsonValue): BenefitConfig | null {
  try {
    return validateConfig(json);
  } catch {
    return null;
  }
}
function source(json: Prisma.JsonValue): string {
  return json &&
    typeof json === 'object' &&
    !Array.isArray(json) &&
    typeof json.sourceUrl === 'string'
    ? json.sourceUrl
    : '';
}
function revisionDay(json: Prisma.JsonValue, fallback: number) {
  return json &&
    typeof json === 'object' &&
    !Array.isArray(json) &&
    typeof json.statementDay === 'number'
    ? json.statementDay
    : fallback;
}
export async function cardEstimate(
  session: AppSession,
  cardId: string,
  benefitMonth: string,
  db: Prisma.TransactionClient = prisma,
) {
  const visible = await visibleMemberIds(session);
  const card = await db.card.findFirst({
    where: { id: cardId, memberId: { in: visible } },
    include: {
      benefitRule: { include: { revisions: { orderBy: { version: 'desc' }, take: 501 } } },
    },
  });
  if (!card) throw new InputError('카드를 찾을 수 없습니다.');
  const revisions = card.benefitRule?.revisions ?? [];
  if (revisions.length > 500) throw new InputError('규칙 이력이 산정 한도를 초과했습니다.');
  // A rule applies by the start of the earning period, never silently across a mid-period change.
  const revision = revisions.find((r) => {
    const c = configuration(r.configuration);
    if (!c || !source(r.configuration)) return false;
    const range = cycle(
      benefitMonth,
      c.periodType,
      revisionDay(r.configuration, card.statementDay),
    );
    return r.effectiveFrom <= range.start && (!r.effectiveTo || r.effectiveTo >= range.end);
  });
  if (!revision) return { card, configured: false as const };
  const config = configuration(revision.configuration)!;
  const range = cycle(
    benefitMonth,
    config.periodType,
    revisionDay(revision.configuration, card.statementDay),
  );
  // The full bounded card ledger includes originals outside this cycle for cancellation eligibility.
  const entries = await db.transaction.findMany({
    where: { memberId: { in: visible }, cardId, state: { not: 'MERGED' } },
    include: { category: { select: { benefitCode: true } } },
    orderBy: { approvedAt: 'asc' },
    take: 10001,
  });
  if (entries.length > 10000)
    throw new InputError(
      '카드 거래가 산정 한도 10,000건을 초과했습니다. 전체 합계로 표시하지 않습니다.',
    );
  const originalConfigs = new Map<string, BenefitConfig>();
  for (const t of entries) {
    const r = revisions.find(
      (r) =>
        r.effectiveFrom <= t.approvedAt &&
        (!r.effectiveTo || t.approvedAt < r.effectiveTo) &&
        source(r.configuration),
    );
    const c = r ? configuration(r.configuration) : null;
    if (c) originalConfigs.set(t.id, c);
  }
  const result = estimate(
    config,
    card.id,
    range,
    entries.map((t) => ({ ...t, categoryCode: t.category?.benefitCode ?? null })),
    originalConfigs,
  );
  const evaluatedIds = new Set(result.evaluations.map((e) => e.transactionId));
  return {
    card,
    configured: true as const,
    config,
    version: revision.version,
    sourceUrl: source(revision.configuration),
    range,
    result,
    transactions: entries
      .filter((t) => evaluatedIds.has(t.id))
      .map((t) => ({
        id: t.id,
        rawMessageId: t.rawMessageId,
        merchantName: t.merchantName,
        approvedAt: t.approvedAt,
        amount: t.amount,
      })),
    unassigned: await db.transaction.count({
      where: {
        memberId: { in: visible },
        AND: { memberId: card.memberId },
        cardId: null,
        state: { not: 'MERGED' },
        approvedAt: { gte: range.start, lt: range.end },
      },
    }),
  };
}
export async function saveEstimateSnapshot(
  session: AppSession,
  cardId: string,
  month: string,
  db: PrismaClient = prisma,
) {
  const visible = await visibleMemberIds(session);
  return serializable(db, async (tx) => {
    const result = await cardEstimate(session, cardId, month, tx);
    if (!result.configured) throw new InputError('기간에 맞는 규칙을 먼저 등록해주세요.');
    const card = await tx.card.findFirst({ where: { id: cardId, memberId: { in: visible } } });
    if (!card) throw new InputError('카드를 찾을 수 없습니다.');
    for (const e of result.result.evaluations)
      await tx.transaction.updateMany({
        where: { id: e.transactionId, memberId: { in: visible }, cardId },
        data: { excludeReason: e.reason },
      });
    return tx.benefitSnapshot.create({
      data: {
        cardId,
        benefitMonth: month,
        ruleVersion: result.version,
        result: JSON.parse(
          JSON.stringify({ range: result.range, ...result.result, sourceUrl: result.sourceUrl }),
        ) as Prisma.InputJsonValue,
      },
    });
  });
}
