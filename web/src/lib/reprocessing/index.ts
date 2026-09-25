import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient, type ReprocessingRun, type ParseStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { AppSession } from '@/lib/auth/types';
import { visibleMemberIds } from '@/lib/auth/scope';
import { visibleRawWhere } from '@/lib/raw';
import { parseMessage } from '@/lib/parser';
import { matchCard } from '@/lib/cardmatch';
import { InputError } from '@/lib/cards';
import { serializable } from '@/lib/database';
import { kstDayStart } from '@/lib/time';
export interface RunFilter {
  issuer?: string;
  status?: string;
  from?: string;
  to?: string;
}
interface Summary {
  total: number;
  wouldFix: number;
  wouldBreak: number;
  wouldChange: number;
  skippedManual: number;
  queued: number;
  ignored: number;
  failed: number;
  samples: Array<{ rawId: string; before: string; after: string }>;
}
const empty = (): Summary => ({
  total: 0,
  wouldFix: 0,
  wouldBreak: 0,
  wouldChange: 0,
  skippedManual: 0,
  queued: 0,
  ignored: 0,
  failed: 0,
  samples: [],
});
function filters(value: RunFilter): RunFilter {
  const out: RunFilter = {};
  if (value.issuer) {
    if (!/^[A-Z0-9_-]{1,40}$/.test(value.issuer))
      throw new InputError('카드사 코드를 확인해주세요.');
    out.issuer = value.issuer;
  }
  if (value.status) {
    if (!['PENDING', 'PARSED', 'FAILED', 'NEEDS_CARD', 'IGNORED'].includes(value.status))
      throw new InputError('상태를 확인해주세요.');
    out.status = value.status;
  }
  try {
    if (value.from) {
      kstDayStart(value.from);
      out.from = value.from;
    }
    if (value.to) {
      kstDayStart(value.to);
      out.to = value.to;
    }
  } catch {
    throw new InputError('기간을 확인해주세요.');
  }
  if (out.from && out.to && out.from > out.to) throw new InputError('기간 순서를 확인해주세요.');
  return out;
}
async function context(visible: string[], db: Prisma.TransactionClient) {
  const [rules, cards] = await Promise.all([
    db.parserRule.findMany({ where: { isActive: true }, orderBy: { id: 'asc' }, take: 257 }),
    db.card.findMany({
      where: { memberId: { in: visible } },
      orderBy: { id: 'asc' },
      take: 1001,
      include: { aliases: { orderBy: { id: 'asc' } } },
    }),
  ]);
  if (cards.length > 1000) throw new InputError('카드 수가 미리보기 처리 한도를 초과했습니다.');
  const fingerprint = createHash('sha256').update(JSON.stringify({ rules, cards })).digest('hex');
  return { rules, cards, fingerprint };
}
const summary = (value: Prisma.JsonValue) => value as unknown as Summary;
function runWhere(session: AppSession, visible: string[]): Prisma.ReprocessingRunWhereInput {
  return {
    actorMemberId: session.memberId,
    actor: { id: { in: visible } },
    ...(session.scope === 'SELF' ? { memberIds: { equals: [session.memberId] } } : {}),
  };
}
export async function createPreview(
  session: AppSession,
  input: RunFilter,
  db: PrismaClient = prisma,
) {
  const visible = await visibleMemberIds(session),
    f = filters(input),
    ctx = await context(visible, db);
  return db.reprocessingRun.create({
    data: {
      actorMemberId: session.memberId,
      memberIds: visible,
      mode: 'PREVIEW',
      filters: f as Prisma.InputJsonObject,
      fingerprint: ctx.fingerprint,
      cutoff: new Date(),
      summary: empty() as unknown as Prisma.InputJsonValue,
    },
  });
}
export async function applyPreview(
  session: AppSession,
  id: string,
  acknowledgeBreak: boolean,
  db: PrismaClient = prisma,
) {
  const visible = await visibleMemberIds(session);
  return serializable(db, async (tx) => {
    const preview = await tx.reprocessingRun.findFirst({
      where: { ...runWhere(session, visible), id, mode: 'PREVIEW', state: 'DONE' },
    });
    if (!preview || preview.memberIds.some((id) => !visible.includes(id)))
      throw new InputError('완료된 본인 미리보기를 선택해주세요.');
    if (summary(preview.summary).wouldBreak > 0 && !acknowledgeBreak)
      throw new InputError('악화 예상 건수를 확인한 뒤 반영해주세요.');
    const ctx = await context(preview.memberIds, tx);
    if (ctx.fingerprint !== preview.fingerprint)
      throw new InputError('규칙이나 카드가 변경되었습니다. 새 미리보기를 실행해주세요.');
    const previous = await tx.reprocessingRun.findFirst({
      where: { ...runWhere(session, visible), previewId: preview.id },
    });
    if (previous) return previous;
    return tx.reprocessingRun.create({
      data: {
        actorMemberId: session.memberId,
        memberIds: preview.memberIds,
        mode: 'APPLY',
        filters: preview.filters as Prisma.InputJsonValue,
        fingerprint: preview.fingerprint,
        cutoff: preview.cutoff,
        previewId: preview.id,
        summary: empty() as unknown as Prisma.InputJsonValue,
      },
    });
  });
}
export async function listRuns(session: AppSession, db: PrismaClient = prisma) {
  const visible = await visibleMemberIds(session);
  const rows = await db.reprocessingRun.findMany({
    where: runWhere(session, visible),
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  return rows
    .filter((r) => r.memberIds.every((id) => visible.includes(id)))
    .map((r) => ({ ...r, summary: summary(r.summary) }));
}
/** One small transaction advances cursor and enqueues all corresponding raw jobs atomically. */
export async function advanceRun(session: AppSession, id?: string, db: PrismaClient = prisma) {
  const visible = await visibleMemberIds(session),
    rawScope = await visibleRawWhere(session);
  let claimedId: string | undefined;
  try {
    return await serializable(db, async (tx) => {
      // Background family principal can work on another actor's run, but only within visible owner IDs.
      const where: Prisma.ReprocessingRunWhereInput =
        session.scope === 'FAMILY' && session.entrypoint === 'WEB' && session.role === 'ADMIN'
          ? { actor: { id: { in: visible } }, state: 'PENDING', ...(id ? { id } : {}) }
          : { ...runWhere(session, visible), state: 'PENDING', ...(id ? { id } : {}) };
      const run = await tx.reprocessingRun.findFirst({ where, orderBy: { createdAt: 'asc' } });
      if (!run) return null;
      claimedId = run.id;
      if (run.memberIds.some((member) => !visible.includes(member)))
        throw new InputError('작업 범위를 확인해주세요.');
      // Take a row lock before reading the cursor. Concurrent workers serialize or retry the transaction.
      await tx.reprocessingRun.update({ where: { id: run.id }, data: { state: 'RUNNING' } });
      const ctx = await context(run.memberIds, tx);
      if (ctx.fingerprint !== run.fingerprint)
        return tx.reprocessingRun.update({
          where: { id: run.id },
          data: { state: 'FAILED', error: 'CONFIG_CHANGED' },
        });
      const f = filters(run.filters as RunFilter);
      const ownerScope: Prisma.RawMessageWhereInput = {
        OR: [
          { device: { memberId: { in: run.memberIds } } },
          { deviceId: null, ownerMemberId: { in: run.memberIds } },
        ],
      };
      // Issuer filters include only previously identified issuer; NO_RULE has no reliable issuer.
      const issuerScope: Prisma.RawMessageWhereInput = f.issuer
        ? {
            OR: [
              { parserRule: { issuer: f.issuer } },
              { evidence: { transaction: { issuer: f.issuer, memberId: { in: run.memberIds } } } },
            ],
          }
        : {};
      const targetIds =
        run.mode === 'APPLY'
          ? (
              await tx.reprocessingTarget.findMany({
                where: {
                  runId: run.previewId!,
                  ...(run.cursor ? { rawMessageId: { gt: run.cursor } } : {}),
                  run: { actorMemberId: run.actorMemberId },
                },
                orderBy: { rawMessageId: 'asc' },
                take: 20,
                select: { rawMessageId: true },
              })
            ).map((t) => t.rawMessageId)
          : [];
      const raws = await tx.rawMessage.findMany({
        where:
          run.mode === 'APPLY'
            ? { AND: [rawScope, ownerScope], id: { in: targetIds } }
            : {
                AND: [rawScope, ownerScope, issuerScope],
                createdAt: { lte: run.cutoff },
                ...(run.cursor ? { id: { gt: run.cursor } } : {}),
                ...(f.status ? { parseStatus: f.status as ParseStatus } : {}),
                ...(f.from || f.to
                  ? {
                      receivedAt: {
                        ...(f.from ? { gte: kstDayStart(f.from) } : {}),
                        ...(f.to ? { lt: new Date(kstDayStart(f.to).getTime() + 86400000) } : {}),
                      },
                    }
                  : {}),
              },
        orderBy: { id: 'asc' },
        take: 20,
        include: {
          device: { select: { memberId: true } },
          evidence: { include: { transaction: true } },
          transaction: true,
        },
      });
      if (run.mode === 'PREVIEW' && raws.length)
        await tx.reprocessingTarget.createMany({
          data: raws.map((raw) => ({ runId: run.id, rawMessageId: raw.id })),
          skipDuplicates: true,
        });
      const s = summary(run.summary);
      for (const raw of raws) {
        s.total++;
        const current = raw.evidence?.transaction ?? raw.transaction;
        const memberId = raw.device?.memberId ?? raw.ownerMemberId;
        if (
          !memberId ||
          !run.memberIds.includes(memberId) ||
          (current && current.memberId !== memberId)
        )
          throw new InputError('원문 소유권을 확인해주세요.');
        if (current?.isManuallyEdited || raw.evidence?.isManual) {
          s.skippedManual++;
          continue;
        }
        if (run.mode === 'APPLY') {
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
          s.queued++;
          continue;
        }
        const result = parseMessage(raw, ctx.rules);
        const match =
          result.status === 'PARSED'
            ? matchCard(
                memberId,
                result.fields.issuer,
                result.fields.cardToken,
                new Date(result.fields.approvedAt),
                ctx.cards,
              )
            : null;
        const after =
          result.status === 'PARSED'
            ? match?.cardId && result.fields.amount !== null
              ? 'PARSED'
              : 'NEEDS_CARD'
            : result.status;
        const good = after === 'PARSED' || after === 'IGNORED';
        if (!good) s.failed++;
        if (after === 'IGNORED') s.ignored++;
        const breaks = (!!current || raw.parseStatus === 'PARSED') && after !== 'PARSED';
        if (breaks) s.wouldBreak++;
        if (good && !['PARSED', 'IGNORED'].includes(raw.parseStatus)) s.wouldFix++;
        const changed =
          after !== raw.parseStatus ||
          (result.status === 'PARSED' &&
            (!current ||
              current.amount !== result.fields.amount ||
              current.cardId !== match?.cardId ||
              current.txType !== result.fields.txType ||
              current.approvedAt.toISOString() !== result.fields.approvedAt ||
              current.merchantName !== result.fields.merchantName ||
              current.installmentMonths !== result.fields.installmentMonths ||
              current.currency !== result.fields.currency ||
              current.foreignAmount !== result.fields.foreignAmount ||
              current.foreignScale !== result.fields.foreignScale));
        if (changed) {
          s.wouldChange++;
          if (s.samples.length < 10)
            s.samples.push({ rawId: raw.id, before: raw.parseStatus, after });
        }
      }
      return tx.reprocessingRun.update({
        where: { id: run.id },
        data: {
          state: (run.mode === 'APPLY' ? targetIds.length : raws.length) < 20 ? 'DONE' : 'PENDING',
          cursor: (run.mode === 'APPLY' ? targetIds.at(-1) : raws.at(-1)?.id) ?? run.cursor,
          summary: s as unknown as Prisma.InputJsonValue,
          error: null,
        },
      });
    });
  } catch (error) {
    if (claimedId)
      await db.reprocessingRun.updateMany({
        where: { id: claimedId, actor: { id: { in: visible } }, state: 'PENDING' },
        data: { state: 'FAILED', error: 'PROCESSING_ERROR' },
      });
    throw error;
  }
}

export function runSummary(run: ReprocessingRun) {
  return summary(run.summary);
}
