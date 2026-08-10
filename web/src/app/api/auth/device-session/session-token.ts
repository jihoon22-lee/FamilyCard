// 디바이스 세션 쿠키를 직접 인코딩한다.
//
// 왜 signIn()/Credentials provider 를 안 쓰나:
// 이 프로젝트의 유일한 Auth.js provider(web/src/lib/auth/auth.ts)는 이름+
// 비밀번호로만 인증한다. 디바이스 토큰 교환은 비밀번호가 없는 별개의 인증
// 경로라 그 provider 로 로그인할 수 없다. 두 번째 provider 를 추가하려면
// auth.ts 를 고쳐야 하는데, 그 파일은 이 웨이브(B)의 담당 파일 목록 밖이고
// scope 계산이 걸린 핵심 인증 파일이라 손대지 않는다
// (docs/plan/phase2-contract.md §6).
//
// 대신 Auth.js 가 세션 쿠키에 실제로 쓰는 JWT 포맷을 그대로 재사용한다.
// `next-auth/jwt` 의 encode() 는 @auth/core 내부(lib/actions/session.ts)가
// 로그인 시 쓰는 것과 동일한 함수이며, salt(=쿠키 이름)·secret·maxAge 를
// authConfig 와 맞추면 이후 요청에서 auth()/getAppSession() 이 이 쿠키를
// 그대로 정상적으로 읽는다 — config.ts 의 jwt() 콜백은 user 가 없는 요청에서
// 토큰을 그대로 통과시키기만 하므로, 우리가 만든 필드(memberId·memberName·
// role·scope)가 그대로 유지된다.
import { encode } from 'next-auth/jwt';

import { authConfig } from '@/lib/auth/config';
import { scopeForDeviceSession } from '@/lib/auth/scope';
import type { MemberRole, SessionScope } from '@/lib/auth/types';

export interface DeviceSessionMember {
  memberId: string;
  memberName: string;
}

export interface DeviceSessionTokenPayload {
  memberId: string;
  memberName: string;
  role: MemberRole;
  scope: SessionScope;
}

/**
 * 디바이스 세션 쿠키에 넣을 토큰 페이로드.
 *
 * ★★ 불변 규칙 3의 핵심 구현.
 *
 * 파라미터 타입(DeviceSessionMember)에 role 필드가 아예 없다 — 호출하는
 * 쪽이 role 을 조회해 넘기고 싶어도 넘길 자리가 없다. scope 는 항상
 * scopeForDeviceSession() 이 결정하며 그 함수도 인자를 받지 않는다.
 *
 * role 은 AppSession 타입상 필수 필드라 값을 채우긴 해야 하는데, 이 세션은
 * scope 가 이미 SELF 로 고정돼 있어 role 값이 어떤 화면의 가시성도 바꾸지
 * 않는다(visibleMemberIds() 는 scope 만 본다). 그래도 항상 'MEMBER'(최소
 * 권한)를 넣어, 훗날 누군가 실수로 role 을 가시성 판단에 쓰는 코드를
 * 추가하더라도 디바이스 세션에서는 절대 권한이 상승하지 않게 한다.
 *
 * → AGENTS.md 불변 규칙 3, docs/adr/0005-scope-by-entrypoint.md
 */
export function buildDeviceSessionToken(member: DeviceSessionMember): DeviceSessionTokenPayload {
  return {
    memberId: member.memberId,
    memberName: member.memberName,
    role: 'MEMBER',
    scope: scopeForDeviceSession(),
  };
}

export interface EncodedSessionCookie {
  name: string;
  value: string;
  options: {
    httpOnly: boolean;
    sameSite: 'strict' | 'lax' | 'none';
    path: string;
    secure: boolean;
    maxAge: number;
  };
}

/** 디바이스 세션 토큰을 Auth.js 와 호환되는 JWT 쿠키로 인코딩한다. */
export async function encodeDeviceSessionCookie(
  member: DeviceSessionMember,
): Promise<EncodedSessionCookie> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET이 설정되지 않았습니다. web/.env를 확인하세요.');
  }

  const maxAge = authConfig.session.maxAge;

  const jwt = await encode({
    token: buildDeviceSessionToken(member),
    secret,
    // @auth/core 는 세션 쿠키 이름을 salt 로 쓴다(lib/actions/session.ts:
    // `const salt = options.cookies.sessionToken.name`). 다른 값을 쓰면
    // auth() 가 이 쿠키를 복호화하지 못해 세션이 성립하지 않는다.
    salt: authConfig.cookies.sessionToken.name,
    maxAge,
  });

  return {
    name: authConfig.cookies.sessionToken.name,
    value: jwt,
    options: {
      ...authConfig.cookies.sessionToken.options,
      maxAge,
    },
  };
}
