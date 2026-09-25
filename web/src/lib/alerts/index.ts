import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { visibleMemberIds } from '@/lib/auth/scope';
import type { AppSession } from '@/lib/auth/types';
import { cardEstimate } from '@/lib/benefit';
import { currentKstMonth } from '@/lib/time';
import { shiftedMonth } from '@/lib/analytics';
import { serializable } from '@/lib/database';
import { InputError } from '@/lib/cards';
const DAY = 86400000;
export function benefitAlertKinds(input: {
  now: Date;
  end: Date;
  total: number;
  minimum: number;
  previousThreshold: number | null;
  achievedThreshold: number | null;
  sameRule: boolean;
}) {
  const days = (input.end.getTime() - input.now.getTime()) / DAY;
  return {
    low: days >= 0 && days <= 5 && input.minimum > 0 && input.total * 100 < input.minimum * 80,
    drop:
      input.sameRule &&
      input.previousThreshold !== null &&
      (input.achievedThreshold === null || input.achievedThreshold < input.previousThreshold),
  };
}
async function event(
  tx: Prisma.TransactionClient,
  memberId: string,
  key: string,
  kind: string,
  message: string,
  href: string,
) {
  return tx.alertEvent.upsert({
    where: { memberId_eventKey: { memberId, eventKey: key } },
    create: { memberId, eventKey: key, kind, message, href },
    update: {},
  });
}
export async function evaluateAlerts(
  session: AppSession,
  now = new Date(),
  db: PrismaClient = prisma,
) {
  const visible = await visibleMemberIds(session),
    day = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  const devices = await db.device.findMany({
    where: { memberId: { in: visible }, revokedAt: null },
    select: { id: true, memberId: true, deviceName: true, statusReportedAt: true, createdAt: true },
  });
  for (const d of devices)
    if (now.getTime() - (d.statusReportedAt ?? d.createdAt).getTime() >= 6 * 3600000)
      await event(
        db,
        d.memberId,
        `DEVICE:${d.id}:${day}`,
        'DEVICE_SILENCE',
        `${d.deviceName}: 상태 보고가 6시간 이상 없습니다. 구버전 여부·권한·절전·네트워크를 확인해주세요.`,
        '/collection',
      );
  const cards = await db.card.findMany({
    where: { memberId: { in: visible }, benefitRule: { isNot: null } },
    select: { id: true, memberId: true, nickname: true },
    orderBy: { id: 'asc' },
    take: 51,
  });
  if (cards.length > 50) throw new Error('ALERT_CARD_LIMIT');
  for (const card of cards)
    for (const offset of [-1, 0, 1]) {
      const month = shiftedMonth(currentKstMonth(now), offset);
      await serializable(db, async (tx) => {
        const value = await cardEstimate(session, card.id, month, tx);
        if (!value.configured) return;
        const old = await tx.benefitAlertState.findFirst({
          where: { cardId: card.id, month, card: { memberId: { in: visible } } },
        });
        const achieved = value.result.achieved?.threshold ?? null;
        const kinds = benefitAlertKinds({
          now,
          end: value.range.end,
          total: value.result.total,
          minimum: value.config.tiers[0]?.threshold ?? 0,
          previousThreshold: old?.achievedThreshold ?? null,
          achievedThreshold: achieved,
          sameRule: old?.ruleVersion === value.version,
        });
        if (kinds.low)
          await event(
            tx,
            card.memberId,
            `LOW:${card.id}:${month}:${value.version}`,
            'BENEFIT_LOW',
            `${card.nickname}: 산정 기간 종료가 임박했고 최소 실적 구간의 80% 미만입니다. 추정치이므로 카드사 앱에서 확인해주세요.`,
            `/benefits?cardId=${card.id}&month=${month}`,
          );
        if (kinds.drop)
          await event(
            tx,
            card.memberId,
            `DROP:${card.id}:${month}:${value.version}:${old!.achievedThreshold}`,
            'BENEFIT_DROP',
            `${card.nickname}: 재산정한 실적 추정치가 이전 달성 구간 아래로 내려갔습니다. 취소·수동 보정과 카드사 수치를 확인해주세요.`,
            `/benefits?cardId=${card.id}&month=${month}`,
          );
        await tx.benefitAlertState.upsert({
          where: { cardId_month: { cardId: card.id, month } },
          create: {
            cardId: card.id,
            month,
            ruleVersion: value.version,
            total: BigInt(value.result.total),
            achievedThreshold: achieved,
          },
          update: {
            ruleVersion: value.version,
            total: BigInt(value.result.total),
            achievedThreshold: achieved,
          },
        });
      });
    }
}
export async function listAlerts(session: AppSession, db: PrismaClient = prisma) {
  const visible = await visibleMemberIds(session);
  return db.alertEvent.findMany({
    where: { memberId: { in: visible } },
    include: { member: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}
export async function readAlert(session: AppSession, id: string, db: PrismaClient = prisma) {
  const visible = await visibleMemberIds(session);
  const changed = await db.alertEvent.updateMany({
    where: { id, memberId: { in: visible }, AND: { memberId: session.memberId } },
    data: { readAt: new Date() },
  });
  if (!changed.count) throw new InputError('본인 알림만 확인 처리할 수 있습니다.');
}
