import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';
import { processBatch, queueRawIds } from '@/lib/processing';
import { saveManualTransaction } from '@/lib/review';
import { monthlyTransactions } from '@/lib/transactions';
import { observedRules } from '@/lib/parser/observed-rules';
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
describe.skipIf(!db)('automatic spending before card registration', () => {
  it('counts primary evidence once, projects partial cancellations, scopes owners, and replays without drift', async () => {
    const rules = await db!.parserRule.findMany({
      where: { id: { in: observedRules.map((r) => r.id) } },
    });
    expect(rules).toHaveLength(observedRules.length);
    for (const rule of rules)
      expect(rule.fieldMap).toEqual(observedRules.find((r) => r.id === rule.id)!.fieldMap);
    const member = await db!.familyMember.create({
      data: {
        name: 'synthetic-auto-' + randomUUID(),
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
      memberId: member.id,
      name: '',
      role: 'ADMIN',
      scope: 'SELF',
      entrypoint: 'DEVICE',
    };
    const ids: string[] = [];
    async function raw(
      body: string,
      title: string,
      packageName: string,
      at: string,
      ownerMemberId = member.id,
    ) {
      const row = await db!.rawMessage.create({
        data: {
          ownerMemberId,
          body,
          title,
          packageName,
          source: packageName === '15881688' ? 'SMS' : 'NOTIFICATION',
          originKind:
            packageName === '15881688'
              ? 'SMS_SENDER'
              : packageName === 'viva.republica.toss'
                ? 'PAYMENT_APP'
                : 'CARD_APP',
          receivedAt: new Date(at),
          clientMessageId: randomUUID(),
          dedupeHash: randomUUID(),
        },
      });
      if (ownerMemberId === member.id) ids.push(row.id);
      return row;
    }
    const body = '[KB Pay 사용 알림] 신용 1234 09/21 12:34 12,000원 가공 상점 승인 ';
    const foreign = await raw(
      body,
      'KB Pay',
      'com.kbcard.cxh.appcard',
      '2026-09-21T03:34:10Z',
      other.id,
    );
    const secondary = await raw(
      'KB국민카드 | 가공 상점(일시불)',
      '12,000원 결제',
      'viva.republica.toss',
      '2026-09-21T03:34:11Z',
    );
    await queueRawIds(session, [secondary.id, foreign.id], db!);
    expect(await processBatch(session, 100, db!)).toEqual({ processed: 1, failed: 0 });
    expect((await monthlyTransactions(session, { month: '2026-09' }, db!)).net).toBe(12000);
    const approval = await raw(body, 'KB Pay', 'com.kbcard.cxh.appcard', '2026-09-21T03:34:10Z');
    await raw(body, 'KB Pay', 'com.kbcard.cxh.appcard', '2026-09-21T03:34:10.400Z');
    await raw(
      '[KB국민카드] 1234 홍*동님 가공 상점 09/21 이용건 09/22 부분취소(-3,000원)',
      '',
      '15881688',
      '2026-09-22T03:00:00Z',
    );
    await raw(
      '[KB국민카드] 9999 홍*동님 가공 상점 09/21 이용건 09/22 부분취소(-2,000원)',
      '',
      '15881688',
      '2026-09-22T03:00:00Z',
    );
    await queueRawIds(session, ids, db!);
    expect((await processBatch(session, 100, db!)).failed).toBe(0);
    const summary = await monthlyTransactions(session, { month: '2026-09' }, db!);
    expect(summary.cards).toHaveLength(0);
    expect(summary.net).toBe(9000);
    expect(summary.totals).toEqual([{ cardId: null, count: 1, net: 9000 }]);
    expect(
      await db!.transaction.findUnique({ where: { rawMessageId: approval.id } }),
    ).toMatchObject({ state: 'CONFIRMED', canceledAmount: 3000, cardId: null });
    expect(
      await db!.transaction.findUnique({ where: { rawMessageId: secondary.id } }),
    ).toMatchObject({ state: 'MERGED' });
    expect(await db!.rawMessage.findUnique({ where: { id: foreign.id } })).toMatchObject({
      parseStatus: 'PENDING',
    });
    await queueRawIds(session, ids, db!);
    expect((await processBatch(session, 100, db!)).failed).toBe(0);
    expect((await monthlyTransactions(session, { month: '2026-09' }, db!)).net).toBe(9000);
    expect(await db!.rawMessage.count({ where: { ownerMemberId: member.id } })).toBe(ids.length);
    // A second genuine approval makes the secondary ambiguous; never suppress that primary.
    await raw(
      body.replace('12:34', '12:35'),
      'KB Pay',
      'com.kbcard.cxh.appcard',
      '2026-09-21T03:35:10Z',
    );
    expect((await processBatch(session, 100, db!)).failed).toBe(0);
    expect(
      await db!.transaction.findUnique({ where: { rawMessageId: secondary.id } }),
    ).toMatchObject({
      state: 'REVIEW',
      reviewReason: 'SECONDARY_NOTIFICATION',
      mergedIntoId: null,
    });
    expect((await monthlyTransactions(session, { month: '2026-09' }, db!)).totals[0]?.count).toBe(
      2,
    );
    await saveManualTransaction(
      session,
      {
        rawId: approval.id,
        amount: 12000,
        approvedAt: '2026-09-21T12:34',
        merchantName: '가공 상점',
        txType: 'APPROVAL',
      },
      db!,
    );
    expect((await monthlyTransactions(session, { month: '2026-09' }, db!)).totals[0]?.count).toBe(
      2,
    );
  });
});
