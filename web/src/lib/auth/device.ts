// 디바이스 토큰 — 안드로이드 앱이 서버에 자신을 증명하는 유일한 수단.
//
// 발급 화면(B, web/src/app/(family)/family/devices)이 토큰 원문을 1회만 보여주고
// 저장하지 않는다. 서버는 해시만 들고 있다가(Device.tokenHash) 매 요청마다
// 들어온 원문을 해시해 조회한다. 문자열을 직접 비교(`===`)하면 앞자리부터
// 다른 요청이 더 빨리 끝나는 타이밍 차이로 토큰을 한 글자씩 추측당할 수
// 있다. findUnique 조회로 상수 시간 비교를 자동으로 얻으므로, 이 파일에는
// 토큰 원문끼리 직접 비교하는 코드를 두지 않는다.
//
// → docs/plan/phase2-contract.md §1, docs/design/02-ingest.md "인증"
import { createHash, randomBytes } from 'node:crypto';

import { prisma } from '@/lib/db';

// 32바이트 = 256비트. 무차별 대입으로 뚫릴 수 없는 여유를 둔다.
const TOKEN_BYTES = 32;

const BEARER_PREFIX = 'Bearer ';

export interface ResolvedDevice {
  deviceId: string;
  memberId: string;
}

/** 32바이트 랜덤 토큰 원문. 발급 시 1회만 화면에 표시하고 저장하지 않는다. */
export function generateDeviceToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

/** 토큰 원문 → 저장용 해시. sha256 hex. */
export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Authorization 헤더에서 기기를 식별한다.
 * 헤더가 없거나 형식이 틀리거나 일치하는 기기가 없으면 null.
 *
 * 해시 조회(findUnique)라 상수 시간 비교가 자동으로 보장된다.
 */
export async function resolveDevice(
  authorizationHeader: string | null,
): Promise<ResolvedDevice | null> {
  if (!authorizationHeader || !authorizationHeader.startsWith(BEARER_PREFIX)) {
    return null;
  }

  const token = authorizationHeader.slice(BEARER_PREFIX.length).trim();
  if (!token) {
    return null;
  }

  const device = await prisma.device.findUnique({
    where: { tokenHash: hashDeviceToken(token) },
    select: { id: true, memberId: true },
  });

  if (!device) {
    return null;
  }

  return { deviceId: device.id, memberId: device.memberId };
}
