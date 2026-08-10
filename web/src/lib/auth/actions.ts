'use server';

// 로그인 · 가입 · 로그아웃 Server Actions. 반환 형태는 W3 계약(§4)에 고정돼
// 있고 W3-B 의 폼이 그대로 받아 쓴다.
//
// ⚠️ redirect() 는 NEXT_REDIRECT 예외를 **throw** 해서 동작한다. Auth.js 의
// signIn() 도 내부적으로 리다이렉트를 던진다. 그래서 이 파일에서는
//   1) try 블록 안에는 최소한만 넣고
//   2) catch 에서는 AuthError 만 골라 처리한 뒤 나머지는 반드시 **다시 던진다**
//   3) redirect() 호출은 try 블록 **바깥**에 둔다
// 이 규칙을 어기면 리다이렉트가 조용히 삼켜져 "로그인은 됐는데 화면이 안
// 넘어가는" 증상이 된다.
import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { prisma } from '@/lib/db';
import { signIn, signOut } from '@/lib/auth/auth';

export type AuthResult = { ok: true } | { ok: false; error: string };

const MIN_PASSWORD_LENGTH = 8;
const BCRYPT_COST = 10;

// 가족 대시보드 차트에서 구성원을 구분하는 색. 시드가 쓰는 두 색(#2563EB,
// #F97316)에 이어지도록 Tailwind 계열에서 골랐다.
const DISPLAY_COLORS = [
  '#2563EB', // blue-600
  '#F97316', // orange-500
  '#16A34A', // green-600
  '#DB2777', // pink-600
  '#7C3AED', // violet-600
  '#0891B2', // cyan-600
  '#CA8A04', // yellow-600
];

function readField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

export async function signInAction(formData: FormData): Promise<AuthResult> {
  const name = readField(formData, 'name').trim();
  const password = readField(formData, 'password');

  if (!name || !password) {
    return { ok: false, error: '이름과 비밀번호를 입력해주세요.' };
  }

  try {
    await signIn('credentials', { name, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      // 실패 사유를 구분하지 않는다. "그런 이름 없음"과 "비밀번호 틀림"을
      // 나눠 알려주면 계정 존재 여부가 새어나간다.
      return { ok: false, error: '이름 또는 비밀번호가 올바르지 않습니다.' };
    }
    throw error;
  }

  redirect('/');
}

export async function signUpAction(formData: FormData): Promise<AuthResult> {
  const name = readField(formData, 'name').trim();
  const password = readField(formData, 'password');
  const inviteCode = readField(formData, 'inviteCode').trim();

  if (!name || !password || !inviteCode) {
    return { ok: false, error: '이름 · 비밀번호 · 초대 코드를 모두 입력해주세요.' };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.` };
  }

  const expectedInviteCode = process.env.INVITE_CODE;
  if (!expectedInviteCode) {
    // 설정 누락을 "코드가 틀렸다"로 뭉개면 관리자가 원인을 못 찾는다.
    throw new Error('INVITE_CODE 가 설정되지 않았습니다. .env 를 확인하세요.');
  }
  if (inviteCode !== expectedInviteCode) {
    return { ok: false, error: '초대 코드가 올바르지 않습니다.' };
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  try {
    await prisma.$transaction(
      async (tx) => {
        // 첫 가입자가 ADMIN. count() 와 create() 사이에 다른 가입이 끼어들면
        // ADMIN 이 둘 생기므로 Serializable 로 묶는다. 충돌하면 Postgres 가
        // 한쪽을 실패시키고(P2034) 그 사용자는 재시도하면 MEMBER 가 된다.
        const memberCount = await tx.familyMember.count();

        await tx.familyMember.create({
          data: {
            name,
            passwordHash,
            role: memberCount === 0 ? 'ADMIN' : 'MEMBER',
            displayColor: DISPLAY_COLORS[memberCount % DISPLAY_COLORS.length] ?? '#2563EB',
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return { ok: false, error: '이미 사용 중인 이름입니다. 다른 이름을 써주세요.' };
      }
      if (error.code === 'P2034') {
        return { ok: false, error: '다른 가입 요청과 겹쳤습니다. 다시 시도해주세요.' };
      }
    }
    throw error;
  }

  try {
    await signIn('credentials', { name, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      // 계정은 만들어졌으므로 로그인 화면으로 보낸다.
      return { ok: false, error: '계정은 만들어졌습니다. 로그인해주세요.' };
    }
    throw error;
  }

  redirect('/');
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' });
}
