import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import { serializable } from '@/lib/database';
import { visibleMemberIds } from './scope';
import type { AppSession } from './types';
import { InputError } from '@/lib/cards';
export async function changePassword(
  session: AppSession,
  current: string,
  next: string,
  db: PrismaClient = prisma,
) {
  if (session.entrypoint !== 'WEB' || !Number.isSafeInteger(session.sessionVersion))
    throw new InputError('웹에서 다시 로그인해주세요.');
  if (
    next.length < 8 ||
    Buffer.byteLength(next, 'utf8') > 72 ||
    Buffer.byteLength(current, 'utf8') > 1024
  )
    throw new InputError('새 비밀번호는 8자 이상, UTF-8 72바이트 이하로 입력해주세요.');
  const visible = await visibleMemberIds(session);
  await serializable(db, async (tx) => {
    const member = await tx.familyMember.findFirst({
      where: {
        id: { in: visible },
        AND: { id: session.memberId },
        sessionVersion: session.sessionVersion,
      },
    });
    if (!member || !(await bcrypt.compare(current, member.passwordHash)))
      throw new InputError('현재 비밀번호를 확인해주세요.');
    await tx.familyMember.update({
      where: { id: member.id },
      data: { passwordHash: await bcrypt.hash(next, 10), sessionVersion: { increment: 1 } },
    });
  });
}
export async function revokeWebSessions(
  session: AppSession,
  memberId: string,
  db: PrismaClient = prisma,
) {
  if (
    session.entrypoint !== 'WEB' ||
    session.role !== 'ADMIN' ||
    session.scope !== 'FAMILY' ||
    !Number.isSafeInteger(session.sessionVersion)
  )
    throw new InputError('관리자 웹에서만 세션을 종료할 수 있습니다.');
  const visible = await visibleMemberIds(session);
  await serializable(db, async (tx) => {
    const actor = await tx.familyMember.findFirst({
      where: {
        id: { in: visible },
        AND: { id: session.memberId },
        role: 'ADMIN',
        sessionVersion: session.sessionVersion,
      },
    });
    if (!actor) throw new InputError('웹에서 다시 로그인해주세요.');
    const result = await tx.familyMember.updateMany({
      where: { id: { in: visible }, AND: { id: memberId } },
      data: { sessionVersion: { increment: 1 } },
    });
    if (!result.count) throw new InputError('구성원을 찾을 수 없습니다.');
    await tx.reviewDecision.create({
      data: {
        memberId,
        actorMemberId: session.memberId,
        action: 'REVOKE_WEB_SESSIONS',
        entityId: memberId,
      },
    });
  });
}
