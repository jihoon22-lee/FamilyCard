import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import { visibleRawWhere } from '@/lib/raw';
import { visibleMemberIds } from '@/lib/auth/scope';
import type { AppSession } from '@/lib/auth/types';

export interface SpendingStatus {
  state: 'EMPTY' | 'UNAVAILABLE' | 'PARTIAL' | 'CALCULATED';
  unresolvedRaw: number;
}
export function spendingStatus(
  rawCount: number,
  unresolvedRaw: number,
  knownApprovals: number,
  needsReview: number,
): SpendingStatus {
  if (knownApprovals === 0) {
    if (unresolvedRaw || needsReview) return { state: 'UNAVAILABLE', unresolvedRaw };
    if (rawCount === 0) return { state: 'EMPTY', unresolvedRaw };
  }
  return { state: unresolvedRaw || needsReview ? 'PARTIAL' : 'CALCULATED', unresolvedRaw };
}
/** Raw receipt time cannot establish the approval month (imports/delayed cancellations).
 * Conservatively disclose unresolved originals across all dates in the selected owner scope.
 * Card registration is deliberately not a condition: it never proves zero spending.
 */
export async function scopedSpendingStatus(
  session: AppSession,
  knownApprovals: number,
  needsReview: number,
  db: PrismaClient = prisma,
  selectedMemberId?: string,
) {
  const visible = await visibleMemberIds(session);
  if (selectedMemberId && !visible.includes(selectedMemberId)) throw new Error('OUT_OF_SCOPE');
  const scope = await visibleRawWhere(session);
  const owner = selectedMemberId
    ? {
        OR: [
          { device: { memberId: selectedMemberId } },
          { deviceId: null, ownerMemberId: selectedMemberId },
        ],
      }
    : {};
  const where = { AND: [scope, owner] };
  const [rawCount, unresolved] = await Promise.all([
    db.rawMessage.count({ where }),
    db.rawMessage.count({
      where: { AND: [scope, owner, { parseStatus: { notIn: ['PARSED', 'IGNORED'] } }] },
    }),
  ]);
  return spendingStatus(rawCount, unresolved, knownApprovals, needsReview);
}
export function spendingLabel(value: number, status: SpendingStatus) {
  return status.state === 'UNAVAILABLE'
    ? '집계 전'
    : status.state === 'EMPTY'
      ? '수집된 내역 없음'
      : `${value.toLocaleString('ko-KR')}원`;
}
