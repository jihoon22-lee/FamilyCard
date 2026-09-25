import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { AppSession } from '@/lib/auth/types';
import { visibleMemberIds } from '@/lib/auth/scope';
import { InputError } from '@/lib/cards';
import { serializable } from '@/lib/database';
import { EXCLUSIONS } from '@/lib/benefit/engine';
export async function categories(db: Prisma.TransactionClient = prisma) {
  return db.category.findMany({ orderBy: { name: 'asc' }, take: 200 });
}
export async function saveCategory(
  session: AppSession,
  input: { id?: string; name: string; benefitCode?: string },
  db: PrismaClient = prisma,
) {
  if (session.scope !== 'FAMILY' || session.entrypoint !== 'WEB' || session.role !== 'ADMIN')
    throw new InputError('카테고리는 관리자 웹에서 편집합니다.');
  const name = input.name.trim();
  if (
    !name ||
    name.length > 50 ||
    (input.benefitCode && !Object.hasOwn(EXCLUSIONS, input.benefitCode))
  )
    throw new InputError('분류 이름·제외 코드를 확인해주세요.');
  const visible = await visibleMemberIds(session);
  if (!visible.includes(session.memberId)) throw new InputError('세션을 확인해주세요.');
  return serializable(db, async (tx) => {
    const category = input.id
      ? await tx.category.update({
          where: { id: input.id },
          data: { name, benefitCode: input.benefitCode || null },
        })
      : await tx.category.create({ data: { name, benefitCode: input.benefitCode || null } });
    await tx.reviewDecision.create({
      data: {
        memberId: session.memberId,
        actorMemberId: session.memberId,
        action: 'SAVE_CATEGORY',
        entityId: category.id,
        after: { name, benefitCode: input.benefitCode || null },
      },
    });
    return category;
  });
}
export async function classifyTransaction(
  session: AppSession,
  input: { id: string; categoryId?: string; benefitOverride?: string; learn: boolean },
  db: PrismaClient = prisma,
) {
  const visible = await visibleMemberIds(session);
  if (input.benefitOverride && !['INCLUDE', 'EXCLUDE'].includes(input.benefitOverride))
    throw new InputError('실적 포함 여부를 확인해주세요.');
  return serializable(db, async (tx) => {
    const row = await tx.transaction.findFirst({
      where: { id: input.id, memberId: { in: visible }, state: { not: 'MERGED' } },
    });
    if (!row) throw new InputError('거래를 찾을 수 없습니다.');
    if (row.txType === 'CANCELLATION' && input.benefitOverride)
      throw new InputError('실적 포함/제외는 취소의 원승인 거래에서 지정해주세요.');
    if (input.categoryId && !(await tx.category.findUnique({ where: { id: input.categoryId } })))
      throw new InputError('분류를 찾을 수 없습니다.');
    await tx.transaction.update({
      where: { id: row.id },
      data: {
        categoryId: input.categoryId || null,
        categoryManual: true,
        benefitOverride: input.benefitOverride || null,
        excludeReason: input.benefitOverride === 'EXCLUDE' ? 'MANUAL_EXCLUDE' : null,
      },
    });
    if (input.learn && input.categoryId && row.merchantName) {
      const previous = await tx.merchantRule.findFirst({
        where: {
          memberId: { in: visible },
          AND: { memberId: row.memberId },
          matchType: 'EXACT',
          pattern: row.merchantName,
        },
      });
      if (previous)
        await tx.merchantRule.update({
          where: { id: previous.id },
          data: { categoryId: input.categoryId },
        });
      else
        await tx.merchantRule.create({
          data: {
            memberId: row.memberId,
            matchType: 'EXACT',
            pattern: row.merchantName,
            categoryId: input.categoryId,
            priority: 0,
          },
        });
      await tx.transaction.updateMany({
        where: {
          memberId: { in: visible },
          AND: { memberId: row.memberId },
          merchantName: row.merchantName,
          categoryManual: false,
        },
        data: { categoryId: input.categoryId },
      });
    }
    await tx.reviewDecision.create({
      data: {
        memberId: row.memberId,
        actorMemberId: session.memberId,
        action: 'CLASSIFY_TRANSACTION',
        entityId: row.id,
        before: { categoryId: row.categoryId, benefitOverride: row.benefitOverride },
        after: {
          categoryId: input.categoryId || null,
          benefitOverride: input.benefitOverride || null,
          learn: input.learn,
        },
      },
    });
  });
}
/** Exact learned merchant names are scoped to their owner. No cross-family learning. */
export async function learnedCategory(
  tx: Prisma.TransactionClient,
  memberId: string,
  merchantName: string,
  visible: string[],
) {
  const rules = await tx.merchantRule.findMany({
    where: {
      memberId: { in: visible },
      AND: { memberId },
      matchType: 'EXACT',
      pattern: merchantName,
    },
    select: { categoryId: true },
    take: 2,
  });
  return rules.length === 1 ? rules[0]!.categoryId : null;
}
