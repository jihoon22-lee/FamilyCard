import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { changePassword, revokeWebSessions } from '@/lib/auth/account';
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
describe.skipIf(!db)('account security boundary', () => {
  it('requires current password, revokes WEB versions, rejects foreign/self-device administration', async () => {
    const hash = await bcrypt.hash('synthetic-old-password', 10);
    const admin = await db!.familyMember.create({
      data: {
        name: 'synthetic-admin-' + randomUUID(),
        passwordHash: hash,
        role: 'ADMIN',
        displayColor: '#123456',
      },
    });
    const member = await db!.familyMember.create({
      data: {
        name: 'synthetic-member-' + randomUUID(),
        passwordHash: hash,
        displayColor: '#123456',
      },
    });
    const self: AppSession = {
      memberId: member.id,
      name: '',
      role: 'MEMBER',
      entrypoint: 'WEB',
      scope: 'SELF',
      sessionVersion: 0,
    };
    const family: AppSession = { ...self, memberId: admin.id, role: 'ADMIN', scope: 'FAMILY' };
    const device = await db!.device.create({
      data: {
        memberId: member.id,
        deviceName: 'synthetic',
        tokenHash: 'revoked:' + randomUUID(),
        revokedAt: new Date(),
      },
    });
    await expect(changePassword(self, 'wrong', 'synthetic-new-password', db!)).rejects.toThrow();
    await expect(revokeWebSessions(self, admin.id, db!)).rejects.toThrow();
    await expect(
      revokeWebSessions({ ...family, entrypoint: 'DEVICE', scope: 'SELF' }, member.id, db!),
    ).rejects.toThrow();
    await expect(revokeWebSessions({ ...family, scope: 'SELF' }, member.id, db!)).rejects.toThrow();
    await changePassword(self, 'synthetic-old-password', 'synthetic-new-password', db!);
    const changed = await db!.familyMember.findUniqueOrThrow({ where: { id: member.id } });
    expect(changed.sessionVersion).toBe(1);
    expect(await bcrypt.compare('synthetic-new-password', changed.passwordHash)).toBe(true);
    expect(
      (await db!.familyMember.findUniqueOrThrow({ where: { id: admin.id } })).sessionVersion,
    ).toBe(0);
    await expect(
      changePassword(self, 'synthetic-new-password', 'synthetic-next-password', db!),
    ).rejects.toThrow();
    await revokeWebSessions(family, member.id, db!);
    expect(
      (await db!.familyMember.findUniqueOrThrow({ where: { id: member.id } })).sessionVersion,
    ).toBe(2);
    expect(await db!.device.findUniqueOrThrow({ where: { id: device.id } })).toEqual(device);
    await revokeWebSessions(family, admin.id, db!);
    await expect(revokeWebSessions(family, member.id, db!)).rejects.toThrow();
  });
});
