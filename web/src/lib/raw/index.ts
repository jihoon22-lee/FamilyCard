import type { Prisma } from '@prisma/client';
import { visibleMemberIds } from '@/lib/auth/scope';
import type { AppSession } from '@/lib/auth/types';

/** A device-bound message never uses an unrelated explicit owner to widen visibility. */
export async function visibleRawWhere(session: AppSession): Promise<Prisma.RawMessageWhereInput> {
  const members = await visibleMemberIds(session);
  return {
    OR: [
      { device: { memberId: { in: members } } },
      { deviceId: null, ownerMemberId: { in: members } },
    ],
  };
}
