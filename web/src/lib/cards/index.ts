import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import { visibleMemberIds } from '@/lib/auth/scope';
import type { AppSession } from '@/lib/auth/types';
import { kstDayStart } from '@/lib/time';
export class InputError extends Error {}
export interface CardInput {
  id?: string;
  memberId: string;
  issuer: string;
  nickname: string;
  last4: string;
  cardType: string;
  statementDay: number;
  isActive: boolean;
  validFrom?: string;
  validTo?: string;
}
export async function listCards(session: AppSession, db: PrismaClient = prisma) {
  const visible = await visibleMemberIds(session);
  return db.card.findMany({
    where: { memberId: { in: visible } },
    include: { member: { select: { name: true } }, aliases: true },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
  });
}
export async function saveCard(session: AppSession, input: CardInput, db: PrismaClient = prisma) {
  const visible = await visibleMemberIds(session);
  if (!visible.includes(input.memberId))
    throw new InputError('해당 구성원의 카드를 관리할 수 없습니다.');
  const issuer = input.issuer.trim().toUpperCase(),
    nickname = input.nickname.trim(),
    last4 = input.last4.trim();
  if (
    !/^[A-Z0-9_-]{1,40}$/.test(issuer) ||
    !nickname ||
    nickname.length > 80 ||
    !/^[0-9]{4}$/.test(last4) ||
    !['CREDIT', 'DEBIT'].includes(input.cardType) ||
    !Number.isInteger(input.statementDay) ||
    input.statementDay < 1 ||
    input.statementDay > 31
  )
    throw new InputError('카드사 코드·이름·끝 4자리·결제일을 확인해주세요.');
  let from: Date | null = null,
    to: Date | null = null;
  try {
    from = input.validFrom ? kstDayStart(input.validFrom) : null;
    to = input.validTo ? kstDayStart(input.validTo) : null;
  } catch {
    throw new InputError('유효 기간 날짜를 확인해주세요.');
  }
  if (from && to && from >= to) throw new InputError('종료일은 시작일 이후여야 합니다.');
  const data = {
    memberId: input.memberId,
    issuer,
    nickname,
    last4,
    cardType: input.cardType as 'CREDIT' | 'DEBIT',
    statementDay: input.statementDay,
    isActive: input.isActive,
    validFrom: from,
    validTo: to,
  };
  return db.$transaction(async (tx) => {
    const existing = input.id
      ? await tx.card.findFirst({ where: { id: input.id, memberId: { in: visible } } })
      : null;
    if (input.id && (!existing || existing.memberId !== input.memberId))
      throw new InputError('카드를 찾을 수 없습니다.');
    const card = existing
      ? await tx.card.update({ where: { id: existing.id }, data })
      : await tx.card.create({ data });
    await tx.reviewDecision.create({
      data: {
        memberId: card.memberId,
        actorMemberId: session.memberId,
        action: existing ? 'UPDATE_CARD' : 'CREATE_CARD',
        entityId: card.id,
        before: existing
          ? {
              issuer: existing.issuer,
              last4: existing.last4,
              nickname: existing.nickname,
              isActive: existing.isActive,
            }
          : undefined,
        after: { issuer, last4, nickname, isActive: input.isActive },
      },
    });
    return card;
  });
}
export async function saveAlias(
  session: AppSession,
  input: { cardId: string; token: string; validFrom?: string; validTo?: string },
  db: PrismaClient = prisma,
) {
  const visible = await visibleMemberIds(session);
  const token = input.token;
  if (!token.trim() || token.length > 100) throw new InputError('표기를 1~100자로 입력해주세요.');
  let from: Date | null, to: Date | null;
  try {
    from = input.validFrom ? kstDayStart(input.validFrom) : null;
    to = input.validTo ? kstDayStart(input.validTo) : null;
  } catch {
    throw new InputError('유효 기간을 확인해주세요.');
  }
  if (from && to && from >= to) throw new InputError('유효 기간을 확인해주세요.');
  return db.$transaction(async (tx) => {
    const card = await tx.card.findFirst({
      where: { id: input.cardId, memberId: { in: visible } },
      select: { id: true, memberId: true },
    });
    if (!card) throw new InputError('카드를 찾을 수 없습니다.');
    const existing = await tx.cardAlias.findFirst({
      where: { cardId: card.id, token, card: { memberId: { in: visible } } },
    });
    const data = { token, validFrom: from, validTo: to };
    const alias = existing
      ? await tx.cardAlias.update({ where: { id: existing.id }, data })
      : await tx.cardAlias.create({ data: { ...data, cardId: card.id, aliasType: 'RAW_TOKEN' } });
    await tx.reviewDecision.create({
      data: {
        memberId: card.memberId,
        actorMemberId: session.memberId,
        action: 'SAVE_ALIAS',
        entityId: alias.id,
        after: {
          cardId: card.id,
          token,
          validFrom: from?.toISOString() ?? null,
          validTo: to?.toISOString() ?? null,
        },
      },
    });
    return alias;
  });
}
