import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import { visibleMemberIds } from '@/lib/auth/scope';
import { visibleRawWhere } from '@/lib/raw';
import type { AppSession } from '@/lib/auth/types';
import { InputError } from '@/lib/cards';
import { serializable } from '@/lib/database';
import { refreshCardProjection } from '@/lib/processing';
import { netAmount } from '@/lib/reconciliation';
import { kstDayStart } from '@/lib/time';
import { readStatementFile } from './file';
import { parseRow, validateMapping, type StatementMapping, type StatementFields } from './parse';
export { readStatementFile } from './file';
export type { StatementMapping } from './parse';
export async function importStatement(
  session: AppSession,
  fileName: string,
  bytes: Buffer,
  mapping: StatementMapping,
  remap = false,
  db: PrismaClient = prisma,
) {
  const visible = await visibleMemberIds(session),
    scope = await visibleRawWhere(session);
  const card = await db.card.findFirst({
    where: { id: mapping.cardId, memberId: { in: visible } },
  });
  if (!card) throw new InputError('본인 소유의 카드를 선택해주세요.');
  const parsed = await readStatementFile(fileName, bytes, mapping.encoding);
  validateMapping(mapping, parsed.headers.length);
  const name = fileName.replace(/[\\/\x00-\x1f]/g, '_').slice(0, 200),
    hash = createHash('sha256').update(bytes).digest('hex');
  return serializable(db, async (tx) => {
    const previous = await tx.statementImport.findFirst({
      select: { id: true, mapping: true },
      where: { memberId: { in: visible }, AND: { memberId: card.memberId }, fileHash: hash },
    });
    if (previous) {
      if (JSON.stringify(previous.mapping) === JSON.stringify(mapping) || !remap)
        return { id: previous.id, duplicate: true, rows: parsed.rows.length };
      const raws = await tx.rawMessage.findMany({
        where: { ...scope, statementImportId: previous.id },
        select: { id: true, clientMessageId: true, evidence: true, parseStatus: true },
      });
      for (const raw of raws) {
        if (raw.evidence || raw.parseStatus === 'IGNORED') continue;
        const index = Number(raw.clientMessageId.split(':').at(-1));
        const row = parsed.rows[index];
        if (!row) throw new InputError('행 출처를 확인해주세요.');
        const result = parseRow(row, mapping);
        await tx.rawMessage.update({
          where: { id: raw.id },
          data: {
            parsedFields: (result.fields as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            parseStatus: result.fields ? 'PENDING' : 'FAILED',
            parseReason: result.reason ?? 'STATEMENT_REVIEW',
          },
        });
      }
      await tx.statementImport.update({
        where: { id: previous.id },
        data: { mapping: mapping as unknown as Prisma.InputJsonValue },
      });
      await tx.reviewDecision.create({
        data: {
          memberId: card.memberId,
          actorMemberId: session.memberId,
          action: 'REMAP_STATEMENT',
          entityId: previous.id,
          before: previous.mapping ?? Prisma.JsonNull,
          after: mapping as unknown as Prisma.InputJsonValue,
        },
      });
      return { id: previous.id, duplicate: false, rows: parsed.rows.length };
    }
    const record = await tx.statementImport.create({
      data: {
        memberId: card.memberId,
        fileName: name,
        fileHash: hash,
        originalFile: new Uint8Array(bytes),
        mapping: mapping as unknown as Prisma.InputJsonValue,
      },
    });
    const raws = parsed.rows.map((row, index) => {
      const result = parseRow(row, mapping);
      return {
        id: randomUUID(),
        ownerMemberId: card.memberId,
        statementImportId: record.id,
        clientMessageId: record.id + ':' + String(index).padStart(5, '0'),
        source: 'STATEMENT' as const,
        originKind: 'STATEMENT_UPLOAD' as const,
        packageName: 'statement',
        title: '명세서 행 ' + (index + 2),
        body: JSON.stringify({ row: index + 2, headers: parsed.headers, values: row }),
        receivedAt: new Date(),
        dedupeHash: createHash('sha256').update(`${card.memberId}|${hash}|${index}`).digest('hex'),
        parsedFields: (result.fields as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        parseStatus: result.fields ? ('PENDING' as const) : ('FAILED' as const),
        parseReason: result.reason ?? 'STATEMENT_REVIEW',
      };
    });
    await tx.rawMessage.createMany({ data: raws });
    await tx.processingJob.createMany({
      data: raws.map((raw) => ({ rawMessageId: raw.id, state: 'DONE' as const })),
    });
    await tx.reviewDecision.create({
      data: {
        memberId: card.memberId,
        actorMemberId: session.memberId,
        action: 'IMPORT_STATEMENT',
        entityId: record.id,
        after: {
          fileHash: hash,
          rows: raws.length,
          mapping: mapping as unknown as Prisma.InputJsonValue,
        },
      },
    });
    return { id: record.id, duplicate: false, rows: raws.length };
  });
}
function fields(value: Prisma.JsonValue): StatementFields | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.cardId !== 'string' ||
    !Number.isInteger(v.amount) ||
    Number(v.amount) < 0 ||
    typeof v.approvedAt !== 'string' ||
    !Number.isFinite(new Date(v.approvedAt).getTime()) ||
    typeof v.merchantName !== 'string' ||
    !['APPROVAL', 'CANCELLATION'].includes(String(v.txType)) ||
    !['APPROVAL', 'NET', 'BILLED'].includes(String(v.amountKind))
  )
    return null;
  return v as unknown as StatementFields;
}
const merchant = (s: string) => s.replace(/\s/g, '').toLowerCase();
export async function statementList(session: AppSession, db: PrismaClient = prisma) {
  const visible = await visibleMemberIds(session);
  return db.statementImport.findMany({
    where: { memberId: { in: visible } },
    select: {
      id: true,
      fileName: true,
      createdAt: true,
      memberId: true,
      _count: { select: { rawMessages: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}
export async function statementDetail(
  session: AppSession,
  id: string,
  page = 1,
  db: PrismaClient = prisma,
) {
  const visible = await visibleMemberIds(session),
    scope = await visibleRawWhere(session);
  const record = await db.statementImport.findFirst({
    where: { id, memberId: { in: visible } },
    select: { id: true, fileName: true, memberId: true, mapping: true },
  });
  if (!record) throw new InputError('명세서를 찾을 수 없습니다.');
  const mapping = record.mapping as unknown as StatementMapping;
  validateMapping(mapping, 50);
  const safePage = Number.isInteger(page) && page >= 1 && page <= 100 ? page : 1;
  const [raws, total, transactions] = await Promise.all([
    db.rawMessage.findMany({
      where: { ...scope, statementImportId: id },
      orderBy: { clientMessageId: 'asc' },
      take: 50,
      skip: (safePage - 1) * 50,
      include: { evidence: { select: { transactionId: true } } },
    }),
    db.rawMessage.count({ where: { ...scope, statementImportId: id } }),
    db.transaction.findMany({
      where: {
        memberId: { in: visible },
        AND: { memberId: record.memberId },
        cardId: mapping.cardId,
        state: { not: 'MERGED' },
        approvedAt: {
          gte: new Date(kstDayStart(mapping.from).getTime() - 3 * 86400000),
          lt: new Date(kstDayStart(mapping.to).getTime() + 4 * 86400000),
        },
      },
      select: {
        id: true,
        rawMessageId: true,
        amount: true,
        canceledAmount: true,
        approvedAt: true,
        merchantName: true,
        txType: true,
        state: true,
        evidence: { select: { rawMessage: { select: { statementImportId: true } } } },
      },
      take: 10001,
    }),
  ]);
  if (transactions.length > 10000)
    throw new InputError('조회 범위를 줄여주세요. 거래 대사 한도는 10,000건입니다.');
  const items = raws.map((raw) => {
    const value = fields(raw.parsedFields);
    if (raw.evidence) return { raw, fields: value, status: 'LINKED', candidates: [] };
    if (raw.parseStatus === 'IGNORED')
      return { raw, fields: value, status: 'IGNORED', candidates: [] };
    if (!value) return { raw, fields: null, status: 'INVALID', candidates: [] };
    const candidates = transactions.filter(
      (t) =>
        t.txType === value.txType &&
        merchant(t.merchantName) === merchant(value.merchantName) &&
        Math.abs(t.approvedAt.getTime() - new Date(value.approvedAt).getTime()) <= 3 * 86400000,
    );
    const exact = candidates.filter(
      (t) =>
        (value.amountKind === 'NET' && t.txType === 'APPROVAL' ? netAmount(t) : t.amount) ===
        value.amount,
    );
    return {
      raw,
      fields: value,
      status:
        exact.length === 1
          ? 'MATCH'
          : exact.length > 1 || candidates.length > 1
            ? 'AMBIGUOUS'
            : candidates.length === 1
              ? 'AMOUNT_MISMATCH'
              : 'MISSING',
      candidates: exact.length ? exact : candidates,
    };
  });
  // Absence is only a review signal. It never deletes/cancels an existing transaction.
  const unlinked = transactions
    .filter(
      (t) =>
        !t.evidence.some((e) => e.rawMessage.statementImportId === id) &&
        t.approvedAt >= kstDayStart(mapping.from) &&
        t.approvedAt < new Date(kstDayStart(mapping.to).getTime() + 86400000),
    )
    .slice(0, 100);
  return {
    record,
    mapping,
    items,
    total,
    page: safePage,
    totalPages: Math.max(1, Math.ceil(total / 50)),
    unlinked,
  };
}
export async function decideStatement(
  session: AppSession,
  input: { rawIds: string[]; action: 'CREATE' | 'LINK' | 'CORRECT' | 'IGNORE'; targetId?: string },
  db: PrismaClient = prisma,
) {
  const visible = await visibleMemberIds(session),
    scope = await visibleRawWhere(session);
  if (
    !input.rawIds.length ||
    input.rawIds.length > 50 ||
    new Set(input.rawIds).size !== input.rawIds.length ||
    !['CREATE', 'LINK', 'CORRECT', 'IGNORE'].includes(input.action) ||
    (input.targetId && input.rawIds.length !== 1)
  )
    throw new InputError('한 번에 최대 50개 서로 다른 행을 선택해주세요.');
  return serializable(db, async (tx) => {
    const raws = await tx.rawMessage.findMany({
      where: { ...scope, id: { in: input.rawIds }, source: 'STATEMENT' },
      include: { evidence: true },
    });
    if (raws.length !== input.rawIds.length) throw new InputError('명세서 행을 찾을 수 없습니다.');
    const cards = new Set<string>();
    for (const raw of raws) {
      if (raw.evidence) continue;
      const memberId = raw.ownerMemberId;
      if (!memberId || !visible.includes(memberId)) throw new InputError('소유자를 확인해주세요.');
      if (input.action === 'IGNORE') {
        await tx.rawMessage.update({
          where: { id: raw.id },
          data: { parseStatus: 'IGNORED', parseReason: 'STATEMENT_MANUAL_IGNORE' },
        });
        await tx.reviewDecision.create({
          data: {
            memberId,
            actorMemberId: session.memberId,
            action: 'IGNORE_STATEMENT_ROW',
            entityId: raw.id,
          },
        });
        continue;
      }
      const value = fields(raw.parsedFields);
      if (!value)
        throw new InputError('잘못된 행은 열 매핑을 수정하거나 수동 거래 화면에서 입력해주세요.');
      const card = await tx.card.findFirst({
        where: { id: value.cardId, memberId: { in: visible }, AND: { memberId } },
      });
      if (!card) throw new InputError('같은 소유자의 카드를 선택해주세요.');
      let target = input.targetId
        ? await tx.transaction.findFirst({
            where: {
              id: input.targetId,
              memberId: { in: visible },
              AND: { memberId },
              cardId: card.id,
              state: { not: 'MERGED' },
              txType: value.txType,
            },
          })
        : null;
      if (input.targetId && !target) throw new InputError('대상 거래를 찾을 수 없습니다.');
      if (input.action === 'LINK' && !target) {
        const candidates = await tx.transaction.findMany({
          where: {
            memberId: { in: visible },
            AND: { memberId },
            cardId: card.id,
            txType: value.txType,
            state: { not: 'MERGED' },
            approvedAt: {
              gte: new Date(new Date(value.approvedAt).getTime() - 3 * 86400000),
              lte: new Date(new Date(value.approvedAt).getTime() + 3 * 86400000),
            },
          },
          take: 101,
        });
        const matches = candidates.filter(
          (t) =>
            merchant(t.merchantName) === merchant(value.merchantName) &&
            (value.amountKind === 'NET' && t.txType === 'APPROVAL' ? netAmount(t) : t.amount) ===
              value.amount,
        );
        if (candidates.length > 100 || matches.length !== 1)
          throw new InputError('유일하게 일치하는 거래만 일괄 연결할 수 있습니다.');
        target = matches[0]!;
      }
      if (
        input.action === 'CORRECT' &&
        (!target || value.amountKind !== 'APPROVAL' || target.canceledAmount > value.amount)
      )
        throw new InputError(
          '승인 금액만 보정할 수 있습니다. 취소·청구 금액 차이는 원거래/취소 내역을 먼저 확인해주세요.',
        );
      if (input.action === 'CREATE' && value.amountKind !== 'APPROVAL')
        throw new InputError(
          '순사용액/청구액 행은 새 승인으로 만들 수 없습니다. 원승인 금액을 확인해주세요.',
        );
      const before = target
        ? { amount: target.amount, canceledAmount: target.canceledAmount }
        : null;
      if (input.action === 'CREATE') {
        target = await tx.transaction.create({
          data: {
            memberId,
            cardId: card.id,
            issuer: card.issuer,
            rawMessageId: raw.id,
            amount: value.amount,
            approvedAt: new Date(value.approvedAt),
            timePrecision: value.timePrecision,
            merchantName: value.merchantName,
            txType: value.txType,
            isManuallyEdited: true,
            state: 'CONFIRMED',
            isOrphanCancellation: value.txType === 'CANCELLATION',
          },
        });
      } else if (target)
        target = await tx.transaction.update({
          where: { id: target.id },
          data: {
            isManuallyEdited: true,
            ...(input.action === 'CORRECT'
              ? { amount: value.amount, state: 'CONFIRMED', reviewReason: null }
              : {}),
          },
        });
      if (!target) throw new InputError('대상 거래가 필요합니다.');
      await tx.transactionEvidence.create({
        data: { rawMessageId: raw.id, transactionId: target.id, isManual: true },
      });
      await tx.rawMessage.update({
        where: { id: raw.id },
        data: { parseStatus: 'PARSED', parseReason: null, processedAt: new Date() },
      });
      await tx.reviewDecision.create({
        data: {
          memberId,
          actorMemberId: session.memberId,
          action: 'STATEMENT_' + input.action,
          entityId: target.id,
          before: before ?? undefined,
          after: { rawId: raw.id, amount: target.amount },
        },
      });
      cards.add(card.id);
    }
    for (const cardId of cards) {
      const card = await tx.card.findFirstOrThrow({
        where: { id: cardId, memberId: { in: visible } },
      });
      await refreshCardProjection(tx, card.memberId, cardId, visible);
    }
    return raws.length;
  });
}
