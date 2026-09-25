import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';
import { saveRule, restoreRule, previewRule, type RuleInput } from '@/lib/parser-rules';
import type { AppSession } from '@/lib/auth/types';
const url =
  process.env.FAMILYCARD_TEST_DATABASE_URL ??
  (process.env.CI ? process.env.DATABASE_URL : undefined);
if (url && !/^\/familycard_(test(?:_\w+)?|verify_\d{8}_\d{6})$/.test(new URL(url).pathname))
  throw new Error('Isolated DB required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }), log: [] })
  : null;
const ids: string[] = [];
afterAll(async () => {
  if (db) {
    await db.parserRule.updateMany({ where: { id: { in: ids } }, data: { isActive: false } });
    await db.$disconnect();
  }
});
describe.skipIf(!db)('rule version persistence', () => {
  it('requires admin web, validates activation and snapshots optimistic versions/rollback', async () => {
    const prefix = 'RULE' + randomUUID().replaceAll('-', '');
    const member = await db!.familyMember.create({
      data: { name: prefix, passwordHash: 'unused', displayColor: '#123456', role: 'ADMIN' },
    });
    const session: AppSession = {
      memberId: member.id,
      name: '',
      role: 'ADMIN',
      scope: 'FAMILY',
      entrypoint: 'WEB',
    };
    const input: RuleInput = {
      issuer: prefix,
      action: 'PARSE',
      priority: 100,
      isActive: false,
      matchPattern: '^' + prefix,
      extractPattern: '^' + prefix + ' (?<amount>[0-9]+)$',
      fieldMap: {
        amount: { type: 'money' },
        txType: { type: 'const', value: 'APPROVAL' },
        approvedAt: { type: 'received_at' },
      },
      sampleText: prefix + ' 12000',
      sampleReceivedAt: '2026-08-01T00:00:00Z',
      confirmed: false,
    };
    await expect(
      saveRule({ ...session, entrypoint: 'DEVICE', scope: 'SELF' }, input, db!),
    ).rejects.toThrow();
    await expect(saveRule(session, { ...input, isActive: true }, db!)).rejects.toThrow();
    await expect(
      saveRule(session, { ...input, isActive: true, confirmed: true, sampleText: 'wrong' }, db!),
    ).rejects.toThrow();
    const rule = await saveRule(session, input, db!);
    ids.push(rule.id);
    expect(rule.version).toBe(1);
    const preview = await previewRule(session, input, db!);
    expect(preview.result.status).toBe('PARSED');
    const active = await saveRule(
      session,
      { ...input, id: rule.id, expectedVersion: 1, isActive: true, confirmed: true },
      db!,
    );
    expect(active.version).toBe(2);
    await expect(
      saveRule(session, { ...input, id: rule.id, expectedVersion: 1 }, db!),
    ).rejects.toThrow();
    const restored = await restoreRule(session, rule.id, 1, 2, db!);
    expect(restored.version).toBe(3);
    expect(restored.isActive).toBe(false);
    expect(await db!.parserRuleRevision.count({ where: { ruleId: rule.id } })).toBe(3);
    expect(await db!.reviewDecision.count({ where: { entityId: rule.id } })).toBe(3);
  }, 30000);
});
