import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import { serializable } from '@/lib/database';
import { visibleMemberIds } from '@/lib/auth/scope';
import type { AppSession } from '@/lib/auth/types';
import { InputError } from '@/lib/cards';
import { projectCancellations } from '@/lib/reconciliation';
/** Explicit administrative recovery; never used by normal ingest. Dry run by default. */
export async function repairCardProjection(
  session: AppSession,
  cardId: string,
  apply = false,
  db: PrismaClient = prisma,
) {
  if (session.entrypoint !== 'WEB' || session.role !== 'ADMIN' || session.scope !== 'FAMILY')
    throw new InputError('관리자 웹에서만 실행할 수 있습니다.');
  const visible = await visibleMemberIds(session);
  return serializable(db, async (tx) => {
    const card = await tx.card.findFirst({ where: { id: cardId, memberId: { in: visible } } });
    if (!card) throw new InputError('카드를 찾을 수 없습니다.');
    const rows = await tx.transaction.findMany({
      where: { cardId, memberId: { in: visible }, state: { not: 'MERGED' } },
      take: 100001,
    });
    if (rows.length > 100000) throw new InputError('복구 도구 상한 100,000건을 초과했습니다.');
    const projection = projectCancellations(
      rows.map((r) => ({
        ...r,
        sourceKeys: [],
        manualCancellationLink: r.isManuallyEdited && !!r.canceledTxId,
      })),
    );
    let changed = 0;
    for (const row of rows) {
      if (row.state !== 'CONFIRMED') continue;
      const data =
        row.txType === 'APPROVAL'
          ? { canceledAmount: projection.totals[row.id] ?? 0 }
          : {
              canceledTxId: projection.links[row.id] ?? null,
              isOrphanCancellation: !projection.links[row.id],
              reviewReason: projection.unresolved[row.id] ?? null,
            };
      if (Object.entries(data).some(([key, value]) => row[key as keyof typeof row] !== value)) {
        changed++;
        if (apply) await tx.transaction.update({ where: { id: row.id }, data });
      }
    }
    if (apply)
      await tx.reviewDecision.create({
        data: {
          memberId: card.memberId,
          actorMemberId: session.memberId,
          action: 'REBUILD_CANCELLATION',
          entityId: cardId,
          after: { scanned: rows.length, changed },
        },
      });
    return { dryRun: !apply, scanned: rows.length, changed };
  });
}
