import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  update: vi.fn(),
  visible: vi.fn(),
  find: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  prisma: { device: { updateMany: mocks.update, findMany: mocks.find } },
}));
vi.mock('@/lib/auth/device', () => ({ resolveDevice: mocks.resolve }));
vi.mock('@/lib/auth/scope', () => ({ visibleMemberIds: mocks.visible }));
import { parseDeviceStatus, statusFreshness, fetchDeviceStatuses } from './index';
import { POST } from '@/app/api/device-status/route';

const status = {
  protocol: 1,
  versionCode: 7,
  pending: 0,
  rejected: 0,
  sampledAt: 1_800_000_000_000,
  lastQueuedAt: 0,
  lastUploadAttemptAt: 0,
  lastUploadAt: 0,
  rcsAttemptedAt: 0,
  rcsCompletedThrough: 0,
  rcsEnabled: false,
  notificationGranted: true,
  smsGranted: false,
  smsReadGranted: false,
};
const request = (body: unknown) =>
  new Request('http://localhost/api/device-status', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({ deviceId: 'own-device', memberId: 'self' });
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.find.mockResolvedValue([]);
  mocks.visible.mockResolvedValue(['self']);
});

describe('strict body without private text', () => {
  it('accepts numerical/boolean metadata only', () =>
    expect(parseDeviceStatus(status)).toEqual(status));
  it.each([
    { ...status, body: 'synthetic text' },
    { ...status, deviceId: 'other' },
    { ...status, pending: -1 },
    { ...status, pending: 1.5 },
    { ...status, lastQueuedAt: Infinity },
    { ...status, protocol: 2 },
    { ...status, notificationGranted: 'true' },
    { ...status, versionCode: 0 },
  ])('rejects invalid or extra fields', (value) => {
    expect(parseDeviceStatus(value)).toBeNull();
  });
  it('missing fields do not silently become zero', () =>
    expect(parseDeviceStatus({ protocol: 1 })).toBeNull());
  it('distinguishes old app from delayed report', () => {
    expect(statusFreshness(null)).toContain('상태 미수신');
    const now = new Date('2026-09-25T00:00:00Z');
    expect(statusFreshness(new Date(now.getTime() - 6 * 3600000), now)).toContain('상태 확인 필요');
    expect(statusFreshness(now, now)).toContain('최근 상태 보고');
  });
});

describe('status API device boundary', () => {
  it('writes only token owner and checks revocation at write', async () => {
    expect((await POST(request(status))).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'own-device', memberId: 'self', revokedAt: null },
      data: { statusReportedAt: expect.any(Date), statusSnapshot: status },
    });
  });
  it('unauthenticated request cannot write', async () => {
    mocks.resolve.mockResolvedValue(null);
    expect((await POST(request(status))).status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('device revoked after resolve is rejected', async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    expect((await POST(request(status))).status).toBe(401);
  });
  it('other device identifier rejected without write', async () => {
    expect((await POST(request({ ...status, deviceId: 'other' }))).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('stream cap works without Content-Length', async () => {
    expect((await POST(request({ body: 'x'.repeat(5000) }))).status).toBe(413);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe('status reads remain scoped', () => {
  it.each(['WEB', 'DEVICE'] as const)(
    'SELF %s cannot query others even for ADMIN',
    async (entrypoint) => {
      const session = {
        memberId: 'self',
        name: 'Test',
        role: 'ADMIN' as const,
        scope: 'SELF' as const,
        entrypoint,
      };
      await fetchDeviceStatuses(session);
      expect(mocks.visible).toHaveBeenCalledWith(session);
      expect(mocks.find.mock.calls[0]?.[0].where).toEqual({ memberId: { in: ['self'] } });
      expect(mocks.find.mock.calls[0]?.[0].select).not.toHaveProperty('tokenHash');
    },
  );
  it('FAMILY uses only visibleMemberIds result', async () => {
    mocks.visible.mockResolvedValue(['self', 'member-2']);
    await fetchDeviceStatuses({
      memberId: 'self',
      name: 'Test',
      role: 'ADMIN',
      scope: 'FAMILY',
      entrypoint: 'WEB',
    });
    expect(mocks.find.mock.calls[0]?.[0].where).toEqual({ memberId: { in: ['self', 'member-2'] } });
  });
});
