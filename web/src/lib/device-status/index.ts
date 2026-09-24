import { prisma } from '@/lib/db';
import { visibleMemberIds } from '@/lib/auth/scope';
import type { AppSession } from '@/lib/auth/types';

const COUNTERS = ['versionCode', 'pending', 'rejected'] as const;
const TIMES = [
  'sampledAt',
  'lastQueuedAt',
  'lastUploadAttemptAt',
  'lastUploadAt',
  'rcsAttemptedAt',
  'rcsCompletedThrough',
] as const;
const FLAGS = ['rcsEnabled', 'notificationGranted', 'smsGranted', 'smsReadGranted'] as const;
export type DeviceStatus = Record<(typeof COUNTERS)[number] | (typeof TIMES)[number], number> &
  Record<(typeof FLAGS)[number], boolean> & { protocol: 1 };

export function parseDeviceStatus(input: unknown): DeviceStatus | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const keys = ['protocol', ...COUNTERS, ...TIMES, ...FLAGS];
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    return null;
  if (value.protocol !== 1) return null;
  for (const key of COUNTERS) {
    if (
      typeof value[key] !== 'number' ||
      !Number.isInteger(value[key]) ||
      value[key] < 0 ||
      value[key] > 2_147_483_647
    )
      return null;
  }
  if ((value.versionCode as number) < 1) return null;
  for (const key of TIMES) {
    if (
      typeof value[key] !== 'number' ||
      !Number.isSafeInteger(value[key]) ||
      value[key] < 0 ||
      value[key] > 4_102_444_800_000
    )
      return null;
  }
  for (const key of FLAGS) if (typeof value[key] !== 'boolean') return null;
  return value as DeviceStatus;
}

export function statusFreshness(reportedAt: Date | null, now = new Date()): string {
  if (!reportedAt) return '상태 미수신 · 구버전 또는 아직 보고되지 않음';
  return now.getTime() - reportedAt.getTime() >= 6 * 60 * 60 * 1000
    ? '상태 확인 필요 · 6시간 이상 보고 없음'
    : '최근 상태 보고 있음';
}

export async function fetchDeviceStatuses(session: AppSession) {
  const visible = await visibleMemberIds(session);
  return prisma.device.findMany({
    where: { memberId: { in: visible } },
    select: {
      id: true,
      deviceName: true,
      lastSeenAt: true,
      revokedAt: true,
      statusReportedAt: true,
      statusSnapshot: true,
      member: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}
