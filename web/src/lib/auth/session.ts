// 서버에서 앱 도메인 세션을 얻는 공용 경로.
//
// Auth.js 의 Session 타입을 그대로 UI 로 흘리지 않고 AppSession 으로 좁혀서
// 넘긴다. Auth.js 세션에는 우리가 쓰지 않는 필드(email·image 등)가 섞여 있고,
// 나중에 인증 구현을 바꾸더라도 화면 쪽이 흔들리지 않게 하기 위해서다.
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth/auth';
import { prisma } from '@/lib/db';
import type { AppSession } from '@/lib/auth/types';

/** 세션이 없으면 null. 서버 컴포넌트/라우트 핸들러에서 사용 */
export async function getAppSession(): Promise<AppSession | null> {
  const session = await auth();
  const user = session?.user;

  // 셋 중 하나라도 없으면 우리 도메인 세션으로 성립하지 않는다. 형식이
  // 어긋난 토큰(구버전 쿠키 등)이나 콜백이 돌지 않은 상황을 여기서 거른다.
  // → config.ts 의 readAppTokenFields()
  if (!user?.memberId || !user.role || !user.scope || !user.entrypoint) return null;

  if (user.entrypoint === 'DEVICE') {
    if (!user.deviceId) return null;
    const device = await prisma.device.findUnique({
      where: { id: user.deviceId },
      select: { memberId: true, revokedAt: true },
    });
    if (!device || device.revokedAt || device.memberId !== user.memberId) return null;
  }

  return {
    memberId: user.memberId,
    name: user.name ?? '',
    role: user.role,
    scope: user.scope,
    entrypoint: user.entrypoint,
    ...(user.deviceId ? { deviceId: user.deviceId } : {}),
  };
}

/** 세션이 없으면 /login 으로 redirect. 보호된 페이지에서 사용 */
export async function requireSession(): Promise<AppSession> {
  const session = await getAppSession();
  // redirect() 는 NEXT_REDIRECT 를 throw 해서 동작하므로 아래 return 에
  // 도달하지 않는다. try/catch 로 감싸지 말 것.
  if (!session) redirect('/login');
  return session;
}

/**
 * scope !== 'FAMILY' 이면 / 로 redirect. (family) 그룹에서 사용
 *
 * 미들웨어가 이미 `/family/**` 를 막지만 여기서 한 번 더 검사한다.
 * 미들웨어 matcher 설정 실수 하나로 전부 뚫리면 안 되기 때문이다.
 * → docs/design/07-auth-scope.md "미들웨어는 1차 방어선일 뿐입니다"
 */
export async function requireFamilyScope(): Promise<AppSession> {
  const session = await requireSession();
  if (session.scope !== 'FAMILY') redirect('/');
  return session;
}
