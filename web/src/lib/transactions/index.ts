import { scopedSpendingStatus } from '@/lib/spending-status';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import { visibleMemberIds } from '@/lib/auth/scope';
import type { AppSession } from '@/lib/auth/types';
import { currentKstMonth, monthRange } from '@/lib/time';
import { netAmount } from '@/lib/reconciliation';
export async function monthlyTransactions(
  session: AppSession,
  params: {
    month?: string;
    cardId?: string;
    page?: number;
    issuer?: string;
    token?: string;
    memberId?: string;
  } = {},
  db: PrismaClient = prisma,
) {
  const visible = await visibleMemberIds(session);
  let month = params.month ?? currentKstMonth(),
    range;
  try {
    range = monthRange(month);
  } catch {
    month = currentKstMonth();
    range = monthRange(month);
  }
  const page =
    Number.isSafeInteger(params.page) && params.page! > 0 && params.page! <= 100000
      ? params.page!
      : 1;
  const where = {
    memberId: { in: visible },
    approvedAt: { gte: range.start, lt: range.end },
    state: { not: 'MERGED' as const },
    ...(params.cardId
      ? { cardId: params.cardId }
      : params.issuer
        ? {
            cardId: null,
            issuer: params.issuer,
            ...(params.token !== undefined ? { cardToken: params.token } : {}),
          }
        : {}),
    ...(params.memberId && !params.cardId ? { AND: { memberId: params.memberId } } : {}),
  };
  const confirmed = {
    ...where,
    state: 'CONFIRMED' as const,
    txType: 'APPROVAL' as const,
    amount: { not: null },
  };
  const [items, total, groups, pending, unknownAmount, cards, observedGroups, members] =
    await Promise.all([
      db.transaction.findMany({
        where,
        include: {
          card: { select: { nickname: true, last4: true } },
          member: { select: { name: true } },
          _count: { select: { evidence: true } },
        },
        orderBy: [{ approvedAt: 'desc' }, { id: 'desc' }],
        take: 50,
        skip: (page - 1) * 50,
      }),
      db.transaction.count({ where }),
      db.transaction.groupBy({
        by: ['cardId'],
        where: confirmed,
        _sum: { amount: true, canceledAmount: true },
        _count: true,
      }),
      db.transaction.count({
        where: { ...where, OR: [{ state: 'REVIEW' as const }, { isOrphanCancellation: true }] },
      }),
      db.transaction.count({ where: { ...where, amount: null } }),
      db.card.findMany({
        where: { memberId: { in: visible } },
        select: { id: true, nickname: true, last4: true, member: { select: { name: true } } },
        orderBy: { nickname: 'asc' },
      }),
      db.transaction.groupBy({
        by: ['memberId', 'issuer', 'cardToken'],
        where: { ...confirmed, cardId: params.cardId ?? null },
        _sum: { amount: true, canceledAmount: true },
        _count: true,
      }),
      db.familyMember.findMany({
        where: { id: { in: visible } },
        select: { id: true, name: true },
      }),
    ]);
  const observedTotals = params.cardId
    ? []
    : observedGroups.map((g) => ({
        memberId: g.memberId,
        memberName: members.find((m) => m.id === g.memberId)?.name ?? '',
        issuer: g.issuer,
        token: g.cardToken,
        count: g._count,
        net: netAmount({ amount: g._sum.amount ?? 0, canceledAmount: g._sum.canceledAmount ?? 0 })!,
      }));
  const totals = groups.map((g) => {
    const amount = g._sum.amount ?? 0,
      canceledAmount = g._sum.canceledAmount ?? 0;
    if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(canceledAmount))
      throw new Error('Unsafe aggregate');
    return { cardId: g.cardId, count: g._count, net: netAmount({ amount, canceledAmount })! };
  });
  const net = totals.reduce((sum, t) => sum + t.net, 0);
  if (!Number.isSafeInteger(net)) throw new Error('Unsafe aggregate');
  const status = await scopedSpendingStatus(
    session,
    groups.reduce((sum, g) => sum + g._count, 0),
    pending + unknownAmount,
    db,
  );
  return {
    status,
    items,
    total,
    totals,
    observedTotals,
    net,
    pending,
    unknownAmount,
    cards,
    month,
    page,
    totalPages: Math.max(1, Math.ceil(total / 50)),
  };
}
