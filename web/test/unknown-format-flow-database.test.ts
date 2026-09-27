import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';
import { saveRule } from '@/lib/parser-rules';
import { processBatch, queueRawIds } from '@/lib/processing';
import { createPreview, advanceRun, applyPreview, runSummary } from '@/lib/reprocessing';
import { saveManualTransaction } from '@/lib/review';
import { visibleMemberIds } from '@/lib/auth/scope';
import { visibleRawWhere } from '@/lib/raw';
import type { AppSession } from '@/lib/auth/types';
const url =
  process.env.FAMILYCARD_TEST_DATABASE_URL ??
  (process.env.CI ? process.env.DATABASE_URL : undefined);
if (
  url &&
  (!/^\/familycard_(test(?:_\w+)?|verify_\d{8}_\d{6})$/.test(new URL(url).pathname) ||
    process.env.DATABASE_URL !== url)
)
  throw new Error('Both database URLs must identify the same isolated database');
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
describe.skipIf(!db)(
  'unknown format through administrator registration and repeated processing',
  () => {
    it('repairs history, processes future arrivals, keeps net amounts, manual decisions and SELF boundaries', async () => {
      const prefix = 'FLOW' + randomUUID().replaceAll('-', '');
      const owner = await db!.familyMember.create({
        data: { name: prefix, role: 'ADMIN', passwordHash: 'unused', displayColor: '#123456' },
      });
      const other = await db!.familyMember.create({
        data: { name: prefix + 'other', passwordHash: 'unused', displayColor: '#123456' },
      });
      const session: AppSession = {
        memberId: owner.id,
        name: '',
        role: 'ADMIN',
        scope: 'SELF',
        entrypoint: 'DEVICE',
      };
      const foreign: AppSession = { ...session, memberId: other.id };
      const admin: AppSession = { ...session, scope: 'FAMILY', entrypoint: 'WEB' };
      const visible = await visibleMemberIds(session),
        scope = await visibleRawWhere(session);
      const make = (
        kind: string,
        amount: number,
        day: string,
        merchant = '가공상점',
        memberId = owner.id,
      ) =>
        db!.rawMessage.create({
          data: {
            ownerMemberId: memberId,
            source: 'MANUAL',
            originKind: 'MANUAL_ENTRY',
            packageName: 'manual',
            title: '',
            body: `${prefix} ${kind} ${amount} 2026-08-${day}T03:00:00Z ${merchant}`,
            receivedAt: new Date(`2026-08-${day}T03:00:00Z`),
            clientMessageId: randomUUID(),
            dedupeHash: randomUUID(),
          },
        });
      const old = await make('APPROVAL', 10000, '10');
      await make('CANCELLATION', 2500, '11');
      const manual = await make('APPROVAL', 5000, '12', '가공수동상점');
      const hidden = await make('APPROVAL', 90000, '10', '가공다른상점', other.id);
      const settle = async () => {
        for (let n = 0; n < 10; n++) {
          const result = await processBatch(session, 100, db!);
          expect(result.failed).toBe(0);
          if (!result.processed) return;
        }
        throw new Error('Processing did not settle');
      };
      await settle();
      expect(await db!.rawMessage.count({ where: { ...scope, parseReason: 'NO_RULE' } })).toBe(3);
      expect(await db!.transaction.count({ where: { memberId: { in: visible } } })).toBe(0);
      const pattern = `^${prefix} (?<kind>APPROVAL|CANCELLATION) (?<amount>\\d+) (?<date>[^ ]+) (?<merchant>.+)$`;
      const input = {
        issuer: prefix,
        action: 'PARSE',
        priority: 1,
        isActive: true,
        matchPattern: pattern,
        extractPattern: pattern,
        fieldMap: {
          amount: { type: 'money', from: 'amount' },
          txType: { type: 'text', from: 'kind' },
          approvedAt: { type: 'datetime_iso', from: 'date' },
          merchant: { type: 'text', from: 'merchant' },
          cardToken: { type: 'const', value: '1234' },
        },
        sampleText: old.body,
        sampleReceivedAt: old.receivedAt.toISOString(),
        confirmed: true,
      };
      await expect(saveRule(session, input, db!)).rejects.toThrow('관리자 웹');
      const rule = await saveRule(admin, input, db!);
      ruleIds.push(rule.id);
      const reprocess = async (status?: string) => {
        const preview = await createPreview(session, status ? { status } : {}, db!);
        expect(await advanceRun(foreign, preview.id, db!)).toBeNull();
        await advanceRun(session, preview.id, db!);
        const summary = runSummary(
          await db!.reprocessingRun.findUniqueOrThrow({ where: { id: preview.id } }),
        );
        await expect(applyPreview(foreign, preview.id, false, db!)).rejects.toThrow();
        const apply = await applyPreview(session, preview.id, false, db!);
        expect((await applyPreview(session, preview.id, false, db!)).id).toBe(apply.id);
        await advanceRun(session, apply.id, db!);
        await settle();
        return summary;
      };
      expect((await reprocess('FAILED')).wouldFix).toBe(3);
      expect(
        await db!.transaction.findFirst({
          where: { memberId: { in: visible }, rawMessageId: old.id },
        }),
      ).toMatchObject({ amount: 10000, canceledAmount: 2500, state: 'CONFIRMED' });
      await saveManualTransaction(
        session,
        {
          rawId: manual.id,
          amount: 7000,
          approvedAt: '2026-08-12T12:00',
          merchantName: '가공수동수정',
          txType: 'APPROVAL',
        },
        db!,
      );
      await make('APPROVAL', 12000, '20', '가공신규상점');
      await make('CANCELLATION', 2000, '21', '가공신규상점');
      await settle(); // Scheduled processing path: no send/reprocess action for new arrivals.
      const originals = () =>
        db!.rawMessage.findMany({
          where: scope,
          orderBy: { id: 'asc' },
          select: {
            id: true,
            body: true,
            title: true,
            receivedAt: true,
            source: true,
            dedupeHash: true,
          },
        });
      const before = await originals();
      const manualBefore = await db!.transaction.findFirstOrThrow({
        where: { memberId: { in: visible }, rawMessageId: manual.id },
      });
      for (let pass = 0; pass < 2; pass++) {
        expect((await reprocess()).skippedManual).toBe(1);
        const approvals = await db!.transaction.findMany({
          where: { memberId: { in: visible }, txType: 'APPROVAL', state: 'CONFIRMED' },
        });
        expect(approvals.reduce((sum, row) => sum + row.amount! - row.canceledAmount, 0)).toBe(
          24500,
        );
        expect(await db!.transaction.count({ where: { memberId: { in: visible } } })).toBe(5);
        expect(
          await db!.transaction.findFirstOrThrow({
            where: { memberId: { in: visible }, rawMessageId: manual.id },
          }),
        ).toEqual(manualBefore);
        expect(await originals()).toEqual(before);
      }
      expect(await queueRawIds(session, [hidden.id], db!)).toBe(0);
      expect(
        await db!.rawMessage.findFirst({
          where: { ...(await visibleRawWhere(foreign)), id: hidden.id },
        }),
      ).toMatchObject({ parseStatus: 'PENDING', processedAt: null });
      expect(
        await db!.transaction.count({
          where: { memberId: { in: await visibleMemberIds(foreign) } },
        }),
      ).toBe(0);
    }, 30000);
  },
);
