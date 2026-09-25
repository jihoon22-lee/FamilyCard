import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { serializable } from '@/lib/database';
import { prisma } from '@/lib/db';
import { visibleMemberIds } from '@/lib/auth/scope';
import { visibleRawWhere } from '@/lib/raw';
import type { AppSession } from '@/lib/auth/types';
import { InputError } from '@/lib/cards';
import { refreshCardProjection } from '@/lib/processing';
import { kstLocalDateTime } from '@/lib/time';

export interface ManualInput {
  rawId?: string;
  memberId?: string;
  requestId?: string;
  cardId?: string;
  amount: number;
  approvedAt: string;
  merchantName: string;
  txType: string;
  originalTransactionId?: string;
}
const snapshot = (row: {
  id: string;
  cardId: string | null;
  amount: number | null;
  approvedAt: Date;
  merchantName: string;
  txType: string;
}) => ({
  id: row.id,
  cardId: row.cardId,
  amount: row.amount,
  approvedAt: row.approvedAt.toISOString(),
  merchantName: row.merchantName,
  txType: row.txType,
});
export async function saveManualTransaction(
  session: AppSession,
  input: ManualInput,
  db: PrismaClient = prisma,
) {
  const visible = await visibleMemberIds(session),
    scope = await visibleRawWhere(session);
  if (
    !Number.isInteger(input.amount) ||
    input.amount < 0 ||
    input.amount > 2147483647 ||
    !['APPROVAL', 'CANCELLATION'].includes(input.txType) ||
    input.merchantName.length > 300
  )
    throw new InputError('금액·거래 종류·가맹점을 확인해주세요.');
  let approvedAt: Date;
  try {
    approvedAt = kstLocalDateTime(input.approvedAt);
  } catch {
    throw new InputError('거래 시각을 한국 시간으로 입력해주세요.');
  }
  if (approvedAt.getTime() > Date.now() + 86400000) throw new InputError('거래 시각이 미래입니다.');
  return serializable(db, async (tx) => {
    let raw = input.rawId
      ? await tx.rawMessage.findFirst({
          where: { ...scope, id: input.rawId },
          include: {
            device: { select: { memberId: true } },
            evidence: { include: { transaction: true } },
            transaction: true,
          },
        })
      : null;
    if (input.rawId && !raw) throw new InputError('원문을 찾을 수 없습니다.');
    const memberId = raw ? (raw.device?.memberId ?? raw.ownerMemberId) : input.memberId;
    if (!memberId || !visible.includes(memberId))
      throw new InputError('이 구성원의 거래를 변경할 수 없습니다.');
    const card = input.cardId
      ? await tx.card.findFirst({
          where: { id: input.cardId, memberId: { in: visible }, AND: { memberId } },
          select: { id: true, issuer: true },
        })
      : null;
    if (input.cardId && !card) throw new InputError('같은 구성원의 카드를 선택해주세요.');
    if (!raw) {
      if (!input.requestId || !/^[-a-zA-Z0-9]{16,100}$/.test(input.requestId))
        throw new InputError('입력 화면을 새로 열어주세요.');
      const body = JSON.stringify({
        amount: input.amount,
        approvedAt: approvedAt.toISOString(),
        merchantName: input.merchantName,
        txType: input.txType,
        cardId: card?.id ?? null,
      });
      const hash = createHash('sha256')
        .update(`manual|${memberId}|${input.requestId}`)
        .digest('hex');
      const previous = await tx.rawMessage.findFirst({
        where: { ...scope, dedupeHash: hash },
        include: {
          device: { select: { memberId: true } },
          evidence: { include: { transaction: true } },
          transaction: true,
        },
      });
      if (previous && previous.body !== body)
        throw new InputError('이미 처리한 입력입니다. 새 입력 화면에서 작성해주세요.');
      raw =
        previous ??
        (await tx.rawMessage.create({
          data: {
            ownerMemberId: memberId,
            clientMessageId: input.requestId,
            source: 'MANUAL',
            originKind: 'MANUAL_ENTRY',
            packageName: 'manual',
            title: '수동 입력',
            body,
            receivedAt: new Date(),
            dedupeHash: hash,
            processingJob: { create: { state: 'DONE' } },
          },
          include: {
            device: { select: { memberId: true } },
            evidence: { include: { transaction: true } },
            transaction: true,
          },
        }));
    }
    const existing = raw.evidence?.transaction ?? raw.transaction;
    if (existing && (existing.memberId !== memberId || existing.state === 'MERGED'))
      throw new InputError('현재 거래의 근거 화면에서 수정해주세요.');
    const original = input.originalTransactionId
      ? await tx.transaction.findFirst({
          where: {
            id: input.originalTransactionId,
            memberId: { in: visible },
            AND: { memberId },
            cardId: card?.id ?? null,
            txType: 'APPROVAL',
            state: 'CONFIRMED',
          },
        })
      : null;
    if (input.originalTransactionId && (!original || !card || input.txType !== 'CANCELLATION'))
      throw new InputError('같은 카드의 확정 원거래를 선택해주세요.');
    const data = {
      amount: input.amount,
      approvedAt,
      merchantName: input.merchantName.trim(),
      txType: input.txType as 'APPROVAL' | 'CANCELLATION',
      cardId: card?.id ?? null,
      issuer: card?.issuer ?? existing?.issuer ?? null,
      isManuallyEdited: true,
      state: card ? ('CONFIRMED' as const) : ('REVIEW' as const),
      reviewReason: card ? null : 'NO_CARD',
      timePrecision: 'MINUTE' as const,
      canceledAmount: 0,
      canceledTxId:
        original?.id ?? (input.txType === 'CANCELLATION' ? existing?.canceledTxId : null) ?? null,
      isOrphanCancellation: input.txType === 'CANCELLATION',
    };
    const saved = existing
      ? await tx.transaction.update({ where: { id: existing.id }, data })
      : await tx.transaction.create({ data: { ...data, memberId, rawMessageId: raw.id } });
    await tx.transactionEvidence.upsert({
      where: { rawMessageId: raw.id },
      create: { transactionId: saved.id, rawMessageId: raw.id, isManual: true },
      update: { isManual: true },
    });
    await tx.rawMessage.update({
      where: { id: raw.id },
      data: {
        parseStatus: card ? 'PARSED' : 'NEEDS_CARD',
        parseReason: card ? null : 'NO_CARD',
        processedAt: new Date(),
      },
    });
    // A manual card selection teaches the exact observed token, never guessed digits.
    const fields = raw.parsedFields as Record<string, unknown> | null;
    const token = typeof fields?.cardToken === 'string' ? fields.cardToken : null;
    if (card && token && token.length <= 100) {
      const alias = await tx.cardAlias.findFirst({
        where: { cardId: card.id, token, card: { memberId: { in: visible } } },
      });
      if (!alias)
        await tx.cardAlias.create({ data: { cardId: card.id, token, aliasType: 'RAW_TOKEN' } });
    }
    if (existing?.cardId && existing.cardId !== card?.id)
      await refreshCardProjection(tx, memberId, existing.cardId, visible, [existing]);
    if (card)
      await refreshCardProjection(tx, memberId, card.id, visible, [
        ...(existing ? [existing] : []),
        saved,
      ]);
    const final = await tx.transaction.findFirstOrThrow({
      where: { id: saved.id, memberId: { in: visible } },
    });
    if (original && final.canceledTxId !== original.id)
      throw new InputError('원거래의 날짜·잔여액을 확인해주세요. 변경은 저장하지 않았습니다.');
    await tx.reviewDecision.create({
      data: {
        memberId,
        actorMemberId: session.memberId,
        action: 'MANUAL_TRANSACTION',
        entityId: saved.id,
        before: existing ? snapshot(existing) : undefined,
        after: snapshot(final),
      },
    });
    return final;
  });
}

export async function mergeTransactions(
  session: AppSession,
  primaryId: string,
  secondaryId: string,
  db: PrismaClient = prisma,
) {
  const visible = await visibleMemberIds(session);
  if (!primaryId || primaryId === secondaryId)
    throw new InputError('서로 다른 두 거래를 선택해주세요.');
  return serializable(db, async (tx) => {
    const rows = await tx.transaction.findMany({
      where: {
        id: { in: [primaryId, secondaryId] },
        memberId: { in: visible },
        state: { not: 'MERGED' },
      },
    });
    const a = rows.find((t) => t.id === primaryId),
      b = rows.find((t) => t.id === secondaryId);
    if (
      !a ||
      !b ||
      a.memberId !== b.memberId ||
      !a.cardId ||
      a.cardId !== b.cardId ||
      a.txType !== b.txType ||
      a.amount !== b.amount ||
      a.currency !== b.currency ||
      a.foreignAmount !== b.foreignAmount ||
      a.foreignScale !== b.foreignScale
    )
      throw new InputError('같은 구성원·카드·종류·금액·통화의 두 거래만 합칠 수 있습니다.');
    await tx.transactionEvidence.updateMany({
      where: { transactionId: b.id, transaction: { memberId: { in: visible } } },
      data: { transactionId: a.id, isManual: true },
    });
    await tx.transaction.update({
      where: { id: b.id },
      data: { state: 'MERGED', mergedIntoId: a.id, isManuallyEdited: true },
    });
    await tx.transaction.update({
      where: { id: a.id },
      data: { isManuallyEdited: true, state: 'CONFIRMED', reviewReason: null },
    });
    await tx.transaction.updateMany({
      where: {
        memberId: { in: visible },
        AND: { memberId: a.memberId },
        cardId: a.cardId,
        canceledTxId: b.id,
      },
      data: { canceledTxId: a.id },
    });
    await refreshCardProjection(tx, a.memberId, a.cardId, visible, [a, b]);
    await tx.reviewDecision.create({
      data: {
        memberId: a.memberId,
        actorMemberId: session.memberId,
        action: 'MERGE',
        entityId: a.id,
        before: { primary: snapshot(a), secondary: snapshot(b) },
        after: { primaryId: a.id, mergedId: b.id },
      },
    });
    return a.id;
  });
}

export async function splitEvidence(session: AppSession, rawId: string, db: PrismaClient = prisma) {
  const visible = await visibleMemberIds(session),
    scope = await visibleRawWhere(session);
  return serializable(db, async (tx) => {
    const raw = await tx.rawMessage.findFirst({
      where: { ...scope, id: rawId },
      select: { id: true, evidence: { select: { transactionId: true } } },
    });
    if (!raw?.evidence) throw new InputError('연결된 원문을 찾을 수 없습니다.');
    const base = await tx.transaction.findFirst({
      where: {
        id: raw.evidence.transactionId,
        memberId: { in: visible },
        state: { not: 'MERGED' },
      },
      include: { evidence: { orderBy: { createdAt: 'asc' } } },
    });
    if (!base || base.evidence.length < 2)
      throw new InputError('근거가 두 개 이상인 거래에서 분리할 수 있습니다.');
    // Keep representative rawMessageId stable: splitting it moves all other evidence together.
    // The review form explicitly describes this grouping before confirmation (R05).
    const moved =
      base.rawMessageId === rawId
        ? base.evidence.filter((e) => e.rawMessageId !== rawId)
        : base.evidence.filter((e) => e.rawMessageId === rawId);
    const representative = moved[0]!.rawMessageId;
    const old = await tx.transaction.findFirst({
      where: { rawMessageId: representative, memberId: { in: visible } },
    });
    if (old && (old.memberId !== base.memberId || old.state !== 'MERGED'))
      throw new InputError('이미 별도 거래로 사용 중인 원문입니다.');
    const data = {
      memberId: base.memberId,
      cardId: base.cardId,
      amount: base.amount,
      txType: base.txType,
      approvedAt: base.approvedAt,
      originalApprovedAt: base.originalApprovedAt,
      timePrecision: base.timePrecision,
      merchantName: base.merchantName,
      installmentMonths: base.installmentMonths,
      categoryId: old?.categoryId ?? base.categoryId,
      categoryManual: old?.categoryManual ?? base.categoryManual,
      benefitOverride: old?.benefitOverride ?? base.benefitOverride,
      currency: base.currency,
      foreignAmount: base.foreignAmount,
      foreignScale: base.foreignScale,
      issuer: base.issuer,
      cardToken: base.cardToken,
      approvalReference: base.approvalReference,
      state: base.cardId && base.amount !== null ? ('CONFIRMED' as const) : ('REVIEW' as const),
      reviewReason: base.cardId ? null : 'NO_CARD',
      isManuallyEdited: true,
      mergedIntoId: null,
      canceledAmount: 0,
      canceledTxId: null,
      isOrphanCancellation: base.txType === 'CANCELLATION',
    };
    const separate = old
      ? await tx.transaction.update({ where: { id: old.id }, data })
      : await tx.transaction.create({ data: { ...data, rawMessageId: representative } });
    await tx.transactionEvidence.updateMany({
      where: { id: { in: moved.map((e) => e.id) }, transaction: { memberId: { in: visible } } },
      data: { transactionId: separate.id, isManual: true },
    });
    await tx.transactionEvidence.updateMany({
      where: { transactionId: base.id, transaction: { memberId: { in: visible } } },
      data: { isManual: true },
    });
    await tx.transaction.update({ where: { id: base.id }, data: { isManuallyEdited: true } });
    if (base.cardId)
      await refreshCardProjection(tx, base.memberId, base.cardId, visible, [base, separate]);
    await tx.reviewDecision.create({
      data: {
        memberId: base.memberId,
        actorMemberId: session.memberId,
        action: 'SPLIT',
        entityId: base.id,
        before: { rawIds: base.evidence.map((e) => e.rawMessageId) },
        after: { separateId: separate.id, movedRawIds: moved.map((e) => e.rawMessageId) },
      },
    });
    return separate.id;
  });
}
export function manualRequestId() {
  return randomUUID();
}
