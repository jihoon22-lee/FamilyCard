import { randomUUID } from 'node:crypto';
import webpush from 'web-push';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import { visibleMemberIds } from '@/lib/auth/scope';
import type { AppSession } from '@/lib/auth/types';
import { InputError } from '@/lib/cards';
import { serializable } from '@/lib/database';
export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export function validateSubscription(value: unknown): SubscriptionInput {
  if (!value || typeof value !== 'object') throw new InputError('구독 형식을 확인해주세요.');
  const v = value as Record<string, unknown>;
  if (
    typeof v.endpoint !== 'string' ||
    v.endpoint.length > 2000 ||
    !v.keys ||
    typeof v.keys !== 'object'
  )
    throw new InputError('구독 형식을 확인해주세요.');
  let url: URL;
  try {
    url = new URL(v.endpoint);
  } catch {
    throw new InputError('구독 주소를 확인해주세요.');
  }
  const allowed =
    url.hostname === 'fcm.googleapis.com' ||
    url.hostname === 'updates.push.services.mozilla.com' ||
    url.hostname === 'web.push.apple.com' ||
    url.hostname.endsWith('.notify.windows.com');
  if (
    !allowed ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    url.hash
  )
    throw new InputError('지원하는 브라우저 푸시 주소가 아닙니다.');
  const keys = v.keys as Record<string, unknown>;
  if (
    typeof keys.p256dh !== 'string' ||
    typeof keys.auth !== 'string' ||
    keys.p256dh.length > 100 ||
    keys.auth.length > 30 ||
    !/^[-_A-Za-z0-9]+$/.test(keys.p256dh) ||
    !/^[-_A-Za-z0-9]+$/.test(keys.auth) ||
    Buffer.from(keys.p256dh, 'base64url').length !== 65 ||
    Buffer.from(keys.auth, 'base64url').length !== 16
  )
    throw new InputError('구독 키를 확인해주세요.');
  return { endpoint: url.toString(), keys: { p256dh: keys.p256dh, auth: keys.auth } };
}
export function pushPublicKey() {
  return process.env.WEB_PUSH_PUBLIC_KEY &&
    process.env.WEB_PUSH_PRIVATE_KEY &&
    process.env.WEB_PUSH_SUBJECT
    ? process.env.WEB_PUSH_PUBLIC_KEY
    : null;
}
export async function subscribe(
  session: AppSession,
  value: unknown,
  family: boolean,
  db: PrismaClient = prisma,
) {
  const input = validateSubscription(value),
    visible = await visibleMemberIds(session);
  if (
    family &&
    (session.scope !== 'FAMILY' || session.entrypoint !== 'WEB' || session.role !== 'ADMIN')
  )
    throw new InputError('가족 알림은 관리자 웹에서만 선택할 수 있습니다.');
  return serializable(db, async (tx) => {
    const existing = await tx.webPushSubscription.findFirst({
      where: {
        endpoint: input.endpoint,
        memberId: { in: visible },
        AND: { memberId: session.memberId },
      },
    });
    // Endpoint uniqueness prevents replacing another user's browser subscription even with a guessed endpoint.
    const data = {
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      family,
      enabled: true,
      deviceId: session.deviceId ?? null,
      failures: 0,
    };
    if (existing) return tx.webPushSubscription.update({ where: { id: existing.id }, data });
    if (
      (await tx.webPushSubscription.count({
        where: { memberId: { in: visible }, AND: { memberId: session.memberId }, enabled: true },
      })) >= 10
    )
      throw new InputError('브라우저 구독은 10개까지입니다. 이전 구독을 먼저 꺼주세요.');
    return tx.webPushSubscription.create({
      data: { ...data, memberId: session.memberId, endpoint: input.endpoint },
    });
  });
}
export async function unsubscribe(session: AppSession, db: PrismaClient = prisma) {
  const visible = await visibleMemberIds(session);
  return db.webPushSubscription.updateMany({
    where: { memberId: { in: visible }, AND: { memberId: session.memberId } },
    data: { enabled: false },
  });
}
const PAYLOAD = JSON.stringify({
  title: 'FamilyCard',
  body: '확인할 알림이 있습니다. 로그인해서 확인해주세요.',
  url: '/alerts',
});
export async function deliverPush(
  session: AppSession,
  db: PrismaClient = prisma,
  send: typeof webpush.sendNotification = webpush.sendNotification,
) {
  if (!pushPublicKey()) return 0;
  const visible = await visibleMemberIds(session),
    now = new Date(),
    retryBefore = new Date(now.getTime() - 3600000);
  const subscriptions = await db.webPushSubscription.findMany({
    where: {
      memberId: { in: visible },
      enabled: true,
      failures: { lt: 5 },
      OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: retryBefore } }],
    },
    include: {
      member: { select: { role: true } },
      device: { select: { revokedAt: true, memberId: true } },
    },
    orderBy: { lastAttemptAt: { sort: 'asc', nulls: 'first' } },
    take: 50,
  });
  let sent = 0;
  for (const sub of subscriptions) {
    if (sub.device && (sub.device.revokedAt || sub.device.memberId !== sub.memberId)) continue;
    const owner: AppSession = {
      memberId: sub.memberId,
      name: '',
      role: sub.member.role,
      scope: sub.family && sub.member.role === 'ADMIN' && !sub.deviceId ? 'FAMILY' : 'SELF',
      entrypoint: 'WEB',
    };
    const recipients = await visibleMemberIds(owner);
    const latest = await db.alertEvent.findFirst({
      where: { memberId: { in: recipients }, readAt: null, createdAt: { gt: sub.lastDeliveredAt } },
      orderBy: { createdAt: 'desc' },
    });
    if (!latest) {
      await db.webPushSubscription.updateMany({
        where: { id: sub.id, memberId: { in: visible }, lastAttemptAt: sub.lastAttemptAt },
        data: { lastAttemptAt: now },
      });
      continue;
    }
    const leaseToken = randomUUID();
    const claim = await db.webPushSubscription.updateMany({
      where: {
        id: sub.id,
        memberId: { in: visible },
        enabled: true,
        lastAttemptAt: sub.lastAttemptAt,
        leaseToken: sub.leaseToken,
      },
      data: { lastAttemptAt: now, leaseToken },
    });
    if (!claim.count) continue;
    try {
      const input = validateSubscription({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      });
      await send(input, PAYLOAD, {
        TTL: 3600,
        timeout: 10000,
        topic: 'familycard-status',
        vapidDetails: {
          subject: process.env.WEB_PUSH_SUBJECT!,
          publicKey: process.env.WEB_PUSH_PUBLIC_KEY!,
          privateKey: process.env.WEB_PUSH_PRIVATE_KEY!,
        },
      });
      await db.webPushSubscription.updateMany({
        where: { id: sub.id, memberId: { in: visible }, leaseToken },
        data: { lastDeliveredAt: latest.createdAt, leaseToken: null, failures: 0 },
      });
      sent++;
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : 0;
      await db.webPushSubscription.updateMany({
        where: { id: sub.id, memberId: { in: visible }, leaseToken },
        data: {
          leaseToken: null,
          failures: { increment: 1 },
          ...([404, 410].includes(code) ? { enabled: false } : {}),
        },
      });
      console.error('web_push_delivery_failed');
    }
  }
  return sent;
}
