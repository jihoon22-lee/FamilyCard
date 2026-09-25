import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, it, expect } from 'vitest';
import {
  importStatement,
  statementDetail,
  decideStatement,
  type StatementMapping,
} from '@/lib/statements';
import { processBatch, queueRawIds } from '@/lib/processing';
import { saveManualTransaction } from '@/lib/review';
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
describe.skipIf(!db)('statement provenance and reviewed correction', () => {
  it('preserves original file/rows, deduplicates import, scopes decisions and remaps only unlinked rows', async () => {
    const owner = await db!.familyMember.create({
      data: {
        name: 'synthetic-statement-' + randomUUID(),
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
      },
      foreign = { ...session, memberId: 'nonexistent' };
    const card = await db!.card.create({
      data: {
        memberId: owner.id,
        issuer: 'SYNTHETIC',
        nickname: '가공 카드',
        last4: '1234',
        statementDay: 14,
        cardType: 'CREDIT',
      },
    });
    const first = await saveManualTransaction(
      session,
      {
        memberId: owner.id,
        requestId: randomUUID(),
        cardId: card.id,
        amount: 10000,
        approvedAt: '2026-08-10T12:00',
        merchantName: '가공 일치',
        txType: 'APPROVAL',
      },
      db!,
    );
    const mismatch = await saveManualTransaction(
      session,
      {
        memberId: owner.id,
        requestId: randomUUID(),
        cardId: card.id,
        amount: 30000,
        approvedAt: '2026-08-12T12:00',
        merchantName: '가공 차이',
        txType: 'APPROVAL',
      },
      db!,
    );
    const bytes = Buffer.from(
      '날짜,금액,가맹점,다른금액\n2026-08-10,10000,가공 일치,11000\n2026-08-11,20000,가공 누락,21000\n2026-08-12,35000,가공 차이,36000\n잘못된날짜,1,가공 오류,1\n',
    );
    const mapping: StatementMapping = {
      cardId: card.id,
      date: 0,
      amount: 1,
      merchant: 2,
      fixedType: 'APPROVAL',
      amountKind: 'APPROVAL',
      encoding: 'utf-8',
      from: '2026-08-01',
      to: '2026-08-31',
    };
    await expect(
      importStatement(foreign, 'synthetic.csv', bytes, mapping, false, db!),
    ).rejects.toThrow();
    const imported = await importStatement(session, 'synthetic.csv', bytes, mapping, false, db!);
    expect((await importStatement(session, 'synthetic.csv', bytes, mapping, false, db!)).id).toBe(
      imported.id,
    );
    const before = await db!.rawMessage.findMany({
      where: { statementImportId: imported.id },
      select: { id: true, body: true, dedupeHash: true, deviceId: true },
      orderBy: { id: 'asc' },
    });
    expect(before).toHaveLength(4);
    expect(before.every((r) => r.deviceId === null)).toBe(true);
    let detail = await statementDetail(session, imported.id, 1, db!);
    expect(detail.items.map((i) => i.status)).toEqual([
      'MATCH',
      'MISSING',
      'AMOUNT_MISMATCH',
      'INVALID',
    ]);
    await expect(statementDetail(foreign, imported.id, 1, db!)).rejects.toThrow();
    await expect(
      decideStatement(foreign, { rawIds: [detail.items[0]!.raw.id], action: 'LINK' }, db!),
    ).rejects.toThrow();
    await decideStatement(session, { rawIds: [detail.items[0]!.raw.id], action: 'LINK' }, db!);
    expect((await db!.transaction.findUniqueOrThrow({ where: { id: first.id } })).amount).toBe(
      10000,
    );
    await importStatement(session, 'synthetic.csv', bytes, { ...mapping, amount: 3 }, true, db!);
    detail = await statementDetail(session, imported.id, 1, db!);
    expect(detail.items[0]!.fields?.amount).toBe(10000);
    expect(detail.items[1]!.fields?.amount).toBe(21000);
    await expect(
      decideStatement(
        session,
        { rawIds: [detail.items[1]!.raw.id, detail.items[3]!.raw.id], action: 'CREATE' },
        db!,
      ),
    ).rejects.toThrow();
    expect(await db!.transaction.count({ where: { memberId: owner.id } })).toBe(2);
    await decideStatement(session, { rawIds: [detail.items[1]!.raw.id], action: 'CREATE' }, db!);
    await decideStatement(session, { rawIds: [detail.items[1]!.raw.id], action: 'CREATE' }, db!);
    await decideStatement(
      session,
      { rawIds: [detail.items[2]!.raw.id], action: 'CORRECT', targetId: mismatch.id },
      db!,
    );
    await decideStatement(session, { rawIds: [detail.items[3]!.raw.id], action: 'IGNORE' }, db!);
    expect((await db!.transaction.findUniqueOrThrow({ where: { id: mismatch.id } })).amount).toBe(
      36000,
    );
    expect(await db!.transaction.count({ where: { memberId: owner.id } })).toBe(3);
    await queueRawIds(
      session,
      before.map((r) => r.id),
      db!,
    );
    await processBatch(session, 20, db!);
    expect(
      (await statementDetail(session, imported.id, 1, db!)).items.map((i) => i.status),
    ).toEqual(['LINKED', 'LINKED', 'LINKED', 'IGNORED']);
    expect(
      await db!.rawMessage.findMany({
        where: { statementImportId: imported.id },
        select: { id: true, body: true, dedupeHash: true, deviceId: true },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
    expect(
      Buffer.from(
        (await db!.statementImport.findUniqueOrThrow({ where: { id: imported.id } })).originalFile,
      ),
    ).toEqual(bytes);
  }, 30000);
});
