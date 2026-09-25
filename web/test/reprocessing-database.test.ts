import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, it, expect } from 'vitest';
import { createPreview, advanceRun, applyPreview, listRuns, runSummary } from '@/lib/reprocessing';
import type { AppSession } from '@/lib/auth/types';
const url =
  process.env.FAMILYCARD_TEST_DATABASE_URL ??
  (process.env.CI ? process.env.DATABASE_URL : undefined);
if (url && !/^\/familycard_(test(?:_\w+)?|verify_\d{8}_\d{6})$/.test(new URL(url).pathname))
  throw new Error('Isolated DB required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }), log: [] })
  : null;
const rules: string[] = [];
afterAll(async () => {
  if (db) {
    await db.parserRule.updateMany({ where: { id: { in: rules } }, data: { isActive: false } });
    await db.$disconnect();
  }
});
describe.skipIf(!db)('persistent scoped reprocessing', () => {
  it('previews in batches, survives concurrency, fixes target IDs and rejects config changes', async () => {
    const prefix = 'RUN' + randomUUID().replaceAll('-', '');
    const owner = await db!.familyMember.create({
      data: { name: prefix, passwordHash: 'unused', displayColor: '#123456' },
    });
    const session: AppSession = {
      memberId: owner.id,
      name: '',
      role: 'ADMIN',
      scope: 'SELF',
      entrypoint: 'DEVICE',
    };
    const foreign: AppSession = { ...session, memberId: 'nonexistent' };
    const card = await db!.card.create({
      data: {
        memberId: owner.id,
        issuer: prefix,
        last4: '1234',
        nickname: '가공카드',
        statementDay: 14,
        cardType: 'CREDIT',
      },
    });
    const rule = await db!.parserRule.create({
      data: {
        issuer: prefix,
        priority: 1,
        matchPattern: '^' + prefix,
        extractPattern: '^' + prefix,
        fieldMap: {
          amount: { type: 'const', value: 10000 },
          txType: { type: 'const', value: 'APPROVAL' },
          cardToken: { type: 'const', value: '1234' },
          approvedAt: { type: 'received_at' },
        },
      },
    });
    rules.push(rule.id);
    const rawIds: string[] = [];
    for (let i = 0; i < 25; i++) {
      const raw = await db!.rawMessage.create({
        data: {
          ownerMemberId: owner.id,
          source: 'MANUAL',
          originKind: 'MANUAL_ENTRY',
          packageName: 'manual',
          title: '',
          body: prefix,
          clientMessageId: randomUUID(),
          dedupeHash: randomUUID(),
          receivedAt: new Date('2026-08-10T00:00:00Z'),
          parseStatus: 'FAILED',
        },
      });
      rawIds.push(raw.id);
    }
    const run = await createPreview(session, { status: 'FAILED' }, db!);
    expect(await advanceRun(foreign, run.id, db!)).toBe(null);
    await Promise.all([advanceRun(session, run.id, db!), advanceRun(session, run.id, db!)]);
    const preview = await db!.reprocessingRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(preview.state).toBe('DONE');
    expect(runSummary(preview).wouldFix).toBe(25);
    expect(await db!.processingJob.count({ where: { rawMessageId: { in: rawIds } } })).toBe(0);
    await expect(applyPreview(foreign, run.id, true, db!)).rejects.toThrow();
    expect(await listRuns(foreign, db!)).toEqual([]);
    // Status changes between preview/apply must not change the materialized target set.
    await db!.rawMessage.updateMany({
      where: { id: { in: rawIds } },
      data: { parseStatus: 'PENDING' },
    });
    const applied = await applyPreview(session, run.id, false, db!);
    expect((await applyPreview(session, run.id, false, db!)).id).toBe(applied.id);
    await advanceRun(session, applied.id, db!);
    await advanceRun(session, applied.id, db!);
    expect(await db!.processingJob.count({ where: { rawMessageId: { in: rawIds } } })).toBe(25);
    expect(
      runSummary(await db!.reprocessingRun.findUniqueOrThrow({ where: { id: applied.id } })).queued,
    ).toBe(25);
    const changed = await createPreview(session, {}, db!);
    await db!.card.update({ where: { id: card.id }, data: { nickname: '가공 카드 수정' } });
    expect((await advanceRun(session, changed.id, db!))?.error).toBe('CONFIG_CHANGED');
    await expect(applyPreview(session, run.id, false, db!)).rejects.toThrow();
    expect(await db!.rawMessage.count({ where: { id: { in: rawIds } } })).toBe(25);
  }, 30000);
  it('keeps exhausted serialization conflicts pending and resets after progress; caps consecutive cycles', async () => {
    const owner = await db!.familyMember.create({
      data: {
        name: 'synthetic-conflict-' + randomUUID(),
        passwordHash: 'unused',
        displayColor: '#123456',
      },
    });
    const session: AppSession = {
      memberId: owner.id,
      name: '',
      role: 'MEMBER',
      scope: 'SELF',
      entrypoint: 'WEB',
    };
    const run = await createPreview(session, {}, db!);
    let attempts = 0;
    const conflicting = db!.$extends({
      query: {
        reprocessingRun: {
          async update({ args, query }) {
            if (args.data.state === 'RUNNING') {
              attempts++;
              throw new Prisma.PrismaClientKnownRequestError('synthetic conflict', {
                code: 'P2034',
                clientVersion: 'test',
              });
            }
            return query(args);
          },
        },
      },
    }) as unknown as PrismaClient;
    const pending = await advanceRun(session, run.id, conflicting);
    expect(attempts).toBe(4);
    expect(pending).toMatchObject({
      state: 'PENDING',
      error: 'TRANSACTION_RETRY',
      consecutiveConflicts: 1,
      cursor: null,
    });
    expect(await advanceRun(session, run.id, db!)).toMatchObject({
      state: 'DONE',
      error: null,
      consecutiveConflicts: 0,
    });
    const limit = await createPreview(session, {}, db!);
    await db!.reprocessingRun.update({
      where: { id: limit.id },
      data: { consecutiveConflicts: 19 },
    });
    expect(await advanceRun(session, limit.id, conflicting)).toMatchObject({
      state: 'FAILED',
      error: 'TRANSACTION_RETRY',
      consecutiveConflicts: 20,
    });
  });
  it('warns before breaking existing parses and preserves manual jobs', async () => {
    const owner = await db!.familyMember.create({
      data: {
        name: 'synthetic-warning-' + randomUUID(),
        passwordHash: 'unused',
        displayColor: '#123456',
      },
    });
    const session: AppSession = {
      memberId: owner.id,
      name: '',
      role: 'MEMBER',
      scope: 'SELF',
      entrypoint: 'WEB',
    };
    for (const manual of [false, true]) {
      const raw = await db!.rawMessage.create({
        data: {
          ownerMemberId: owner.id,
          source: 'MANUAL',
          originKind: 'MANUAL_ENTRY',
          packageName: 'manual',
          title: '',
          body: 'synthetic no matching rule',
          clientMessageId: randomUUID(),
          dedupeHash: randomUUID(),
          receivedAt: new Date(),
          parseStatus: 'PARSED',
        },
      });
      await db!.transaction.create({
        data: {
          memberId: owner.id,
          rawMessageId: raw.id,
          amount: 12000,
          merchantName: '가공 가맹점',
          approvedAt: new Date(),
          txType: 'APPROVAL',
          isManuallyEdited: manual,
          evidence: { create: { rawMessageId: raw.id, isManual: manual } },
        },
      });
    }
    const run = await createPreview(session, {}, db!);
    const done = await advanceRun(session, run.id, db!);
    expect(runSummary(done!).wouldBreak).toBe(1);
    expect(runSummary(done!).skippedManual).toBe(1);
    await expect(applyPreview(session, run.id, false, db!)).rejects.toThrow();
    const apply = await applyPreview(session, run.id, true, db!);
    const result = await advanceRun(session, apply.id, db!);
    expect(runSummary(result!).queued).toBe(1);
    expect(runSummary(result!).skippedManual).toBe(1);
  }, 30000);
});
