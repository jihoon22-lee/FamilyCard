import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import { visibleMemberIds } from '@/lib/auth/scope';
import { visibleRawWhere } from '@/lib/raw';
import type { AppSession } from '@/lib/auth/types';
function reviewNeeds(visible: string[]): Prisma.RawMessageWhereInput {
  return {
    parseStatus: { not: 'IGNORED' },
    OR: [
      { parseStatus: { in: ['FAILED', 'NEEDS_CARD'] } },
      { processingJob: { state: 'FAILED' } },
      { parseReason: { not: null } },
      {
        evidence: {
          transaction: {
            memberId: { in: visible },
            OR: [{ state: 'REVIEW' }, { isOrphanCancellation: true }],
          },
        },
      },
    ],
  };
}
export async function reviewCount(session: AppSession, db: PrismaClient = prisma) {
  const visible = await visibleMemberIds(session),
    scope = await visibleRawWhere(session);
  return db.rawMessage.count({ where: { AND: [scope, reviewNeeds(visible)] } });
}
export async function reviewData(
  session: AppSession,
  page = 1,
  rawId?: string,
  db: PrismaClient = prisma,
) {
  const visible = await visibleMemberIds(session),
    scope = await visibleRawWhere(session);
  const needs = reviewNeeds(visible);
  const where: Prisma.RawMessageWhereInput = { AND: [scope, rawId ? { id: rawId } : needs] };
  const safePage = Number.isSafeInteger(page) && page >= 1 && page <= 100000 ? page : 1;
  const [raws, total, pending, failed, members, transactions] = await Promise.all([
    db.rawMessage.findMany({
      where,
      include: {
        device: { select: { memberId: true } },
        evidence: { select: { transactionId: true } },
        owner: { select: { name: true } },
        processingJob: { select: { state: true, lastError: true, attempts: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
      skip: (safePage - 1) * 20,
    }),
    db.rawMessage.count({ where }),
    db.processingJob.count({
      where: { rawMessage: scope, state: { in: ['PENDING', 'RUNNING'] } },
    }),
    db.processingJob.count({ where: { rawMessage: scope, state: 'FAILED' } }),
    db.familyMember.findMany({
      where: { id: { in: visible } },
      select: { id: true, name: true },
    }),
    db.transaction.findMany({
      where: { memberId: { in: visible }, state: { not: 'MERGED' } },
      orderBy: { approvedAt: 'desc' },
      take: 1000,
      include: {
        card: { select: { nickname: true, last4: true } },
        evidence: { select: { rawMessageId: true } },
      },
    }),
  ]);
  // Resolve listed raw links independently through transaction scope, even beyond the dropdown's latest 1000.
  const ids = raws.flatMap((raw) => (raw.evidence ? [raw.evidence.transactionId] : []));
  const linked = await db.transaction.findMany({
    where: { id: { in: ids }, memberId: { in: visible } },
    include: {
      card: { select: { nickname: true, last4: true } },
      evidence: { select: { rawMessageId: true } },
    },
  });
  return {
    raws,
    total,
    pending,
    failed,
    members,
    transactions,
    linked,
    page: safePage,
    totalPages: Math.max(1, Math.ceil(total / 20)),
  };
}
