import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, it, expect, vi } from 'vitest';
import { evaluateAlerts, listAlerts, readAlert } from '@/lib/alerts';
import { subscribe, deliverPush, unsubscribe } from '@/lib/alerts/push';
import { saveBenefitRule } from '@/lib/benefit';
import type { AppSession } from '@/lib/auth/types';
const url =
  process.env.FAMILYCARD_TEST_DATABASE_URL ??
  (process.env.CI ? process.env.DATABASE_URL : undefined);
if (url && !/^\/familycard_(test(?:_\w+)?|verify_\d{8}_\d{6})$/.test(new URL(url).pathname))
  throw new Error('Isolated DB required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }), log: [] })
  : null;
const ownerIds: string[] = [];
afterAll(async () => {
  vi.unstubAllEnvs();
  if (db) {
    await db.webPushSubscription.updateMany({
      where: { memberId: { in: ownerIds } },
      data: { enabled: false },
    });
    await db.device.updateMany({
      where: { memberId: { in: ownerIds } },
      data: { revokedAt: new Date() },
    });
    await db.$disconnect();
  }
});
describe.skipIf(!db)('scoped alerts and optional generic push', () => {
  it('deduplicates silence/drop events, scopes reading and sends only generic payload through a mock', async () => {
    const owner = await db!.familyMember.create({
      data: {
        name: 'synthetic-alert-' + randomUUID(),
        passwordHash: 'unused',
        displayColor: '#123456',
      },
    });
    ownerIds.push(owner.id);
    const session: AppSession = {
        memberId: owner.id,
        name: '',
        role: 'ADMIN',
        scope: 'SELF',
        entrypoint: 'DEVICE',
      },
      foreign = { ...session, memberId: 'nonexistent' };
    await db!.device.create({
      data: {
        memberId: owner.id,
        deviceName: 'synthetic silent',
        tokenHash: 'revoked:' + randomUUID(),
        createdAt: new Date('2026-08-01T00:00:00Z'),
      },
    });
    const card = await db!.card.create({
      data: {
        memberId: owner.id,
        issuer: 'SYNTHETIC',
        nickname: '가공 비공개 카드',
        last4: '1234',
        statementDay: 14,
        cardType: 'CREDIT',
      },
    });
    await saveBenefitRule(
      session,
      {
        cardId: card.id,
        expectedVersion: 0,
        effectiveFrom: '2026-01-01',
        sourceUrl: 'https://example.com/synthetic',
        config: {
          periodType: 'PREV_CALENDAR_MONTH',
          tiers: [{ threshold: 300000, benefitDesc: '가공 혜택', monthlyCap: 10000 }],
          exclusions: [],
          minPerTxAmount: 0,
          cancellationPolicy: 'DEDUCT_FROM_ORIGINAL',
        },
      },
      db!,
    );
    const raw = await db!.rawMessage.create({
      data: {
        ownerMemberId: owner.id,
        source: 'MANUAL',
        originKind: 'MANUAL_ENTRY',
        packageName: 'manual',
        title: '',
        body: 'synthetic alert',
        clientMessageId: randomUUID(),
        dedupeHash: randomUUID(),
        receivedAt: new Date(),
      },
    });
    const approval = await db!.transaction.create({
      data: {
        memberId: owner.id,
        cardId: card.id,
        rawMessageId: raw.id,
        amount: 300000,
        approvedAt: new Date('2026-09-10T00:00:00Z'),
        merchantName: '가공 비공개 가맹점',
        txType: 'APPROVAL',
      },
    });
    const now = new Date('2026-09-26T00:00:00Z');
    await evaluateAlerts(session, now, db!);
    await db!.transaction.update({ where: { id: approval.id }, data: { canceledAmount: 100000 } });
    await evaluateAlerts(session, now, db!);
    await evaluateAlerts(session, now, db!);
    const alerts = await listAlerts(session, db!);
    expect(alerts.map((a) => a.kind).sort()).toEqual([
      'BENEFIT_DROP',
      'BENEFIT_LOW',
      'DEVICE_SILENCE',
    ]);
    expect(await listAlerts(foreign, db!)).toEqual([]);
    await expect(readAlert(foreign, alerts[0]!.id, db!)).rejects.toThrow();
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/' + randomUUID(),
      keys: {
        p256dh: Buffer.alloc(65, 1).toString('base64url'),
        auth: Buffer.alloc(16, 1).toString('base64url'),
      },
    };
    await expect(subscribe(session, subscription, true, db!)).rejects.toThrow();
    const sub = await subscribe(session, subscription, false, db!);
    await db!.webPushSubscription.update({
      where: { id: sub.id },
      data: { lastDeliveredAt: new Date(0) },
    });
    vi.stubEnv('WEB_PUSH_PUBLIC_KEY', 'synthetic');
    vi.stubEnv('WEB_PUSH_PRIVATE_KEY', 'synthetic');
    vi.stubEnv('WEB_PUSH_SUBJECT', 'https://example.com');
    const send = vi.fn().mockResolvedValue({ statusCode: 201, headers: {}, body: '' });
    expect(await deliverPush(session, db!, send)).toBe(1);
    const payload = String(send.mock.calls[0]![1]);
    expect(payload).not.toContain('300000');
    expect(payload).not.toContain(card.nickname);
    expect(payload).not.toContain(approval.merchantName);
    expect(await deliverPush(session, db!, send)).toBe(0);
    await unsubscribe(session, db!);
    expect(
      (await db!.webPushSubscription.findUniqueOrThrow({ where: { id: sub.id } })).enabled,
    ).toBe(false);
    await readAlert(session, alerts[0]!.id, db!);
    expect(
      (await listAlerts(session, db!)).find((a) => a.id === alerts[0]!.id)?.readAt,
    ).not.toBeNull();
  }, 30000);
});
