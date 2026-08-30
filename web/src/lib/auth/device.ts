// 디바이스 토큰 — 안드로이드 앱이 서버에 자신을 증명하는 유일한 수단.
//
// 발급 화면(B, web/src/app/(family)/family/devices)이 토큰 원문을 1회만 보여주고
// 저장하지 않는다. 서버는 해시만 들고 있다가(Device.tokenHash) 매 요청마다
// 들어온 원문을 해시해 조회한다. DB에는 원문이 없고 SHA-256 결과만 들어가며,
// 256비트 랜덤 토큰이라 비교 시간으로 원문의 접두사를 추측할 수도 없다.
//
// → docs/plan/phase2-contract.md §1, docs/design/02-ingest.md "인증"
import { createHash, randomBytes } from 'node:crypto';

import { prisma } from '@/lib/db';

// 32바이트 = 256비트. 무차별 대입으로 뚫릴 수 없는 여유를 둔다.
const TOKEN_BYTES = 32;

const BEARER_PREFIX = 'Bearer ';
const DEVICE_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

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
 * 토큰 형식이 아니면 DB 조회 전에 거부하고, 폐기 상태도 해시 sentinel에만
 * 의존하지 않고 다시 확인한다.
 */
export async function resolveDevice(
  authorizationHeader: string | null,
): Promise<ResolvedDevice | null> {
  if (!authorizationHeader || !authorizationHeader.startsWith(BEARER_PREFIX)) {
    return null;
  }

  const token = authorizationHeader.slice(BEARER_PREFIX.length).trim();
  if (!DEVICE_TOKEN_PATTERN.test(token)) {
    return null;
  }

  const device = await prisma.device.findUnique({
    where: { tokenHash: hashDeviceToken(token) },
    select: { id: true, memberId: true, revokedAt: true },
  });

  if (!device || device.revokedAt) {
    return null;
  }

  return { deviceId: device.id, memberId: device.memberId };
}
