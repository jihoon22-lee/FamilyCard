import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import { visibleMemberIds } from '@/lib/auth/scope';
import type { AppSession } from '@/lib/auth/types';
import { monthRange } from '@/lib/time';
import { InputError } from '@/lib/cards';
import { serializable } from '@/lib/database';
export async function saveBudget(
  session: AppSession,
  input: { id?: string; memberId?: string; categoryId?: string; month: string; amount: number },
  db: PrismaClient = prisma,
) {
  const visible = await visibleMemberIds(session);
  const family =
    session.scope === 'FAMILY' && session.role === 'ADMIN' && session.entrypoint === 'WEB';
  if (input.memberId ? !visible.includes(input.memberId) : !family)
    throw new InputError('이 예산을 변경할 수 없습니다.');
  if (!Number.isInteger(input.amount) || input.amount < 0 || input.amount > 2147483647)
    throw new InputError('예산은 원 단위 정수로 입력해주세요.');
  try {
    monthRange(input.month);
  } catch {
    throw new InputError('예산 월을 확인해주세요.');
  }
  return serializable(db, async (tx) => {
    const old = input.id
      ? await tx.budget.findFirst({
          where: {
            id: input.id,
            OR: [{ memberId: { in: visible } }, ...(family ? [{ memberId: null }] : [])],
          },
        })
      : null;
    if (input.id && !old) throw new InputError('예산을 찾을 수 없습니다.');
    if (input.categoryId && !(await tx.category.findUnique({ where: { id: input.categoryId } })))
      throw new InputError('분류를 찾을 수 없습니다.');
    const data = {
      memberId: input.memberId || null,
      categoryId: input.categoryId || null,
      month: input.month,
      amount: input.amount,
    };
    const existing =
      old ??
      (await tx.budget.findFirst({
        where: {
          ...data,
          amount: undefined,
          OR: [{ memberId: { in: visible } }, ...(family ? [{ memberId: null }] : [])],
        },
      }));
    const saved = existing
      ? await tx.budget.update({ where: { id: existing.id }, data })
      : await tx.budget.create({ data });
    await tx.reviewDecision.create({
      data: {
        memberId: input.memberId ?? session.memberId,
        actorMemberId: session.memberId,
        action: 'SAVE_BUDGET',
        entityId: saved.id,
        before: existing ? { amount: existing.amount, month: existing.month } : undefined,
        after: data,
      },
    });
    return saved;
  });
}
