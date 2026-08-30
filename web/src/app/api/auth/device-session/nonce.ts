// 디바이스 세션 교환용 1회용 nonce — 발급·소모.
//
// 저장 위치·형식에 대한 설계 근거는 web/prisma/schema.prisma 의
// DeviceSessionNonce 모델 주석에 정리했다. 요약: 해시로 저장(Device.tokenHash
// 와 같은 이유), consumedAt 으로 1회용을 강제.
//
// → docs/plan/phase2-contract.md §3, docs/design/07-auth-scope.md "세션 교환"
import { createHash, randomBytes } from 'node:crypto';

import { prisma } from '@/lib/db';

const NONCE_BYTES = 32;
const DEFAULT_TTL_SECONDS = 60;

function nonceTtlSeconds(): number {
  const raw = process.env.DEVICE_SESSION_NONCE_TTL;
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_SECONDS;
}

function hashNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

export interface IssuedDeviceSessionNonce {
  nonce: string;
  expiresAt: Date;
}

export interface DeviceSessionNonceOwner {
  deviceId: string;
  memberId: string;
}

/** 디바이스 세션 교환용 nonce 를 발급한다. DB 에는 해시만 저장한다. */
export async function issueDeviceSessionNonce(
  owner: DeviceSessionNonceOwner,
): Promise<IssuedDeviceSessionNonce> {
  // URL 쿼리스트링에 그대로 실리므로 percent-encoding 이 필요 없는 base64url 을 쓴다.
  const nonce = randomBytes(NONCE_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + nonceTtlSeconds() * 1000);

  await prisma.deviceSessionNonce.create({
    data: {
      nonceHash: hashNonce(nonce),
      deviceId: owner.deviceId,
      memberId: owner.memberId,
      expiresAt,
    },
  });

  return { nonce, expiresAt };
}

export interface ConsumedDeviceSessionNonce {
  deviceId: string;
  memberId: string;
}

/**
 * nonce 를 소모한다. 성공하면 그 nonce 는 이후 다시 호출해도 항상 null —
 * "만료됨"과 "이미 씀"을 구분해 알려주지 않는다. 이유를 구분해 알려주면
 * 공격자가 nonce 의 발급 시각이나 유효기간을 추정하는 데 쓸 수 있다
 * (web/src/lib/auth/actions.ts 의 로그인 실패 문구가 계정 존재 여부를
 * 흘리지 않는 것과 같은 이유).
 *
 * 동시성: 같은 nonce 로 두 요청이 동시에 들어와도 한쪽만 성공해야 한다.
 * updateMany 의 WHERE 절에 `consumedAt: null` 을 넣어 단일 UPDATE 문 안에서
 * "아직 안 쓴 것만 소모 처리"를 원자적으로 수행한다 — Postgres 는 이 UPDATE
 * 를 행 단위로 직렬화하므로, 먼저 커밋된 쪽만 조건에 매치되고 나중 쪽은
 * WHERE 가 더 이상 매치되지 않아 count: 0 이 된다. SELECT 로 먼저 확인한 뒤
 * UPDATE 하는 2단계 방식은 그 사이에 경쟁 조건이 생겨 같은 nonce 로 세션이
 * 두 번 발급될 수 있으므로 쓰지 않는다.
 */
export async function consumeDeviceSessionNonce(
  nonce: string,
): Promise<ConsumedDeviceSessionNonce | null> {
  const nonceHash = hashNonce(nonce);

  const { count } = await prisma.deviceSessionNonce.updateMany({
    where: { nonceHash, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });

  if (count === 0) return null;

  // 방금 이 nonceHash 행을 소모 처리했으니(unique 제약이라 최대 1건) 존재가
  // 보장된다. null 이 나오는 건 이 테이블에 없는 삭제 로직이 그 사이 끼어든
  // 경우뿐이라 방어적으로만 처리한다.
  const record = await prisma.deviceSessionNonce.findUnique({
    where: { nonceHash },
    select: { deviceId: true, memberId: true },
  });

  return record ? { deviceId: record.deviceId, memberId: record.memberId } : null;
}
