'use client';

import { useActionState } from 'react';

import { signInAction, type AuthResult } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const initialState: AuthResult = { ok: true };

/**
 * 로그인 폼. useActionState로 signInAction의 결과(AuthResult)를 받아
 * 실패 시 한국어 에러 문구를 보여줍니다. 성공 시 리다이렉트는 액션 내부에서 처리됩니다.
 */
export function LoginForm() {
  const [state, formAction, isPending] = useActionState(
    (_prevState: AuthResult, formData: FormData) => signInAction(formData),
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="login-name">이름</Label>
        <Input
          id="login-name"
          name="name"
          type="text"
          autoComplete="username"
          required
          disabled={isPending}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="login-password">비밀번호</Label>
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={isPending}
        />
      </div>

      {!state.ok && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}

      <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={isPending}>
        {isPending ? '로그인 중…' : '로그인'}
      </Button>
    </form>
  );
}
