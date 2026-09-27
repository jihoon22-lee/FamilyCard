import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';
import { observedCards, observedCardLabel, linkObservedCard } from '@/lib/observed-cards';
import { processBatch } from '@/lib/processing';
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
it('labels observed identifiers without inventing masked digits or a product name', () => {
  expect(observedCardLabel('HANA', '1*2*')).toBe('하나카드 · 1*2*');
  expect(observedCardLabel('KB', '')).toBe('KB국민카드 · 번호 미확인');
});
describe.skipIf(!db)('observed card links', () => {
  it('groups by owner/issuer/token, links history and future, preserves originals/manual decisions and rejects forged scope', async () => {
    const member = async () =>
      db!.familyMember.create({
        data: {
          name: 'synthetic-observed-' + randomUUID(),
          passwordHash: 'unused',
          displayColor: '#123456',
        },
      });
    const owner = await member(),
      other = await member();
    const session: AppSession = {
      memberId: owner.id,
      name: '',
      role: 'ADMIN',
      scope: 'SELF',
      entrypoint: 'DEVICE',
    };
    async function raw(
      ownerMemberId: string,
      body: string,
      title = 'KB Pay',
      source: 'NOTIFICATION' | 'SMS' = 'NOTIFICATION',
    ) {
      return db!.rawMessage.create({
        data: {
          ownerMemberId,
          body,
          title,
          source,
          originKind: source === 'SMS' ? 'SMS_SENDER' : 'CARD_APP',
          packageName: source === 'SMS' ? '15881688' : 'com.kbcard.cxh.appcard',
          clientMessageId: randomUUID(),
          dedupeHash: randomUUID(),
          receivedAt: new Date('2026-09-27T03:00:00Z'),
        },
      });
    }
    const approval = await raw(
      owner.id,
      '[KB Pay 사용 알림] 신용 1234 09/21 12:34 12,000원 가공상점 승인 ',
    );
    const different = await raw(
      owner.id,
      '[KB Pay 사용 알림] 신용 5678 09/21 12:34 9,000원 가공상점 승인 ',
    );
    await raw(
      owner.id,
      '[KB국민카드] 1234 홍*동님 가공상점 09/21 이용건 09/22 부분취소(-3,000원)',
      '',
      'SMS',
    );
    const protectedCancel = await raw(
      owner.id,
      '[KB국민카드] 5678 홍*동님 가공상점 09/21 이용건 09/22 부분취소(-2,000원)',
      '',
      'SMS',
    );
    const foreign = await raw(other.id, approval.body);
    await db!.transaction.create({
      data: {
        memberId: other.id,
        rawMessageId: foreign.id,
        issuer: 'KB',
        cardToken: '1234',
        amount: 99000,
        txType: 'APPROVAL',
        merchantName: '다른 구성원 가공거래',
        approvedAt: new Date('2026-09-21T03:34:00Z'),
      },
    });
    expect((await processBatch(session, 100, db!)).failed).toBe(0);
    const before = await monthlyTransactions(session, { month: '2026-09' }, db!);
    expect(before.observedTotals.map((t) => [t.token, t.net]).sort()).toEqual([
      ['1234', 9000],
      ['5678', 7000],
    ]);
    expect((await observedCards(session, db!)).map((g) => g.memberId)).toEqual([
      owner.id,
      owner.id,
    ]);
    expect(
      (await monthlyTransactions(session, { month: '2026-09', issuer: 'KB', token: '1234' }, db!))
        .net,
    ).toBe(9000);
    expect(
      (
        await monthlyTransactions(
          session,
          { month: '2026-09', issuer: 'KB', token: '1234', memberId: other.id },
          db!,
        )
      ).items,
    ).toHaveLength(0);
    const manual = await db!.transaction.update({
      where: { rawMessageId: different.id },
      data: { isManuallyEdited: true },
    });
    const card = await db!.card.create({
      data: {
        memberId: owner.id,
        issuer: 'KB',
        nickname: '가공 실제 카드',
        last4: '1234',
        cardType: 'CREDIT',
        statementDay: 14,
      },
    });
    const otherCard = await db!.card.create({
      data: {
        memberId: other.id,
        issuer: 'KB',
        nickname: '다른 구성원 카드',
        last4: '1234',
        cardType: 'CREDIT',
        statementDay: 14,
      },
    });
    const wrongIssuer = await db!.card.create({
      data: {
        memberId: owner.id,
        issuer: 'HANA',
        nickname: '다른 카드사',
        last4: '1234',
        cardType: 'CREDIT',
        statementDay: 14,
      },
    });
    const input = { memberId: owner.id, issuer: 'KB', token: '1234', cardId: card.id };
    await expect(
      linkObservedCard(session, { ...input, memberId: other.id, cardId: otherCard.id }, db!),
    ).rejects.toThrow();
    await expect(
      linkObservedCard(session, { ...input, cardId: otherCard.id }, db!),
    ).rejects.toThrow();
    await expect(
      linkObservedCard(session, { ...input, cardId: wrongIssuer.id }, db!),
    ).rejects.toThrow();
    await expect(linkObservedCard(session, { ...input, token: '' }, db!)).rejects.toThrow();
    expect(await linkObservedCard(session, input, db!)).toEqual({ linked: 2, skipped: 0 });
    const conflictCard = await db!.card.create({
      data: {
        memberId: owner.id,
        issuer: 'KB',
        nickname: '가공 충돌 카드',
        last4: '7777',
        cardType: 'CREDIT',
        statementDay: 14,
      },
    });
    await expect(
      linkObservedCard(session, { ...input, cardId: conflictCard.id }, db!),
    ).rejects.toThrow('이미 다른 카드');
    const after = await monthlyTransactions(session, { month: '2026-09' }, db!);
    expect(after.net).toBe(before.net);
    expect(after.totals.find((t) => t.cardId === card.id)?.net).toBe(9000);
    expect(after.observedTotals.map((t) => t.token)).toEqual(['5678']);
    expect(await db!.rawMessage.findUnique({ where: { id: approval.id } })).toMatchObject({
      body: approval.body,
      title: approval.title,
      receivedAt: approval.receivedAt,
    });
    expect(await db!.rawMessage.findUnique({ where: { id: foreign.id } })).toMatchObject({
      parseStatus: 'PENDING',
    });
    expect(await linkObservedCard(session, { ...input, token: '5678' }, db!)).toEqual({
      linked: 0,
      skipped: 2,
    });
    expect(await db!.transaction.findUnique({ where: { id: manual.id } })).toMatchObject({
      cardId: null,
      isManuallyEdited: true,
      canceledAmount: 2000,
    });
    expect(
      await db!.transaction.findUnique({ where: { rawMessageId: protectedCancel.id } }),
    ).toMatchObject({ cardId: null, canceledTxId: manual.id });
    const next = await raw(
      owner.id,
      '[KB Pay 사용 알림] 신용 1234 09/26 12:34 7,000원 가공미래상점 승인 ',
    );
    expect((await processBatch(session, 100, db!)).failed).toBe(0);
    expect(await db!.transaction.findUnique({ where: { rawMessageId: next.id } })).toMatchObject({
      cardId: card.id,
      state: 'CONFIRMED',
    });
  });
});
