import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, it, expect } from 'vitest';
import { analytics, reportRows } from '@/lib/analytics';
import { saveBudget } from '@/lib/budgets';
import type { AppSession } from '@/lib/auth/types';
const url =
  process.env.FAMILYCARD_TEST_DATABASE_URL ??
  (process.env.CI ? process.env.DATABASE_URL : undefined);
if (url && !/^\/familycard_(test(?:_\w+)?|verify_\d{8}_\d{6})$/.test(new URL(url).pathname))
  throw new Error('Isolated DB required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }), log: [] })
  : null;
afterAll(async () => {
  await db?.$disconnect();
});
describe.skipIf(!db)('analytics budgets and exports share owner scope', () => {
  it('uses net amounts and prevents forged member IDs or family budgets from phones', async () => {
    const owners = [];
    for (let i = 0; i < 2; i++)
      owners.push(
        await db!.familyMember.create({
          data: {
            name: 'synthetic-analytics-' + randomUUID(),
            passwordHash: 'unused',
            displayColor: '#123456',
          },
        }),
      );
    const session: AppSession = {
        memberId: owners[0]!.id,
        name: '',
        role: 'ADMIN',
        scope: 'SELF',
        entrypoint: 'DEVICE',
      },
      other = { ...session, memberId: owners[1]!.id };
    for (const owner of owners) {
      const raw = await db!.rawMessage.create({
        data: {
          ownerMemberId: owner.id,
          source: 'MANUAL',
          originKind: 'MANUAL_ENTRY',
          packageName: 'manual',
          title: '',
          body: 'synthetic analytics',
          clientMessageId: randomUUID(),
          dedupeHash: randomUUID(),
          receivedAt: new Date(),
          parseStatus: 'FAILED',
        },
      });
      await db!.transaction.create({
        data: {
          memberId: owner.id,
          rawMessageId: raw.id,
          amount: 100000,
          canceledAmount: 30000,
          merchantName: '가공 가맹점',
          approvedAt: new Date('2026-07-31T15:30:00Z'),
          txType: 'APPROVAL',
          evidence: { create: { rawMessageId: raw.id } },
        },
      });
    }
    const input = { memberId: session.memberId, month: '2026-08', amount: 50000 };
    await saveBudget(session, input, db!);
    await expect(saveBudget(session, { ...input, memberId: undefined }, db!)).rejects.toThrow();
    await expect(
      saveBudget(session, { ...input, memberId: other.memberId }, db!),
    ).rejects.toThrow();
    const foreignBudget = await saveBudget(other, { ...input, memberId: other.memberId }, db!);
    await expect(saveBudget(session, { ...input, id: foreignBudget.id }, db!)).rejects.toThrow();
    const self = await analytics(session, { month: '2026-08' }, db!);
    expect(self.total).toBe(70000);
    expect(self.budgets[0]?.over).toBe(20000);
    expect(self.reviewCounts[0]?.count).toBe(1);
    expect(self.members.map((m) => m.id)).toEqual([session.memberId]);
    expect((await reportRows(session, { month: '2026-08' }, db!)).map((t) => t.memberId)).toEqual([
      session.memberId,
    ]);
    await expect(
      reportRows(session, { month: '2026-08', memberId: other.memberId }, db!),
    ).rejects.toThrow();
    await expect(
      analytics(session, { month: '2026-08', memberId: other.memberId }, db!),
    ).rejects.toThrow();
    const admin = { ...session, entrypoint: 'WEB' as const, scope: 'FAMILY' as const };
    expect(
      (await reportRows(admin, { month: '2026-08', memberId: other.memberId }, db!)).map(
        (t) => t.memberId,
      ),
    ).toEqual([other.memberId]);
    expect(
      (await analytics(admin, { month: '2026-08', memberId: other.memberId }, db!)).total,
    ).toBe(70000);
    const memberWeb = { ...session, role: 'MEMBER' as const, entrypoint: 'WEB' as const };
    expect(
      (await reportRows(memberWeb, { month: '2026-08' }, db!)).every(
        (t) => t.memberId === session.memberId,
      ),
    ).toBe(true);
  }, 30000);
});
