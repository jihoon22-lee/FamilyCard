// 가입 · 로그인 액션 테스트.
//
// 검증 대상은 세 가지다.
//   1. 초대 코드를 통과하지 못하면 계정이 만들어지지 않는다
//   2. 첫 가입자만 ADMIN 이 된다
//   3. 로그인 실패 문구가 계정 존재 여부를 흘리지 않는다
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signIn = vi.fn();
const signOut = vi.fn();
const redirect = vi.fn();
const create = vi.fn();
const count = vi.fn();

// next-auth 본체를 그대로 로드하면 내부에서 `next/server` 를 import 하는데,
// vitest 의 node 환경에서는 그 서브패스가 해석되지 않아 스위트 전체가 죽는다.
// actions.ts 가 이 모듈에서 쓰는 것은 AuthError 하나뿐이라 그것만 대체한다.
// instanceof 검사는 프로덕션 코드와 테스트가 같은 모듈을 보므로 성립한다.
class MockAuthError extends Error {}
vi.mock('next-auth', () => ({ AuthError: MockAuthError }));

vi.mock('@/lib/auth/auth', () => ({
  signIn: (...args: unknown[]) => signIn(...args),
  signOut: (...args: unknown[]) => signOut(...args),
}));

// 실제 redirect() 는 NEXT_REDIRECT 를 throw 하지만, 여기서는 "호출되었는지"만
// 확인하면 되므로 조용한 목으로 대체한다.
vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => redirect(...args),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ familyMember: { count, create } }),
  },
}));

const { signInAction, signUpAction } = await import('@/lib/auth/actions');

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.stubEnv('INVITE_CODE', '우리집초대코드');
  signIn.mockReset();
  redirect.mockReset();
  create.mockReset();
  count.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('signUpAction — 초대 코드', () => {
  it('초대 코드가 틀리면 계정을 만들지 않는다', async () => {
    const result = await signUpAction(
      form({ name: '김하은', password: 'devpassword', inviteCode: '틀린코드' }),
    );

    expect(result).toEqual({ ok: false, error: '초대 코드가 올바르지 않습니다.' });
    expect(create).not.toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('짧은 비밀번호는 거부한다', async () => {
    const result = await signUpAction(
      form({ name: '김하은', password: 'short', inviteCode: '우리집초대코드' }),
    );

    expect(result).toEqual({ ok: false, error: '비밀번호는 8자 이상이어야 합니다.' });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('signUpAction — 첫 가입자가 ADMIN', () => {
  it('구성원이 없으면 ADMIN 으로 만든다', async () => {
    count.mockResolvedValue(0);
    create.mockResolvedValue({ id: 'new-member' });

    await signUpAction(
      form({ name: '김도현', password: 'devpassword', inviteCode: '우리집초대코드' }),
    );

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]?.data?.role).toBe('ADMIN');
  });

  it('이미 구성원이 있으면 MEMBER 로 만든다', async () => {
    count.mockResolvedValue(1);
    create.mockResolvedValue({ id: 'new-member' });

    await signUpAction(
      form({ name: '김하은', password: 'devpassword', inviteCode: '우리집초대코드' }),
    );

    expect(create.mock.calls[0]?.[0]?.data?.role).toBe('MEMBER');
  });

  it('비밀번호를 평문으로 저장하지 않는다', async () => {
    count.mockResolvedValue(0);
    create.mockResolvedValue({ id: 'new-member' });

    await signUpAction(
      form({ name: '김도현', password: 'devpassword', inviteCode: '우리집초대코드' }),
    );

    const saved = create.mock.calls[0]?.[0]?.data;
    expect(saved.passwordHash).not.toBe('devpassword');
    expect(saved.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt 해시 형식
    expect(saved).not.toHaveProperty('password');
  });
});

describe('signInAction', () => {
  it('입력이 비면 DB 나 Auth.js 를 부르지 않는다', async () => {
    const result = await signInAction(form({ name: '', password: '' }));

    expect(result).toEqual({ ok: false, error: '이름과 비밀번호를 입력해주세요.' });
    expect(signIn).not.toHaveBeenCalled();
  });

  it('성공하면 / 로 리다이렉트한다', async () => {
    signIn.mockResolvedValue(undefined);

    await signInAction(form({ name: '김도현', password: 'devpassword' }));

    expect(redirect).toHaveBeenCalledWith('/');
  });

  it('AuthError 는 계정 존재 여부를 흘리지 않는 문구로 바꾼다', async () => {
    signIn.mockRejectedValue(new MockAuthError('CredentialsSignin'));

    const result = await signInAction(form({ name: '없는사람', password: 'whatever' }));

    expect(result).toEqual({ ok: false, error: '이름 또는 비밀번호가 올바르지 않습니다.' });
    expect(redirect).not.toHaveBeenCalled();
  });

  it('AuthError 가 아닌 예외는 삼키지 않고 다시 던진다', async () => {
    // redirect() 의 NEXT_REDIRECT 가 여기 걸려 삼켜지면 "로그인은 됐는데
    // 화면이 안 넘어가는" 증상이 된다.
    signIn.mockRejectedValue(new Error('DB 연결 실패'));

    await expect(signInAction(form({ name: '김도현', password: 'devpassword' }))).rejects.toThrow(
      'DB 연결 실패',
    );
  });
});
