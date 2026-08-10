'use server';

// 기기 등록 · 폐기 Server Actions.
//
// ADMIN 전용. 미들웨어(1차 방어선)가 이미 /family/** 를 scope=FAMILY 로
// 제한하지만, docs/design/07-auth-scope.md "미들웨어는 1차 방어선일
// 뿐입니다" 원칙에 따라 각 액션도 requireFamilyScope() 로 다시 확인한다.
//
// → docs/plan/phase2-contract.md §4
import { revalidatePath } from 'next/cache';

import { prisma } from '@/lib/db';
import { generateDeviceToken, hashDeviceToken } from '@/lib/auth/device';
import { requireFamilyScope } from '@/lib/auth/session';
import { visibleMemberIds } from '@/lib/auth/scope';

const DEVICES_PATH = '/family/devices';

function readField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

export type RegisterDeviceState =
  | { status: 'idle' }
  | { status: 'error'; error: string }
  | { status: 'success'; token: string; deviceName: string; memberName: string };

export async function registerDeviceAction(
  _prevState: RegisterDeviceState,
  formData: FormData,
): Promise<RegisterDeviceState> {
  const session = await requireFamilyScope();

  const memberId = readField(formData, 'memberId');
  const deviceName = readField(formData, 'deviceName').trim();

  if (!memberId || !deviceName) {
    return { status: 'error', error: '구성원과 기기 이름을 모두 입력해주세요.' };
  }

  // 클라이언트가 보낸 memberId 를 그대로 믿지 않는다(AGENTS.md 불변 규칙 2).
  // ADMIN 세션이라 visibleMemberIds() 는 사실상 항상 가족 전원을 돌려주지만,
  // "조회는 반드시 visibleMemberIds 경유"라는 원칙을 화면마다 예외 없이
  // 지킨다.
  const visible = await visibleMemberIds(session);
  const member = visible.includes(memberId)
    ? await prisma.familyMember.findUnique({ where: { id: memberId }, select: { name: true } })
    : null;
  if (!member) {
    return { status: 'error', error: '존재하지 않는 구성원입니다.' };
  }

  const token = generateDeviceToken();
  const tokenHash = hashDeviceToken(token);

  await prisma.device.create({ data: { memberId, deviceName, tokenHash } });

  revalidatePath(DEVICES_PATH);

  // 토큰 원문은 이 반환값에만 담겨 클라이언트에 1회 전달되고, 서버 어디에도
  // 저장하지 않는다(Device.tokenHash 만 영속화됨). 화면을 새로고침하면
  // 다시는 볼 수 없다.
  return { status: 'success', token, deviceName, memberName: member.name };
}

export type RevokeDeviceState = { ok: true } | { ok: false; error: string };

export async function revokeDeviceAction(deviceId: string): Promise<RevokeDeviceState> {
  const session = await requireFamilyScope();

  const visible = await visibleMemberIds(session);
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { memberId: true, revokedAt: true },
  });

  if (!device || !visible.includes(device.memberId)) {
    return { ok: false, error: '존재하지 않는 기기입니다.' };
  }
  if (device.revokedAt) {
    // 이미 폐기된 기기를 다시 누르는 경우 — 멱등하게 성공 처리.
    return { ok: true };
  }

  // Device 를 delete() 하지 않는 이유는 prisma/schema.prisma 의 Device.revokedAt
  // 주석 참고 — RawMessage.device 가 onDelete: Restrict 라 이미 원문을
  // 수집한 기기는 삭제 자체가 FK 제약에 걸려 실패한다. 대신 tokenHash 를
  // sha256 hex 형식이 될 수 없는 sentinel 값으로 덮어써 즉시 무효화한다.
  await prisma.device.update({
    where: { id: deviceId },
    data: { tokenHash: `revoked:${deviceId}`, revokedAt: new Date() },
  });

  revalidatePath(DEVICES_PATH);

  return { ok: true };
}
