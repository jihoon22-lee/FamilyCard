import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';
import { visibleRawWhere } from '@/lib/raw';

// Integration tests can never point at the live DB. No dotenv auto-loading.
const url =
  process.env.FAMILYCARD_TEST_DATABASE_URL ??
  (process.env.CI ? process.env.DATABASE_URL : undefined);
if (url && !/^\/familycard_(test(?:_\w+)?|verify_\d{8}_\d{6})$/.test(new URL(url).pathname)) {
  throw new Error('Isolated test database required');
}
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }), log: [] })
  : null;
afterAll(async () => {
  await db?.$disconnect();
});

describe.skipIf(!db)('evidence/provenance database invariants (always rolled back)', () => {
  it('preserves multiple sources, last4 collisions and SELF isolation without a fake device', async () => {
    const rollback = new Error('rollback synthetic fixture');
    try {
      await db!.$transaction(async (tx) => {
        const owner = await tx.familyMember.create({
          data: {
            name: 'synthetic-' + randomUUID(),
            passwordHash: 'unused',
            displayColor: '#123456',
          },
        });
        const other = await tx.familyMember.create({
          data: {
            name: 'synthetic-' + randomUUID(),
            passwordHash: 'unused',
            displayColor: '#123456',
          },
        });
        const device = await tx.device.create({
          data: { memberId: owner.id, deviceName: 'synthetic', tokenHash: randomUUID() },
        });
        const rawData = {
          clientMessageId: randomUUID(),
          source: 'MANUAL' as const,
          originKind: 'MANUAL_ENTRY' as const,
          packageName: 'manual',
          title: '',
          body: 'synthetic',
          receivedAt: new Date(),
        };
        const first = await tx.rawMessage.create({
          data: { ...rawData, ownerMemberId: owner.id, dedupeHash: randomUUID() },
        });
        const second = await tx.rawMessage.create({
          data: {
            ...rawData,
            clientMessageId: randomUUID(),
            deviceId: device.id,
            source: 'NOTIFICATION',
            originKind: 'CARD_APP',
            dedupeHash: randomUUID(),
          },
        });
        const foreign = await tx.rawMessage.create({
          data: { ...rawData, ownerMemberId: other.id, dedupeHash: randomUUID() },
        });
        const cards = [];
        for (let i = 0; i < 2; i++)
          cards.push(
            await tx.card.create({
              data: {
                memberId: owner.id,
                issuer: 'TEST',
                last4: '1234',
                nickname: 'synthetic-' + i,
                cardType: 'CREDIT',
                statementDay: 14,
              },
            }),
          );
        expect(cards[0]!.id).not.toBe(cards[1]!.id);
        const transaction = await tx.transaction.create({
          data: {
            rawMessageId: first.id,
            memberId: owner.id,
            amount: null,
            txType: 'APPROVAL',
            approvedAt: new Date(),
            merchantName: 'synthetic',
            foreignAmount: 1234,
            foreignScale: 2,
            currency: 'USD',
            state: 'REVIEW',
          },
        });
        await tx.transactionEvidence.createMany({
          data: [first, second].map((raw) => ({
            transactionId: transaction.id,
            rawMessageId: raw.id,
          })),
        });
        expect(
          await tx.transactionEvidence.count({ where: { transactionId: transaction.id } }),
        ).toBe(2);
        expect(
          await tx.rawMessage.count({ where: { id: { in: [first.id, second.id, foreign.id] } } }),
        ).toBe(3);
        const scope = await visibleRawWhere({
          memberId: owner.id,
          name: '',
          role: 'ADMIN',
          scope: 'SELF',
          entrypoint: 'DEVICE',
        });
        const visible = await tx.rawMessage.findMany({
          where: { ...scope, id: { in: [first.id, second.id, foreign.id] } },
          select: { id: true },
        });
        expect(visible.map((x) => x.id).sort()).toEqual([first.id, second.id].sort());
        // An inconsistent explicit owner on a device message cannot widen scope.
        await tx.rawMessage.update({ where: { id: second.id }, data: { ownerMemberId: other.id } });
        const otherScope = await visibleRawWhere({
          memberId: other.id,
          name: '',
          role: 'MEMBER',
          scope: 'SELF',
          entrypoint: 'WEB',
        });
        expect(await tx.rawMessage.count({ where: { ...otherScope, id: second.id } })).toBe(0);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });
});
