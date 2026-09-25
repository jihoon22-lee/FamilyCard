import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import { visibleMemberIds } from '@/lib/auth/scope';
import { visibleRawWhere } from '@/lib/raw';
import type { AppSession } from '@/lib/auth/types';
import { parseMessage, type ParsedFields } from '@/lib/parser';
import { matchCard } from '@/lib/cardmatch';
import { findDuplicate, projectCancellations, type LedgerEntry } from '@/lib/reconciliation';

const LEASE_MS = 120000;
const LEDGER_LIMIT = 10000;
const evidenceInclude = {
  rawMessage: { select: { source: true, originKind: true, packageName: true } },
} as const;
function sourceKey(raw: { source: string; originKind: string; packageName: string }): string {
  return `${raw.source}:${raw.originKind}:${raw.packageName}`;
}

export async function recoverMissingJobs(
  session: AppSession,
  db: PrismaClient = prisma,
): Promise<number> {
  const scope = await visibleRawWhere(session);
  const missing = await db.rawMessage.findMany({
    where: { ...scope, processingJob: null, parseStatus: { notIn: ['PARSED', 'IGNORED'] } },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: 100,
  });
  if (!missing.length) return 0;
  const result = await db.processingJob.createMany({
    data: missing.map((raw) => ({ rawMessageId: raw.id })),
    skipDuplicates: true,
  });
  return result.count;
}

export async function queueRawIds(
  session: AppSession,
  ids: readonly string[],
  db: PrismaClient = prisma,
): Promise<number> {
  if (ids.length > 100) throw new Error('Reprocess batch exceeds 100');
  const scope = await visibleRawWhere(session);
  const raws = await db.rawMessage.findMany({
    where: { ...scope, id: { in: [...ids] } },
    select: { id: true },
  });
  await db.$transaction(async (tx) => {
    for (const raw of raws)
      await tx.processingJob.upsert({
        where: { rawMessageId: raw.id },
        create: { rawMessageId: raw.id },
        update: {
          state: 'PENDING',
          generation: { increment: 1 },
          attempts: 0,
          nextAttemptAt: new Date(),
          lockedAt: null,
          leaseToken: null,
          lastError: null,
        },
      });
  });
  return raws.length;
}

interface Claim {
  rawMessageId: string;
  generation: number;
  leaseToken: string;
  attempts: number;
}
async function claimNext(session: AppSession, db: PrismaClient): Promise<Claim | null> {
  const scope = await visibleRawWhere(session),
    now = new Date();
  const available: Prisma.ProcessingJobWhereInput = {
    rawMessage: scope,
    OR: [
      { state: 'PENDING', nextAttemptAt: { lte: now } },
      { state: 'RUNNING', lockedAt: { lt: new Date(now.getTime() - LEASE_MS) } },
    ],
  };
  return db.$transaction(async (tx) => {
    const job = await tx.processingJob.findFirst({
      where: available,
      orderBy: [{ nextAttemptAt: 'asc' }, { rawMessageId: 'asc' }],
    });
    if (!job) return null;
    const leaseToken = randomUUID();
    const updated = await tx.processingJob.updateMany({
      where: {
        AND: [
          available,
          {
            rawMessageId: job.rawMessageId,
            generation: job.generation,
            leaseToken: job.leaseToken,
            lockedAt: job.lockedAt,
          },
        ],
      },
      data: { state: 'RUNNING', lockedAt: now, leaseToken, attempts: { increment: 1 } },
    });
    return updated.count
      ? {
          rawMessageId: job.rawMessageId,
          generation: job.generation,
          leaseToken,
          attempts: job.attempts + 1,
        }
      : null;
  });
}

export async function refreshCardProjection(
  tx: Prisma.TransactionClient,
  memberId: string,
  cardId: string,
  visible: string[],
): Promise<void> {
  const rows = await tx.transaction.findMany({
    where: { memberId: { in: visible }, AND: { memberId }, cardId, state: { not: 'MERGED' } },
    take: LEDGER_LIMIT + 1,
    orderBy: { id: 'asc' },
  });
  if (rows.length > LEDGER_LIMIT) throw new Error('LEDGER_LIMIT');
  const entries: LedgerEntry[] = rows.map((row) => ({
    ...row,
    sourceKeys: [],
    manualCancellationLink: row.isManuallyEdited && !!row.canceledTxId,
  }));
  const projection = projectCancellations(entries);
  for (const row of rows) {
    if (row.state !== 'CONFIRMED') continue;
    if (row.txType === 'APPROVAL') {
      const amount = projection.totals[row.id] ?? 0;
      if (row.canceledAmount !== amount)
        await tx.transaction.update({ where: { id: row.id }, data: { canceledAmount: amount } });
    } else {
      const target = projection.links[row.id] ?? null;
      const reason = projection.unresolved[row.id] ?? null;
      if (
        row.canceledTxId !== target ||
        row.isOrphanCancellation !== !target ||
        row.reviewReason !== reason
      ) {
        await tx.transaction.update({
          where: { id: row.id },
          data: { canceledTxId: target, isOrphanCancellation: !target, reviewReason: reason },
        });
      }
    }
  }
}

function transactionData(fields: ParsedFields) {
  return {
    amount: fields.amount,
    txType: fields.txType,
    approvedAt: new Date(fields.approvedAt),
    originalApprovedAt: fields.originalApprovedAt ? new Date(fields.originalApprovedAt) : null,
    timePrecision: fields.timePrecision,
    merchantName: fields.merchantName,
    installmentMonths: fields.installmentMonths,
    currency: fields.currency,
    foreignAmount: fields.foreignAmount,
    foreignScale: fields.foreignScale,
    issuer: fields.issuer,
    cardToken: fields.cardToken,
    approvalReference: fields.approvalReference,
  };
}

async function processClaim(session: AppSession, claim: Claim, db: PrismaClient): Promise<void> {
  const scope = await visibleRawWhere(session),
    visible = await visibleMemberIds(session);
  await db.$transaction(
    async (tx) => {
      const raw = await tx.rawMessage.findFirst({
        where: { ...scope, id: claim.rawMessageId },
        include: {
          device: { select: { memberId: true } },
          evidence: { include: { transaction: true } },
          transaction: true,
        },
      });
      if (!raw) throw new Error('OUT_OF_SCOPE');
      const memberId = raw.device?.memberId ?? raw.ownerMemberId;
      if (!memberId || !visible.includes(memberId)) throw new Error('OUT_OF_SCOPE');
      const current = raw.evidence?.transaction ?? raw.transaction;
      if (current && current.memberId !== memberId) throw new Error('OUT_OF_SCOPE');
      if (current?.isManuallyEdited || raw.evidence?.isManual) {
        await finishJob(tx, claim);
        return;
      }
      const rules = await tx.parserRule.findMany({
        where: { isActive: true },
        orderBy: [{ priority: 'asc' }, { id: 'asc' }],
        take: 257,
      });
      const result = parseMessage(raw, rules);
      const meta = {
        processedAt: new Date(),
        parserRuleId: result.ruleId ?? null,
        parserVersion: result.ruleVersion ?? null,
      };
      if (result.status !== 'PARSED') {
        await tx.rawMessage.update({
          where: { id: raw.id },
          data: {
            ...meta,
            parseStatus: current ? 'FAILED' : result.status,
            parseReason: current ? `EXISTING_PRESERVED_${result.reason}` : result.reason,
          },
        });
        await finishJob(tx, claim);
        return;
      }
      const fields = result.fields;
      const cards = await tx.card.findMany({
        where: { memberId: { in: visible }, AND: { memberId }, issuer: fields.issuer },
        include: { aliases: true },
      });
      const match = matchCard(
        memberId,
        fields.issuer,
        fields.cardToken,
        new Date(fields.approvedAt),
        cards,
      );
      let reason: string | null =
        match.reason ?? (fields.amount === null ? 'FOREIGN_KRW_UNKNOWN' : null);
      let state: 'CONFIRMED' | 'REVIEW' = reason ? 'REVIEW' : 'CONFIRMED';
      const data = transactionData(fields);
      const neighbors = match.cardId
        ? await tx.transaction.findMany({
            where: {
              memberId: { in: visible },
              AND: { memberId },
              cardId: match.cardId,
              state: { not: 'MERGED' },
              approvedAt: {
                gte: new Date(new Date(fields.approvedAt).getTime() - 86400000),
                lte: new Date(new Date(fields.approvedAt).getTime() + 86400000),
              },
            },
            include: { evidence: { include: evidenceInclude } },
            take: 1001,
          })
        : [];
      if (neighbors.length > 1000) throw new Error('LEDGER_LIMIT');
      const incoming: LedgerEntry = {
        ...data,
        id: current?.id ?? raw.id,
        memberId,
        cardId: match.cardId,
        sourceKeys: [sourceKey(raw)],
        state,
      };
      // Linked secondary evidence or multiple-source representatives cannot silently rewrite a shared transaction.
      const linkedCount = current
        ? await tx.transactionEvidence.count({
            where: { transactionId: current.id, transaction: { memberId: { in: visible } } },
          })
        : 0;
      if (current && (linkedCount > 1 || current.rawMessageId !== raw.id)) {
        const agrees =
          current.cardId === match.cardId &&
          current.amount === fields.amount &&
          current.txType === fields.txType &&
          current.currency === fields.currency &&
          current.foreignAmount === fields.foreignAmount &&
          current.foreignScale === fields.foreignScale &&
          current.merchantName.trim().replace(/\s+/g, ' ') ===
            fields.merchantName.trim().replace(/\s+/g, ' ') &&
          current.installmentMonths === fields.installmentMonths &&
          current.approvalReference === fields.approvalReference &&
          (current.timePrecision === 'DAY' || fields.timePrecision === 'DAY'
            ? new Date(current.approvedAt.getTime() + 9 * 3600000).toISOString().slice(0, 10) ===
              new Date(new Date(fields.approvedAt).getTime() + 9 * 3600000)
                .toISOString()
                .slice(0, 10)
            : Math.abs(current.approvedAt.getTime() - new Date(fields.approvedAt).getTime()) <=
              120000);
        await tx.rawMessage.update({
          where: { id: raw.id },
          data: {
            ...meta,
            parsedFields: fields as unknown as Prisma.InputJsonValue,
            parseStatus: agrees ? 'PARSED' : 'FAILED',
            parseReason: agrees ? null : 'EVIDENCE_CONFLICT',
          },
        });
        await finishJob(tx, claim);
        return;
      }
      const duplicate = findDuplicate(
        incoming,
        neighbors.map((row) => ({
          ...row,
          sourceKeys: row.evidence.map((e) => sourceKey(e.rawMessage)),
        })),
      );
      let targetId: string;
      if (duplicate.kind === 'MERGE' && !current) {
        targetId = duplicate.transactionId;
      } else {
        if (duplicate.kind !== 'NEW') {
          state = 'REVIEW';
          reason = 'NEEDS_RECONCILIATION';
        }
        const saved = await tx.transaction.upsert({
          where: { rawMessageId: raw.id },
          create: {
            ...data,
            memberId,
            rawMessageId: raw.id,
            cardId: match.cardId,
            state,
            reviewReason: reason,
          },
          update: {
            ...data,
            cardId: match.cardId,
            state,
            reviewReason: reason,
            canceledAmount: 0,
            canceledTxId: null,
            isOrphanCancellation: fields.txType === 'CANCELLATION',
          },
        });
        targetId = saved.id;
      }
      await tx.transactionEvidence.upsert({
        where: { rawMessageId: raw.id },
        create: { rawMessageId: raw.id, transactionId: targetId },
        update: { transactionId: targetId },
      });
      await tx.rawMessage.update({
        where: { id: raw.id },
        data: {
          ...meta,
          parsedFields: fields as unknown as Prisma.InputJsonValue,
          parseStatus: match.cardId ? 'PARSED' : 'NEEDS_CARD',
          parseReason: reason,
        },
      });
      if (current?.cardId && current.cardId !== match.cardId)
        await refreshCardProjection(tx, memberId, current.cardId, visible);
      if (match.cardId) await refreshCardProjection(tx, memberId, match.cardId, visible);
      await finishJob(tx, claim);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
      maxWait: 10000,
    },
  );
}
async function finishJob(tx: Prisma.TransactionClient, claim: Claim): Promise<void> {
  const done = await tx.processingJob.updateMany({
    where: {
      rawMessageId: claim.rawMessageId,
      generation: claim.generation,
      leaseToken: claim.leaseToken,
      state: 'RUNNING',
    },
    data: { state: 'DONE', lockedAt: null, leaseToken: null, lastError: null },
  });
  if (done.count !== 1) throw new Error('LEASE_LOST');
}

export async function processBatch(session: AppSession, limit = 20, db: PrismaClient = prisma) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('Invalid processing limit');
  await recoverMissingJobs(session, db);
  let processed = 0,
    failed = 0;
  for (let i = 0; i < limit; i++) {
    const claim = await claimNext(session, db);
    if (!claim) break;
    try {
      await processClaim(session, claim, db);
      processed++;
    } catch (error) {
      failed++;
      const transient =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
      const reason =
        error instanceof Error &&
        ['LEASE_LOST', 'LEDGER_LIMIT', 'OUT_OF_SCOPE'].includes(error.message)
          ? error.message
          : transient
            ? 'TRANSACTION_RETRY'
            : 'PROCESSING_ERROR';
      await db.processingJob.updateMany({
        where: {
          rawMessageId: claim.rawMessageId,
          generation: claim.generation,
          leaseToken: claim.leaseToken,
          state: 'RUNNING',
        },
        data: {
          state: claim.attempts >= 5 ? 'FAILED' : 'PENDING',
          nextAttemptAt: new Date(Date.now() + Math.min(300000, 1000 * 2 ** claim.attempts)),
          lockedAt: null,
          leaseToken: null,
          lastError: reason,
        },
      });
    }
  }
  return { processed, failed };
}
