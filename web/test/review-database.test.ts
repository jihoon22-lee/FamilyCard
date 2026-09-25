import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';
import { saveManualTransaction, mergeTransactions, splitEvidence } from '@/lib/review';
import { monthlyTransactions } from '@/lib/transactions';
import { reviewData, reviewCount } from '@/lib/review/query';
import { listCards, saveCard, saveAlias } from '@/lib/cards';
import type { AppSession } from '@/lib/auth/types';
const url =
  process.env.FAMILYCARD_TEST_DATABASE_URL ??
  (process.env.CI ? process.env.DATABASE_URL : undefined);
if (url && !/^\/familycard_(test(?:_\w+)?|verify_\d{8}_\d{6})$/.test(new URL(url).pathname))
  throw new Error('Isolated test DB required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }), log: [] })
  : null;
afterAll(async () => {
  await db?.$disconnect();
});
describe.skipIf(!db)('review decisions with synthetic records retained', () => {
  it('preserves immutable evidence through manual edits, merge/split and rejects other owners', async () => {
    const owner = await db!.familyMember.create({
      data: {
        name: 'synthetic-review-' + randomUUID(),
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
    const otherSession: AppSession = { ...session, memberId: other.id };
    const cardInput = {
      memberId: owner.id,
      issuer: 'SYNTHETIC',
      nickname: '가공 카드',
      last4: '1234',
      cardType: 'CREDIT',
      statementDay: 14,
      isActive: true,
    };
    const card = await saveCard(session, cardInput, db!);
    const foreignCard = await saveCard(otherSession, { ...cardInput, memberId: other.id }, db!);
    expect((await listCards(session, db!)).map((c) => c.id)).toEqual([card.id]);
    await expect(saveCard(session, { ...cardInput, id: foreignCard.id }, db!)).rejects.toThrow();
    await expect(
      saveAlias(session, { cardId: foreignCard.id, token: '1*34' }, db!),
    ).rejects.toThrow();
    await saveAlias(session, { cardId: card.id, token: '1*34', validFrom: '2026-01-01' }, db!);
    const input = {
      memberId: owner.id,
      requestId: randomUUID(),
      cardId: card.id,
      amount: 100000,
      approvedAt: '2026-08-10T11:00',
      merchantName: '가공 가맹점',
      txType: 'APPROVAL',
    };
    const a = await saveManualTransaction(session, input, db!);
    expect((await saveManualTransaction(session, input, db!)).id).toBe(a.id);
    await expect(
      saveManualTransaction(session, { ...input, amount: 90000 }, db!),
    ).rejects.toThrow();
    await expect(
      saveManualTransaction(
        session,
        { ...input, requestId: randomUUID(), cardId: foreignCard.id },
        db!,
      ),
    ).rejects.toThrow();
    const b = await saveManualTransaction(session, { ...input, requestId: randomUUID() }, db!);
    const foreign = await saveManualTransaction(
      otherSession,
      { ...input, memberId: other.id, cardId: foreignCard.id, requestId: randomUUID() },
      db!,
    );
    await expect(
      saveManualTransaction(session, { ...input, rawId: foreign.rawMessageId }, db!),
    ).rejects.toThrow();
    await expect(mergeTransactions(session, a.id, foreign.id, db!)).rejects.toThrow();
    await expect(splitEvidence(session, foreign.rawMessageId, db!)).rejects.toThrow();
    const before = await db!.rawMessage.findMany({
      where: { ownerMemberId: owner.id },
      select: { id: true, body: true, dedupeHash: true, receivedAt: true },
      orderBy: { id: 'asc' },
    });
    await mergeTransactions(session, a.id, b.id, db!);
    expect(await db!.transactionEvidence.count({ where: { transactionId: a.id } })).toBe(2);
    expect((await db!.transaction.findUniqueOrThrow({ where: { id: b.id } })).state).toBe('MERGED');
    // Splitting the representative must reactivate the previous row, not collide with its raw key.
    expect(await splitEvidence(session, a.rawMessageId, db!)).toBe(b.id);
    await mergeTransactions(session, a.id, b.id, db!);
    expect(await splitEvidence(session, b.rawMessageId, db!)).toBe(b.id);
    await mergeTransactions(session, a.id, b.id, db!);
    const cancel = await saveManualTransaction(
      session,
      {
        ...input,
        requestId: randomUUID(),
        amount: 30000,
        txType: 'CANCELLATION',
        approvedAt: '2026-08-12T11:00',
        originalTransactionId: a.id,
      },
      db!,
    );
    expect(cancel.canceledTxId).toBe(a.id);
    expect((await db!.transaction.findUniqueOrThrow({ where: { id: a.id } })).canceledAmount).toBe(
      30000,
    );
    await saveManualTransaction(session, { ...input, rawId: a.rawMessageId, amount: 90000 }, db!);
    expect((await db!.transaction.findUniqueOrThrow({ where: { id: a.id } })).canceledAmount).toBe(
      30000,
    );
    await expect(
      saveManualTransaction(
        session,
        {
          ...input,
          rawId: cancel.rawMessageId,
          amount: 100000,
          txType: 'CANCELLATION',
          approvedAt: '2026-08-12T11:00',
          originalTransactionId: a.id,
        },
        db!,
      ),
    ).rejects.toThrow();
    expect((await db!.transaction.findUniqueOrThrow({ where: { id: cancel.id } })).amount).toBe(
      30000,
    );
    const month = await monthlyTransactions(session, { month: '2026-08' }, db!);
    expect(month.net).toBe(60000);
    expect(month.items).toHaveLength(2);
    expect(month.items.every((t) => t.memberId === owner.id)).toBe(true);
    expect(
      (await monthlyTransactions(session, { month: '2026-08', cardId: foreignCard.id }, db!)).total,
    ).toBe(0);
    expect((await reviewData(session, 1, foreign.rawMessageId, db!)).raws).toEqual([]);
    await db!.rawMessage.update({
      where: { id: foreign.rawMessageId },
      data: { parseStatus: 'FAILED', parseReason: 'NO_RULE' },
    });
    expect(await reviewCount(session, db!)).toBe(0);
    expect(await reviewCount(otherSession, db!)).toBe(1);
    const after = await db!.rawMessage.findMany({
      where: { id: { in: before.map((r) => r.id) } },
      select: { id: true, body: true, dedupeHash: true, receivedAt: true },
      orderBy: { id: 'asc' },
    });
    expect(after).toEqual(before);
    expect(await db!.reviewDecision.count({ where: { memberId: owner.id, action: 'SPLIT' } })).toBe(
      2,
    );
  }, 30000);
});
