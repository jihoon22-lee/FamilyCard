import type { PrismaClient, Prisma } from '@prisma/client';
import { visibleRawWhere } from '@/lib/raw';
import { prisma } from '@/lib/db';
import { visibleMemberIds } from '@/lib/auth/scope';
import type { AppSession } from '@/lib/auth/types';
import { InputError } from '@/lib/cards';
import { monthRange, currentKstMonth } from '@/lib/time';
import { netAmount } from '@/lib/reconciliation';
export function shiftedMonth(month: string, offset: number) {
  monthRange(month);
  const [year, m] = month.split('-').map(Number);
  return new Date(Date.UTC(year!, m! - 1 + offset, 1)).toISOString().slice(0, 7);
}
export async function analyticsScope(session: AppSession, memberId?: string) {
  const visible = await visibleMemberIds(session);
  if (memberId && !visible.includes(memberId))
    throw new InputError('이 구성원을 조회할 수 없습니다.');
  return { visible, selected: memberId ? [memberId] : visible };
}
function net(sum: { amount: number | null; canceledAmount: number | null }) {
  return netAmount({ amount: sum.amount ?? 0, canceledAmount: sum.canceledAmount ?? 0 })!;
}
export async function analytics(
  session: AppSession,
  params: { month?: string; memberId?: string } = {},
  db: PrismaClient = prisma,
) {
  const { selected } = await analyticsScope(session, params.memberId);
  let month = params.month ?? currentKstMonth();
  try {
    monthRange(month);
  } catch {
    month = currentKstMonth();
  }
  const range = monthRange(month),
    scope = { memberId: { in: selected } },
    where = { ...scope, approvedAt: { gte: range.start, lt: range.end } },
    confirmed = { ...where, txType: 'APPROVAL' as const, state: 'CONFIRMED' as const };
  const [groups, categories, members, cards, pending, devices, budgets, categoryNames] =
    await Promise.all([
      db.transaction.groupBy({
        by: ['memberId', 'cardId'],
        where: confirmed,
        _sum: { amount: true, canceledAmount: true },
        _count: true,
      }),
      db.transaction.groupBy({
        by: ['memberId', 'categoryId'],
        where: confirmed,
        _sum: { amount: true, canceledAmount: true },
        _count: true,
      }),
      db.familyMember.findMany({
        where: { id: { in: selected } },
        select: { id: true, name: true, displayColor: true },
        orderBy: { name: 'asc' },
      }),
      db.card.findMany({
        where: scope,
        select: {
          id: true,
          memberId: true,
          nickname: true,
          last4: true,
          benefitRule: { select: { id: true } },
        },
        orderBy: { nickname: 'asc' },
      }),
      db.transaction.groupBy({
        by: ['memberId'],
        where: {
          ...where,
          state: { not: 'MERGED' },
          OR: [{ state: 'REVIEW' }, { isOrphanCancellation: true }, { amount: null }],
        },
        _count: true,
      }),
      db.device.findMany({
        where: { ...scope, revokedAt: null },
        select: {
          id: true,
          memberId: true,
          deviceName: true,
          statusReportedAt: true,
          lastSeenAt: true,
          statusSnapshot: true,
        },
      }),
      db.budget.findMany({
        where: {
          month,
          OR: [
            { memberId: { in: selected } },
            ...(session.scope === 'FAMILY' && !params.memberId ? [{ memberId: null }] : []),
          ],
        },
        include: { category: { select: { name: true } }, member: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      db.category.findMany({ select: { id: true, name: true } }),
    ]);
  const rawScope = await visibleRawWhere(session);
  const reviewCounts: Array<{ memberId: string; count: number }> = [];
  for (const member of members)
    reviewCounts.push({
      memberId: member.id,
      count: await db.rawMessage.count({
        where: {
          AND: [
            rawScope,
            {
              OR: [
                { device: { memberId: member.id } },
                { deviceId: null, ownerMemberId: member.id },
              ],
            },
            {
              OR: [
                { parseStatus: { in: ['FAILED', 'NEEDS_CARD'] } },
                { processingJob: { state: 'FAILED' } },
                {
                  evidence: {
                    transaction: {
                      memberId: { in: selected },
                      OR: [{ state: 'REVIEW' }, { isOrphanCancellation: true }],
                    },
                  },
                },
              ],
            },
          ],
        },
      }),
    });
  const months = Array.from({ length: 13 }, (_, i) => shiftedMonth(month, i - 12)),
    trend: Array<{ month: string; net: number }> = [];
  // Sequential aggregates keep the DB pool and memory bounded on the small home server.
  for (const m of months) {
    const r = monthRange(m);
    const sums = await db.transaction.aggregate({
      where: {
        ...scope,
        txType: 'APPROVAL',
        state: 'CONFIRMED',
        approvedAt: { gte: r.start, lt: r.end },
      },
      _sum: { amount: true, canceledAmount: true },
    });
    trend.push({ month: m, net: net(sums._sum) });
  }
  const rows = groups.map((g) => ({ ...g, net: net(g._sum) }));
  const categoryRows = categories.map((g) => ({
    ...g,
    net: net(g._sum),
    name: categoryNames.find((c) => c.id === g.categoryId)?.name ?? '미분류',
  }));
  const total = rows.reduce((sum, g) => sum + g.net, 0);
  if (!Number.isSafeInteger(total)) throw new Error('Unsafe aggregate');
  return {
    month,
    members,
    cards,
    rows,
    total,
    categoryRows,
    pending,
    reviewCounts,
    devices,
    trend,
    previous: trend[11]?.net ?? 0,
    lastYear: trend[0]?.net ?? 0,
    budgets: budgets.map((b) => {
      const used = categoryRows
        .filter(
          (c) =>
            (!b.memberId || c.memberId === b.memberId) &&
            (!b.categoryId || c.categoryId === b.categoryId),
        )
        .reduce((s, c) => s + c.net, 0);
      return { ...b, used, over: Math.max(0, used - b.amount) };
    }),
  };
}
export async function reportRows(
  session: AppSession,
  params: { month: string; memberId?: string },
  db: PrismaClient = prisma,
) {
  const { selected } = await analyticsScope(session, params.memberId),
    range = monthRange(params.month);
  const where: Prisma.TransactionWhereInput = {
    memberId: { in: selected },
    state: { not: 'MERGED' },
    approvedAt: { gte: range.start, lt: range.end },
  };
  const rows = await db.transaction.findMany({
    where,
    select: {
      id: true,
      memberId: true,
      member: { select: { name: true } },
      card: { select: { nickname: true, last4: true } },
      approvedAt: true,
      merchantName: true,
      amount: true,
      canceledAmount: true,
      txType: true,
      state: true,
      isOrphanCancellation: true,
      category: { select: { name: true } },
    },
    orderBy: [{ approvedAt: 'asc' }, { id: 'asc' }],
    take: 10001,
  });
  if (rows.length > 10000)
    throw new InputError('보고서는 월 10,000건까지 지원합니다. 구성원별로 나눠 조회해주세요.');
  return rows;
}
