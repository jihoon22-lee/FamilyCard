import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, it, expect } from 'vitest';
import {
  saveBenefitRule,
  cardEstimate,
  saveEstimateSnapshot,
  type BenefitConfig,
} from '@/lib/benefit';
import { classifyTransaction, saveCategory, learnedCategory } from '@/lib/classification';
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
describe.skipIf(!db)('benefit/classification persistence and scope', () => {
  it('preserves effective versions, manual exclusions and owner-local merchant learning', async () => {
    const owner = await db!.familyMember.create({
      data: {
        name: 'synthetic-benefit-' + randomUUID(),
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
      memberId: owner.id,
      name: '',
      role: 'ADMIN',
      scope: 'SELF',
      entrypoint: 'DEVICE',
    };
    const foreign: AppSession = { ...session, memberId: other.id };
    const card = await db!.card.create({
      data: {
        memberId: owner.id,
        issuer: 'SYNTHETIC',
        last4: '1234',
        nickname: '가공 카드',
        statementDay: 14,
        cardType: 'CREDIT',
      },
    });
    const category = await db!.category.create({
      data: { name: '가공 제외-' + randomUUID(), benefitCode: 'TAX' },
    });
    await expect(saveCategory(session, { name: 'denied' }, db!)).rejects.toThrow();
    const config: BenefitConfig = {
      periodType: 'PREV_CALENDAR_MONTH',
      tiers: [{ threshold: 300000, benefitDesc: '가공 혜택', monthlyCap: 10000 }],
      exclusions: ['TAX'],
      minPerTxAmount: 0,
      cancellationPolicy: 'DEDUCT_FROM_ORIGINAL',
    };
    const input = {
      cardId: card.id,
      expectedVersion: 0,
      effectiveFrom: '2026-01-01',
      sourceUrl: 'https://example.com/synthetic-terms',
      config,
    };
    await expect(saveBenefitRule(foreign, input, db!)).rejects.toThrow();
    await saveBenefitRule(session, input, db!);
    const rows = [];
    for (const memberId of [owner.id, owner.id, other.id]) {
      const raw = await db!.rawMessage.create({
        data: {
          ownerMemberId: memberId,
          source: 'MANUAL',
          originKind: 'MANUAL_ENTRY',
          packageName: 'manual',
          title: '',
          body: 'synthetic benefit',
          clientMessageId: randomUUID(),
          dedupeHash: randomUUID(),
          receivedAt: new Date(),
        },
      });
      rows.push(
        await db!.transaction.create({
          data: {
            memberId,
            cardId: memberId === owner.id ? card.id : null,
            rawMessageId: raw.id,
            amount: 150000,
            merchantName: '가공 가맹점',
            approvedAt: new Date('2026-07-15T00:00:00Z'),
            txType: 'APPROVAL',
            evidence: { create: { rawMessageId: raw.id } },
          },
        }),
      );
    }
    const first = await cardEstimate(session, card.id, '2026-08', db!);
    expect(first.configured && first.result.total).toBe(300000);
    await expect(cardEstimate(foreign, card.id, '2026-08', db!)).rejects.toThrow();
    await expect(
      classifyTransaction(foreign, { id: rows[0]!.id, learn: true }, db!),
    ).rejects.toThrow();
    await classifyTransaction(
      session,
      { id: rows[0]!.id, categoryId: category.id, learn: true },
      db!,
    );
    expect(
      (await db!.transaction.findUniqueOrThrow({ where: { id: rows[1]!.id } })).categoryId,
    ).toBe(category.id);
    expect(
      (await db!.transaction.findUniqueOrThrow({ where: { id: rows[2]!.id } })).categoryId,
    ).toBeNull();
    expect(await learnedCategory(db!, other.id, '가공 가맹점', [owner.id, other.id])).toBeNull();
    await classifyTransaction(
      session,
      { id: rows[0]!.id, categoryId: category.id, benefitOverride: 'INCLUDE', learn: false },
      db!,
    );
    const included = await cardEstimate(session, card.id, '2026-08', db!);
    expect(included.configured && included.result.total).toBe(150000);
    const snapshot = await saveEstimateSnapshot(session, card.id, '2026-08', db!);
    expect(snapshot.ruleVersion).toBe(1);
    expect(
      (await db!.transaction.findUniqueOrThrow({ where: { id: rows[1]!.id } })).excludeReason,
    ).toBe('CATEGORY_TAX');
    await saveBenefitRule(
      session,
      {
        ...input,
        expectedVersion: 1,
        effectiveFrom: '2026-08-01',
        config: { ...config, exclusions: [] },
      },
      db!,
    );
    const historical = await cardEstimate(session, card.id, '2026-08', db!);
    expect(historical.configured && historical.version).toBe(1);
    expect(historical.configured && historical.result.total).toBe(150000);
    const next = await cardEstimate(session, card.id, '2026-09', db!);
    expect(next.configured && next.version).toBe(2);
    await expect(saveBenefitRule(session, { ...input, expectedVersion: 1 }, db!)).rejects.toThrow();
    await saveBenefitRule(
      session,
      {
        ...input,
        expectedVersion: 2,
        effectiveFrom: '2026-09-01',
        config: { ...config, periodType: 'STATEMENT_CYCLE' },
      },
      db!,
    );
    await db!.card.update({ where: { id: card.id }, data: { statementDay: 24 } });
    const fixedCycle = await cardEstimate(session, card.id, '2026-10', db!);
    expect(fixedCycle.configured && fixedCycle.range.end.toISOString()).toBe(
      '2026-10-14T15:00:00.000Z',
    );
    expect(await db!.benefitSnapshot.count({ where: { cardId: card.id } })).toBe(1);
    expect(
      await db!.rawMessage.count({ where: { id: { in: rows.map((t) => t.rawMessageId) } } }),
    ).toBe(3);
  }, 30000);
});
