import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import { visibleMemberIds } from '@/lib/auth/scope';
import type { AppSession } from '@/lib/auth/types';
import { InputError } from '@/lib/cards';
import { serializable } from '@/lib/database';
import { refreshCardProjection } from '@/lib/processing';
import { netAmount } from '@/lib/reconciliation';
const issuers: Record<string, string> = {
  KB: 'KB국민카드',
  HANA: '하나카드',
  SAMSUNG: '삼성카드',
  LOTTE: '롯데카드',
  SHINHAN: '신한카드',
  HYUNDAI: '현대카드',
  WOORI: '우리카드',
  NH: 'NH농협카드',
  BC: 'BC카드',
};
export function observedCardLabel(issuer: string | null, token: string | null) {
  return `${issuer ? (issuers[issuer] ?? issuer) : '카드사 미확인'} · ${token?.trim() || '번호 미확인'}`;
}
export async function observedCards(session: AppSession, db: PrismaClient = prisma) {
  const visible = await visibleMemberIds(session);
  const [groups, members] = await Promise.all([
    db.transaction.groupBy({
      by: ['memberId', 'issuer', 'cardToken', 'state', 'txType'],
      where: { memberId: { in: visible }, cardId: null, state: { not: 'MERGED' } },
      _sum: { amount: true, canceledAmount: true },
      _count: true,
    }),
    db.familyMember.findMany({ where: { id: { in: visible } }, select: { id: true, name: true } }),
  ]);
  const result = new Map<
    string,
    {
      key: string;
      memberId: string;
      memberName: string;
      issuer: string | null;
      token: string | null;
      count: number;
      net: number;
      hasKnownApproval: boolean;
    }
  >();
  for (const group of groups) {
    const key = JSON.stringify([group.memberId, group.issuer, group.cardToken]);
    const row = result.get(key) ?? {
      key,
      memberId: group.memberId,
      memberName: members.find((m) => m.id === group.memberId)?.name ?? '',
      issuer: group.issuer,
      token: group.cardToken,
      count: 0,
      net: 0,
      hasKnownApproval: false,
    };
    row.count += group._count;
    if (group.state === 'CONFIRMED' && group.txType === 'APPROVAL' && group._sum.amount !== null)
      row.hasKnownApproval = true;
    if (group.state === 'CONFIRMED' && group.txType === 'APPROVAL')
      row.net += netAmount({
        amount: group._sum.amount ?? 0,
        canceledAmount: group._sum.canceledAmount ?? 0,
      })!;
    if (!Number.isSafeInteger(row.net)) throw Error('Unsafe aggregate');
    result.set(key, row);
  }
  return [...result.values()].sort(
    (a, b) =>
      a.memberName.localeCompare(b.memberName) ||
      observedCardLabel(a.issuer, a.token).localeCompare(observedCardLabel(b.issuer, b.token)),
  );
}
/** Explicit user selection connects an observed token, without guessing hidden digits or products. */
export async function linkObservedCard(
  session: AppSession,
  input: { memberId: string; issuer: string; token: string; cardId: string },
  db: PrismaClient = prisma,
) {
  const visible = await visibleMemberIds(session);
  if (
    !visible.includes(input.memberId) ||
    !input.token.trim() ||
    input.token.length > 100 ||
    !input.issuer ||
    input.issuer.length > 40
  )
    throw new InputError('연결할 카드사와 번호 표기를 확인해주세요.');
  return serializable(db, async (tx) => {
    const owner = { memberId: { in: visible }, AND: { memberId: input.memberId } };
    const card = await tx.card.findFirst({
      where: { ...owner, id: input.cardId, issuer: input.issuer, isActive: true },
    });
    if (!card) throw new InputError('같은 구성원·카드사의 사용 중인 카드를 선택해주세요.');
    const conflict = await tx.cardAlias.findFirst({
      where: {
        token: input.token,
        cardId: { not: card.id },
        card: { ...owner, issuer: input.issuer },
      },
    });
    if (conflict)
      throw new InputError(
        '이미 다른 카드에 연결된 표기입니다. 카드 표기 관리에서 기존 연결을 확인해주세요.',
      );
    const rows = await tx.transaction.findMany({
      where: { ...owner, issuer: input.issuer, cardToken: input.token, cardId: null },
      take: 10001,
    });
    if (rows.length > 10000)
      throw new InputError('연결 대상이 너무 많습니다. 관리자에게 기간별 연결을 요청해주세요.');
    if (!rows.length)
      throw new InputError('이미 연결되었거나 해당 알림 묶음이 없습니다. 새로고침해주세요.');
    const ids = rows.map((r) => r.id);
    const fixed = await tx.transaction.findMany({
      where: {
        ...owner,
        isManuallyEdited: true,
        OR: [
          { canceledTxId: { in: ids } },
          { id: { in: rows.flatMap((r) => (r.canceledTxId ? [r.canceledTxId] : [])) } },
        ],
      },
      select: { id: true, canceledTxId: true },
    });
    const protectedIds = new Set(
      fixed.flatMap((r) => [r.id, ...(r.canceledTxId ? [r.canceledTxId] : [])]),
    );
    const edges = new Map<string, string[]>();
    for (const row of rows) {
      if (row.isManuallyEdited) protectedIds.add(row.id);
      if (row.canceledTxId) {
        edges.set(row.id, [...(edges.get(row.id) ?? []), row.canceledTxId]);
        edges.set(row.canceledTxId, [...(edges.get(row.canceledTxId) ?? []), row.id]);
      }
    }
    const pending = [...protectedIds];
    for (let i = 0; i < pending.length; i++)
      for (const id of edges.get(pending[i]!) ?? []) {
        if (!protectedIds.has(id)) {
          protectedIds.add(id);
          pending.push(id);
        }
      }
    const movable = rows.filter(
      (r) =>
        !r.isManuallyEdited &&
        !protectedIds.has(r.id) &&
        (!card.validFrom || r.approvedAt >= card.validFrom) &&
        (!card.validTo || r.approvedAt < card.validTo),
    );
    const alias = await tx.cardAlias.findFirst({
      where: { cardId: card.id, token: input.token, card: owner },
    });
    if (alias)
      await tx.cardAlias.update({
        where: { id: alias.id },
        data: { validFrom: card.validFrom, validTo: card.validTo },
      });
    else
      await tx.cardAlias.create({
        data: {
          cardId: card.id,
          token: input.token,
          aliasType: 'RAW_TOKEN',
          validFrom: card.validFrom,
          validTo: card.validTo,
        },
      });
    await tx.transaction.updateMany({
      where: { ...owner, id: { in: movable.map((r) => r.id) }, cardId: null },
      data: { cardId: card.id },
    });
    if (movable.length) {
      await refreshCardProjection(tx, card.memberId, null, visible, movable);
      await refreshCardProjection(
        tx,
        card.memberId,
        card.id,
        visible,
        movable.map((r) => ({ ...r, cardId: card.id })),
      );
    }
    await tx.reviewDecision.create({
      data: {
        memberId: card.memberId,
        actorMemberId: session.memberId,
        action: 'LINK_OBSERVED_CARD',
        entityId: card.id,
        after: {
          issuer: input.issuer,
          token: input.token,
          linked: movable.length,
          skipped: rows.length - movable.length,
        },
      },
    });
    return { linked: movable.length, skipped: rows.length - movable.length };
  });
}
