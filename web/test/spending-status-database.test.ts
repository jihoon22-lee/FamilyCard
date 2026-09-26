import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, it, expect } from 'vitest';
import { monthlyTransactions } from '@/lib/transactions';
import type { AppSession } from '@/lib/auth/types';
const url =
  process.env.FAMILYCARD_TEST_DATABASE_URL ??
  (process.env.CI ? process.env.DATABASE_URL : undefined);
if (url && !/^\/familycard_(test(?:_\w+)?|verify_\d{8}_\d{6})$/.test(new URL(url).pathname))
  throw Error('isolated required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }), log: [] })
  : null;
afterAll(async () => {
  await db?.$disconnect();
});
describe.skipIf(!db)('unprocessed originals are not zero spending', () => {
  it('distinguishes empty/self pending/ignored originals without leaking another owner', async () => {
    const self = await db!.familyMember.create({
      data: {
        name: 'synthetic-spending-' + randomUUID(),
        passwordHash: 'unused',
        displayColor: '#123456',
      },
    });
    const other = await db!.familyMember.create({
      data: {
        name: 'synthetic-other-' + randomUUID(),
        passwordHash: 'unused',
        displayColor: '#123456',
      },
    });
    const session: AppSession = {
      memberId: self.id,
      name: '',
      role: 'ADMIN',
      entrypoint: 'DEVICE',
      scope: 'SELF',
    };
    const raw = async (ownerMemberId: string) =>
      db!.rawMessage.create({
        data: {
          ownerMemberId,
          source: 'MANUAL',
          originKind: 'MANUAL_ENTRY',
          packageName: 'synthetic',
          title: '',
          body: 'synthetic sample',
          clientMessageId: randomUUID(),
          dedupeHash: randomUUID(),
          receivedAt: new Date('2025-01-01'),
        },
      });
    await raw(other.id);
    expect((await monthlyTransactions(session, { month: '2026-09' }, db!)).status).toEqual({
      state: 'EMPTY',
      unresolvedRaw: 0,
    });
    const original = await raw(self.id);
    const pending = await monthlyTransactions(session, { month: '2026-09' }, db!);
    expect(pending.cards).toHaveLength(0);
    expect(pending.status).toEqual({ state: 'UNAVAILABLE', unresolvedRaw: 1 });
    await db!.rawMessage.update({ where: { id: original.id }, data: { parseStatus: 'FAILED' } });
    expect((await monthlyTransactions(session, { month: '2026-09' }, db!)).status.state).toBe(
      'UNAVAILABLE',
    );
    await db!.rawMessage.update({ where: { id: original.id }, data: { parseStatus: 'IGNORED' } });
    expect((await monthlyTransactions(session, { month: '2026-09' }, db!)).status).toEqual({
      state: 'CALCULATED',
      unresolvedRaw: 0,
    });
  });
});
