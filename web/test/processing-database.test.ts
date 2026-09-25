import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';
import { repairCardProjection } from '@/lib/processing/repair';
import { processBatch, queueRawIds } from '@/lib/processing';
import type { AppSession } from '@/lib/auth/types';
const url =
  process.env.FAMILYCARD_TEST_DATABASE_URL ??
  (process.env.CI ? process.env.DATABASE_URL : undefined);
if (url && !/^\/familycard_(test(?:_\w+)?|verify_\d{8}_\d{6})$/.test(new URL(url).pathname))
  throw new Error('Isolated test DB required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }), log: [] })
  : null;
const ruleIds: string[] = [];
afterAll(async () => {
  if (db) {
    await db.parserRule.updateMany({ where: { id: { in: ruleIds } }, data: { isActive: false } });
    await db.$disconnect();
  }
});

describe.skipIf(!db)('persistent processing integration (synthetic records retained)', () => {
  it('recovers jobs, merges evidence, recomputes cancellation and preserves manual/failed reprocessing', async () => {
    const prefix = 'SYN' + randomUUID().replaceAll('-', '');
    const owner = await db!.familyMember.create({
      data: { name: prefix, passwordHash: 'unused', displayColor: '#123456' },
    });
    const other = await db!.familyMember.create({
      data: { name: prefix + 'other', passwordHash: 'unused', displayColor: '#123456' },
    });
    const device = await db!.device.create({
      data: {
        memberId: owner.id,
        deviceName: 'synthetic-processing',
        tokenHash: 'revoked:' + prefix,
        revokedAt: new Date(),
      },
    });
    const session: AppSession = {
      memberId: owner.id,
      name: '',
      role: 'ADMIN',
      scope: 'SELF',
      entrypoint: 'DEVICE',
    };
    const card = await db!.card.create({
      data: {
        memberId: owner.id,
        issuer: prefix,
        nickname: 'synthetic card',
        last4: '1234',
        cardType: 'CREDIT',
        statementDay: 14,
      },
    });
    // A lifetime ledger above the former 10,000-row cap must not block fresh events.
    for (let offset = 0; offset < 12000; offset += 500) {
      const ids = Array.from({ length: 500 }, () => randomUUID());
      await db!.rawMessage.createMany({
        data: ids.map((id) => ({
          id,
          ownerMemberId: owner.id,
          clientMessageId: id,
          source: 'MANUAL' as const,
          originKind: 'MANUAL_ENTRY' as const,
          packageName: 'synthetic',
          title: '',
          body: 'synthetic history',
          receivedAt: new Date('2024-01-01'),
          dedupeHash: id,
          parseStatus: 'PARSED' as const,
        })),
      });
      await db!.transaction.createMany({
        data: ids.map((id, i) => ({
          memberId: owner.id,
          rawMessageId: id,
          cardId: card.id,
          amount: 1,
          merchantName: 'synthetic history',
          txType: 'APPROVAL' as const,
          state: 'CONFIRMED' as const,
          approvedAt: new Date(Date.UTC(2020, 0, 1) + (offset + i) * 3600000),
        })),
      });
    }
    let rowsRead = 0;
    const measured = db!.$extends({
      query: {
        transaction: {
          async findMany({ args, query }) {
            const rows = await query(args);
            rowsRead += rows.length;
            return rows;
          },
        },
      },
    }) as unknown as PrismaClient;
    const rule = await db!.parserRule.create({
      data: {
        issuer: prefix,
        priority: 100,
        matchPattern: '^' + prefix,
        extractPattern:
          '^' +
          prefix +
          ' (?<token>[0-9]{4}) (?<amount>[0-9]+) (?<date>[^ ]+) (?<kind>APPROVAL|CANCELLATION) (?<reference>[^ ]+) (?<merchant>.+)$',
        fieldMap: {
          cardToken: { type: 'card_token', from: 'token' },
          amount: { type: 'money' },
          approvedAt: { type: 'datetime_iso', from: 'date' },
          txType: { type: 'text', from: 'kind' },
          approvalReference: { type: 'text', from: 'reference' },
          merchant: { type: 'text' },
        },
      },
    });
    ruleIds.push(rule.id);
    const rawIds: string[] = [];
    for (const [kind, amount, date, reference, origin] of [
      ['APPROVAL', 100000, '2026-08-10T02:00:00Z', 'A', 'CARD_APP'],
      ['APPROVAL', 100000, '2026-08-10T02:00:00Z', 'A', 'PAYMENT_APP'],
      ['CANCELLATION', 30000, '2026-08-12T02:00:00Z', 'C1', 'CARD_APP'],
      ['CANCELLATION', 30000, '2026-08-12T02:00:00Z', 'C1', 'PAYMENT_APP'],
      ['CANCELLATION', 20000, '2026-08-13T02:00:00Z', 'C2', 'CARD_APP'],
    ] as const) {
      const raw = await db!.rawMessage.create({
        data: {
          deviceId: device.id,
          clientMessageId: randomUUID(),
          source: 'NOTIFICATION',
          originKind: origin,
          packageName: 'com.example.' + origin,
          title: '',
          body: `${prefix} 1234 ${amount} ${date} ${kind} ${reference} 테스트가맹점`,
          receivedAt: new Date('2026-08-14T00:00:00Z'),
          dedupeHash: randomUUID(),
        },
      });
      rawIds.push(raw.id);
    }
    const foreign = await db!.rawMessage.create({
      data: {
        ownerMemberId: other.id,
        clientMessageId: randomUUID(),
        source: 'MANUAL',
        originKind: 'MANUAL_ENTRY',
        packageName: 'manual',
        title: '',
        body: 'synthetic other',
        receivedAt: new Date(),
        dedupeHash: randomUUID(),
        processingJob: { create: {} },
      },
    });
    expect(await queueRawIds(session, [rawIds[0]!, foreign.id], db!)).toBe(1);
    expect(
      (await db!.processingJob.findUniqueOrThrow({ where: { rawMessageId: foreign.id } }))
        .generation,
    ).toBe(0);
    async function settle() {
      for (let i = 0; i < 5; i++) {
        await processBatch(session, 20, measured);
        const pending = await db!.processingJob.count({
          where: { rawMessageId: { in: rawIds }, state: { not: 'DONE' } },
        });
        if (!pending) return;
        await db!.processingJob.updateMany({
          where: { rawMessageId: { in: rawIds }, state: 'PENDING' },
          data: { nextAttemptAt: new Date(0) },
        });
      }
      throw new Error('Synthetic jobs did not settle');
    }
    await Promise.all([processBatch(session, 2, measured), processBatch(session, 2, measured)]);
    await settle();
    await expect(repairCardProjection(session, card.id, false, db!)).rejects.toThrow('관리자');
    await expect(
      repairCardProjection({ ...session, entrypoint: 'WEB', role: 'MEMBER' }, card.id, true, db!),
    ).rejects.toThrow('관리자');
    const admin = { ...session, entrypoint: 'WEB' as const, scope: 'FAMILY' as const };
    expect(await repairCardProjection(admin, card.id, false, db!)).toEqual({
      dryRun: true,
      scanned: 12003,
      changed: 0,
    });
    expect(await repairCardProjection(admin, card.id, true, db!)).toEqual({
      dryRun: false,
      scanned: 12003,
      changed: 0,
    });
    expect(await db!.rawMessage.count({ where: { id: { in: rawIds } } })).toBe(5);
    expect(await db!.transaction.count({ where: { memberId: owner.id } })).toBe(12003);
    let approval = await db!.transaction.findFirstOrThrow({
      where: { memberId: owner.id, txType: 'APPROVAL', amount: { gt: 1 } },
    });
    expect(approval.cardId).toBe(card.id);
    expect(approval.canceledAmount).toBe(50000);
    expect(await db!.transactionEvidence.count({ where: { transactionId: approval.id } })).toBe(2);
    for (let pass = 0; pass < 2; pass++) {
      await queueRawIds(session, rawIds, db!);
      await settle();
    }
    approval = await db!.transaction.findUniqueOrThrow({ where: { id: approval.id } });
    expect(approval.canceledAmount).toBe(50000);
    expect(await db!.transaction.count({ where: { memberId: owner.id } })).toBe(12003);
    await db!.transaction.update({
      where: { id: approval.id },
      data: { amount: 90000, isManuallyEdited: true },
    });
    await queueRawIds(session, rawIds, db!);
    await settle();
    expect((await db!.transaction.findUniqueOrThrow({ where: { id: approval.id } })).amount).toBe(
      90000,
    );
    await db!.parserRule.update({
      where: { id: rule.id },
      data: { extractPattern: '^never$', version: 2 },
    });
    await queueRawIds(session, rawIds, db!);
    await settle();
    expect(await db!.transaction.count({ where: { memberId: owner.id } })).toBe(12003);
    expect(
      (await db!.rawMessage.findUniqueOrThrow({ where: { id: rawIds[2]! } })).parseReason,
    ).toBe('EXISTING_PRESERVED_EXTRACTION_FAILED');
    expect(
      (await db!.processingJob.findUniqueOrThrow({ where: { rawMessageId: foreign.id } })).state,
    ).toBe('PENDING');
    expect(rowsRead).toBeLessThan(1000);
  }, 60000);
  it('stale work rolls back when a new reprocessing generation replaces its lease', async () => {
    const owner = await db!.familyMember.create({
      data: {
        name: 'synthetic-lease-' + randomUUID(),
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
    const raw = await db!.rawMessage.create({
      data: {
        ownerMemberId: owner.id,
        clientMessageId: randomUUID(),
        source: 'MANUAL',
        originKind: 'MANUAL_ENTRY',
        packageName: 'manual',
        title: '',
        body: 'synthetic lease body',
        receivedAt: new Date(),
        dedupeHash: randomUUID(),
        processingJob: { create: {} },
      },
    });
    let replaced = false;
    // Extended Prisma clients keep the same query/transaction methods; cast only for injected client typing.
    const raced = db!.$extends({
      query: {
        processingJob: {
          async updateMany({ args, query }) {
            if (!replaced && args.data.state === 'DONE') {
              replaced = true;
              await db!.processingJob.update({
                where: { rawMessageId: raw.id },
                data: {
                  generation: { increment: 1 },
                  state: 'PENDING',
                  leaseToken: null,
                  lockedAt: null,
                },
              });
            }
            return query(args);
          },
        },
      },
    }) as unknown as PrismaClient;
    expect((await processBatch(session, 1, raced)).failed).toBe(1);
    expect((await db!.rawMessage.findUniqueOrThrow({ where: { id: raw.id } })).parseStatus).toBe(
      'PENDING',
    );
    const job = await db!.processingJob.findUniqueOrThrow({ where: { rawMessageId: raw.id } });
    expect(job.generation).toBe(1);
    expect(job.state).toBe('PENDING');
    expect((await processBatch(session, 1, db!)).processed).toBe(1);
    await db!.processingJob.update({
      where: { rawMessageId: raw.id },
      data: { state: 'RUNNING', lockedAt: new Date(0), leaseToken: 'abandoned' },
    });
    expect((await processBatch(session, 1, db!)).processed).toBe(1);
    expect(
      (await db!.processingJob.findUniqueOrThrow({ where: { rawMessageId: raw.id } })).state,
    ).toBe('DONE');
  }, 30000);
});
